import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { AuthCache, RedisClient } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { Subscription } from '@models/index';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { SSEService } from '@services/sse/sse.service';
import { EventEmitterService } from '@services/eventEmitter';
import { PaymentGatewayService } from '@services/paymentGateway';
import { ISubscriptionStatus } from '@interfaces/subscription.interface';
import { SubscriptionService } from '@services/subscription/subscription.service';

jest.mock('@models/index', () => ({
  Subscription: {
    find: jest.fn(),
  },
}));

describe('SubscriptionService - Webhook Handlers', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockAuthCache: jest.Mocked<AuthCache>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockEmitterService: jest.Mocked<EventEmitterService>;
  let mockSSEService: jest.Mocked<SSEService>;
  let mockSession: any;

  beforeEach(() => {
    mockSession = {
      startTransaction: jest.fn(),
      commitTransaction: jest.fn(),
      abortTransaction: jest.fn(),
      endSession: jest.fn(),
    };

    mockSubscriptionDAO = {
      findFirst: jest.fn(),
      findById: jest.fn(),
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

    mockUserDAO = {
      getUsersByClientId: jest.fn().mockResolvedValue({
        items: [
          { _id: new Types.ObjectId(), email: 'user1@example.com' },
          { _id: new Types.ObjectId(), email: 'user2@example.com' },
        ],
      }),
    } as any;

    mockAuthCache = {
      invalidateCurrentUser: jest.fn().mockResolvedValue({ success: true, data: null }),
    } as any;

    mockSSEService = {
      sendToUser: jest.fn().mockResolvedValue(true),
    } as any;

    mockPaymentGatewayService = {
      getSubscriptionWithItems: jest.fn(),
      getCharge: jest.fn(),
    } as any;
    mockEmitterService = {
      emit: jest.fn(),
      off: jest.fn(),
      on: jest.fn(),
    } as any;

    subscriptionService = new SubscriptionService({
      subscriptionDAO: mockSubscriptionDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      authCache: mockAuthCache,
      paymentGatewayService: mockPaymentGatewayService,
      emitterService: mockEmitterService,
      sseService: mockSSEService,
      propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
    });
  });

  describe('handleSubscriptionCreated', () => {
    it('should link subscriberId when not yet set', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        billing: { customerId: 'cus_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      await subscriptionService.handleSubscriptionCreated({
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test123',
      });

      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({
        'billing.customerId': 'cus_test123',
      });
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        { $set: { 'billing.subscriberId': 'sub_test123' } }
      );
    });

    it('should skip update if subscriberId is already set', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        billing: { customerId: 'cus_test123', subscriberId: 'sub_existing' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      await subscriptionService.handleSubscriptionCreated({
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test123',
      });

      expect(mockSubscriptionDAO.update).not.toHaveBeenCalled();
    });

    it('should return without error when no local subscription found', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(
        subscriptionService.handleSubscriptionCreated({
          stripeCustomerId: 'cus_unknown',
          stripeSubscriptionId: 'sub_test123',
        })
      ).resolves.toBeUndefined();

      expect(mockSubscriptionDAO.update).not.toHaveBeenCalled();
    });
  });

  describe('handleInvoicePaid', () => {
    it('should return early when invoice has no subscription ID', async () => {
      await subscriptionService.handleInvoicePaid({ id: 'in_test', subscription: null });

      expect(mockSubscriptionDAO.findFirst).not.toHaveBeenCalled();
    });

    it('should return early when billing_reason is not subscription_create', async () => {
      await subscriptionService.handleInvoicePaid({
        id: 'in_test',
        subscription: 'sub_test123',
        billing_reason: 'subscription_cycle',
      });

      expect(mockSubscriptionDAO.findFirst).not.toHaveBeenCalled();
    });

    it('should return early when no charge ID is found', async () => {
      await subscriptionService.handleInvoicePaid({
        id: 'in_test',
        subscription: 'sub_test123',
        billing_reason: 'subscription_create',
        latest_charge: null,
        charge: null,
      });

      expect(mockSubscriptionDAO.findFirst).not.toHaveBeenCalled();
    });

    it('should save card details from charge on first payment', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        billing: { subscriberId: 'sub_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockPaymentGatewayService.getCharge = jest.fn().mockResolvedValue({
        success: true,
        data: {
          payment_method_details: {
            card: { last4: '4242', brand: 'visa' },
          },
        },
      });

      await subscriptionService.handleInvoicePaid({
        id: 'in_test123',
        subscription: 'sub_test123',
        billing_reason: 'subscription_create',
        latest_charge: 'ch_test123',
      });

      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({
        'billing.subscriberId': 'sub_test123',
      });
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        { $set: { 'billing.cardLast4': '4242', 'billing.cardBrand': 'visa' } }
      );
    });

    it('should not update when charge has no card details', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        billing: { subscriberId: 'sub_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockPaymentGatewayService.getCharge = jest.fn().mockResolvedValue({
        success: true,
        data: { payment_method_details: {} },
      });

      await subscriptionService.handleInvoicePaid({
        id: 'in_test123',
        subscription: 'sub_test123',
        billing_reason: 'subscription_create',
        latest_charge: 'ch_test123',
      });

      expect(mockSubscriptionDAO.update).not.toHaveBeenCalled();
    });
  });

  describe('handlePaymentFailed', () => {
    it('should mark subscription as inactive when payment fails', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          subscriberId: 'sub_test123',
          customerId: 'cus_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.INACTIVE,
      } as any);

      const result = await subscriptionService.handlePaymentFailed({
        stripeSubscriptionId: 'sub_test123',
        invoiceId: 'in_test123',
        attemptCount: 2,
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({
        'billing.subscriberId': 'sub_test123',
      });
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            status: ISubscriptionStatus.INACTIVE,
          },
        },
        undefined,
        mockSession
      );
      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith('client123');
      expect(mockAuthCache.invalidateCurrentUser).toHaveBeenCalledTimes(1); // Called only for account admin
      expect(mockSSEService.sendToUser).toHaveBeenCalledTimes(1);
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        expect.any(String),
        'client123',
        expect.objectContaining({
          action: 'REFETCH_CURRENT_USER',
          eventType: 'payment_failed',
        }),
        'subscription_update'
      );
    });

    it('should throw error if subscription not found for payment failure', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(
        subscriptionService.handlePaymentFailed({
          stripeSubscriptionId: 'sub_notfound',
          invoiceId: 'in_test123',
        })
      ).rejects.toThrow('Subscription not found');
    });
  });

  describe('handleInvoicePaymentFailed', () => {
    it('should return early when invoice has no subscription ID', async () => {
      await subscriptionService.handleInvoicePaymentFailed({ id: 'in_test', subscription: null });

      expect(mockSubscriptionDAO.findFirst).not.toHaveBeenCalled();
    });

    it('should process subscription invoices by delegating to handlePaymentFailed', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        billing: { subscriberId: 'sub_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.INACTIVE,
      } as any);

      await subscriptionService.handleInvoicePaymentFailed({
        id: 'in_test123',
        subscription: 'sub_test123',
        attempt_count: 1,
      });

      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({
        'billing.subscriberId': 'sub_test123',
      });
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        { $set: { status: ISubscriptionStatus.INACTIVE } },
        undefined,
        mockSession
      );
    });
  });

  describe('handleSubscriptionUpdated', () => {
    it('should update subscription status to active', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.INACTIVE,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        totalMonthlyPrice: 29,
        billing: {
          subscriberId: 'sub_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.ACTIVE,
      } as any);

      mockPaymentGatewayService.getSubscriptionWithItems = jest.fn().mockResolvedValue({
        success: true,
        data: { items: { data: [] } },
      });

      mockAuthCache.client = {
        DEL: jest.fn().mockResolvedValue(1),
      } as unknown as RedisClient;

      const result = await subscriptionService.handleSubscriptionUpdated({
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            status: ISubscriptionStatus.ACTIVE,
            pendingDowngradeAt: null,
          },
        }
      );
      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith('client123');
      expect(mockAuthCache.invalidateCurrentUser).toHaveBeenCalledTimes(1); // Called only for account admin
      expect(mockAuthCache.client.DEL).toHaveBeenCalledWith('billing_history:client123');
      expect(mockSSEService.sendToUser).toHaveBeenCalledTimes(1);
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        expect.any(String),
        'client123',
        expect.objectContaining({
          action: 'REFETCH_CURRENT_USER',
          eventType: 'subscription_updated',
        }),
        'subscription_update'
      );
    });

    it('should update subscription status to inactive when canceled', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        billing: { subscriberId: 'sub_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.INACTIVE,
      } as any);

      const result = await subscriptionService.handleSubscriptionUpdated({
        stripeSubscriptionId: 'sub_test123',
        status: 'canceled',
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            status: ISubscriptionStatus.INACTIVE,
          },
        }
      );
    });

    it('should update billing period end date', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        billing: { subscriberId: 'sub_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue(mockSubscription as any);

      await subscriptionService.handleSubscriptionUpdated({
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
        currentPeriodEnd: 1702592000,
      });

      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            status: ISubscriptionStatus.ACTIVE,
            pendingDowngradeAt: null,
            endDate: new Date(1702592000 * 1000),
          },
        }
      );
    });

    it('should sync seat quantity changes from Stripe', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        billingInterval: 'annual',
        status: ISubscriptionStatus.ACTIVE,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        totalMonthlyPrice: 768,
        billing: {
          subscriberId: 'sub_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe returning subscription with 2 seats
      mockPaymentGatewayService.getSubscriptionWithItems = jest.fn().mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [
              {
                id: 'si_base123',
                price: { lookup_key: 'growth_annual_price' },
                quantity: 1,
              },
              {
                id: 'si_seat123',
                price: { lookup_key: 'growth_seat_annual' },
                quantity: 2,
              },
            ],
          },
        },
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 2,
        additionalSeatsCost: 15.98, // 2 seats * 799 cents / 100 = 15.98
        totalMonthlyPrice: 783.98, // 768 + 15.98
        billing: {
          subscriberId: 'sub_test123',
          seatItemId: 'si_seat123',
        },
      } as any);

      mockAuthCache.client = { DEL: jest.fn().mockResolvedValue(1) } as unknown as RedisClient;

      const result = await subscriptionService.handleSubscriptionUpdated({
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
      });

      expect(result.success).toBe(true);
      expect(mockPaymentGatewayService.getSubscriptionWithItems).toHaveBeenCalledWith(
        expect.any(String),
        'sub_test123'
      );
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        expect.objectContaining({
          $set: expect.objectContaining({
            additionalSeatsCount: 2,
            additionalSeatsCost: 15.98,
            totalMonthlyPrice: 783.98,
            'billing.seatItemId': 'si_seat123',
          }),
        })
      );
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        expect.any(String),
        'client123',
        expect.objectContaining({
          eventType: 'subscription_updated',
          message: expect.stringContaining('Seats: 2'),
        }),
        'subscription_update'
      );
    });

    it('should sync seat removal from Stripe to database', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        billingInterval: 'monthly',
        status: ISubscriptionStatus.ACTIVE,
        additionalSeatsCount: 5,
        additionalSeatsCost: 25,
        totalMonthlyPrice: 54,
        billing: {
          subscriberId: 'sub_test123',
          seatItemId: 'si_seat123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe returning subscription WITHOUT seat item (removed)
      mockPaymentGatewayService.getSubscriptionWithItems = jest.fn().mockResolvedValue({
        success: true,
        data: {
          items: {
            data: [
              {
                id: 'si_base123',
                price: { lookup_key: 'growth_monthly_price' },
                quantity: 1,
              },
            ],
          },
        },
      });

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        additionalSeatsCount: 0,
        additionalSeatsCost: 0,
        totalMonthlyPrice: 29,
      } as any);

      mockAuthCache.client = { DEL: jest.fn().mockResolvedValue(1) } as unknown as RedisClient;

      const result = await subscriptionService.handleSubscriptionUpdated({
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        expect.objectContaining({
          $set: expect.objectContaining({
            additionalSeatsCount: 0,
            additionalSeatsCost: 0,
            totalMonthlyPrice: 29,
          }),
        })
      );
    });

    it('should continue with status update if seat sync fails', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        additionalSeatsCount: 0,
        billing: {
          subscriberId: 'sub_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      // Mock Stripe fetch failure
      mockPaymentGatewayService.getSubscriptionWithItems = jest
        .fn()
        .mockRejectedValue(new Error('Stripe API error'));

      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.ACTIVE,
      } as any);

      mockAuthCache.client = { DEL: jest.fn().mockResolvedValue(1) } as unknown as RedisClient;

      const result = await subscriptionService.handleSubscriptionUpdated({
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
      });

      // Should still succeed with status update
      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.update).toHaveBeenCalled();
    });

    it('should throw error if subscription not found for update', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(
        subscriptionService.handleSubscriptionUpdated({
          stripeSubscriptionId: 'sub_notfound',
          status: 'active',
        })
      ).rejects.toThrow('Subscription not found');
    });
  });

  describe('handleSubscriptionCanceled', () => {
    it('should mark subscription as canceled with timestamp', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        billing: {
          subscriberId: 'sub_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.INACTIVE,
        canceledAt: new Date(1700000000 * 1000),
      } as any);

      const result = await subscriptionService.handleSubscriptionCanceled({
        stripeSubscriptionId: 'sub_test123',
        canceledAt: 1700000000,
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({
        'billing.subscriberId': 'sub_test123',
      });
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            status: ISubscriptionStatus.INACTIVE,
            canceledAt: new Date(1700000000 * 1000),
          },
        },
        undefined,
        mockSession
      );
      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith('client123');
      expect(mockAuthCache.invalidateCurrentUser).toHaveBeenCalledTimes(1); // Called only for account admin
      expect(mockSSEService.sendToUser).toHaveBeenCalledTimes(1);
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        expect.any(String),
        'client123',
        expect.objectContaining({
          action: 'REFETCH_CURRENT_USER',
          eventType: 'subscription_canceled',
        }),
        'subscription_update'
      );
    });

    it('should throw error if subscription not found for cancellation', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(
        subscriptionService.handleSubscriptionCanceled({
          stripeSubscriptionId: 'sub_notfound',
          canceledAt: 1700000000,
        })
      ).rejects.toThrow('Subscription not found');
    });

    it('should throw error if update fails during cancellation', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        billing: { subscriberId: 'sub_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue(null);

      await expect(
        subscriptionService.handleSubscriptionCanceled({
          stripeSubscriptionId: 'sub_test123',
          canceledAt: 1700000000,
        })
      ).rejects.toThrow('Failed to update subscription');
    });
  });

  describe('processExpiredSubscriptions', () => {
    it('should mark expired active subscriptions as inactive', async () => {
      const now = new Date();
      const pastDate = new Date(now.getTime() - 86400000); // 1 day ago

      const expiredSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        endDate: pastDate,
      };

      (Subscription.find as jest.Mock).mockResolvedValue([expiredSubscription]);
      mockSubscriptionDAO.update = jest.fn().mockResolvedValue({
        ...expiredSubscription,
        status: ISubscriptionStatus.INACTIVE,
      });

      await subscriptionService.processExpiredSubscriptions();

      expect(Subscription.find).toHaveBeenCalledWith({
        status: ISubscriptionStatus.ACTIVE,
        endDate: { $lt: expect.any(Date) },
        planName: { $ne: 'essential' },
      });

      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: expiredSubscription._id },
        { $set: { status: ISubscriptionStatus.INACTIVE } }
      );

      expect(mockSSEService.sendToUser).toHaveBeenCalled();
    });

    it('should skip essential plan (free tier)', async () => {
      (Subscription.find as jest.Mock).mockResolvedValue([]);

      await subscriptionService.processExpiredSubscriptions();

      expect(Subscription.find).toHaveBeenCalledWith(
        expect.objectContaining({
          planName: { $ne: 'essential' },
        })
      );
    });

    it('should handle case when no expired subscriptions found', async () => {
      (Subscription.find as jest.Mock).mockResolvedValue([]);

      await subscriptionService.processExpiredSubscriptions();

      expect(Subscription.find).toHaveBeenCalled();
      expect(mockSubscriptionDAO.update).not.toHaveBeenCalled();
      expect(mockSSEService.sendToUser).not.toHaveBeenCalled();
    });
  });
});
