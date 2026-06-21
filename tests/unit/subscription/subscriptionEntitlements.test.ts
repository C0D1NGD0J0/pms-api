import { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { SSEService } from '@services/sse/sse.service';
import { ISubscriptionStatus } from '@interfaces/index';
import { SubscriptionController } from '@controllers/index';
import { SubscriptionCache, AuthCache } from '@caching/index';
import { SubscriptionService } from '@services/subscription/subscription.service';
import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import { SubscriptionWebhookService } from '@services/subscription/subscriptionWebhook.service';

/**
 * Tests for the entitlements extraction feature:
 * - SubscriptionCache (get, set, invalidate)
 * - getSubscriptionEntitlements (cache hit, cache miss, cache write)
 * - Webhook invalidation (notifyAccountAdminViaSSE invalidates entitlements cache)
 * - Controller getEntitlements (cuid ownership, response shape)
 */
describe('Subscription Entitlements', () => {
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockSubscriptionCache: jest.Mocked<SubscriptionCache>;
  let mockAuthCache: jest.Mocked<AuthCache>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockSSEService: jest.Mocked<SSEService>;

  const testCuid = 'test-client-123';
  const testUserId = new Types.ObjectId().toString();

  const mockSubscription = {
    _id: new Types.ObjectId(),
    cuid: testCuid,
    planName: 'growth' as const,
    status: ISubscriptionStatus.ACTIVE,
    billingInterval: 'monthly' as const,
    startDate: new Date(),
    endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  };

  const growthFeatures = subscriptionPlanConfig.getConfig('growth').features;

  const expectedEntitlements = {
    plan: {
      name: 'growth',
      status: ISubscriptionStatus.ACTIVE,
      billingInterval: 'monthly',
    },
    entitlements: growthFeatures,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    mockSubscriptionDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
    } as any;

    mockSubscriptionCache = {
      getEntitlements: jest.fn(),
      cacheEntitlements: jest.fn(),
      invalidate: jest.fn(),
    } as any;

    mockAuthCache = {
      invalidateCurrentUser: jest.fn().mockResolvedValue({ success: true, data: null }),
    } as any;

    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        accountAdmin: new Types.ObjectId(testUserId),
      }),
    } as any;

    mockSSEService = {
      sendToUser: jest.fn().mockResolvedValue(true),
    } as any;
  });

  // ── getSubscriptionEntitlements ────────────────────────

  describe('getSubscriptionEntitlements', () => {
    let service: SubscriptionService;

    beforeEach(() => {
      service = new SubscriptionService({
        subscriptionDAO: mockSubscriptionDAO,
        subscriptionCache: mockSubscriptionCache,
        clientDAO: mockClientDAO,
        authCache: mockAuthCache,
        sseService: mockSSEService,
        userDAO: {} as any,
        emitterService: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } as any,
        propertyDAO: {} as any,
        propertyUnitDAO: {} as any,
        paymentProcessorDAO: {} as any,
        paymentGatewayService: {} as any,
        emailQueue: {} as any,
        subscriptionWebhookService: {} as any,
      });
    });

    it('should return cached entitlements on cache hit', async () => {
      mockSubscriptionCache.getEntitlements.mockResolvedValue({
        success: true,
        data: expectedEntitlements as any,
      });

      const result = await service.getSubscriptionEntitlements(testCuid, 'admin');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expectedEntitlements);
      expect(mockSubscriptionCache.getEntitlements).toHaveBeenCalledWith(testCuid);
      expect(mockSubscriptionDAO.findFirst).not.toHaveBeenCalled();
    });

    it('should query DB and cache result on cache miss', async () => {
      mockSubscriptionCache.getEntitlements.mockResolvedValue({
        success: false,
        data: null,
      });
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionCache.cacheEntitlements.mockResolvedValue({ success: true, data: null });

      const result = await service.getSubscriptionEntitlements(testCuid, 'admin');

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data!.plan.name).toBe('growth');
      expect(result.data!.entitlements).toEqual(growthFeatures);
      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalledWith({ cuid: testCuid });
      expect(mockSubscriptionCache.cacheEntitlements).toHaveBeenCalledWith(
        testCuid,
        expect.objectContaining({ plan: expect.objectContaining({ name: 'growth' }) })
      );
    });

    it('should return null when no subscription exists', async () => {
      mockSubscriptionCache.getEntitlements.mockResolvedValue({ success: false, data: null });
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      const result = await service.getSubscriptionEntitlements(testCuid);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
      expect(mockSubscriptionCache.cacheEntitlements).not.toHaveBeenCalled();
    });

    it('should include paymentFlow only for super-admin with pending payment', async () => {
      mockSubscriptionCache.getEntitlements.mockResolvedValue({ success: false, data: null });
      mockSubscriptionDAO.findFirst.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.PENDING_PAYMENT,
        pendingDowngradeAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      } as any);
      mockSubscriptionCache.cacheEntitlements.mockResolvedValue({ success: true, data: null });

      const result = await service.getSubscriptionEntitlements(testCuid, 'super-admin');

      expect(result.data?.paymentFlow).toBeDefined();
      expect(result.data!.paymentFlow!.requiresPayment).toBe(true);
      expect(result.data!.paymentFlow!.reason).toBe('pending_signup');
    });

    it('should NOT include paymentFlow for non-super-admin roles', async () => {
      mockSubscriptionCache.getEntitlements.mockResolvedValue({ success: false, data: null });
      mockSubscriptionDAO.findFirst.mockResolvedValue({
        ...mockSubscription,
        status: ISubscriptionStatus.PENDING_PAYMENT,
      } as any);
      mockSubscriptionCache.cacheEntitlements.mockResolvedValue({ success: true, data: null });

      const result = await service.getSubscriptionEntitlements(testCuid, 'admin');

      expect(result.data?.paymentFlow).toBeUndefined();
    });

    it('should gracefully handle cache write failure', async () => {
      mockSubscriptionCache.getEntitlements.mockResolvedValue({ success: false, data: null });
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockSubscriptionCache.cacheEntitlements.mockRejectedValue(new Error('Redis down'));

      // The service catches the error internally and returns a failure result
      const result = await service.getSubscriptionEntitlements(testCuid, 'admin');

      expect(result.success).toBe(false);
      expect(mockSubscriptionDAO.findFirst).toHaveBeenCalled();
    });
  });

  // ── Webhook cache invalidation ────────────────────────

  describe('Webhook cache invalidation', () => {
    let webhookService: SubscriptionWebhookService;

    beforeEach(() => {
      webhookService = new SubscriptionWebhookService({
        subscriptionDAO: mockSubscriptionDAO,
        subscriptionCache: mockSubscriptionCache,
        clientDAO: mockClientDAO,
        authCache: mockAuthCache,
        sseService: mockSSEService,
        userDAO: {} as any,
        emailQueue: {} as any,
        paymentProcessorDAO: {} as any,
        paymentGatewayService: {} as any,
        subscriptionPlanConfig,
      });
    });

    it('should invalidate entitlements cache when subscription is updated', async () => {
      const updatedSub = {
        ...mockSubscription,
        save: jest.fn().mockResolvedValue(mockSubscription),
      };

      mockSubscriptionDAO.findFirst.mockResolvedValue(updatedSub as any);
      mockSubscriptionDAO.update.mockResolvedValue(updatedSub as any);
      mockSubscriptionCache.invalidate.mockResolvedValue({ success: true, data: null });

      // notifyAccountAdminViaSSE is called by handleSubscriptionUpdated
      // We test the private method indirectly via the public handler
      // The key assertion: invalidate is called with the cuid
      try {
        await (webhookService as any).notifyAccountAdminViaSSE(testCuid, {
          type: 'subscription_updated',
          subscription: { plan: 'growth', status: 'active' },
          message: 'Test',
        });
      } catch {
        // May fail due to incomplete mocks — we only care about the invalidate call
      }

      expect(mockSubscriptionCache.invalidate).toHaveBeenCalledWith(testCuid);
    });
  });

  // ── Controller getEntitlements ─────────────────────────

  describe('SubscriptionController.getEntitlements', () => {
    it('should return entitlements for authenticated user with matching cuid', () => {
      const controller = new SubscriptionController({
        subscriptionService: {} as any,
        smsService: {} as any,
      });

      const mockEntitlements = {
        plan: { name: 'growth', status: 'active', billingInterval: 'monthly' },
        entitlements: growthFeatures,
      };

      const req = {
        params: { cuid: testCuid },
        context: {
          currentuser: {
            sub: testUserId,
            client: { cuid: testCuid },
            clientEntitlements: growthFeatures,
          },
          entitlements: mockEntitlements,
        },
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      controller.getEntitlements(req as any, res as any);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          subscription: mockEntitlements,
          clientEntitlements: growthFeatures,
        },
      });
    });

    it('should throw UnauthorizedError when cuid does not match', async () => {
      const controller = new SubscriptionController({
        subscriptionService: {} as any,
        smsService: {} as any,
      });

      const req = {
        params: { cuid: 'wrong-cuid' },
        context: {
          currentuser: {
            sub: testUserId,
            client: { cuid: testCuid },
          },
        },
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      await expect(controller.getEntitlements(req as any, res as any)).rejects.toThrow();
    });

    it('should return clientEntitlements only when entitlements middleware returns null', () => {
      const controller = new SubscriptionController({
        subscriptionService: {} as any,
        smsService: {} as any,
      });

      const req = {
        params: { cuid: testCuid },
        context: {
          currentuser: {
            sub: testUserId,
            client: { cuid: testCuid },
            clientEntitlements: growthFeatures,
          },
          entitlements: null,
        },
      };

      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn().mockReturnThis(),
      };

      controller.getEntitlements(req as any, res as any);

      expect(res.json).toHaveBeenCalledWith({
        success: true,
        data: {
          clientEntitlements: growthFeatures,
        },
      });
    });
  });
});
