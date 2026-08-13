import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { LeaseDAO } from '@dao/leaseDAO';
import { LeaseStatus } from '@interfaces/lease.interface';
import { EventTypes } from '@interfaces/events.interface';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@utils/systemBot', () => ({
  getSystemBotUserId: jest.fn().mockResolvedValue(new Types.ObjectId()),
}));

import { LeaseService } from '@services/lease/lease.service';

describe('LeaseService - markExpiredLeases renewal hold', () => {
  let leaseService: LeaseService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let mockNotificationService: {
    notifyLeaseLifecycleEvent: jest.Mock;
    notifySystemError: jest.Mock;
  };

  const testCuid = 'TESTCLIENT123';
  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();
  const mockPropertyId = new Types.ObjectId();
  const mockUnitId = new Types.ObjectId();
  const mockCreatedBy = new Types.ObjectId();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // A lease that is 10 days past its end date (beyond the 7-day grace)
  const pastEndDate = dayjs(today).subtract(10, 'days').toDate();

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
    renewalOptions: {},
    ...overrides,
  });

  beforeEach(() => {
    mockLeaseDAO = {
      list: jest.fn(),
      findFirst: jest.fn(),
      updateById: jest.fn(),
      setRenewalHold: jest.fn(),
      autoRejectRenewalRequest: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
    } as any;

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    };

    mockNotificationService = {
      notifyLeaseLifecycleEvent: jest.fn().mockResolvedValue(undefined),
      notifySystemError: jest.fn().mockResolvedValue(undefined),
    };

    leaseService = new LeaseService({
      leaseDAO: mockLeaseDAO,
      userDAO: {} as any,
      clientDAO: {} as any,
      propertyDAO: { updateById: jest.fn() } as any,
      invitationDAO: {} as any,
      profileDAO: {} as any,
      mailerService: {} as any,
      invitationService: {} as any,
      leaseCache: {
        invalidateLease: jest.fn(),
        invalidateLeaseLists: jest.fn(),
        getClientLeases: jest.fn().mockResolvedValue({ success: false, data: null }),
        saveClientLeases: jest.fn(),
      } as any,
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
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      paymentDAO: {} as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue({ success: true }) } as any,
    });
  });

  it('should hold expiry and set holdUntil when a renewal request is pending (first encounter)', async () => {
    const lease = makeExpiredLease({
      renewalRequest: { status: 'pending', requestedTermMonths: 12 },
    });

    mockLeaseDAO.list
        .mockResolvedValueOnce({ items: [lease] } as any) // 3-day-past batch
        .mockResolvedValueOnce({ items: [] } as any);     // recently-past batch (smart grace)

    await leaseService.markExpiredLeases();

    // Should set holdUntil via setRenewalHold
    expect(mockLeaseDAO.setRenewalHold).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.any(Date)
    );

    // Should NOT update status to expired
    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();

    // Should NOT emit LEASE_EXPIRED
    expect(mockEmitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.LEASE_EXPIRED,
      expect.anything()
    );
  });

  it('should skip expiry when holdUntil has not passed yet', async () => {
    const futureHold = dayjs(today).add(24, 'hours').toDate();
    const lease = makeExpiredLease({
      renewalRequest: { status: 'pending', requestedTermMonths: 12, holdUntil: futureHold },
    });

    mockLeaseDAO.list
        .mockResolvedValueOnce({ items: [lease] } as any) // 3-day-past batch
        .mockResolvedValueOnce({ items: [] } as any);     // recently-past batch (smart grace)

    await leaseService.markExpiredLeases();

    // Should NOT set holdUntil again (already set)
    expect(mockLeaseDAO.setRenewalHold).not.toHaveBeenCalled();

    // Should NOT update status
    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();

    // Should NOT emit LEASE_EXPIRED
    expect(mockEmitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.LEASE_EXPIRED,
      expect.anything()
    );
  });

  it('should auto-reject renewal and mark expired when holdUntil has passed', async () => {
    const expiredHold = dayjs(today).subtract(1, 'hour').toDate();
    const lease = makeExpiredLease({
      renewalRequest: { status: 'pending', requestedTermMonths: 12, holdUntil: expiredHold },
    });

    // No renewal lease exists
    mockLeaseDAO.list
        .mockResolvedValueOnce({ items: [lease] } as any) // 3-day-past batch
        .mockResolvedValueOnce({ items: [] } as any);     // recently-past batch (smart grace)
    mockLeaseDAO.findFirst.mockResolvedValue(null);
    mockLeaseDAO.updateById.mockResolvedValue(lease as any);

    await leaseService.markExpiredLeases();

    // Should auto-reject the renewal request
    expect(mockLeaseDAO.autoRejectRenewalRequest).toHaveBeenCalledWith(mockLeaseId.toString());

    // Should mark lease as expired (Case 3: no renewal)
    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({
        status: 'expired',
      })
    );

    // Should emit LEASE_EXPIRED
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      EventTypes.LEASE_EXPIRED,
      expect.objectContaining({
        leaseId: mockLeaseId.toString(),
        luid: 'LEASE123',
        cuid: testCuid,
        reason: 'expired',
      })
    );
  });

  it('should emit LEASE_EXPIRED for Case 2 (renewal exists but not active)', async () => {
    const renewalId = new Types.ObjectId();
    const lease = makeExpiredLease();

    mockLeaseDAO.list
        .mockResolvedValueOnce({ items: [lease] } as any) // 3-day-past batch
        .mockResolvedValueOnce({ items: [] } as any);     // recently-past batch (smart grace)
    // Renewal exists but is still in draft_renewal status
    mockLeaseDAO.findFirst.mockResolvedValue({
      _id: renewalId,
      luid: 'RENEWAL123',
      status: 'draft_renewal',
    } as any);
    mockLeaseDAO.updateById.mockResolvedValue(lease as any);

    await leaseService.markExpiredLeases();

    // Should mark lease as expired
    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({ status: 'expired' })
    );

    // Should emit LEASE_EXPIRED
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      EventTypes.LEASE_EXPIRED,
      expect.objectContaining({
        leaseId: mockLeaseId.toString(),
        reason: 'expired',
      })
    );
  });

  it('should NOT emit LEASE_EXPIRED for Case 1 (renewal is active)', async () => {
    const renewalId = new Types.ObjectId();
    const lease = makeExpiredLease();

    mockLeaseDAO.list
        .mockResolvedValueOnce({ items: [lease] } as any) // 3-day-past batch
        .mockResolvedValueOnce({ items: [] } as any);     // recently-past batch (smart grace)
    // Renewal is fully active
    mockLeaseDAO.findFirst.mockResolvedValue({
      _id: renewalId,
      luid: 'RENEWAL123',
      status: 'active',
    } as any);
    mockLeaseDAO.updateById.mockResolvedValue(lease as any);

    await leaseService.markExpiredLeases();

    // Should mark lease as completed (not expired)
    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({ status: 'completed' })
    );

    // Should NOT emit LEASE_EXPIRED
    expect(mockEmitterService.emit).not.toHaveBeenCalledWith(
      EventTypes.LEASE_EXPIRED,
      expect.anything()
    );
  });

  it('should emit LEASE_EXPIRED for Case 3 (no renewal exists)', async () => {
    const lease = makeExpiredLease();

    mockLeaseDAO.list
        .mockResolvedValueOnce({ items: [lease] } as any) // 3-day-past batch
        .mockResolvedValueOnce({ items: [] } as any);     // recently-past batch (smart grace)
    // No renewal exists
    mockLeaseDAO.findFirst.mockResolvedValue(null);
    mockLeaseDAO.updateById.mockResolvedValue(lease as any);

    await leaseService.markExpiredLeases();

    // Should mark lease as expired
    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({ status: 'expired' })
    );

    // Should emit LEASE_EXPIRED
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      EventTypes.LEASE_EXPIRED,
      expect.objectContaining({
        leaseId: mockLeaseId.toString(),
        cuid: testCuid,
        tenantId: mockTenantId.toString(),
        reason: 'expired',
      })
    );
  });

  it('should skip grace period and expire immediately when an upcoming lease exists on the same unit', async () => {
    // Lease ended 1 day ago (within 3-day grace period — normally would NOT be expired yet)
    const recentEndDate = dayjs(today).subtract(1, 'day').toDate();
    const recentLease = makeExpiredLease({
      _id: new Types.ObjectId(),
      luid: 'LEASE_RECENT',
      duration: {
        startDate: dayjs(recentEndDate).subtract(12, 'months').toDate(),
        endDate: recentEndDate,
      },
    });

    // Upcoming lease on the same unit starting in 3 days
    const upcomingLease = {
      _id: new Types.ObjectId(),
      cuid: testCuid,
      property: { id: mockPropertyId, unitId: mockUnitId },
      duration: { startDate: dayjs(recentEndDate).add(3, 'days').toDate() },
    };

    mockLeaseDAO.list
      .mockResolvedValueOnce({ items: [] } as any)              // 3-day-past batch (empty)
      .mockResolvedValueOnce({ items: [recentLease] } as any)   // recently-past batch
      .mockResolvedValueOnce({ items: [upcomingLease] } as any); // findLeasesWithUpcomingConflicts batch query

    // No renewal exists
    mockLeaseDAO.findFirst.mockResolvedValue(null);
    mockLeaseDAO.updateById.mockResolvedValue(recentLease as any);

    await leaseService.markExpiredLeases();

    // Should expire the lease even though it's within the 3-day grace period
    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      recentLease._id.toString(),
      expect.objectContaining({ status: 'expired' })
    );
  });

  it('should NOT expire a recently-past lease when no upcoming lease exists (grace period applies)', async () => {
    // Lease ended 1 day ago (within 3-day grace period)
    const recentEndDate = dayjs(today).subtract(1, 'day').toDate();
    const recentLease = makeExpiredLease({
      _id: new Types.ObjectId(),
      luid: 'LEASE_GRACE',
      duration: {
        startDate: dayjs(recentEndDate).subtract(12, 'months').toDate(),
        endDate: recentEndDate,
      },
    });

    mockLeaseDAO.list
      .mockResolvedValueOnce({ items: [] } as any)             // 3-day-past batch (empty)
      .mockResolvedValueOnce({ items: [recentLease] } as any)  // recently-past batch
      .mockResolvedValueOnce({ items: [] } as any);             // no upcoming conflicts

    await leaseService.markExpiredLeases();

    // Should NOT expire — grace period still applies
    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();
  });
});
