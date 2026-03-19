import { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { BadRequestError } from '@shared/customErrors';
import { IRequestContext } from '@interfaces/utils.interface';
import { IClientDocument } from '@interfaces/client.interface';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('SubscriptionService - Plan Usage with Verification', () => {
  let subscriptionService: SubscriptionService;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  const mockUserId = new Types.ObjectId().toString();
  const mockClientId = new Types.ObjectId();

  const mockContext: IRequestContext = {
    currentuser: {
      sub: mockUserId,
      email: 'admin@example.com',
      client: { cuid: 'TEST123', role: 'super-admin' },
    },
    request: {
      params: { cuid: 'TEST123' },
      url: '/api/v1/subscriptions/TEST123/plan-usage',
    },
    requestId: 'req-123',
  } as any;

  beforeEach(() => {
    mockSubscriptionDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as any;

    mockClientDAO = {
      findFirst: jest.fn(),
    } as any;

    subscriptionService = new SubscriptionService({
      subscriptionDAO: mockSubscriptionDAO,
      clientDAO: mockClientDAO,
      authCache: {} as any,
      paymentGatewayService: {} as any,
      sseService: {} as any,
      userDAO: { list: jest.fn().mockResolvedValue([]) } as any,
      emitterService: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } as any,
      propertyDAO: { countDocuments: jest.fn().mockResolvedValue(0) } as any,
      propertyUnitDAO: { countDocuments: jest.fn().mockResolvedValue(0) } as any,
    });
  });

  describe('getSubscriptionPlanUsage - Verification Status', () => {
    it('should return correct verification status for verified account', async () => {
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - 10); // 10 days ago

      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: true,
        createdAt,
      };

      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'TEST123',
        planName: 'growth',
        limits: {
          maxProperties: 10,
          maxUsers: 5,
          maxUnits: 50,
        },
      };

      mockClientDAO.findFirst.mockResolvedValue(mockClient as IClientDocument);
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      const result = await subscriptionService.getSubscriptionPlanUsage(mockContext);

      expect(result.data.verification).toBeDefined();
      expect(result.data.verification.isVerified).toBe(true);
      expect(result.data.verification.requiresVerification).toBe(false);
      expect(result.data.verification.gracePeriodExpired).toBe(false);
      expect(result.data.verification.daysRemaining).toBeNull();
    });

    it('should calculate grace period correctly for unverified account within 5 days', async () => {
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - 3); // 3 days ago

      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        createdAt,
      };

      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'TEST123',
        planName: 'growth',
        limits: {
          maxProperties: 10,
          maxUsers: 5,
          maxUnits: 50,
        },
      };

      mockClientDAO.findFirst.mockResolvedValue(mockClient as IClientDocument);
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      const result = await subscriptionService.getSubscriptionPlanUsage(mockContext);

      expect(result.data.verification).toBeDefined();
      expect(result.data.verification.isVerified).toBe(false);
      expect(result.data.verification.requiresVerification).toBe(true);
      expect(result.data.verification.gracePeriodExpired).toBe(false);
      expect(result.data.verification.daysRemaining).toBe(2); // 5 - 3 = 2 days remaining
    });

    it('should indicate grace period expired for unverified account older than 5 days', async () => {
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - 7); // 7 days ago

      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        createdAt,
      };

      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'TEST123',
        planName: 'growth',
        limits: {
          maxProperties: 10,
          maxUsers: 5,
          maxUnits: 50,
        },
      };

      mockClientDAO.findFirst.mockResolvedValue(mockClient as IClientDocument);
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      const result = await subscriptionService.getSubscriptionPlanUsage(mockContext);

      expect(result.data.verification).toBeDefined();
      expect(result.data.verification.isVerified).toBe(false);
      expect(result.data.verification.requiresVerification).toBe(true);
      expect(result.data.verification.gracePeriodExpired).toBe(true);
      expect(result.data.verification.daysRemaining).toBe(0);
    });

    it('should handle exactly 5 days old account (boundary case)', async () => {
      const createdAt = new Date();
      createdAt.setDate(createdAt.getDate() - 5); // Exactly 5 days ago

      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        createdAt,
      };

      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'TEST123',
        planName: 'growth',
        limits: {
          maxProperties: 10,
          maxUsers: 5,
          maxUnits: 50,
        },
      };

      mockClientDAO.findFirst.mockResolvedValue(mockClient as IClientDocument);
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      const result = await subscriptionService.getSubscriptionPlanUsage(mockContext);

      expect(result.data.verification).toBeDefined();
      expect(result.data.verification.isVerified).toBe(false);
      expect(result.data.verification.requiresVerification).toBe(true);
      expect(result.data.verification.gracePeriodExpired).toBe(false);
      expect(result.data.verification.daysRemaining).toBe(0);
    });

    it('should handle brand new account (0 days old)', async () => {
      const createdAt = new Date(); // Just created

      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        createdAt,
      };

      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'TEST123',
        planName: 'growth',
        limits: {
          maxProperties: 10,
          maxUsers: 5,
          maxUnits: 50,
        },
      };

      mockClientDAO.findFirst.mockResolvedValue(mockClient as IClientDocument);
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      const result = await subscriptionService.getSubscriptionPlanUsage(mockContext);

      expect(result.data.verification).toBeDefined();
      expect(result.data.verification.isVerified).toBe(false);
      expect(result.data.verification.requiresVerification).toBe(true);
      expect(result.data.verification.gracePeriodExpired).toBe(false);
      expect(result.data.verification.daysRemaining).toBe(5);
    });

    it('should throw BadRequestError when client not found', async () => {
      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'TEST123',
        planName: 'growth',
        limits: { maxProperties: 10, maxUsers: 5, maxUnits: 50 },
      };
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);
      mockClientDAO.findFirst.mockResolvedValue(null);

      await expect(subscriptionService.getSubscriptionPlanUsage(mockContext)).rejects.toThrow(
        BadRequestError
      );
      await expect(subscriptionService.getSubscriptionPlanUsage(mockContext)).rejects.toThrow(
        'Client not found'
      );
    });

    it('should include accountCreatedAt in verification response', async () => {
      const createdAt = new Date('2024-01-01');

      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        createdAt,
      };

      const mockSubscription = {
        _id: new Types.ObjectId(),
        cuid: 'TEST123',
        planName: 'growth',
        limits: {
          maxProperties: 10,
          maxUsers: 5,
          maxUnits: 50,
        },
      };

      mockClientDAO.findFirst.mockResolvedValue(mockClient as IClientDocument);
      mockSubscriptionDAO.findFirst.mockResolvedValue(mockSubscription as any);

      const result = await subscriptionService.getSubscriptionPlanUsage(mockContext);

      expect(result.data.verification).toBeDefined();
      expect(result.data.verification.accountCreatedAt).toEqual(createdAt);
    });
  });
});
