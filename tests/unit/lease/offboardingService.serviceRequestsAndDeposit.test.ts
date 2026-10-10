import { Types } from 'mongoose';
import { LeaseStatus } from '@interfaces/lease.interface';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { InspectionType } from '@interfaces/inspection.interface';
import { MaintenanceRequestStatus } from '@interfaces/maintenanceRequest.interface';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';

const SYSTEM_BOT_ID = new Types.ObjectId();

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@utils/systemBot', () => ({
  getSystemBotUserId: jest.fn().mockResolvedValue(SYSTEM_BOT_ID),
  buildSystemRequestContext: jest.fn(),
}));

import { OffboardingService } from '@services/offboarding/offboarding.service';

const CUID = 'TESTCLIENT123';
const tenantId = new Types.ObjectId();
const propertyId = new Types.ObjectId();

const makeServiceRequest = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  mruid: `MR-${Math.random().toString(36).slice(2, 8)}`,
  status: MaintenanceRequestStatus.IN_PROGRESS,
  isBillable: false,
  ...overrides,
});

describe('OffboardingService', () => {
  let service: OffboardingService;
  let mockMaintenanceRequestDAO: { list: jest.Mock; updateMany: jest.Mock };
  let mockPaymentDAO: { list: jest.Mock; countDocuments: jest.Mock };
  let mockChargeForMaintenance: jest.Mock;
  let mockLeaseDAO: { findFirst: jest.Mock };
  let mockInspectionDAO: { findFirst: jest.Mock };
  let mockFindLeaseDepositPayment: jest.Mock;

  beforeEach(() => {
    mockMaintenanceRequestDAO = {
      list: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({}),
    };
    mockPaymentDAO = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      countDocuments: jest.fn().mockResolvedValue(0),
    };
    mockChargeForMaintenance = jest.fn().mockResolvedValue({ success: true });
    mockLeaseDAO = { findFirst: jest.fn() };
    mockInspectionDAO = { findFirst: jest.fn().mockResolvedValue(null) };
    mockFindLeaseDepositPayment = jest.fn().mockResolvedValue(null);

    service = new OffboardingService({
      userDAO: {} as any,
      leaseDAO: mockLeaseDAO as any,
      propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
      paymentDAO: mockPaymentDAO as any,
      invoiceDAO: {} as any,
      leaseService: {} as any,
      inspectionDAO: mockInspectionDAO as any,
      inspectionService: { findLeaseDepositPayment: mockFindLeaseDepositPayment } as any,
      leaseRenewalService: {} as any,
      emitterService: { on: jest.fn(), emit: jest.fn() } as any,
      maintenanceRequestDAO: mockMaintenanceRequestDAO as any,
      maintenancePaymentService: { chargeForMaintenance: mockChargeForMaintenance } as any,
      sseService: {} as any,
      vendorDAO: {} as any,
      clientDAO: {} as any,
      emailQueue: {} as any,
    });
  });

  describe('closeOpenServiceRequests (lease expiry / termination)', () => {
    const closeOpenServiceRequests = () =>
      (service as any).closeOpenServiceRequests(CUID, tenantId.toString(), propertyId.toString());
    const cancelledIds = () =>
      mockMaintenanceRequestDAO.updateMany.mock.calls[0]?.[0]._id.$in.map(String) ?? [];

    it('cancels service requests with no approved work or charges', async () => {
      const plainRequest = makeServiceRequest();
      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [plainRequest] });

      await closeOpenServiceRequests();

      expect(cancelledIds()).toEqual([plainRequest._id.toString()]);
      expect(mockMaintenanceRequestDAO.updateMany.mock.calls[0][1]).toEqual({
        $set: { status: MaintenanceRequestStatus.CANCELLED, completedAt: expect.any(Date) },
      });
    });

    it('charges billable approved work and leaves the request open for completion', async () => {
      const billable = makeServiceRequest({
        isBillable: true,
        invoiceId: { status: InvoiceStatus.APPROVED, amountInCents: 12000 },
      });
      const plainRequest = makeServiceRequest();
      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [billable, plainRequest] });

      await closeOpenServiceRequests();

      expect(mockChargeForMaintenance).toHaveBeenCalledWith(
        CUID,
        SYSTEM_BOT_ID.toString(),
        expect.objectContaining({ mruid: billable.mruid, tenantId: tenantId.toString() })
      );
      expect(cancelledIds()).toEqual([plainRequest._id.toString()]);
    });

    it('leaves a non-billable request with an approved invoice open', async () => {
      const approvedWork = makeServiceRequest({
        invoiceId: { status: InvoiceStatus.APPROVED, amountInCents: 5000 },
      });
      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [approvedWork] });

      await closeOpenServiceRequests();

      expect(mockChargeForMaintenance).not.toHaveBeenCalled();
      expect(mockMaintenanceRequestDAO.updateMany).not.toHaveBeenCalled();
    });

    it('leaves a request that already has a (non-cancelled) maintenance charge open', async () => {
      const charged = makeServiceRequest();
      const plainRequest = makeServiceRequest();
      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [charged, plainRequest] });
      mockPaymentDAO.list.mockResolvedValue({
        items: [{ maintenanceRequestUid: charged.mruid }],
      });

      await closeOpenServiceRequests();

      expect(mockPaymentDAO.list).toHaveBeenCalledWith(
        expect.objectContaining({
          cuid: CUID,
          maintenanceRequestUid: { $in: [charged.mruid, plainRequest.mruid] },
          paymentType: PaymentRecordType.MAINTENANCE,
          status: { $ne: PaymentRecordStatus.CANCELLED },
        }),
        expect.anything()
      );
      expect(cancelledIds()).toEqual([plainRequest._id.toString()]);
    });

    it('keeps billable approved work open even when the auto-charge fails', async () => {
      const billable = makeServiceRequest({
        isBillable: true,
        invoiceId: { status: InvoiceStatus.APPROVED, amountInCents: 12000 },
      });
      mockMaintenanceRequestDAO.list.mockResolvedValue({ items: [billable] });
      mockChargeForMaintenance.mockRejectedValue(new Error('Payment account not configured'));

      await closeOpenServiceRequests();

      expect(mockMaintenanceRequestDAO.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('getOffboardingStatus — deposit refund status', () => {
    const lease = {
      _id: new Types.ObjectId(),
      luid: 'LEASE-1',
      cuid: CUID,
      status: LeaseStatus.TERMINATED,
      duration: { terminationDate: new Date() },
      fees: { securityDeposit: 150000 },
      petPolicy: { allowed: true, deposit: 30000 },
    };

    beforeEach(() => {
      mockLeaseDAO.findFirst.mockResolvedValue(lease);
    });

    it('reports the deposit record amount (security + pet) and "pending" until it is refunded', async () => {
      mockFindLeaseDepositPayment.mockResolvedValue({
        status: PaymentRecordStatus.PAID,
        baseAmount: 180000,
      });
      mockInspectionDAO.findFirst.mockResolvedValue({
        type: InspectionType.MOVE_OUT,
        status: 'approved',
        refundInfo: { amount: 180000, proposedRefund: 180000, isRefunded: false },
      });

      const result = await service.getOffboardingStatus(CUID, lease.luid);

      expect(mockFindLeaseDepositPayment).toHaveBeenCalledWith(CUID, lease);
      expect(result.data).toEqual(
        expect.objectContaining({ depositAmount: 180000, depositRefundStatus: 'pending' })
      );
    });

    it('reports "refunded" once the deposit record is refunded', async () => {
      mockFindLeaseDepositPayment.mockResolvedValue({
        status: PaymentRecordStatus.REFUNDED,
        baseAmount: 180000,
      });

      const result = await service.getOffboardingStatus(CUID, lease.luid);

      expect(result.data.depositRefundStatus).toBe('refunded');
    });

    it('falls back to the configured security + pet deposit when no record exists', async () => {
      const result = await service.getOffboardingStatus(CUID, lease.luid);

      expect(result.data).toEqual(
        expect.objectContaining({ depositAmount: 180000, depositRefundStatus: 'pending' })
      );
    });
  });

  describe('closurePreflightCheck', () => {
    const totals = (count: number, totalCents: number) =>
      jest.fn().mockResolvedValue(count ? [{ _id: null, count, totalCents }] : []);

    const buildPreflightService = (daos: Record<string, any>) =>
      new OffboardingService({
        leaseDAO: {} as any,
        paymentDAO: {} as any,
        invoiceDAO: {} as any,
        userDAO: {} as any,
        propertyDAO: {} as any,
        propertyUnitDAO: {} as any,
        leaseService: {} as any,
        inspectionDAO: {} as any,
        inspectionService: {} as any,
        leaseRenewalService: {} as any,
        emitterService: { on: jest.fn(), emit: jest.fn() } as any,
        maintenanceRequestDAO: {} as any,
        maintenancePaymentService: {} as any,
        sseService: {} as any,
        vendorDAO: {} as any,
        clientDAO: {} as any,
        emailQueue: {} as any,
        ...daos,
      });

    it('totals every matching record in the database and queries standalone invoices', async () => {
      const paymentDAO = { aggregate: totals(1500, 3_000_000) };
      const invoiceDAO = { aggregate: totals(2, 45000) };
      const leaseDAO = {
        aggregate: totals(40, 8_000_000),
        countDocuments: jest.fn().mockResolvedValue(40),
      };
      const preflightService = buildPreflightService({ paymentDAO, invoiceDAO, leaseDAO });

      const result = await preflightService.closurePreflightCheck(CUID);

      expect(result.data.canProceed).toBe(true);
      expect(result.data.warnings).toEqual([
        expect.objectContaining({
          type: 'outstanding_payments',
          count: 1500,
          totalCents: 3_000_000,
        }),
        expect.objectContaining({ type: 'unpaid_vendor_invoices', count: 2, totalCents: 45000 }),
        expect.objectContaining({ type: 'security_deposits', count: 40, totalCents: 8_000_000 }),
        expect.objectContaining({ type: 'active_leases', count: 40 }),
      ]);
      expect(invoiceDAO.aggregate.mock.calls[0][0][0].$match).toEqual(
        expect.objectContaining({
          cuid: CUID,
          status: InvoiceStatus.APPROVED,
          vendorPayoutStatus: { $ne: 'paid' },
        })
      );
      expect(paymentDAO.aggregate.mock.calls[0][0][0].$match).toEqual(
        expect.objectContaining({ cuid: CUID, vendorId: { $exists: false } })
      );
    });

    it('returns no warnings when nothing is outstanding', async () => {
      const preflightService = buildPreflightService({
        paymentDAO: { aggregate: totals(0, 0) },
        invoiceDAO: { aggregate: totals(0, 0) },
        leaseDAO: { aggregate: totals(0, 0), countDocuments: jest.fn().mockResolvedValue(0) },
      });

      const result = await preflightService.closurePreflightCheck(CUID);

      expect(result.data.warnings).toEqual([]);
    });
  });
});
