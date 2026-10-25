import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { InspectionDAO } from '@dao/inspectionDAO';
import { LeaseStatus } from '@interfaces/lease.interface';
import { EventTypes } from '@interfaces/events.interface';
import { IRequestContext } from '@interfaces/utils.interface';
import { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { OffboardingService } from '@services/offboarding/offboarding.service';

describe('OffboardingService - Renewal Requests', () => {
  let offboardingService: OffboardingService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockInspectionDAO: jest.Mocked<InspectionDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let mockLeaseService: { terminateLease: jest.Mock };
  let mockInspectionService: { scheduleInspection: jest.Mock };
  let mockLeaseRenewalService: { createDraftLeaseRenewal: jest.Mock };
  let mockSSEService: { sendToUser: jest.Mock; broadcastToClient: jest.Mock };
  let mockNotificationService: { notifyLeaseLifecycleEvent: jest.Mock };
  let mockLeaseCache: { invalidateLease: jest.Mock; invalidateLeaseLists: jest.Mock };

  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();
  const testCuid = 'TESTCLIENT123';
  const testLuid = 'LEASE123';
  const mockManagerId = new Types.ObjectId();
  const mockCreatorId = new Types.ObjectId();

  const mockTenantContext: Partial<IRequestContext> = {
    currentuser: {
      sub: mockTenantId.toString(),
      email: 'tenant@example.com',
      fullname: 'Tenant User',
      client: {
        cuid: testCuid,
        role: 'tenant',
      },
    } as any,
    request: {
      params: { cuid: testCuid },
    } as any,
  };

  const mockPMContext: Partial<IRequestContext> = {
    currentuser: {
      sub: new Types.ObjectId().toString(),
      email: 'pm@example.com',
      fullname: 'Property Manager',
      client: {
        cuid: testCuid,
        role: 'admin',
      },
    } as any,
    request: {
      params: { cuid: testCuid },
    } as any,
  };

  const makeActiveLease = (overrides: Record<string, any> = {}) => ({
    _id: mockLeaseId,
    luid: testLuid,
    cuid: testCuid,
    tenantId: mockTenantId,
    status: LeaseStatus.ACTIVE,
    duration: {
      startDate: dayjs().subtract(11, 'months').toDate(),
      endDate: dayjs().add(15, 'days').toDate(),
    },
    leaseNumber: 'L-2026-001',
    createdBy: mockCreatorId,
    property: {
      id: new Types.ObjectId(),
      unitId: new Types.ObjectId(),
      managedBy: mockManagerId,
      address: { fullAddress: '123 Main St' },
    },
    renewalOptions: { noticePeriodDays: 30 },
    vacateRequest: null,
    renewalRequest: null,
    ...overrides,
  });

  beforeEach(() => {
    mockLeaseDAO = {
      findFirst: jest.fn(),
      list: jest.fn(),
      startSession: jest.fn().mockResolvedValue({}),
      withTransaction: jest.fn((session, callback) => callback(session)),
      submitRenewalRequest: jest.fn(),
      decideRenewalRequest: jest.fn(),
      checkOverlappingLeases: jest.fn().mockResolvedValue([]),
      findOpenRenewalForLease: jest.fn().mockResolvedValue(null),
      revertRenewalRequestDecision: jest.fn(),
      getPendingRenewalRequests: jest.fn(),
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
      on: jest.fn(),
      off: jest.fn(),
    };

    mockLeaseService = {
      terminateLease: jest.fn(),
    };

    mockInspectionService = {
      scheduleInspection: jest.fn(),
    };

    mockLeaseRenewalService = {
      createDraftLeaseRenewal: jest
        .fn()
        .mockResolvedValue({ success: true, data: { luid: 'RENEWAL456' } }),
    };

    mockSSEService = {
      sendToUser: jest.fn().mockResolvedValue(undefined),
      broadcastToClient: jest.fn().mockResolvedValue(undefined),
    };

    mockNotificationService = {
      notifyLeaseLifecycleEvent: jest.fn().mockResolvedValue(undefined),
    };

    mockLeaseCache = {
      invalidateLease: jest.fn().mockResolvedValue(undefined),
      invalidateLeaseLists: jest.fn().mockResolvedValue(undefined),
    };

    offboardingService = new OffboardingService({
      userDAO: mockUserDAO,
      leaseDAO: mockLeaseDAO,
      propertyDAO: { updateById: jest.fn() } as any,
      propertyUnitDAO: { updateById: jest.fn() } as any,
      paymentDAO: mockPaymentDAO,
      invoiceDAO: {} as any,
      leaseService: mockLeaseService as any,
      inspectionDAO: mockInspectionDAO,
      inspectionService: mockInspectionService as any,
      leaseRenewalService: mockLeaseRenewalService as any,
      emitterService: mockEmitterService as any,
      leaseCache: mockLeaseCache as any,
      authCache: { invalidateCurrentUser: jest.fn() } as any,
      maintenanceRequestDAO: {
        list: jest.fn().mockResolvedValue({ items: [] }),
        updateMany: jest.fn(),
      } as any,
      maintenancePaymentService: { chargeForMaintenance: jest.fn() } as any,
      sseService: mockSSEService as any,
      notificationService: mockNotificationService as any,
      vendorDAO: { disconnectClient: jest.fn() } as any,
      clientDAO: { findFirst: jest.fn() } as any,
      emailQueue: { addToEmailQueue: jest.fn() } as any,
    });
  });

  describe('submitRenewalRequest', () => {
    it('should successfully submit a renewal request', async () => {
      const lease = makeActiveLease();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.submitRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      } as any);

      const result = await offboardingService.submitRenewalRequest(
        testCuid,
        testLuid,
        { requestedTermMonths: 12, message: 'Would like to renew' },
        mockTenantContext as IRequestContext
      );

      expect(result.success).toBe(true);
      expect(mockLeaseDAO.submitRenewalRequest).toHaveBeenCalledWith(
        testCuid,
        mockLeaseId.toString(),
        { requestedTermMonths: 12, message: 'Would like to renew' }
      );
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.LEASE_RENEWAL_REQUESTED,
        expect.objectContaining({
          luid: testLuid,
          cuid: testCuid,
          tenantId: mockTenantId.toString(),
        })
      );
    });

    it('should notify managers, broadcast to management and invalidate caches', async () => {
      const lease = makeActiveLease();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.submitRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'pending', requestedTermMonths: 6 },
      } as any);

      await offboardingService.submitRenewalRequest(
        testCuid,
        testLuid,
        { requestedTermMonths: 6 },
        mockTenantContext as IRequestContext
      );

      expect(mockNotificationService.notifyLeaseLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'renewal_requested',
          lease: expect.objectContaining({
            luid: testLuid,
            leaseNumber: 'L-2026-001',
            propertyAddress: '123 Main St',
          }),
          recipients: {
            propertyManager: mockManagerId.toString(),
            createdBy: mockCreatorId.toString(),
          },
          metadata: expect.objectContaining({ luid: testLuid, requestedTermMonths: 6 }),
        })
      );
      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        testCuid,
        { resource: 'lease', action: 'renewal-requested', resourceUId: testLuid },
        'resource-event',
        undefined,
        [...ROLE_GROUPS.MANAGEMENT_ROLES]
      );
      expect(mockSSEService.sendToUser).not.toHaveBeenCalled();
      expect(mockLeaseCache.invalidateLease).toHaveBeenCalledWith(testCuid, testLuid);
      expect(mockLeaseCache.invalidateLeaseLists).toHaveBeenCalledWith(testCuid);
    });

    it('should still succeed when the SSE broadcast fails', async () => {
      const lease = makeActiveLease();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.submitRenewalRequest.mockResolvedValue(lease as any);
      mockSSEService.broadcastToClient.mockRejectedValue(new Error('redis down'));

      const result = await offboardingService.submitRenewalRequest(
        testCuid,
        testLuid,
        { requestedTermMonths: 12 },
        mockTenantContext as IRequestContext
      );

      expect(result.success).toBe(true);
    });

    it('should reject if lease is not active', async () => {
      const lease = makeActiveLease({ status: LeaseStatus.EXPIRED });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.submitRenewalRequest(
          testCuid,
          testLuid,
          { requestedTermMonths: 12 },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject if a vacate request is pending', async () => {
      const lease = makeActiveLease({ vacateRequest: { status: 'pending' } });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.submitRenewalRequest(
          testCuid,
          testLuid,
          { requestedTermMonths: 12 },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject if a renewal request is already pending', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.submitRenewalRequest(
          testCuid,
          testLuid,
          { requestedTermMonths: 12 },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject if lease is not within the 30-day expiry window', async () => {
      const lease = makeActiveLease({
        duration: {
          startDate: dayjs().subtract(6, 'months').toDate(),
          endDate: dayjs().add(60, 'days').toDate(), // 60 days out > 30-day window
        },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.submitRenewalRequest(
          testCuid,
          testLuid,
          { requestedTermMonths: 12 },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject if an overlapping lease exists for the proposed dates', async () => {
      const lease = makeActiveLease();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.checkOverlappingLeases.mockResolvedValue([{ _id: new Types.ObjectId() }] as any);

      await expect(
        offboardingService.submitRenewalRequest(
          testCuid,
          testLuid,
          { requestedTermMonths: 12 },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('decideRenewalRequest', () => {
    it('should approve and create a draft renewal lease', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'approved' },
      } as any);

      const result = await offboardingService.decideRenewalRequest(
        testCuid,
        testLuid,
        { approved: true },
        mockPMContext as IRequestContext
      );

      expect(result.success).toBe(true);
      expect(mockLeaseRenewalService.createDraftLeaseRenewal).toHaveBeenCalledWith(
        testCuid,
        testLuid,
        expect.objectContaining({
          duration: expect.objectContaining({
            startDate: expect.any(Date),
            endDate: expect.any(Date),
          }),
        }),
        mockPMContext
      );
      expect(mockLeaseDAO.decideRenewalRequest).toHaveBeenCalled();
      expect(result.data.renewalLuid).toBe('RENEWAL456');
      expect(mockLeaseDAO.revertRenewalRequestDecision).not.toHaveBeenCalled();
    });

    it('should emit approved event, notify the tenant and push SSE to managers and tenant', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'approved' },
      } as any);

      await offboardingService.decideRenewalRequest(
        testCuid,
        testLuid,
        { approved: true },
        mockPMContext as IRequestContext
      );

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.LEASE_RENEWAL_REQUEST_APPROVED,
        expect.objectContaining({
          leaseId: mockLeaseId.toString(),
          luid: testLuid,
          cuid: testCuid,
          tenantId: mockTenantId.toString(),
          decidedBy: mockPMContext.currentuser!.sub,
          approved: true,
          renewalLuid: 'RENEWAL456',
        })
      );
      expect(mockNotificationService.notifyLeaseLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'renewal_approved',
          recipients: { tenant: true },
          lease: expect.objectContaining({ tenantId: mockTenantId.toString() }),
          metadata: expect.objectContaining({ luid: testLuid, renewalLuid: 'RENEWAL456' }),
        })
      );
      const sseEvent = { resource: 'lease', action: 'renewal-decided', resourceUId: testLuid };
      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        testCuid,
        sseEvent,
        'resource-event',
        undefined,
        [...ROLE_GROUPS.MANAGEMENT_ROLES]
      );
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        mockTenantId.toString(),
        testCuid,
        sseEvent,
        'resource-event'
      );
      expect(mockLeaseCache.invalidateLease).toHaveBeenCalledWith(testCuid, testLuid);
      expect(mockLeaseCache.invalidateLeaseLists).toHaveBeenCalledWith(testCuid);
    });

    it('should revert the request to pending when draft creation fails', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'approved' },
      } as any);
      mockLeaseDAO.revertRenewalRequestDecision.mockResolvedValue(lease as any);
      mockLeaseRenewalService.createDraftLeaseRenewal.mockRejectedValue(
        new BadRequestError({ message: 'Property is not leasable' })
      );

      await expect(
        offboardingService.decideRenewalRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow('Property is not leasable');

      expect(mockLeaseDAO.revertRenewalRequestDecision).toHaveBeenCalledWith(
        testCuid,
        mockLeaseId.toString()
      );
      expect(mockEmitterService.emit).not.toHaveBeenCalled();
      expect(mockNotificationService.notifyLeaseLifecycleEvent).not.toHaveBeenCalled();
      expect(mockSSEService.broadcastToClient).not.toHaveBeenCalled();
    });

    it('should explain, not leak a database error, when a cancelled renewal holds the slot', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'approved' },
      } as any);
      mockLeaseDAO.revertRenewalRequestDecision.mockResolvedValue(lease as any);
      mockLeaseRenewalService.createDraftLeaseRenewal.mockRejectedValue(
        Object.assign(new Error('E11000 duplicate key error'), { code: 11000 })
      );

      const attempt = offboardingService.decideRenewalRequest(
        testCuid,
        testLuid,
        { approved: true },
        mockPMContext as IRequestContext
      );

      await expect(attempt).rejects.toBeInstanceOf(BadRequestError);
      await expect(attempt).rejects.not.toThrow(/E11000/);
      expect(mockLeaseDAO.revertRenewalRequestDecision).toHaveBeenCalled();
    });

    it('should approve against an existing renewal instead of creating a new draft', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.findOpenRenewalForLease.mockResolvedValue({
        luid: 'EXISTING789',
        status: LeaseStatus.DRAFT_RENEWAL,
      } as any);
      mockLeaseDAO.decideRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'approved' },
      } as any);

      const result = await offboardingService.decideRenewalRequest(
        testCuid,
        testLuid,
        { approved: true },
        mockPMContext as IRequestContext
      );

      expect(result.data.renewalLuid).toBe('EXISTING789');
      expect(mockLeaseRenewalService.createDraftLeaseRenewal).not.toHaveBeenCalled();
      // The existing renewal overlaps the proposed dates by design — skip the guard
      expect(mockLeaseDAO.checkOverlappingLeases).not.toHaveBeenCalled();
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.LEASE_RENEWAL_REQUEST_APPROVED,
        expect.objectContaining({ renewalLuid: 'EXISTING789' })
      );
    });

    it('should not create a draft when another manager already decided the request', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideRenewalRequest.mockResolvedValue(null);

      await expect(
        offboardingService.decideRenewalRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow(BadRequestError);

      expect(mockLeaseRenewalService.createDraftLeaseRenewal).not.toHaveBeenCalled();
    });

    it('should block approval when an unrelated lease overlaps the renewal dates', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.checkOverlappingLeases.mockResolvedValue([{ _id: new Types.ObjectId() }] as any);

      await expect(
        offboardingService.decideRenewalRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow(BadRequestError);

      expect(mockLeaseDAO.decideRenewalRequest).not.toHaveBeenCalled();
    });

    it('should reject and save the rejection reason', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideRenewalRequest.mockResolvedValue({
        ...lease,
        renewalRequest: { status: 'rejected', rejectionReason: 'Property sold' },
      } as any);

      const result = await offboardingService.decideRenewalRequest(
        testCuid,
        testLuid,
        { approved: false, rejectionReason: 'Property sold' },
        mockPMContext as IRequestContext
      );

      expect(result.success).toBe(true);
      expect(mockLeaseRenewalService.createDraftLeaseRenewal).not.toHaveBeenCalled();
      expect(mockLeaseDAO.decideRenewalRequest).toHaveBeenCalledWith(
        testCuid,
        mockLeaseId.toString(),
        expect.objectContaining({
          approved: false,
          rejectionReason: 'Property sold',
          decidedBy: mockPMContext.currentuser!.sub,
        })
      );
      expect(result.data.renewalLuid).toBeNull();
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.LEASE_RENEWAL_REQUEST_REJECTED,
        expect.objectContaining({
          luid: testLuid,
          approved: false,
          rejectionReason: 'Property sold',
          tenantId: mockTenantId.toString(),
        })
      );
      expect(mockNotificationService.notifyLeaseLifecycleEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'renewal_rejected',
          recipients: { tenant: true },
          metadata: expect.objectContaining({ luid: testLuid, rejectionReason: 'Property sold' }),
        })
      );
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        mockTenantId.toString(),
        testCuid,
        { resource: 'lease', action: 'renewal-decided', resourceUId: testLuid },
        'resource-event'
      );
      expect(mockLeaseDAO.findOpenRenewalForLease).not.toHaveBeenCalled();
    });

    it('should reject if there is no pending renewal request', async () => {
      const lease = makeActiveLease({ renewalRequest: null });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.decideRenewalRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });
  });

  describe('getPendingRenewalRequests', () => {
    it('should map pending leases to dashboard rows', async () => {
      const submittedAt = new Date('2026-10-01');
      const holdUntil = new Date('2026-10-20');
      const endDate = new Date('2026-10-18');
      mockLeaseDAO.getPendingRenewalRequests.mockResolvedValue([
        {
          luid: testLuid,
          leaseNumber: 'L-2026-001',
          tenantId: {
            uid: 'TENANTUID',
            email: 'tenant@example.com',
            profile: { personalInfo: { firstName: 'Jane', lastName: 'Doe' } },
          },
          property: {
            id: { pid: 'PID1', name: 'Sunset Towers', address: { fullAddress: '1 Sunset Blvd' } },
            unitId: { unitNumber: '4B', puid: 'PUID1' },
            address: '1 Sunset Blvd',
          },
          duration: { endDate },
          renewalRequest: {
            status: 'pending',
            requestedTermMonths: 12,
            message: 'Please renew',
            submittedAt,
            holdUntil,
          },
        },
        {
          luid: 'LEASE999',
          leaseNumber: 'L-2026-002',
          tenantId: { uid: 'T2', email: 'no-profile@example.com' },
          property: { id: new Types.ObjectId(), address: { fullAddress: '9 Elm St' } },
          duration: { endDate },
          renewalRequest: { status: 'pending', submittedAt },
        },
      ] as any);

      const result = await offboardingService.getPendingRenewalRequests(testCuid);

      expect(mockLeaseDAO.getPendingRenewalRequests).toHaveBeenCalledWith(testCuid);
      expect(result.success).toBe(true);
      expect(result.data[0]).toEqual({
        luid: testLuid,
        leaseNumber: 'L-2026-001',
        tenant: { uid: 'TENANTUID', email: 'tenant@example.com', fullName: 'Jane Doe' },
        property: {
          pid: 'PID1',
          name: 'Sunset Towers',
          address: '1 Sunset Blvd',
          unitNumber: '4B',
          puid: 'PUID1',
        },
        requestedTermMonths: 12,
        message: 'Please renew',
        submittedAt,
        holdUntil,
        currentEndDate: endDate,
      });
      expect(result.data[1].tenant.fullName).toBe('no-profile@example.com');
      expect(result.data[1].property.address).toBe('9 Elm St');
    });
  });
});
