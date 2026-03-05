import { Types } from 'mongoose';
import { AuthCache } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { SSEService } from '@services/sse/sse.service';
import { PaymentGatewayService } from '@services/paymentGateway';
import { IPaymentGatewayProvider, ISubscriptionStatus } from '@interfaces/index';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('SubscriptionService - Subscription Updates (Active → Billing/Plan Changes)', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockAuthCache: jest.Mocked<AuthCache>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockSSEService: jest.Mocked<SSEService>;
  let mockSession: any;

  const mockContext = {
    currentuser: {
      sub: new Types.ObjectId().toString(),
      email: 'admin@example.com',
      client: { cuid: 'client123', role: 'super-admin' },
    },
    request: { params: { cuid: 'client123' } },
  };

  beforeEach(() => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };

    mockSubscriptionDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
      startSession: jest.fn().mockResolvedValue(mockSession),
      withTransaction: jest.fn((session, callback) => callback(session)),
    } as any;

    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        accountAdmin: new Types.ObjectId(),
      }),
    } as any;

    mockAuthCache = {
      invalidateCurrentUser: jest.fn().mockResolvedValue({ success: true }),
      client: {
        DEL: jest.fn().mockResolvedValue(1),
      },
    } as any;

    mockSSEService = {
      sendToUser: jest.fn().mockResolvedValue(true),
    } as any;

    mockPaymentGatewayService = {
      updateSubscription: jest.fn().mockResolvedValue({ success: true, data: {} }),
    } as any;

    const mockEmitterService = {
      on: jest.fn(),
      off: jest.fn(),
      emit: jest.fn(),
    } as any;

    subscriptionService = new SubscriptionService({
      subscriptionDAO: mockSubscriptionDAO,
      clientDAO: mockClientDAO,
      authCache: mockAuthCache,
      paymentGatewayService: mockPaymentGatewayService,
      sseService: mockSSEService,
      userDAO: {} as any,
      emitterService: mockEmitterService,
    });
  });

  describe('initSubscriptionPayment - Update Flow (ACTIVE subscription)', () => {
    it('should update billing interval from monthly to annual for active subscription', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billingInterval: 'monthly',
        billing: {
          subscriberId: 'sub_stripe123',
          customerId: 'cus_stripe123',
          planId: 'price_growth_monthly',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        billingInterval: 'annual',
        billing: {
          ...mockSubscription.billing,
          planId: 'price_growth_annual',
        },
      } as any);

      const result = await subscriptionService.initSubscriptionPayment(mockContext as any, {
        priceId: 'price_growth_annual',
        lookUpKey: 'growth_annual',
        billingInterval: 'annual',
      });

      expect(result.success).toBe(true);
      expect(result.data?.checkoutUrl).toBeUndefined(); // No redirect for updates
      expect(result.data?.message).toBe('Subscription updated successfully');

      expect(mockPaymentGatewayService.updateSubscription).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'sub_stripe123',
        'price_growth_annual'
      );

      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            billingInterval: 'annual',
            entitlements: expect.any(Object),
            'billing.planId': 'price_growth_annual',
            'billing.planLookUpKey': 'growth_annual',
          },
        },
        undefined,
        mockSession
      );

      expect(mockSSEService.sendToUser).toHaveBeenCalled();
    });

    it('should handle upgrade from growth to portfolio for active subscription', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          subscriberId: 'sub_stripe123',
          planId: 'price_growth_monthly',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        billing: {
          ...mockSubscription.billing,
          planId: 'price_portfolio_monthly',
        },
      } as any);

      const result = await subscriptionService.initSubscriptionPayment(mockContext as any, {
        priceId: 'price_portfolio_monthly',
        lookUpKey: 'portfolio_monthly',
        billingInterval: 'monthly',
      });

      expect(result.success).toBe(true);
      expect(result.data?.checkoutUrl).toBeUndefined();
      expect(mockPaymentGatewayService.updateSubscription).toHaveBeenCalled();
    });

    it('should throw error if active subscription has no Stripe subscription ID', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          subscriberId: null, // Missing!
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      await expect(
        subscriptionService.initSubscriptionPayment(mockContext as any, {
          priceId: 'price_growth_annual',
          billingInterval: 'annual',
        })
      ).rejects.toThrow('No active Stripe subscription found');

      expect(mockPaymentGatewayService.updateSubscription).not.toHaveBeenCalled();
    });

    it('should throw error for inactive subscriptions', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        status: ISubscriptionStatus.INACTIVE,
        canceledAt: new Date(),
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      await expect(
        subscriptionService.initSubscriptionPayment(mockContext as any, {
          priceId: 'price_growth_annual',
          billingInterval: 'annual',
        })
      ).rejects.toThrow('Cannot update canceled/inactive subscription');
    });

    it('should invalidate billing history cache after update', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          subscriberId: 'sub_stripe123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue(mockSubscription as any);

      await subscriptionService.initSubscriptionPayment(mockContext as any, {
        priceId: 'price_growth_annual',
        billingInterval: 'annual',
      });

      expect(mockAuthCache.client.DEL).toHaveBeenCalledWith('billing_history:client123');
    });
  });
});
