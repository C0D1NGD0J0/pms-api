import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { InspectionDAO } from '@dao/inspectionDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { LeaseStatus } from '@interfaces/lease.interface';
import { EventTypes } from '@interfaces/events.interface';
import { InspectionType } from '@interfaces/inspection.interface';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';

const SYSTEM_BOT_ID = new Types.ObjectId();

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@utils/systemBot', () => ({
  getSystemBotUserId: jest.fn().mockResolvedValue(SYSTEM_BOT_ID),
}));

import { OffboardingService } from '@services/offboarding/offboarding.service';

describe('OffboardingService - INSPECTION_APPROVED Listener', () => {
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockPropertyDAO: jest.Mocked<PropertyDAO>;
  let mockPropertyUnitDAO: jest.Mocked<PropertyUnitDAO>;
  let mockInspectionDAO: jest.Mocked<InspectionDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let mockSseService: { sendToUser: jest.Mock };
  let mockLeaseCache: { invalidateLease: jest.Mock; invalidateLeaseLists: jest.Mock };
  let mockAuthCache: { invalidateCurrentUser: jest.Mock };
  let registeredListeners: Record<string, (...args: any[]) => any>;

  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();
  const mockPropertyId = new Types.ObjectId();
  const mockUnitId = new Types.ObjectId();
  const testCuid = 'TESTCLIENT123';
  const testIuid = 'INSP123';
  const testLuid = 'LEASE123';

  const mockUserCache = {
    invalidateUserDetail: jest.fn().mockReturnValue(Promise.resolve(true)),
  };

  const makeLease = (overrides: Record<string, any> = {}) => ({
    _id: mockLeaseId,
    luid: testLuid,
    status: LeaseStatus.EXPIRED,
    tenantId: mockTenantId,
    cuid: testCuid,
    property: {
      id: mockPropertyId,
      unitId: mockUnitId,
    },
    ...overrides,
  });

  const makeUser = (overrides: Record<string, any> = {}) => ({
    _id: mockTenantId,
    uid: 'tenant-uid',
    cuids: [{ cuid: testCuid, pendingDeactivation: true, isConnected: true }],
    ...overrides,
  });

  beforeEach(() => {
    registeredListeners = {};

    mockLeaseDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn().mockReturnValue(Promise.resolve({})),
      list: jest.fn(),
      startSession: jest.fn().mockReturnValue(Promise.resolve({})),
      withTransaction: jest.fn((session, callback) => callback(session)),
      submitVacateRequest: jest.fn(),
      decideVacateRequest: jest.fn(),
    } as any;

    mockUserDAO = {
      findFirst: jest.fn(),
      update: jest.fn().mockReturnValue(Promise.resolve({})),
    } as any;

    mockPaymentDAO = {
      countDocuments: jest.fn(),
    } as any;

    mockPropertyDAO = {
      updateById: jest.fn().mockReturnValue(Promise.resolve({})),
    } as any;

    mockPropertyUnitDAO = {
      updateById: jest.fn().mockReturnValue(Promise.resolve({})),
    } as any;

    mockInspectionDAO = {
      findFirst: jest.fn(),
    } as any;

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        registeredListeners[event] = handler;
        return mockEmitterService;
      }),
      off: jest.fn(),
    };

    mockLeaseCache = {
      invalidateLease: jest.fn().mockReturnValue(Promise.resolve()),
      invalidateLeaseLists: jest.fn().mockReturnValue(Promise.resolve()),
    };
    mockAuthCache = {
      invalidateCurrentUser: jest.fn().mockReturnValue(Promise.resolve({ success: true })),
    };
    mockSseService = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
    };

    new OffboardingService({
      userDAO: mockUserDAO,
      leaseDAO: mockLeaseDAO,
      propertyDAO: mockPropertyDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
      paymentDAO: mockPaymentDAO,
      leaseService: { terminateLease: jest.fn() } as any,
      inspectionDAO: mockInspectionDAO,
      inspectionService: { scheduleInspection: jest.fn() } as any,
      leaseRenewalService: { createDraftLeaseRenewal: jest.fn() } as any,
      emitterService: mockEmitterService as any,
      userCache: mockUserCache as any,
      leaseCache: mockLeaseCache as any,
      authCache: mockAuthCache as any,
      maintenanceRequestDAO: {
        list: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
        updateMany: jest.fn(),
      } as any,
      maintenancePaymentService: { chargeForMaintenance: jest.fn() } as any,
      sseService: mockSseService as any,
      vendorDAO: { disconnectClient: jest.fn() } as any,
      clientDAO: { findFirst: jest.fn() } as any,
      emailQueue: { addToEmailQueue: jest.fn() } as any,
    });
  });

  it('should mark lease as completed with audit trail', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(makeLease() as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({
        status: 'completed',
        completedAt: expect.any(Date),
      })
    );
  });

  it('should release property unit when lease has unitId', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(makeLease() as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockPropertyUnitDAO.updateById).toHaveBeenCalledWith(mockUnitId.toString(), {
      status: PropertyUnitStatusEnum.AVAILABLE,
      currentTenant: null,
      currentLease: null,
    });
    expect(mockPropertyDAO.updateById).not.toHaveBeenCalled();
  });

  it('should mark property vacant when lease has no unitId (single-family)', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    const leaseWithoutUnit = makeLease({
      property: { id: mockPropertyId, unitId: null },
    });
    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(leaseWithoutUnit as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockPropertyDAO.updateById).toHaveBeenCalledWith(mockPropertyId.toString(), {
      occupancyStatus: 'vacant',
    });
    expect(mockPropertyUnitDAO.updateById).not.toHaveBeenCalled();
  });

  it('should set tenant to isFormerTenant and disconnect', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(makeLease() as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockUserDAO.update).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId), 'cuids.cuid': testCuid },
      {
        $set: {
          'cuids.$.isConnected': false,
          'cuids.$.pendingDeactivation': false,
          'cuids.$.isFormerTenant': true,
        },
      }
    );
  });

  it('should invalidate user cache after deactivation', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(makeLease() as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockUserCache.invalidateUserDetail).toHaveBeenCalledWith(testCuid, 'tenant-uid');
  });

  it('should still complete lease and release unit even if user not found', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(makeLease() as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await handler({ iuid: testIuid, cuid: testCuid });

    // Lease should still be completed
    expect(mockLeaseDAO.updateById).toHaveBeenCalled();
    // Unit should still be released
    expect(mockPropertyUnitDAO.updateById).toHaveBeenCalled();
    // User update should NOT be called
    expect(mockUserDAO.update).not.toHaveBeenCalled();
  });

  it('should handle terminated leases (not just expired)', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    const terminatedLease = makeLease({ status: LeaseStatus.TERMINATED });
    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(terminatedLease as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('should ignore inspections that are not move-out type', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.findFirst).not.toHaveBeenCalled();
    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();
    expect(mockUserDAO.update).not.toHaveBeenCalled();
  });

  it('should ignore if lease is not found', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();
    expect(mockUserDAO.update).not.toHaveBeenCalled();
  });

  it('should complete an active lease that is past its end date (PM completed inspection early)', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    // Lease is active but past end date
    const pastEndDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000); // 2 days ago
    mockLeaseDAO.findFirst.mockReturnValue(
      Promise.resolve(
        makeLease({ status: LeaseStatus.ACTIVE, duration: { endDate: pastEndDate } }) as any
      )
    );
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({ status: 'completed' })
    );
    expect(mockUserDAO.update).toHaveBeenCalled();
  });

  it('should NOT complete an active lease that has not reached its end date', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    // Lease is active and end date is in the future
    const futureEndDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days from now
    mockLeaseDAO.findFirst.mockReturnValue(
      Promise.resolve(
        makeLease({ status: LeaseStatus.ACTIVE, duration: { endDate: futureEndDate } }) as any
      )
    );

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();
    expect(mockUserDAO.update).not.toHaveBeenCalled();
  });

  it('should invalidate lease and auth caches after completing lease', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(makeLease() as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    // Lease cache busted
    expect(mockLeaseCache.invalidateLease).toHaveBeenCalledWith(testCuid, testLuid);
    expect(mockLeaseCache.invalidateLeaseLists).toHaveBeenCalledWith(testCuid);

    // Auth cache busted for tenant
    expect(mockAuthCache.invalidateCurrentUser).toHaveBeenCalledWith(
      mockTenantId.toString(),
      testCuid
    );
  });

  it('should complete an active lease within the grace period window', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    // Lease is active but end date is only 2 days away (within 3-day grace window)
    const nearEndDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
    mockLeaseDAO.findFirst.mockReturnValue(
      Promise.resolve(
        makeLease({ status: LeaseStatus.ACTIVE, duration: { endDate: nearEndDate } }) as any
      )
    );
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.updateById).toHaveBeenCalledWith(
      mockLeaseId.toString(),
      expect.objectContaining({ status: 'completed' })
    );
  });

  it('should send SSE notification to tenant after completing lease', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: testIuid,
        type: InspectionType.MOVE_OUT,
        leaseId: mockLeaseId,
        cuid: testCuid,
      } as any)
    );

    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(makeLease() as any));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve(makeUser() as any));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      mockTenantId.toString(),
      testCuid,
      { resource: 'lease', action: 'lease-expired', resourceUId: testLuid },
      'resource-event'
    );
  });
});

describe('OffboardingService - LEASE_EXPIRED Completed Guard', () => {
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockInspectionDAO: { findFirst: jest.Mock };
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let registeredListeners: Record<string, (...args: any[]) => any>;

  const testCuid = 'TESTCLIENT123';

  beforeEach(() => {
    registeredListeners = {};

    mockLeaseDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn().mockReturnValue(Promise.resolve({})),
      list: jest.fn(),
      startSession: jest.fn().mockReturnValue(Promise.resolve({})),
      withTransaction: jest.fn((session, callback) => callback(session)),
      submitVacateRequest: jest.fn(),
      decideVacateRequest: jest.fn(),
    } as any;

    mockInspectionDAO = {
      findFirst: jest.fn(),
    };

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        registeredListeners[event] = handler;
        return mockEmitterService;
      }),
      off: jest.fn(),
    };

    new OffboardingService({
      userDAO: { findFirst: jest.fn(), update: jest.fn() } as any,
      leaseDAO: mockLeaseDAO,
      propertyDAO: { updateById: jest.fn() } as any,
      propertyUnitDAO: { updateById: jest.fn() } as any,
      paymentDAO: { countDocuments: jest.fn() } as any,
      leaseService: { terminateLease: jest.fn() } as any,
      inspectionDAO: mockInspectionDAO as any,
      inspectionService: { scheduleInspection: jest.fn() } as any,
      leaseRenewalService: { createDraftLeaseRenewal: jest.fn() } as any,
      emitterService: mockEmitterService as any,
      userCache: { invalidateUserDetail: jest.fn().mockReturnValue(Promise.resolve(true)) } as any,
      leaseCache: { invalidateLease: jest.fn(), invalidateLeaseLists: jest.fn() } as any,
      authCache: { invalidateCurrentUser: jest.fn() } as any,
      maintenanceRequestDAO: {
        list: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
        updateMany: jest.fn(),
      } as any,
      maintenancePaymentService: { chargeForMaintenance: jest.fn() } as any,
      sseService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
      vendorDAO: { disconnectClient: jest.fn() } as any,
      clientDAO: { findFirst: jest.fn() } as any,
      emailQueue: { addToEmailQueue: jest.fn() } as any,
    });
  });

  it('should skip offboarding if lease is already completed', async () => {
    const handler = registeredListeners[EventTypes.LEASE_EXPIRED];
    expect(handler).toBeDefined();

    // Lease is already completed (PM finalized via inspection before cron)
    mockLeaseDAO.findFirst.mockReturnValue(
      Promise.resolve({ status: 'completed', luid: 'LEASE123', cuid: testCuid } as any)
    );

    await handler({ luid: 'LEASE123', cuid: testCuid, reason: 'expired' });

    // Should NOT update anything — lease already done
    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();
  });

  it('should proceed with offboarding if lease is expired (not completed)', async () => {
    const handler = registeredListeners[EventTypes.LEASE_EXPIRED];

    mockLeaseDAO.findFirst
      .mockReturnValueOnce(
        Promise.resolve({
          _id: new Types.ObjectId(),
          status: 'expired',
          luid: 'LEASE123',
          cuid: testCuid,
          tenantId: new Types.ObjectId(),
          property: { id: new Types.ObjectId() },
        } as any)
      )
      .mockReturnValueOnce(Promise.resolve(null)); // no existing inspection

    await handler({ luid: 'LEASE123', cuid: testCuid, reason: 'expired' });

    // Should have attempted to look up the lease (offboarding proceeded)
    expect(mockLeaseDAO.findFirst).toHaveBeenCalled();
  });

  it('should skip offboarding if reason is not expired', async () => {
    const handler = registeredListeners[EventTypes.LEASE_EXPIRED];

    await handler({ luid: 'LEASE123', cuid: testCuid, reason: 'terminated' });

    // Should not even look up the lease
    expect(mockLeaseDAO.findFirst).not.toHaveBeenCalled();
  });

  it('should re-emit INSPECTION_APPROVED when a pre-approved inspection exists', async () => {
    const handler = registeredListeners[EventTypes.LEASE_EXPIRED];
    const leaseId = new Types.ObjectId();

    // Lease is expired (not completed)
    mockLeaseDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: leaseId,
        status: 'expired',
        luid: 'LEASE123',
        cuid: testCuid,
        tenantId: new Types.ObjectId(),
        property: { id: new Types.ObjectId() },
      } as any)
    );

    // An approved move-out inspection already exists
    mockInspectionDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: new Types.ObjectId(),
        iuid: 'INSP_APPROVED',
        type: InspectionType.MOVE_OUT,
        status: 'approved',
        leaseId,
      } as any)
    );

    await handler({ luid: 'LEASE123', cuid: testCuid, reason: 'expired' });

    // Should re-emit INSPECTION_APPROVED instead of scheduling a new inspection
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      EventTypes.INSPECTION_APPROVED,
      expect.objectContaining({ iuid: 'INSP_APPROVED', cuid: testCuid })
    );
  });
});
