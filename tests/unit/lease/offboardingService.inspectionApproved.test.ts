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

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { OffboardingService } from '@services/offboarding/offboarding.service';

describe('OffboardingService - INSPECTION_APPROVED Listener', () => {
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockPropertyDAO: jest.Mocked<PropertyDAO>;
  let mockPropertyUnitDAO: jest.Mocked<PropertyUnitDAO>;
  let mockInspectionDAO: jest.Mocked<InspectionDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
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
      maintenanceRequestDAO: {
        list: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
        updateMany: jest.fn(),
      } as any,
      maintenancePaymentService: { chargeForMaintenance: jest.fn() } as any,
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
        $push: {
          lastModifiedBy: expect.objectContaining({
            action: 'completed',
            userId: 'system',
            name: 'System - Inspection Approved',
          }),
        },
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

  it('should ignore if lease is not in expired or terminated state', async () => {
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

    // Lease is active — not eligible for offboarding
    mockLeaseDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await handler({ iuid: testIuid, cuid: testCuid });

    expect(mockLeaseDAO.updateById).not.toHaveBeenCalled();
    expect(mockUserDAO.update).not.toHaveBeenCalled();
  });
});
