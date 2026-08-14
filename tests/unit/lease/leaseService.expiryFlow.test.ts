import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { LeaseStatus } from '@interfaces/lease.interface';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@utils/systemBot', () => ({
  getSystemBotUserId: jest.fn().mockResolvedValue(new Types.ObjectId()),
}));

import { LeaseService } from '@services/lease/lease.service';

describe('LeaseService — Expiry Flow', () => {
  let leaseService: LeaseService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let mockNotificationService: {
    notifyLeaseLifecycleEvent: jest.Mock;
    notifySystemError: jest.Mock;
  };
  let mockLeaseCache: {
    invalidateLease: jest.Mock;
    invalidateLeaseLists: jest.Mock;
    getClientLeases: jest.Mock;
    saveClientLeases: jest.Mock;
  };
  let mockAuthCache: { invalidateCurrentUser: jest.Mock };
  let mockUserCache: { invalidateUserDetail: jest.Mock };
  let mockMailerService: { sendMail: jest.Mock };

  const testCuid = 'TESTCLIENT123';
  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();
  const mockPropertyId = new Types.ObjectId();
  const mockUnitId = new Types.ObjectId();
  const mockCreatedBy = new Types.ObjectId();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const pastEndDate = dayjs(today).subtract(5, 'days').toDate();

  const makeExpiredLease = (overrides: Record<string, any> = {}) => ({
    _id: mockLeaseId,
    luid: 'LEASE123',
    cuid: testCuid,
    leaseNumber: 'L-001',
    tenantId: mockTenantId,
    status: LeaseStatus.ACTIVE,
    duration: {
      startDate: dayjs(pastEndDate).subtract(12, 'months').toDate(),
      endDate: pastEndDate,
    },
    property: {
      id: mockPropertyId,
      unitId: mockUnitId,
      address: { fullAddress: '123 Test St' },
    },
    propertyInfo: { managedBy: mockCreatedBy },
    createdBy: mockCreatedBy,
    renewalRequest: null,
    renewalOptions: { autoRenew: false },
    ...overrides,
  });

  beforeEach(() => {
    mockLeaseDAO = {
      list: jest.fn(),
      findFirst: jest.fn(),
      updateById: jest.fn().mockReturnValue(Promise.resolve({})),
      setRenewalHold: jest.fn(),
      autoRejectRenewalRequest: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
    } as any;

    mockUserDAO = {
      findFirst: jest.fn(),
    } as any;

    mockProfileDAO = {
      findFirst: jest.fn(),
    } as any;

    mockEmitterService = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };

    mockNotificationService = {
      notifyLeaseLifecycleEvent: jest.fn().mockReturnValue(Promise.resolve(undefined)),
      notifySystemError: jest.fn().mockReturnValue(Promise.resolve(undefined)),
    };

    mockLeaseCache = {
      invalidateLease: jest.fn().mockReturnValue(Promise.resolve()),
      invalidateLeaseLists: jest.fn().mockReturnValue(Promise.resolve()),
      getClientLeases: jest.fn().mockReturnValue(Promise.resolve({ success: false, data: null })),
      saveClientLeases: jest.fn(),
    };

    mockAuthCache = {
      invalidateCurrentUser: jest.fn().mockReturnValue(Promise.resolve({ success: true })),
    };

    mockUserCache = {
      invalidateUserDetail: jest.fn().mockReturnValue(Promise.resolve({ success: true })),
    };

    mockMailerService = {
      sendMail: jest.fn().mockReturnValue(Promise.resolve()),
    };

    leaseService = new LeaseService({
      leaseDAO: mockLeaseDAO,
      userDAO: mockUserDAO as any,
      clientDAO: {} as any,
      propertyDAO: { updateById: jest.fn() } as any,
      invitationDAO: {} as any,
      profileDAO: mockProfileDAO as any,
      mailerService: mockMailerService as any,
      invitationService: {} as any,
      leaseCache: mockLeaseCache as any,
      authCache: mockAuthCache as any,
      emitterService: mockEmitterService as any,
      notificationService: mockNotificationService as any,
      leaseSignatureService: {} as any,
      leaseDocumentService: {} as any,
      leaseTemplateService: {} as any,
      leaseRenewalService: {} as any,
      mediaUploadService: {} as any,
      leasePdfService: {} as any,
      boldSignService: {} as any,
      propertyUnitDAO: { updateById: jest.fn() } as any,
      queueFactory: {} as any,
      userService: {} as any,
      smsService: { sendToUser: jest.fn().mockReturnValue(Promise.resolve({})) } as any,
      paymentDAO: {} as any,
      userCache: mockUserCache as any,
    });
  });

  // ─── sendLeaseExpiredEmail ──────────────────────────────────────────────────

  describe('sendLeaseExpiredEmail (via markExpiredLeases)', () => {
    it('should send expiry email to tenant when lease expires', async () => {
      const lease = makeExpiredLease();

      mockLeaseDAO.list
        .mockReturnValueOnce(Promise.resolve({ items: [lease] } as any)) // 3-day-past batch
        .mockReturnValueOnce(Promise.resolve({ items: [] } as any)); // recently-past batch

      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any); // no renewal
      mockLeaseDAO.updateById.mockReturnValue(Promise.resolve(lease) as any);

      // Profile lookup returns tenant with populated user
      mockProfileDAO.findFirst.mockReturnValue(
        Promise.resolve({
          user: { _id: mockTenantId, email: 'tenant@test.com', uid: 'TENANT01' },
          personalInfo: { firstName: 'Sarah', lastName: 'Williams' },
        } as any)
      );

      await leaseService.markExpiredLeases();

      expect(mockMailerService.sendMail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'tenant@test.com',
          subject: 'Your Lease Has Expired',
          data: expect.objectContaining({
            tenantName: 'Sarah Williams',
            leaseNumber: 'L-001',
          }),
        }),
        'LEASE_EXPIRED'
      );
    });

    it('should not throw when tenant profile is not found', async () => {
      const lease = makeExpiredLease();

      mockLeaseDAO.list
        .mockReturnValueOnce(Promise.resolve({ items: [lease] } as any))
        .mockReturnValueOnce(Promise.resolve({ items: [] } as any));

      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);
      mockLeaseDAO.updateById.mockReturnValue(Promise.resolve(lease) as any);
      mockProfileDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      // Should not throw — silently skips email
      await expect(leaseService.markExpiredLeases()).resolves.not.toThrow();

      expect(mockMailerService.sendMail).not.toHaveBeenCalled();
    });

    it('should not throw when tenant has no email', async () => {
      const lease = makeExpiredLease();

      mockLeaseDAO.list
        .mockReturnValueOnce(Promise.resolve({ items: [lease] } as any))
        .mockReturnValueOnce(Promise.resolve({ items: [] } as any));

      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);
      mockLeaseDAO.updateById.mockReturnValue(Promise.resolve(lease) as any);
      mockProfileDAO.findFirst.mockReturnValue(
        Promise.resolve({
          user: { _id: mockTenantId, email: null },
          personalInfo: {},
        } as any)
      );

      await expect(leaseService.markExpiredLeases()).resolves.not.toThrow();
      expect(mockMailerService.sendMail).not.toHaveBeenCalled();
    });
  });

  // ─── invalidateLeaseStatusCaches ────────────────────────────────────────────

  describe('invalidateLeaseStatusCaches (via markExpiredLeases)', () => {
    it('should invalidate lease cache, auth cache, and user cache when lease expires', async () => {
      const lease = makeExpiredLease();

      mockLeaseDAO.list
        .mockReturnValueOnce(Promise.resolve({ items: [lease] } as any))
        .mockReturnValueOnce(Promise.resolve({ items: [] } as any));

      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);
      mockLeaseDAO.updateById.mockReturnValue(Promise.resolve(lease) as any);
      mockProfileDAO.findFirst.mockReturnValue(Promise.resolve(null) as any); // email skipped
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ uid: 'TENANT01' } as any));

      await leaseService.markExpiredLeases();

      // Lease cache busted
      expect(mockLeaseCache.invalidateLease).toHaveBeenCalledWith(testCuid, 'LEASE123');
      expect(mockLeaseCache.invalidateLeaseLists).toHaveBeenCalledWith(testCuid);

      // Auth cache busted for tenant
      expect(mockAuthCache.invalidateCurrentUser).toHaveBeenCalledWith(
        mockTenantId.toString(),
        testCuid
      );

      // User cache busted for tenant
      expect(mockUserCache.invalidateUserDetail).toHaveBeenCalledWith(testCuid, 'TENANT01');
    });

    it('should still expire lease even if cache invalidation fails', async () => {
      const lease = makeExpiredLease();

      mockLeaseDAO.list
        .mockReturnValueOnce(Promise.resolve({ items: [lease] } as any))
        .mockReturnValueOnce(Promise.resolve({ items: [] } as any));

      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);
      mockLeaseDAO.updateById.mockReturnValue(Promise.resolve(lease) as any);
      mockProfileDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      // Cache throws
      mockLeaseCache.invalidateLease.mockReturnValue(Promise.reject(new Error('Redis down')));

      // Should not throw — cache failure is non-fatal
      await expect(leaseService.markExpiredLeases()).resolves.not.toThrow();

      // Lease was still marked expired
      expect(mockLeaseDAO.updateById).toHaveBeenCalled();
    });
  });

  // ─── Tenant receives notification ──────────────────────────────────────────

  describe('tenant notification on expiry', () => {
    it('should include tenant: true in recipients when lease expires (Case 3 - no renewal)', async () => {
      const lease = makeExpiredLease();

      mockLeaseDAO.list
        .mockReturnValueOnce(Promise.resolve({ items: [lease] } as any))
        .mockReturnValueOnce(Promise.resolve({ items: [] } as any));

      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);
      mockLeaseDAO.updateById.mockReturnValue(Promise.resolve(lease) as any);
      mockProfileDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      await leaseService.markExpiredLeases();

      expect(mockNotificationService.notifyLeaseLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'expired',
          recipients: expect.objectContaining({
            tenant: true,
          }),
        })
      );
    });

    it('should include tenant: true in recipients when lease completes (Case 1 - active renewal)', async () => {
      const lease = makeExpiredLease();
      const renewal = { _id: new Types.ObjectId(), luid: 'RENEWAL01', status: 'active' };

      mockLeaseDAO.list
        .mockReturnValueOnce(Promise.resolve({ items: [lease] } as any))
        .mockReturnValueOnce(Promise.resolve({ items: [] } as any));

      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(renewal) as any);
      mockLeaseDAO.updateById.mockReturnValue(Promise.resolve(lease) as any);
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      await leaseService.markExpiredLeases();

      expect(mockNotificationService.notifyLeaseLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'completed',
          recipients: expect.objectContaining({
            tenant: true,
          }),
        })
      );
    });
  });

  // ─── hasUpcomingLease ──────────────────────────────────────────────────────

  describe('hasUpcomingLease', () => {
    it('should return true when an upcoming lease exists on the same unit', async () => {
      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve({ _id: new Types.ObjectId() } as any));

      const result = await leaseService.hasUpcomingLease(
        testCuid,
        mockPropertyId,
        mockUnitId,
        pastEndDate
      );

      expect(result).toBe(true);
      expect(mockLeaseDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          cuid: testCuid,
          'property.unitId': mockUnitId,
        }),
        { select: '_id' }
      );
    });

    it('should return false when no upcoming lease exists', async () => {
      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      const result = await leaseService.hasUpcomingLease(
        testCuid,
        mockPropertyId,
        mockUnitId,
        pastEndDate
      );

      expect(result).toBe(false);
    });

    it('should query by property.id when no unitId provided (single-family)', async () => {
      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      await leaseService.hasUpcomingLease(testCuid, mockPropertyId, null, pastEndDate);

      expect(mockLeaseDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          'property.id': mockPropertyId,
        }),
        { select: '_id' }
      );
    });

    it('should exclude the current lease when excludeLeaseId provided', async () => {
      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      await leaseService.hasUpcomingLease(testCuid, mockPropertyId, mockUnitId, pastEndDate, {
        excludeLeaseId: mockLeaseId,
      });

      expect(mockLeaseDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          _id: { $ne: mockLeaseId },
        }),
        { select: '_id' }
      );
    });

    it('should use custom windowDays when provided', async () => {
      mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null) as any);

      await leaseService.hasUpcomingLease(testCuid, mockPropertyId, mockUnitId, pastEndDate, {
        windowDays: 14,
      });

      expect(mockLeaseDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          'duration.startDate': expect.objectContaining({
            $lte: dayjs(pastEndDate).add(14, 'days').toDate(),
          }),
        }),
        { select: '_id' }
      );
    });
  });
});
