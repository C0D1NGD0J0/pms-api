import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { InspectionDAO } from '@dao/inspectionDAO';
import { LeaseStatus } from '@interfaces/lease.interface';
import { EventTypes } from '@interfaces/events.interface';
import { IRequestContext } from '@interfaces/utils.interface';
import { InspectionType } from '@interfaces/inspection.interface';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { OffboardingService } from '@services/offboarding/offboarding.service';

describe('OffboardingService - INSPECTION_APPROVED Listener', () => {
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockInspectionDAO: jest.Mocked<InspectionDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let registeredListeners: Record<string, Function>;

  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();
  const testCuid = 'TESTCLIENT123';
  const testIuid = 'INSP123';

  const mockUserCache = {
    invalidateUserDetail: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    registeredListeners = {};

    mockLeaseDAO = {
      findFirst: jest.fn(),
      list: jest.fn(),
      startSession: jest.fn().mockResolvedValue({}),
      withTransaction: jest.fn((session, callback) => callback(session)),
      submitVacateRequest: jest.fn(),
      decideVacateRequest: jest.fn(),
    } as any;

    mockUserDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as any;

    mockPaymentDAO = {
      countDocuments: jest.fn(),
    } as any;

    mockInspectionDAO = {
      findFirst: jest.fn(),
    } as any;

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn().mockImplementation((event: string, handler: Function) => {
        registeredListeners[event] = handler;
        return mockEmitterService;
      }),
      off: jest.fn(),
    };

    // Construct the service — this triggers setupEventListeners
    new OffboardingService({
      userDAO: mockUserDAO,
      leaseDAO: mockLeaseDAO,
      paymentDAO: mockPaymentDAO,
      leaseService: { terminateLease: jest.fn() } as any,
      inspectionDAO: mockInspectionDAO,
      inspectionService: { scheduleInspection: jest.fn() } as any,
      leaseRenewalService: { createDraftLeaseRenewal: jest.fn() } as any,
      emitterService: mockEmitterService as any,
      userCache: mockUserCache as any,
      maintenanceRequestDAO: {
        list: jest.fn().mockResolvedValue({ items: [] }),
        updateMany: jest.fn(),
      } as any,
      maintenancePaymentService: { chargeForMaintenance: jest.fn() } as any,
    });
  });

  it('should complete deferred deactivation when a move-out inspection is approved', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];
    expect(handler).toBeDefined();

    // Inspection is move-out type
    mockInspectionDAO.findFirst.mockResolvedValue({
      _id: new Types.ObjectId(),
      iuid: testIuid,
      type: InspectionType.MOVE_OUT,
      leaseId: mockLeaseId,
      cuid: testCuid,
    } as any);

    // Lease is expired
    mockLeaseDAO.findFirst.mockResolvedValue({
      _id: mockLeaseId,
      status: LeaseStatus.EXPIRED,
      tenantId: mockTenantId,
      cuid: testCuid,
    } as any);

    // User has pendingDeactivation flag
    mockUserDAO.findFirst.mockResolvedValue({
      _id: mockTenantId,
      uid: 'tenant-uid',
      cuids: [{ cuid: testCuid, pendingDeactivation: true, isConnected: true }],
    } as any);

    await handler({
      iuid: testIuid,
      cuid: testCuid,
      tenantId: mockTenantId.toString(),
      leaseId: mockLeaseId.toString(),
    });

    // Should set isConnected=false and pendingDeactivation=false
    expect(mockUserDAO.update).toHaveBeenCalledWith(
      { _id: expect.any(Types.ObjectId), 'cuids.cuid': testCuid },
      {
        $set: {
          'cuids.$.isConnected': false,
          'cuids.$.pendingDeactivation': false,
        },
      }
    );

    // Should invalidate cache
    expect(mockUserCache.invalidateUserDetail).toHaveBeenCalledWith(testCuid, 'tenant-uid');
  });

  it('should ignore inspections that are not move-out type', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    // Inspection is NOT move-out
    mockInspectionDAO.findFirst.mockResolvedValue(null);

    await handler({
      iuid: testIuid,
      cuid: testCuid,
      tenantId: mockTenantId.toString(),
      leaseId: mockLeaseId.toString(),
    });

    // Should not update user at all
    expect(mockUserDAO.update).not.toHaveBeenCalled();
    expect(mockUserDAO.findFirst).not.toHaveBeenCalled();
  });

  it('should not deactivate if user has no pendingDeactivation flag', async () => {
    const handler = registeredListeners[EventTypes.INSPECTION_APPROVED];

    mockInspectionDAO.findFirst.mockResolvedValue({
      _id: new Types.ObjectId(),
      iuid: testIuid,
      type: InspectionType.MOVE_OUT,
      leaseId: mockLeaseId,
      cuid: testCuid,
    } as any);

    mockLeaseDAO.findFirst.mockResolvedValue({
      _id: mockLeaseId,
      status: LeaseStatus.EXPIRED,
      tenantId: mockTenantId,
      cuid: testCuid,
    } as any);

    // User does NOT have pendingDeactivation
    mockUserDAO.findFirst.mockResolvedValue(null);

    await handler({
      iuid: testIuid,
      cuid: testCuid,
      tenantId: mockTenantId.toString(),
      leaseId: mockLeaseId.toString(),
    });

    expect(mockUserDAO.update).not.toHaveBeenCalled();
  });
});
