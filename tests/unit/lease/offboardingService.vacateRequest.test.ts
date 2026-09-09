import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { InspectionDAO } from '@dao/inspectionDAO';
import { LeaseStatus } from '@interfaces/lease.interface';
import { EventTypes } from '@interfaces/events.interface';
import { IRequestContext } from '@interfaces/utils.interface';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { MaintenanceRequestStatus } from '@interfaces/maintenanceRequest.interface';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { OffboardingService } from '@services/offboarding/offboarding.service';

describe('OffboardingService - Vacate Requests', () => {
  let offboardingService: OffboardingService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockInspectionDAO: jest.Mocked<InspectionDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock; off: jest.Mock };
  let mockLeaseService: { terminateLease: jest.Mock };
  let mockInspectionService: { scheduleInspection: jest.Mock };
  let mockLeaseRenewalService: { createDraftLeaseRenewal: jest.Mock };
  let mockMaintenanceRequestDAO: { list: jest.Mock; updateMany: jest.Mock };
  let mockMaintenancePaymentService: { chargeForMaintenance: jest.Mock };

  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();
  const mockPropertyId = new Types.ObjectId();
  const mockUnitId = new Types.ObjectId();
  const testCuid = 'TESTCLIENT123';
  const testLuid = 'LEASE123';

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
      endDate: dayjs().add(3, 'months').toDate(),
    },
    property: {
      id: mockPropertyId,
      unitId: mockUnitId,
    },
    renewalOptions: { noticePeriodDays: 30 },
    vacateRequest: null,
    renewalRequest: null,
    fees: { securityDeposit: 1500 },
    ...overrides,
  });

  beforeEach(() => {
    mockLeaseDAO = {
      findFirst: jest.fn(),
      list: jest.fn(),
      startSession: jest.fn().mockResolvedValue({}),
      withTransaction: jest.fn((_session, callback) => callback(_session)),
      submitVacateRequest: jest.fn(),
      decideVacateRequest: jest.fn(),
      submitRenewalRequest: jest.fn(),
      decideRenewalRequest: jest.fn(),
      checkOverlappingLeases: jest.fn().mockResolvedValue([]),
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
      terminateLease: jest.fn().mockResolvedValue({ success: true }),
    };

    mockInspectionService = {
      scheduleInspection: jest.fn(),
    };

    mockLeaseRenewalService = {
      createDraftLeaseRenewal: jest.fn().mockResolvedValue({ success: true, data: {} }),
    };

    mockMaintenanceRequestDAO = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      updateMany: jest.fn(),
    };

    mockMaintenancePaymentService = {
      chargeForMaintenance: jest.fn(),
    };

    offboardingService = new OffboardingService({
      userDAO: mockUserDAO,
      leaseDAO: mockLeaseDAO,
      propertyDAO: { updateById: jest.fn() } as any,
      propertyUnitDAO: { updateById: jest.fn() } as any,
      paymentDAO: mockPaymentDAO,
      leaseService: mockLeaseService as any,
      inspectionDAO: mockInspectionDAO,
      inspectionService: mockInspectionService as any,
      leaseRenewalService: mockLeaseRenewalService as any,
      emitterService: mockEmitterService as any,
      leaseCache: { invalidateLease: jest.fn(), invalidateLeaseLists: jest.fn() } as any,
      authCache: { invalidateCurrentUser: jest.fn() } as any,
      maintenanceRequestDAO: mockMaintenanceRequestDAO as any,
      maintenancePaymentService: mockMaintenancePaymentService as any,
      sseService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
      vendorDAO: { disconnectClient: jest.fn() } as any,
      clientDAO: { findFirst: jest.fn() } as any,
      emailQueue: { addToEmailQueue: jest.fn() } as any,
    });
  });

  describe('submitVacateRequest', () => {
    it('should successfully submit a vacate request', async () => {
      const lease = makeActiveLease();
      const futureDate = dayjs().add(45, 'days').toDate();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.submitVacateRequest.mockResolvedValue({
        ...lease,
        vacateRequest: {
          status: 'pending',
          requestedMoveOutDate: futureDate,
          reason: 'Relocating',
        },
      } as any);

      const result = await offboardingService.submitVacateRequest(
        testCuid,
        testLuid,
        { requestedMoveOutDate: futureDate, reason: 'Relocating' },
        mockTenantContext as IRequestContext
      );

      expect(result.success).toBe(true);
      expect(mockLeaseDAO.submitVacateRequest).toHaveBeenCalledWith(
        testCuid,
        mockLeaseId.toString(),
        { requestedMoveOutDate: futureDate, reason: 'Relocating' }
      );
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.VACATE_REQUEST_SUBMITTED,
        expect.objectContaining({
          luid: testLuid,
          cuid: testCuid,
          tenantId: mockTenantId.toString(),
          requestedMoveOutDate: futureDate,
          reason: 'Relocating',
        })
      );
    });

    it('should throw BadRequestError when lease is not found', async () => {
      mockLeaseDAO.findFirst.mockResolvedValue(null);

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: dayjs().add(45, 'days').toDate(), reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw ValidationRequestError when tenant is not the lease tenant', async () => {
      const otherTenantId = new Types.ObjectId();
      const lease = makeActiveLease({ tenantId: otherTenantId });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: dayjs().add(45, 'days').toDate(), reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject if a vacate request is already pending', async () => {
      const lease = makeActiveLease({
        vacateRequest: { status: 'pending', requestedMoveOutDate: new Date(), reason: 'Moving' },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: dayjs().add(45, 'days').toDate(), reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject if a renewal request is pending', async () => {
      const lease = makeActiveLease({
        renewalRequest: { status: 'pending', requestedTermMonths: 12 },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: dayjs().add(45, 'days').toDate(), reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should reject if move-out date is before the notice period', async () => {
      const lease = makeActiveLease({ renewalOptions: { noticePeriodDays: 30 } });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      // Request a date only 10 days from now (less than 30-day notice)
      const tooSoonDate = dayjs().add(10, 'days').toDate();

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: tooSoonDate, reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should use default 30-day notice period when renewalOptions is absent', async () => {
      const lease = makeActiveLease({ renewalOptions: null });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      // 15 days from now should fail with default 30-day notice
      const tooSoonDate = dayjs().add(15, 'days').toDate();

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: tooSoonDate, reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should respect custom notice period from renewalOptions', async () => {
      const lease = makeActiveLease({ renewalOptions: { noticePeriodDays: 60 } });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.submitVacateRequest.mockResolvedValue({
        ...lease,
        vacateRequest: { status: 'pending' },
      } as any);

      // 45 days from now should fail with 60-day notice period
      const tooSoonDate = dayjs().add(45, 'days').toDate();

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: tooSoonDate, reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);

      // 65 days from now should succeed
      const validDate = dayjs().add(65, 'days').toDate();
      const result = await offboardingService.submitVacateRequest(
        testCuid,
        testLuid,
        { requestedMoveOutDate: validDate, reason: 'Relocating' },
        mockTenantContext as IRequestContext
      );

      expect(result.success).toBe(true);
    });

    it('should throw BadRequestError when DAO returns null (race condition)', async () => {
      const lease = makeActiveLease();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.submitVacateRequest.mockResolvedValue(null as any);

      await expect(
        offboardingService.submitVacateRequest(
          testCuid,
          testLuid,
          { requestedMoveOutDate: dayjs().add(45, 'days').toDate(), reason: 'Relocating' },
          mockTenantContext as IRequestContext
        )
      ).rejects.toThrow(BadRequestError);

      expect(mockEmitterService.emit).not.toHaveBeenCalled();
    });
  });

  describe('decideVacateRequest', () => {
    const requestedMoveOutDate = dayjs().add(60, 'days').toDate();

    const makeLeaseWithPendingVacate = (overrides: Record<string, any> = {}) =>
      makeActiveLease({
        vacateRequest: {
          status: 'pending',
          requestedMoveOutDate,
          reason: 'Relocating for work',
        },
        ...overrides,
      });

    it('should approve a vacate request and trigger lease termination', async () => {
      const lease = makeLeaseWithPendingVacate();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideVacateRequest.mockResolvedValue({
        ...lease,
        vacateRequest: { status: 'approved', requestedMoveOutDate, reason: 'Relocating for work' },
      } as any);

      const result = await offboardingService.decideVacateRequest(
        testCuid,
        testLuid,
        { approved: true },
        mockPMContext as IRequestContext
      );

      expect(result.success).toBe(true);

      // Verify lease termination was called with correct move-out date
      expect(mockLeaseService.terminateLease).toHaveBeenCalledWith(
        testCuid,
        testLuid,
        expect.objectContaining({
          terminationDate: expect.any(Date),
          terminationReason: expect.stringContaining('Relocating for work'),
          moveOutDate: requestedMoveOutDate,
        }),
        mockPMContext
      );

      // Verify approval event emitted
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.VACATE_REQUEST_APPROVED,
        expect.objectContaining({
          luid: testLuid,
          cuid: testCuid,
          tenantId: mockTenantId.toString(),
          decidedBy: mockPMContext.currentuser!.sub,
          approved: true,
        })
      );
    });

    it('should use adjustedMoveOutDate when provided on approval', async () => {
      const lease = makeLeaseWithPendingVacate();
      const adjustedDate = dayjs().add(90, 'days').toDate();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideVacateRequest.mockResolvedValue({
        ...lease,
        vacateRequest: { status: 'approved', requestedMoveOutDate, reason: 'Relocating for work' },
      } as any);

      await offboardingService.decideVacateRequest(
        testCuid,
        testLuid,
        { approved: true, adjustedMoveOutDate: adjustedDate },
        mockPMContext as IRequestContext
      );

      expect(mockLeaseService.terminateLease).toHaveBeenCalledWith(
        testCuid,
        testLuid,
        expect.objectContaining({
          moveOutDate: adjustedDate,
        }),
        mockPMContext
      );

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.VACATE_REQUEST_APPROVED,
        expect.objectContaining({
          adjustedMoveOutDate: adjustedDate,
        })
      );
    });

    it('should reject a vacate request and save rejection reason', async () => {
      const lease = makeLeaseWithPendingVacate();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideVacateRequest.mockResolvedValue({
        ...lease,
        vacateRequest: {
          status: 'rejected',
          requestedMoveOutDate,
          reason: 'Relocating for work',
          rejectionReason: 'Lease term not met',
        },
      } as any);

      const result = await offboardingService.decideVacateRequest(
        testCuid,
        testLuid,
        { approved: false, rejectionReason: 'Lease term not met' },
        mockPMContext as IRequestContext
      );

      expect(result.success).toBe(true);

      // Verify lease was NOT terminated
      expect(mockLeaseService.terminateLease).not.toHaveBeenCalled();

      // Verify DAO called with rejection
      expect(mockLeaseDAO.decideVacateRequest).toHaveBeenCalledWith(
        testCuid,
        mockLeaseId.toString(),
        expect.objectContaining({
          approved: false,
          decidedBy: mockPMContext.currentuser!.sub,
          rejectionReason: 'Lease term not met',
        })
      );

      // Verify rejection event emitted
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.VACATE_REQUEST_REJECTED,
        expect.objectContaining({
          luid: testLuid,
          cuid: testCuid,
          approved: false,
          rejectionReason: 'Lease term not met',
        })
      );
    });

    it('should throw BadRequestError when lease is not found', async () => {
      mockLeaseDAO.findFirst.mockResolvedValue(null);

      await expect(
        offboardingService.decideVacateRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw ValidationRequestError when no pending vacate request exists', async () => {
      const lease = makeActiveLease({ vacateRequest: null });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.decideVacateRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should throw ValidationRequestError when vacate request is already decided', async () => {
      const lease = makeActiveLease({
        vacateRequest: { status: 'approved', requestedMoveOutDate, reason: 'Moving' },
      });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);

      await expect(
        offboardingService.decideVacateRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow(ValidationRequestError);
    });

    it('should throw BadRequestError when DAO returns null (race condition)', async () => {
      const lease = makeLeaseWithPendingVacate();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideVacateRequest.mockResolvedValue(null as any);

      await expect(
        offboardingService.decideVacateRequest(
          testCuid,
          testLuid,
          { approved: true },
          mockPMContext as IRequestContext
        )
      ).rejects.toThrow(BadRequestError);

      expect(mockLeaseService.terminateLease).not.toHaveBeenCalled();
      expect(mockEmitterService.emit).not.toHaveBeenCalledWith(
        EventTypes.VACATE_REQUEST_APPROVED,
        expect.anything()
      );
    });

    it('should use a transaction for the decision', async () => {
      const lease = makeLeaseWithPendingVacate();
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockLeaseDAO.decideVacateRequest.mockResolvedValue({
        ...lease,
        vacateRequest: { status: 'rejected', requestedMoveOutDate, reason: 'Not eligible' },
      } as any);

      await offboardingService.decideVacateRequest(
        testCuid,
        testLuid,
        { approved: false, rejectionReason: 'Not eligible' },
        mockPMContext as IRequestContext
      );

      expect(mockLeaseDAO.startSession).toHaveBeenCalled();
      expect(mockLeaseDAO.withTransaction).toHaveBeenCalled();
    });
  });

  describe('closeOpenServiceRequests (via LEASE_TERMINATED event)', () => {
    let terminatedEventHandler: (...args: any[]) => any;

    beforeEach(() => {
      // Capture the event handler registered for LEASE_TERMINATED
      const onCalls = mockEmitterService.on.mock.calls;
      const terminatedCall = onCalls.find(
        ([eventType]: [string]) => eventType === EventTypes.LEASE_TERMINATED
      );
      terminatedEventHandler = terminatedCall?.[1];
    });

    it('should register a LEASE_TERMINATED event listener', () => {
      expect(terminatedEventHandler).toBeDefined();
    });

    it('should auto-charge billable SRs with approved invoices and cancel all open SRs', async () => {
      const lease = makeActiveLease({ status: LeaseStatus.TERMINATED });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockInspectionDAO.findFirst.mockResolvedValue(null); // no existing move-out inspection

      const billableSR = {
        _id: new Types.ObjectId(),
        mruid: 'SR001',
        isBillable: true,
        invoiceId: { status: InvoiceStatus.APPROVED, amountInCents: 15000 },
      };
      const nonBillableSR = {
        _id: new Types.ObjectId(),
        mruid: 'SR002',
        isBillable: false,
        invoiceId: null,
      };

      mockMaintenanceRequestDAO.list.mockResolvedValue({
        items: [billableSR, nonBillableSR],
      });

      await terminatedEventHandler({
        leaseId: mockLeaseId.toString(),
        luid: testLuid,
        cuid: testCuid,
        terminatedBy: mockPMContext.currentuser!.sub,
        moveOutDate: dayjs().add(30, 'days').toDate(),
      });

      // Verify auto-charge was attempted for billable SR
      expect(mockMaintenancePaymentService.chargeForMaintenance).toHaveBeenCalledWith(
        testCuid,
        'system',
        expect.objectContaining({
          mruid: 'SR001',
          tenantId: mockTenantId.toString(),
          amount: 15000,
        })
      );

      // Verify non-billable SR was not charged
      expect(mockMaintenancePaymentService.chargeForMaintenance).toHaveBeenCalledTimes(1);

      // Verify all open SRs were bulk cancelled
      expect(mockMaintenanceRequestDAO.updateMany).toHaveBeenCalledWith(
        { _id: { $in: [billableSR._id, nonBillableSR._id] } },
        {
          $set: {
            status: MaintenanceRequestStatus.CANCELLED,
            completedAt: expect.any(Date),
          },
        }
      );
    });

    it('should skip closing when no open service requests exist', async () => {
      const lease = makeActiveLease({ status: LeaseStatus.TERMINATED });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockInspectionDAO.findFirst.mockResolvedValue(null);
      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [] });

      await terminatedEventHandler({
        leaseId: mockLeaseId.toString(),
        luid: testLuid,
        cuid: testCuid,
        terminatedBy: 'system',
        moveOutDate: new Date(),
      });

      expect(mockMaintenancePaymentService.chargeForMaintenance).not.toHaveBeenCalled();
      expect(mockMaintenanceRequestDAO.updateMany).not.toHaveBeenCalled();
    });

    it('should continue cancelling SRs even if auto-charge fails', async () => {
      const lease = makeActiveLease({ status: LeaseStatus.TERMINATED });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockInspectionDAO.findFirst.mockResolvedValue(null);

      const billableSR = {
        _id: new Types.ObjectId(),
        mruid: 'SR001',
        isBillable: true,
        invoiceId: { status: InvoiceStatus.APPROVED, amountInCents: 5000 },
      };

      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [billableSR] });
      mockMaintenancePaymentService.chargeForMaintenance.mockRejectedValue(
        new Error('Payment already exists')
      );

      await terminatedEventHandler({
        leaseId: mockLeaseId.toString(),
        luid: testLuid,
        cuid: testCuid,
        terminatedBy: 'system',
        moveOutDate: new Date(),
      });

      // Charge was attempted but failed
      expect(mockMaintenancePaymentService.chargeForMaintenance).toHaveBeenCalled();

      // SRs should still be cancelled despite charge failure
      expect(mockMaintenanceRequestDAO.updateMany).toHaveBeenCalledWith(
        { _id: { $in: [billableSR._id] } },
        expect.objectContaining({
          $set: expect.objectContaining({
            status: MaintenanceRequestStatus.CANCELLED,
          }),
        })
      );
    });

    it('should not charge SRs whose invoice is not approved', async () => {
      const lease = makeActiveLease({ status: LeaseStatus.TERMINATED });
      mockLeaseDAO.findFirst.mockResolvedValue(lease as any);
      mockInspectionDAO.findFirst.mockResolvedValue(null);

      const draftInvoiceSR = {
        _id: new Types.ObjectId(),
        mruid: 'SR003',
        isBillable: true,
        invoiceId: { status: InvoiceStatus.PENDING, amountInCents: 8000 },
      };

      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [draftInvoiceSR] });

      await terminatedEventHandler({
        leaseId: mockLeaseId.toString(),
        luid: testLuid,
        cuid: testCuid,
        terminatedBy: 'system',
        moveOutDate: new Date(),
      });

      expect(mockMaintenancePaymentService.chargeForMaintenance).not.toHaveBeenCalled();

      // SR should still be cancelled
      expect(mockMaintenanceRequestDAO.updateMany).toHaveBeenCalled();
    });
  });
});
