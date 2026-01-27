import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { AuthCache } from '@caching/index';
import { ClientDAO } from '@dao/clientDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { SSEService } from '@services/sse/sse.service';
import { EventEmitterService } from '@services/eventEmitter';
import { PaymentGatewayService } from '@services/paymentGateway';
import { StripeService } from '@services/external/stripe/stripe.service';
import { ISubscriptionStatus } from '@interfaces/subscription.interface';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('SubscriptionService - Webhook Handlers', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockAuthCache: jest.Mocked<AuthCache>;
  let mockStripeService: jest.Mocked<StripeService>;
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

    mockStripeService = {} as any;
    mockPaymentGatewayService = {} as any;
    mockEmitterService = {} as any;

    subscriptionService = new SubscriptionService({
      subscriptionDAO: mockSubscriptionDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      authCache: mockAuthCache,
      stripeService: mockStripeService,
      paymentGatewayService: mockPaymentGatewayService,
      emitterService: mockEmitterService,
      sseService: mockSSEService,
    });
  });

  describe('handlePaymentSuccess', () => {
    it('should activate subscription after successful payment', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.PENDING_PAYMENT,
        paymentGateway: {
          customerId: 'cus_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.ACTIVE,
        paymentGateway: {
          customerId: 'cus_test123',
          subscriberId: 'sub_test123',
        },
        startDate: new Date(1700000000 * 1000),
        endDate: new Date(1702592000 * 1000),
        pendingDowngradeAt: null,
      } as any);

      const result = await subscriptionService.handlePaymentSuccess({
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test123',
        currentPeriodStart: 1700000000,
        currentPeriodEnd: 1702592000,
        clientId: 'client123',
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({
        'paymentGateway.customerId': 'cus_test123',
      });
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            status: ISubscriptionStatus.ACTIVE,
            'paymentGateway.customerId': 'cus_test123',
            'paymentGateway.subscriberId': 'sub_test123',
            pendingDowngradeAt: null,
            startDate: new Date(1700000000 * 1000),
            endDate: new Date(1702592000 * 1000),
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
          eventType: 'subscription_activated',
        }),
        'subscription_update'
      );
    });

    it('should throw error if subscription not found for payment success', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(
        subscriptionService.handlePaymentSuccess({
          stripeCustomerId: 'cus_notfound',
          stripeSubscriptionId: 'sub_test123',
          currentPeriodStart: 1700000000,
          currentPeriodEnd: 1702592000,
          clientId: 'client123',
        })
      ).rejects.toThrow('Subscription not found for customer');
    });
  });

  describe('handleSubscriptionRenewal', () => {
    it('should update billing period for subscription renewal', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        paymentGateway: {
          subscriberId: 'sub_test123',
          customerId: 'cus_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        startDate: new Date(1700000000 * 1000),
        endDate: new Date(1702592000 * 1000),
      } as any);

      const result = await subscriptionService.handleSubscriptionRenewal({
        stripeSubscriptionId: 'sub_test123',
        currentPeriodStart: 1700000000,
        currentPeriodEnd: 1702592000,
      });

      expect(result.success).toBe(true);
      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({
        'paymentGateway.subscriberId': 'sub_test123',
      });
      expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
        { _id: mockSubscription._id },
        {
          $set: {
            startDate: new Date(1700000000 * 1000),
            endDate: new Date(1702592000 * 1000),
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
          eventType: 'subscription_renewed',
        }),
        'subscription_update'
      );
    });

    it('should throw error if subscription not found for renewal', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      await expect(
        subscriptionService.handleSubscriptionRenewal({
          stripeSubscriptionId: 'sub_notfound',
          currentPeriodStart: 1700000000,
          currentPeriodEnd: 1702592000,
        })
      ).rejects.toThrow('Subscription not found');
    });

    it('should throw error if update fails', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        paymentGateway: { subscriberId: 'sub_test123' },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue(null);

      await expect(
        subscriptionService.handleSubscriptionRenewal({
          stripeSubscriptionId: 'sub_test123',
          currentPeriodStart: 1700000000,
          currentPeriodEnd: 1702592000,
        })
      ).rejects.toThrow('Failed to update subscription');
    });
  });

  describe('handlePaymentFailed', () => {
    it('should mark subscription as inactive when payment fails', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.ACTIVE,
        paymentGateway: {
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
        'paymentGateway.subscriberId': 'sub_test123',
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

  describe('handleSubscriptionUpdated', () => {
    it('should update subscription status to active', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'client123',
        planName: 'growth',
        status: ISubscriptionStatus.INACTIVE,
        paymentGateway: {
          subscriberId: 'sub_test123',
        },
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionDAO.update.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.ACTIVE,
      } as any);

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
          },
        }
      );
      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith('client123');
      expect(mockAuthCache.invalidateCurrentUser).toHaveBeenCalledTimes(1); // Called only for account admin
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
        paymentGateway: { subscriberId: 'sub_test123' },
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
        paymentGateway: { subscriberId: 'sub_test123' },
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
            endDate: new Date(1702592000 * 1000),
          },
        }
      );
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
        paymentGateway: {
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
        'paymentGateway.subscriberId': 'sub_test123',
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
        paymentGateway: { subscriberId: 'sub_test123' },
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
});
