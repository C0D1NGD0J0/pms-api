import { Types } from 'mongoose';
import { AuthCache } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { SSEService } from '@services/sse/sse.service';
import { PaymentGatewayService } from '@services/billing';
import { StripeService } from '@services/external/stripe/stripe.service';
import { IPaymentGatewayProvider, ISubscriptionStatus } from '@interfaces/index';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('SubscriptionService - User-Initiated Cancellation', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockAuthCache: jest.Mocked<AuthCache>;
  let mockStripeService: jest.Mocked<StripeService>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockSSEService: jest.Mocked<SSEService>;
  let mockSession: any;

  const mockContext = {
    currentuser: {
      sub: new Types.ObjectId().toString(),
      uid: 'user123',
      email: 'admin@example.com',
      client: {
        cuid: 'client123',
        role: 'super-admin',
      },
    },
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
      invalidateCurrentUser: jest.fn().mockResolvedValue({ success: true, data: null }),
    } as any;

    mockSSEService = {
      sendToUser: jest.fn().mockResolvedValue(true),
    } as any;

    mockPaymentGatewayService = {
      cancelSubscription: jest.fn().mockResolvedValue({ success: true, data: {} }),
    } as any;

    mockStripeService = {} as any;

    const mockEmitterService = {
      emit: jest.fn(),
      off: jest.fn(),
      on: jest.fn(),
    } as any;

    subscriptionService = new SubscriptionService({
      subscriptionDAO: mockSubscriptionDAO,
      clientDAO: mockClientDAO,
      authCache: mockAuthCache,
      stripeService: mockStripeService,
      billingService: mockPaymentGatewayService,
      sseService: mockSSEService,
      userDAO: {} as any,
      emitterService: mockEmitterService,
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel paid subscription in Stripe and update DB', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          subscriberId: 'sub_stripe123',
          customerId: 'cus_stripe123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        canceledAt: new Date(),
      } as any);

      const result = await subscriptionService.cancelSubscription(mockContext as any);

      expect(result.success).toBe(true);
      expect(mockPaymentGatewayService.cancelSubscription).toHaveBeenCalledWith(
        IPaymentGatewayProvider.STRIPE,
        'sub_stripe123'
      );
      // For paid subscriptions: keeps status ACTIVE until period end, just sets canceledAt
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            canceledAt: expect.any(Date),
          },
        },
        undefined,
        mockSession
      );
      expect(mockSSEService.sendToUser).toHaveBeenCalled();
    });

    it('should cancel free subscription without calling Stripe', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'essential',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          provider: 'none',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.INACTIVE,
        canceledAt: new Date(),
      } as any);

      const result = await subscriptionService.cancelSubscription(mockContext as any);

      expect(result.success).toBe(true);
      expect(mockPaymentGatewayService.cancelSubscription).not.toHaveBeenCalled();
      expect(mockSubscriptionDAO.update).toHaveBeenCalled();
      expect(mockSSEService.sendToUser).toHaveBeenCalled();
    });

    it('should throw error if subscription already canceled', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        status: ISubscriptionStatus.INACTIVE,
        canceledAt: new Date(),
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      await expect(subscriptionService.cancelSubscription(mockContext as any)).rejects.toThrow(
        'Subscription already canceled'
      );

      expect(mockPaymentGatewayService.cancelSubscription).not.toHaveBeenCalled();
      expect(mockSubscriptionDAO.update).not.toHaveBeenCalled();
    });

    it('should throw error if subscription not found', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(subscriptionService.cancelSubscription(mockContext as any)).rejects.toThrow(
        'Subscription not found'
      );
    });

    it('should rollback if Stripe cancellation fails', async () => {
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
      mockPaymentGatewayService.cancelSubscription.mockResolvedValue({
        success: false,
        data: null,
        message: 'Stripe API error',
      });

      await expect(subscriptionService.cancelSubscription(mockContext as any)).rejects.toThrow(
        'Stripe API error'
      );

      expect(mockSubscriptionDAO.update).not.toHaveBeenCalled();
    });
  });
});
