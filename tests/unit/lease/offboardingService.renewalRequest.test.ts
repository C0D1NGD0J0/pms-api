import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { InspectionDAO } from '@dao/inspectionDAO';
import { LeaseStatus } from '@interfaces/lease.interface';
import { EventTypes } from '@interfaces/events.interface';
import { IRequestContext } from '@interfaces/utils.interface';
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

  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();
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
      endDate: dayjs().add(15, 'days').toDate(),
    },
    property: {
      id: new Types.ObjectId(),
      unitId: new Types.ObjectId(),
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
      createDraftLeaseRenewal: jest.fn().mockResolvedValue({ success: true, data: {} }),
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
      maintenanceRequestDAO: {
        list: jest.fn().mockResolvedValue({ items: [] }),
        updateMany: jest.fn(),
      } as any,
      maintenancePaymentService: { chargeForMaintenance: jest.fn() } as any,
      sseService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
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
});
