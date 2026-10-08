import { Types } from 'mongoose';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';

// Break the circular import chain: lease.service → @shared/middlewares → @di/index → registerResources → lease.service (undefined)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { LeaseService } from '@services/lease/lease.service';

describe('LeaseService - charges after a lease termination', () => {
  const CUID = 'TESTCLIENT123';
  const leaseId = new Types.ObjectId();
  const terminationDate = new Date('2026-10-15');

  let leaseService: LeaseService;
  let mockPaymentDAO: { list: jest.Mock; updateMany: jest.Mock };
  let mockPaymentGatewayService: { voidInvoice: jest.Mock };

  const makeCharge = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: `PY-${Math.random().toString(36).slice(2, 8)}`,
    paymentType: PaymentRecordType.RENT,
    status: PaymentRecordStatus.PENDING,
    dueDate: new Date('2026-11-01'),
    ...overrides,
  });

  const cancelCharges = () =>
    (leaseService as any).cancelRentChargesAfterTermination(CUID, leaseId, terminationDate);
  const cancelledIds = () => mockPaymentDAO.updateMany.mock.calls[0]?.[0]._id.$in.map(String) ?? [];

  beforeEach(() => {
    mockPaymentDAO = {
      list: jest.fn().mockResolvedValue({ items: [] }),
      updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
    };
    mockPaymentGatewayService = {
      voidInvoice: jest.fn().mockResolvedValue({ success: true, data: null }),
    };
    leaseService = new LeaseService({
      paymentDAO: mockPaymentDAO,
      paymentGatewayService: mockPaymentGatewayService,
    } as any);
  });

  it('only looks at rent and late-fee charges due after the termination date', async () => {
    await cancelCharges();

    expect(mockPaymentDAO.list).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: CUID,
        lease: leaseId,
        paymentType: { $in: [PaymentRecordType.RENT, PaymentRecordType.LATE_FEE] },
        dueDate: { $gt: terminationDate },
      }),
      expect.anything()
    );
  });

  it('voids the open Stripe invoice before cancelling the charge', async () => {
    const rent = makeCharge({ gatewayPaymentId: 'in_rent' });
    const lateFee = makeCharge({
      paymentType: PaymentRecordType.LATE_FEE,
      status: PaymentRecordStatus.OVERDUE,
      gatewayPaymentId: 'in_late',
    });
    mockPaymentDAO.list.mockResolvedValue({ items: [rent, lateFee] });

    await cancelCharges();

    expect(mockPaymentGatewayService.voidInvoice).toHaveBeenCalledWith('stripe', 'in_rent');
    expect(mockPaymentGatewayService.voidInvoice).toHaveBeenCalledWith('stripe', 'in_late');
    expect(cancelledIds()).toEqual([rent._id.toString(), lateFee._id.toString()]);
    expect(mockPaymentDAO.updateMany.mock.calls[0][1]).toEqual({
      $set: { status: PaymentRecordStatus.CANCELLED, cancelledAt: expect.any(Date) },
    });
  });

  it('cancels charges without a Stripe invoice (manual tracking) directly', async () => {
    const manualCharge = makeCharge();
    mockPaymentDAO.list.mockResolvedValue({ items: [manualCharge] });

    await cancelCharges();

    expect(mockPaymentGatewayService.voidInvoice).not.toHaveBeenCalled();
    expect(cancelledIds()).toEqual([manualCharge._id.toString()]);
  });

  it('leaves a charge open when its invoice cannot be voided', async () => {
    const unvoidable = makeCharge({ gatewayPaymentId: 'in_paid_meanwhile' });
    const voidable = makeCharge({ gatewayPaymentId: 'in_ok' });
    mockPaymentDAO.list.mockResolvedValue({ items: [unvoidable, voidable] });
    mockPaymentGatewayService.voidInvoice.mockImplementation((_provider: string, id: string) =>
      Promise.resolve(
        id === 'in_paid_meanwhile'
          ? { success: false, message: 'Invoice is already paid' }
          : { success: true }
      )
    );

    await cancelCharges();

    expect(cancelledIds()).toEqual([voidable._id.toString()]);
  });

  it('never cancels a PROCESSING charge (bank debit already submitted)', async () => {
    const processing = makeCharge({
      status: PaymentRecordStatus.PROCESSING,
      gatewayPaymentId: 'in_processing',
    });
    mockPaymentDAO.list.mockResolvedValue({ items: [processing] });

    await cancelCharges();

    expect(mockPaymentGatewayService.voidInvoice).not.toHaveBeenCalled();
    expect(mockPaymentDAO.updateMany).not.toHaveBeenCalled();
  });
});
