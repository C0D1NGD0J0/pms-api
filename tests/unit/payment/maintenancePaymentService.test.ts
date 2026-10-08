import { Types } from 'mongoose';

// Break the circular import chain through the DI container (mirrors paymentService.test.ts)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { EventTypes } from '@interfaces/events.interface';
import { InvoiceStatus } from '@interfaces/invoice.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';
import { MaintenancePaymentService } from '@services/payments/maintenancePayment.service';

const CUID = 'CUID-MAINT-001';
const MRUID = 'MR-MAINT-001';
const INVUID = 'INV-MAINT-001';
const TENANT_USER_ID = new Types.ObjectId().toString();
const PM_USER_ID = new Types.ObjectId().toString();
const PROPERTY_ID = new Types.ObjectId();
const SERVICE_FEE_PERCENT = 4;
const INVOICE_AMOUNT = 30000;
const EXPECTED_FEE = 1200; // 4% of 30000
const EXPECTED_TOTAL = INVOICE_AMOUNT + EXPECTED_FEE;

const makeRequest = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  mruid: MRUID,
  cuid: CUID,
  title: 'Leaking pipe',
  isBillable: true,
  tenantId: new Types.ObjectId(TENANT_USER_ID),
  propertyId: PROPERTY_ID,
  ...overrides,
});

const makeInvoice = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  invuid: INVUID,
  mruid: MRUID,
  cuid: CUID,
  status: InvoiceStatus.APPROVED,
  amountInCents: INVOICE_AMOUNT,
  currency: 'CAD',
  lineItems: [{ description: 'Pipe replacement', amountInCents: INVOICE_AMOUNT }],
  vendorPayoutStatus: 'pending',
  submittedBy: new Types.ObjectId(),
  ...overrides,
});

function buildService() {
  const mocks = {
    maintenanceRequestDAO: { getByMruid: jest.fn() },
    invoiceDAO: {
      findByMaintenanceRequest: jest.fn(),
      updateById: jest.fn().mockReturnValue(Promise.resolve({})),
      update: jest.fn(),
    },
    paymentDAO: { findFirst: jest.fn(), insert: jest.fn() },
    profileDAO: { getProfileByUserId: jest.fn() },
    clientDAO: { findFirst: jest.fn() },
    subscriptionDAO: { findFirst: jest.fn() },
    paymentProcessorDAO: { findFirst: jest.fn(), findByVuid: jest.fn() },
    vendorDAO: { findFirst: jest.fn() },
    leaseDAO: { getActiveLeaseByTenant: jest.fn(), findFirst: jest.fn() },
    userDAO: { findFirst: jest.fn() },
    paymentGatewayService: { createTransfer: jest.fn() },
    emitterService: { emit: jest.fn(), on: jest.fn() },
    smsService: { sendToUser: jest.fn().mockReturnValue(Promise.resolve({})) },
    subscriptionPlanConfig: {
      getTransactionFeePercent: jest.fn().mockReturnValue(SERVICE_FEE_PERCENT),
    },
  };

  const service = new MaintenancePaymentService(mocks as any);
  return { service, mocks };
}

// ═════════════════════════════════════════════════════════════════════════════
// chargeForMaintenance — S1 validation, S11 notice, S13 dedupe
// ═════════════════════════════════════════════════════════════════════════════

describe('MaintenancePaymentService - chargeForMaintenance', () => {
  let service: MaintenancePaymentService;
  let mocks: ReturnType<typeof buildService>['mocks'];

  beforeEach(() => {
    ({ service, mocks } = buildService());
    mocks.clientDAO.findFirst.mockReturnValue(Promise.resolve({ cuid: CUID }));
    mocks.maintenanceRequestDAO.getByMruid.mockReturnValue(Promise.resolve(makeRequest()));
    mocks.invoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(makeInvoice()));
    mocks.userDAO.findFirst.mockReturnValue(
      Promise.resolve({ _id: new Types.ObjectId(TENANT_USER_ID) })
    );
    mocks.leaseDAO.findFirst.mockReturnValue(Promise.resolve(null));
    mocks.leaseDAO.getActiveLeaseByTenant.mockReturnValue(
      Promise.resolve({ fees: { currency: 'CAD' } })
    );
    mocks.subscriptionDAO.findFirst.mockReturnValue(
      Promise.resolve({ status: 'active', planName: 'growth' })
    );
    mocks.paymentProcessorDAO.findFirst.mockReturnValue(
      Promise.resolve({ accountId: 'acct_pm', chargesEnabled: true })
    );
    mocks.profileDAO.getProfileByUserId.mockReturnValue(
      Promise.resolve({ _id: new Types.ObjectId() })
    );
    mocks.paymentDAO.findFirst.mockReturnValue(Promise.resolve(null));
    mocks.paymentDAO.insert.mockImplementation((data: any) =>
      Promise.resolve({ ...data, pytuid: 'PYT-NEW' })
    );
  });

  it('derives the amount from the approved invoice and ignores a caller-supplied amount', async () => {
    await service.chargeForMaintenance(CUID, TENANT_USER_ID, {
      mruid: MRUID,
      tenantId: TENANT_USER_ID,
      amount: 1,
    });

    const inserted = mocks.paymentDAO.insert.mock.calls[0][0];
    expect(inserted.baseAmount).toBe(EXPECTED_TOTAL);
    expect(inserted.applicationFee).toBe(EXPECTED_FEE);
    expect(inserted.currency).toBe('CAD');
    expect(inserted.lineItems).toEqual([
      { description: 'Pipe replacement', amountInCents: INVOICE_AMOUNT },
      { description: 'Service Fee', amountInCents: EXPECTED_FEE },
    ]);
  });

  it('supports the tenant "ensure" path with no amount at all', async () => {
    const result = await service.chargeForMaintenance(CUID, TENANT_USER_ID, {
      mruid: MRUID,
      tenantId: TENANT_USER_ID,
    });

    expect(result.success).toBe(true);
    expect(mocks.paymentDAO.insert.mock.calls[0][0].baseAmount).toBe(EXPECTED_TOTAL);
  });

  it('emits MAINTENANCE_CHARGE_CREATED so the tenant is told before any auto-charge', async () => {
    await service.chargeForMaintenance(CUID, PM_USER_ID, {
      mruid: MRUID,
      tenantId: TENANT_USER_ID,
    });

    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_CHARGE_CREATED,
      expect.objectContaining({
        pytuid: 'PYT-NEW',
        tenantId: TENANT_USER_ID,
        amountInCents: EXPECTED_TOTAL,
        serviceFeeInCents: EXPECTED_FEE,
        currency: 'CAD',
        mruid: MRUID,
        title: 'Leaking pipe',
        cuid: CUID,
        dueDate: expect.any(Date),
      })
    );
  });

  it('throws NotFoundError when the maintenance request is not in this client', async () => {
    mocks.maintenanceRequestDAO.getByMruid.mockReturnValue(Promise.resolve(null));

    await expect(
      service.chargeForMaintenance(CUID, TENANT_USER_ID, { mruid: MRUID, tenantId: TENANT_USER_ID })
    ).rejects.toThrow(NotFoundError);
    expect(mocks.maintenanceRequestDAO.getByMruid).toHaveBeenCalledWith(MRUID, CUID);
    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
  });

  it('throws BadRequestError when the request is not billable', async () => {
    mocks.maintenanceRequestDAO.getByMruid.mockReturnValue(
      Promise.resolve(makeRequest({ isBillable: false }))
    );

    await expect(
      service.chargeForMaintenance(CUID, TENANT_USER_ID, { mruid: MRUID, tenantId: TENANT_USER_ID })
    ).rejects.toThrow(BadRequestError);
    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['pending', makeInvoice({ status: InvoiceStatus.PENDING })],
    ['rejected', makeInvoice({ status: InvoiceStatus.REJECTED })],
  ])('throws BadRequestError when the invoice is %s', async (_label, invoice) => {
    mocks.invoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(invoice));

    await expect(
      service.chargeForMaintenance(CUID, TENANT_USER_ID, { mruid: MRUID, tenantId: TENANT_USER_ID })
    ).rejects.toThrow(BadRequestError);
    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
  });

  it('throws NotFoundError when the tenant does not belong to the client', async () => {
    mocks.userDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await expect(
      service.chargeForMaintenance(CUID, TENANT_USER_ID, { mruid: MRUID, tenantId: TENANT_USER_ID })
    ).rejects.toThrow(NotFoundError);
    expect(mocks.userDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ 'cuids.cuid': CUID, deletedAt: null })
    );
    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
  });

  it('throws ForbiddenError when the tenant is neither the request tenant nor leased on the property', async () => {
    const otherTenantId = new Types.ObjectId().toString();
    mocks.userDAO.findFirst.mockReturnValue(
      Promise.resolve({ _id: new Types.ObjectId(otherTenantId) })
    );

    await expect(
      service.chargeForMaintenance(CUID, otherTenantId, { mruid: MRUID, tenantId: otherTenantId })
    ).rejects.toThrow(ForbiddenError);
    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
  });

  it('allows billing another tenant leased on the request property/unit', async () => {
    const otherTenantId = new Types.ObjectId().toString();
    const unitId = new Types.ObjectId();
    mocks.maintenanceRequestDAO.getByMruid.mockReturnValue(
      Promise.resolve(makeRequest({ propertyUnitId: unitId }))
    );
    mocks.userDAO.findFirst.mockReturnValue(
      Promise.resolve({ _id: new Types.ObjectId(otherTenantId) })
    );
    mocks.leaseDAO.findFirst.mockReturnValue(Promise.resolve({ luid: 'L1' }));

    await service.chargeForMaintenance(CUID, PM_USER_ID, {
      mruid: MRUID,
      tenantId: otherTenantId,
    });

    expect(mocks.leaseDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: CUID,
        'property.id': PROPERTY_ID,
        'property.unitId': unitId,
      })
    );
    expect(mocks.paymentDAO.insert).toHaveBeenCalledTimes(1);
  });

  it('dedupes only against live charges (pending/overdue/processing/paid)', async () => {
    await service.chargeForMaintenance(CUID, TENANT_USER_ID, {
      mruid: MRUID,
      tenantId: TENANT_USER_ID,
    });

    expect(mocks.paymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        maintenanceRequestUid: MRUID,
        paymentType: PaymentRecordType.MAINTENANCE,
        status: {
          $in: [
            PaymentRecordStatus.PENDING,
            PaymentRecordStatus.OVERDUE,
            PaymentRecordStatus.PROCESSING,
            PaymentRecordStatus.PAID,
          ],
        },
      })
    );
  });

  it('returns the existing live charge without creating a new one or re-notifying', async () => {
    const existing = { pytuid: 'PYT-EXISTING', status: PaymentRecordStatus.PENDING };
    mocks.paymentDAO.findFirst.mockReturnValue(Promise.resolve(existing));

    const result = await service.chargeForMaintenance(CUID, TENANT_USER_ID, {
      mruid: MRUID,
      tenantId: TENANT_USER_ID,
    });

    expect(result.data).toBe(existing);
    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
    expect(mocks.emitterService.emit).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleMaintenanceInvoiceApproved — S13 dedupe, L5 skipped-charge notice
// ═════════════════════════════════════════════════════════════════════════════

describe('MaintenancePaymentService - handleMaintenanceInvoiceApproved', () => {
  let service: MaintenancePaymentService;
  let mocks: ReturnType<typeof buildService>['mocks'];

  const makePayload = (overrides: Record<string, any> = {}) => ({
    requestId: new Types.ObjectId().toString(),
    invoiceId: new Types.ObjectId().toString(),
    mruid: MRUID,
    cuid: CUID,
    title: 'Leaking pipe',
    amount: INVOICE_AMOUNT,
    currency: 'CAD',
    approvedBy: PM_USER_ID,
    tenantId: TENANT_USER_ID,
    isBillable: true,
    invoiceLineItems: [],
    ...overrides,
  });

  beforeEach(() => {
    ({ service, mocks } = buildService());
    mocks.paymentDAO.findFirst.mockReturnValue(Promise.resolve(null));
    mocks.paymentDAO.insert.mockImplementation((data: any) =>
      Promise.resolve({ ...data, pytuid: 'PYT-EVT' })
    );
    mocks.profileDAO.getProfileByUserId.mockReturnValue(
      Promise.resolve({ _id: new Types.ObjectId() })
    );
    mocks.subscriptionDAO.findFirst.mockReturnValue(Promise.resolve({ planName: 'growth' }));
    mocks.leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(null));
  });

  it('emits MAINTENANCE_CHARGE_SKIPPED for the PM when a billable request has no tenant', async () => {
    await service.handleMaintenanceInvoiceApproved(makePayload({ tenantId: undefined }) as any);

    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_CHARGE_SKIPPED,
      expect.objectContaining({
        reason: 'no_tenant',
        notifyUserId: PM_USER_ID,
        amountInCents: INVOICE_AMOUNT,
        mruid: MRUID,
        cuid: CUID,
      })
    );
  });

  it('emits MAINTENANCE_CHARGE_SKIPPED when the tenant profile is missing', async () => {
    mocks.profileDAO.getProfileByUserId.mockReturnValue(Promise.resolve(null));

    await service.handleMaintenanceInvoiceApproved(makePayload() as any);

    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_CHARGE_SKIPPED,
      expect.objectContaining({ reason: 'tenant_profile_not_found' })
    );
  });

  it('does nothing for a non-billable request', async () => {
    await service.handleMaintenanceInvoiceApproved(makePayload({ isBillable: false }) as any);

    expect(mocks.paymentDAO.insert).not.toHaveBeenCalled();
    expect(mocks.emitterService.emit).not.toHaveBeenCalled();
  });

  it('creates a fresh charge when the only previous charge was cancelled (live-status dedupe)', async () => {
    await service.handleMaintenanceInvoiceApproved(makePayload() as any);

    expect(mocks.paymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ status: { $in: expect.any(Array) } })
    );
    const dedupeStatuses = mocks.paymentDAO.findFirst.mock.calls[0][0].status.$in;
    expect(dedupeStatuses).not.toContain(PaymentRecordStatus.CANCELLED);
    expect(dedupeStatuses).not.toContain(PaymentRecordStatus.REFUNDED);
    expect(mocks.paymentDAO.insert).toHaveBeenCalledTimes(1);
    expect(mocks.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_CHARGE_CREATED,
      expect.objectContaining({ amountInCents: EXPECTED_TOTAL, serviceFeeInCents: EXPECTED_FEE })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// quoteTenantMaintenanceCharge — M9 consistent tenant quote
// ═════════════════════════════════════════════════════════════════════════════

describe('MaintenancePaymentService - quoteTenantMaintenanceCharge', () => {
  it('returns the same fee/total the charge will use', async () => {
    const { service, mocks } = buildService();
    mocks.subscriptionDAO.findFirst.mockReturnValue(Promise.resolve({ planName: 'growth' }));

    const quote = await service.quoteTenantMaintenanceCharge(CUID, INVOICE_AMOUNT);

    expect(quote).toEqual({ serviceFeeCents: EXPECTED_FEE, totalAmount: EXPECTED_TOTAL });
    expect(mocks.subscriptionPlanConfig.getTransactionFeePercent).toHaveBeenCalledWith('growth');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// payVendor — S12 atomic claim + idempotency, partial refunds
// ═════════════════════════════════════════════════════════════════════════════

describe('MaintenancePaymentService - payVendor claim and refunds', () => {
  let service: MaintenancePaymentService;
  let mocks: ReturnType<typeof buildService>['mocks'];
  const VENDOR_USER_ID = new Types.ObjectId();

  beforeEach(() => {
    ({ service, mocks } = buildService());
    mocks.invoiceDAO.findByMaintenanceRequest.mockReturnValue(
      Promise.resolve(makeInvoice({ submittedBy: VENDOR_USER_ID }))
    );
    mocks.invoiceDAO.update.mockReturnValue(Promise.resolve({ vendorPayoutStatus: 'processing' }));
    mocks.paymentProcessorDAO.findFirst.mockReturnValue(
      Promise.resolve({ accountId: 'acct_pm', chargesEnabled: true })
    );
    mocks.userDAO.findFirst.mockReturnValue(
      Promise.resolve({
        _id: VENDOR_USER_ID,
        uid: 'VENDOR-UID',
        cuids: [{ cuid: CUID, linkedVendorUid: 'VUID-1' }],
      })
    );
    mocks.paymentProcessorDAO.findByVuid.mockReturnValue(
      Promise.resolve({ accountId: 'acct_vendor' })
    );
    mocks.vendorDAO.findFirst.mockReturnValue(
      Promise.resolve({
        vuid: 'VUID-1',
        connectedClients: [{ cuid: CUID, payoutAccount: { isSetup: true, payoutsEnabled: true } }],
      })
    );
    mocks.paymentDAO.findFirst.mockReturnValue(
      Promise.resolve({
        status: PaymentRecordStatus.PAID,
        gatewayChargeId: 'ch_1',
        baseAmount: EXPECTED_TOTAL,
      })
    );
    mocks.paymentGatewayService.createTransfer.mockReturnValue(
      Promise.resolve({ success: true, data: { transferId: 'tr_1', amount: INVOICE_AMOUNT } })
    );
  });

  it('claims the invoice atomically and passes a per-invoice idempotency key', async () => {
    await service.payVendor(CUID, MRUID);

    const [claimFilter, claimUpdate] = mocks.invoiceDAO.update.mock.calls[0];
    expect(claimFilter).toEqual(
      expect.objectContaining({ status: InvoiceStatus.APPROVED, $or: expect.any(Array) })
    );
    expect(claimUpdate.$set.vendorPayoutStatus).toBe('processing');
    expect(mocks.paymentGatewayService.createTransfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ idempotencyKey: `vendor-payout:${INVUID}` })
    );
    expect(mocks.invoiceDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: expect.objectContaining({
          vendorPayoutStatus: 'paid',
          vendorPayoutTransferId: 'tr_1',
        }),
      })
    );
  });

  it('does not transfer when another attempt already holds the claim', async () => {
    mocks.invoiceDAO.update.mockReturnValue(Promise.resolve(null));

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mocks.paymentGatewayService.createTransfer).not.toHaveBeenCalled();
  });

  it('rejects while a recent payout attempt is still processing', async () => {
    mocks.invoiceDAO.findByMaintenanceRequest.mockReturnValue(
      Promise.resolve(
        makeInvoice({ vendorPayoutStatus: 'processing', vendorPayoutClaimedAt: new Date() })
      )
    );

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mocks.invoiceDAO.update).not.toHaveBeenCalled();
    expect(mocks.paymentGatewayService.createTransfer).not.toHaveBeenCalled();
  });

  it('releases the claim back to pending when the transfer fails', async () => {
    mocks.paymentGatewayService.createTransfer.mockReturnValue(
      Promise.resolve({ success: false, data: null, message: 'insufficient funds' })
    );

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow('insufficient funds');

    expect(mocks.invoiceDAO.update).toHaveBeenCalledTimes(2);
    const [releaseFilter, releaseUpdate] = mocks.invoiceDAO.update.mock.calls[1];
    expect(releaseFilter.vendorPayoutStatus).toBe('processing');
    expect(releaseUpdate.$set.vendorPayoutStatus).toBe('pending');
    expect(mocks.invoiceDAO.updateById).not.toHaveBeenCalled();
  });

  it('releases the claim when the gateway throws', async () => {
    mocks.paymentGatewayService.createTransfer.mockReturnValue(
      Promise.reject(new Error('network down'))
    );

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow('network down');
    expect(mocks.invoiceDAO.update.mock.calls[1][1].$set.vendorPayoutStatus).toBe('pending');
  });

  it('still pays the vendor after a partial refund that leaves enough to cover the invoice', async () => {
    mocks.paymentDAO.findFirst.mockReturnValue(
      Promise.resolve({
        status: PaymentRecordStatus.PAID,
        gatewayChargeId: 'ch_1',
        baseAmount: EXPECTED_TOTAL,
        refund: { amount: EXPECTED_FEE }, // service fee refunded only
      })
    );

    const result = await service.payVendor(CUID, MRUID);

    expect(result.success).toBe(true);
    expect(mocks.paymentGatewayService.createTransfer).toHaveBeenCalled();
  });

  it('blocks payout when a partial refund leaves less than the invoice amount', async () => {
    mocks.paymentDAO.findFirst.mockReturnValue(
      Promise.resolve({
        status: PaymentRecordStatus.PAID,
        gatewayChargeId: 'ch_1',
        baseAmount: EXPECTED_TOTAL,
        refund: { amount: 10000 },
      })
    );

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mocks.invoiceDAO.update).not.toHaveBeenCalled();
    expect(mocks.paymentGatewayService.createTransfer).not.toHaveBeenCalled();
  });

  it('blocks payout when the tenant charge was fully refunded (no PAID charge)', async () => {
    mocks.paymentDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mocks.paymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ status: PaymentRecordStatus.PAID })
    );
    expect(mocks.paymentGatewayService.createTransfer).not.toHaveBeenCalled();
  });
});
