import dayjs from 'dayjs';
import { Types } from 'mongoose';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { PaymentCronService } from '@services/payments/paymentCron.service';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';

const CUID = 'CLIENT_1';
const LATE_FEE = 5000;
const LATE_FEE_DAYS = 5;

const makePayment = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: `PYT${Math.random().toString(36).slice(2, 8)}`,
  cuid: CUID,
  status: PaymentRecordStatus.PENDING,
  paymentType: PaymentRecordType.RENT,
  baseAmount: 150000,
  dueDate: dayjs().subtract(1, 'day').toDate(),
  tenant: new Types.ObjectId(),
  lease: new Types.ObjectId(),
  isManualEntry: true,
  lineItems: [],
  ...overrides,
});

// Mirrors lease.calculateFees: the late fee applies once the payment is LATE_FEE_DAYS late
const makeLease = () => ({
  _id: new Types.ObjectId(),
  luid: 'LEASE-1',
  tenantId: new Types.ObjectId(),
  calculateFees: ({ daysLate }: { daysLate: number }) => ({
    late: { fee: daysLate >= LATE_FEE_DAYS ? LATE_FEE : 0 },
  }),
});

const makeService = () => {
  const paymentDAO = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    findFirst: jest.fn().mockResolvedValue(null),
    findOverduePayments: jest.fn().mockResolvedValue({ items: [] }),
    updateById: jest.fn().mockResolvedValue({}),
  };
  const leaseDAO = {
    findFirst: jest.fn().mockResolvedValue(makeLease()),
    list: jest.fn().mockResolvedValue({ items: [] }),
  };
  const paymentGatewayService = { payInvoice: jest.fn() };
  const paymentQueue = { addCreateRentInvoiceJob: jest.fn().mockResolvedValue(undefined) };
  const emitterService = { emit: jest.fn(), on: jest.fn() };
  const noop = {} as any;

  const service = new PaymentCronService({
    maintenancePaymentService: noop,
    paymentGatewayService: paymentGatewayService as any,
    paymentProcessorDAO: { findFirst: jest.fn().mockResolvedValue({ accountId: 'acct_1' }) } as any,
    subscriptionPlanConfig: noop,
    emitterService: emitterService as any,
    subscriptionDAO: noop,
    stripeService: noop,
    smsService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
    invoiceDAO: noop,
    queueFactory: { getQueue: jest.fn().mockReturnValue(paymentQueue) } as any,
    profileDAO: noop,
    paymentDAO: { ...paymentDAO, findByPeriod: jest.fn().mockResolvedValue(null) } as any,
    clientDAO: {
      getCuidsByTimezone: jest.fn().mockResolvedValue([CUID]),
      getClientByCuid: jest.fn().mockResolvedValue({ settings: {} }),
    } as any,
    leaseDAO: leaseDAO as any,
  });

  return {
    service: service as any,
    paymentDAO,
    leaseDAO,
    paymentGatewayService,
    emitterService,
    paymentQueue,
  };
};

const lateFeeUpdates = (paymentDAO: { updateById: jest.Mock }) =>
  paymentDAO.updateById.mock.calls.filter((call) => call[1].$push?.lineItems);

describe('PaymentCronService — markOverduePayments', () => {
  it('adds the late fee once the threshold is reached, even if the payment is already overdue', async () => {
    const { service, paymentDAO } = makeService();
    const alreadyOverdue = makePayment({
      status: PaymentRecordStatus.OVERDUE,
      dueDate: dayjs()
        .subtract(LATE_FEE_DAYS + 1, 'day')
        .toDate(),
    });
    paymentDAO.findOverduePayments.mockResolvedValueOnce({ items: [alreadyOverdue] });

    await service.markOverduePayments();

    expect(lateFeeUpdates(paymentDAO)).toEqual([
      [
        alreadyOverdue._id.toString(),
        {
          $push: { lineItems: { description: 'Late Fee', amountInCents: LATE_FEE } },
          $inc: { baseAmount: LATE_FEE },
        },
      ],
    ]);
    // Already overdue — not flipped or notified again
    expect(paymentDAO.updateById).not.toHaveBeenCalledWith(
      alreadyOverdue._id.toString(),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'overdue' }) })
    );
  });

  it('marks a newly past-due payment overdue without a late fee before the threshold', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    const justPastDue = makePayment();
    paymentDAO.findOverduePayments.mockResolvedValueOnce({ items: [justPastDue] });

    await service.markOverduePayments();

    expect(lateFeeUpdates(paymentDAO)).toEqual([]);
    expect(paymentDAO.updateById).toHaveBeenCalledWith(justPastDue._id.toString(), {
      $set: { status: PaymentRecordStatus.OVERDUE, overdueAt: expect.any(Date) },
    });
    expect(emitterService.emit).toHaveBeenCalledTimes(1);
  });

  it('does not add a second late fee', async () => {
    const { service, paymentDAO } = makeService();
    paymentDAO.findOverduePayments.mockResolvedValueOnce({
      items: [
        makePayment({
          status: PaymentRecordStatus.OVERDUE,
          dueDate: dayjs().subtract(10, 'day').toDate(),
          lineItems: [{ description: 'Late Fee', amountInCents: LATE_FEE }],
        }),
      ],
    });

    await service.markOverduePayments();

    expect(lateFeeUpdates(paymentDAO)).toEqual([]);
  });

  describe('auto-debit (Stripe-invoiced) rent', () => {
    const lateAutoDebitRent = (daysLate: number) =>
      makePayment({
        isManualEntry: false,
        gatewayPaymentId: 'in_1',
        status: PaymentRecordStatus.OVERDUE,
        dueDate: dayjs().subtract(daysLate, 'day').toDate(),
        period: { month: 9, year: 2026 },
      });

    it('queues a separate late-fee payment once the threshold is reached', async () => {
      const { service, paymentDAO, paymentQueue } = makeService();
      const rent = lateAutoDebitRent(LATE_FEE_DAYS + 1);
      paymentDAO.findOverduePayments.mockResolvedValueOnce({ items: [rent] });

      await service.markOverduePayments();

      expect(paymentQueue.addCreateRentInvoiceJob).toHaveBeenCalledWith({
        cuid: CUID,
        leaseId: 'LEASE-1',
        tenantId: expect.any(String),
        period: { month: 9, year: 2026 },
        dueDate: rent.dueDate,
        paymentType: PaymentRecordType.LATE_FEE,
        description: 'Late fee for 9/2026',
      });
      // Its finalized invoice is never edited in place
      expect(lateFeeUpdates(paymentDAO)).toEqual([]);
    });

    it('does nothing before the threshold', async () => {
      const { service, paymentDAO, paymentQueue } = makeService();
      paymentDAO.findOverduePayments.mockResolvedValueOnce({ items: [lateAutoDebitRent(2)] });

      await service.markOverduePayments();

      expect(paymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
      expect(paymentDAO.updateById).not.toHaveBeenCalled();
    });

    it('does not queue a second late fee for the same period', async () => {
      const { service, paymentDAO, paymentQueue } = makeService();
      paymentDAO.findOverduePayments.mockResolvedValueOnce({
        items: [lateAutoDebitRent(LATE_FEE_DAYS + 3)],
      });
      paymentDAO.findFirst.mockResolvedValueOnce({ pytuid: 'EXISTING-LATE-FEE' });

      await service.markOverduePayments();

      expect(paymentDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          paymentType: PaymentRecordType.LATE_FEE,
          'period.month': 9,
          'period.year': 2026,
        })
      );
      expect(paymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
    });
  });

  it('reads every past-due payment in batches instead of only the first page', async () => {
    const { service, paymentDAO } = makeService();
    const fullBatch = Array.from({ length: 500 }, () =>
      makePayment({ status: PaymentRecordStatus.OVERDUE })
    );
    const lastBatch = [makePayment()];
    paymentDAO.findOverduePayments
      .mockResolvedValueOnce({ items: fullBatch })
      .mockResolvedValueOnce({ items: lastBatch });

    await service.markOverduePayments('America/Toronto');

    expect(paymentDAO.findOverduePayments).toHaveBeenCalledTimes(2);
    expect(paymentDAO.findOverduePayments.mock.calls[0][1]).toEqual({ limit: 500, skip: 0 });
    expect(paymentDAO.findOverduePayments.mock.calls[1][1]).toEqual({ limit: 500, skip: 500 });
    // The payment in the second batch is still handled
    expect(paymentDAO.updateById).toHaveBeenCalledWith(
      lastBatch[0]._id.toString(),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'overdue' }) })
    );
  });
});

describe('PaymentCronService — autoChargeDueRentPayments', () => {
  const dueRent = () =>
    makePayment({
      isManualEntry: false,
      gatewayPaymentId: 'in_rent_1',
      dueDate: dayjs().subtract(1, 'hour').toDate(),
    });

  it('marks the payment processing only when Stripe accepted the charge', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = dueRent();
    paymentDAO.list.mockResolvedValueOnce({ items: [payment] });
    paymentGatewayService.payInvoice.mockResolvedValue({ success: true, data: null });

    await service.autoChargeDueRentPayments();

    expect(paymentDAO.updateById).toHaveBeenCalledWith(payment._id.toString(), {
      status: PaymentRecordStatus.PROCESSING,
      chargedAt: expect.any(Date),
    });
  });

  it('treats a declined charge as a failure instead of marking it processing', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = dueRent();
    paymentDAO.list.mockResolvedValueOnce({ items: [payment] });
    paymentGatewayService.payInvoice.mockResolvedValue({
      success: false,
      data: null,
      message: 'Your card was declined.',
    });

    await service.autoChargeDueRentPayments();

    expect(paymentDAO.updateById).not.toHaveBeenCalledWith(
      payment._id.toString(),
      expect.objectContaining({ status: PaymentRecordStatus.PROCESSING })
    );
    expect(paymentDAO.updateById).toHaveBeenCalledWith(payment._id.toString(), {
      status: PaymentRecordStatus.OVERDUE,
      'failure.lastFailedAt': expect.any(Date),
      'failure.retryCount': 1,
    });
  });

  it('records the bank-debit limit failure so the tenant can pay by card', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = dueRent();
    paymentDAO.list.mockResolvedValueOnce({ items: [payment] });
    paymentGatewayService.payInvoice.mockResolvedValue({
      success: false,
      data: null,
      message: 'amount_too_large for acss_debit',
    });

    await service.autoChargeDueRentPayments();

    expect(paymentDAO.updateById).toHaveBeenCalledWith(payment._id.toString(), {
      'failure.reason': expect.stringContaining('per-transaction limit'),
      'failure.lastFailedAt': expect.any(Date),
    });
  });
});

describe('PaymentCronService — rent invoice crons', () => {
  // An auto-debit lease whose rent is due tomorrow, so it falls in both crons' windows
  const leaseDueTomorrow = (luid: string) => ({
    _id: new Types.ObjectId(),
    luid,
    cuid: CUID,
    tenantId: new Types.ObjectId(),
    duration: {
      startDate: dayjs().subtract(6, 'month').toDate(),
      endDate: dayjs().add(6, 'month').toDate(),
    },
    fees: { rentDueDay: dayjs().add(1, 'day').date(), acceptedPaymentMethod: 'auto-debit' },
  });

  it('pages through every active lease instead of stopping at the first 1000', async () => {
    const { service, leaseDAO, paymentQueue } = makeService();
    const firstPage = Array.from({ length: 500 }, (_, i) => ({
      ...leaseDueTomorrow(`L${i}`),
      fees: { rentDueDay: 15, acceptedPaymentMethod: 'cash' },
      duration: { startDate: new Date('2000-01-01'), endDate: new Date('2000-02-01') },
    }));
    leaseDAO.list
      .mockResolvedValueOnce({ items: firstPage })
      .mockResolvedValueOnce({ items: [leaseDueTomorrow('LAST-PAGE')] });

    await service.queueWeeklyRentInvoices();

    expect(leaseDAO.list.mock.calls.map((call: any[]) => call[1])).toEqual([
      { limit: 500, skip: 0 },
      { limit: 500, skip: 500 },
    ]);
    expect(paymentQueue.addCreateRentInvoiceJob).toHaveBeenCalledWith(
      expect.objectContaining({ leaseId: 'LAST-PAGE', paymentType: PaymentRecordType.RENT })
    );
  });

  it('pages through every active lease in the daily safety net too', async () => {
    const { service, leaseDAO } = makeService();
    leaseDAO.list
      .mockResolvedValueOnce({
        items: Array.from({ length: 500 }, (_, i) => leaseDueTomorrow(`L${i}`)),
      })
      .mockResolvedValueOnce({ items: [] });

    await service.queueDailySafetyNetInvoices();

    expect(leaseDAO.list).toHaveBeenCalledTimes(2);
    expect(leaseDAO.list.mock.calls[1][1]).toEqual({ limit: 500, skip: 500 });
  });
});
