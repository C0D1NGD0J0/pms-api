import dayjs from 'dayjs';
import { Types } from 'mongoose';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { EventTypes } from '@interfaces/events.interface';
import { PaymentCronService } from '@services/payments/paymentCron.service';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

const CUID = 'CLIENT_1';
const LATE_FEE = 5000;
const LATE_FEE_DAYS = 5;
const ACCOUNT_ID = 'acct_1';

const makePayment = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: `PYT${Math.random().toString(36).slice(2, 8)}`,
  cuid: CUID,
  status: PaymentRecordStatus.PENDING,
  paymentType: PaymentRecordType.RENT,
  baseAmount: 150000,
  currency: 'CAD',
  dueDate: dayjs().subtract(1, 'day').toDate(),
  tenant: new Types.ObjectId(),
  lease: new Types.ObjectId(),
  // Cron-created tracking record (cash / cheque lease) — not a PM-recorded manual payment
  isManualEntry: false,
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

const makeTenantProfile = (paymentMethodId = 'pm_card') => ({
  _id: new Types.ObjectId(),
  user: new Types.ObjectId(),
  tenantInfo: {
    paymentGatewayCustomers: new Map([['platform', 'cus_1']]),
    paymentMethods: new Map([[ACCOUNT_ID, paymentMethodId]]),
    paymentMandates: new Map<string, string>(),
  },
});

const makeService = () => {
  const paymentDAO = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    findFirst: jest.fn().mockResolvedValue(null),
    findOverduePayments: jest.fn().mockResolvedValue({ items: [] }),
    updateById: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    findByPeriod: jest.fn().mockResolvedValue(null),
  };
  const leaseDAO = {
    findFirst: jest.fn().mockResolvedValue(makeLease()),
    list: jest.fn().mockResolvedValue({ items: [] }),
  };
  const tenantProfile = makeTenantProfile();
  const profileDAO = { findFirst: jest.fn().mockResolvedValue(tenantProfile) };
  const paymentGatewayService = {
    payInvoice: jest.fn().mockResolvedValue({ success: true, data: null }),
    retrievePaymentMethod: jest
      .fn()
      .mockResolvedValue({ success: true, data: { type: 'card', last4: '4242' } }),
  };
  const paymentQueue = { addCreateRentInvoiceJob: jest.fn().mockResolvedValue(undefined) };
  const emitterService = { emit: jest.fn(), on: jest.fn() };
  const noop = {} as any;

  const service = new PaymentCronService({
    maintenancePaymentService: noop,
    paymentGatewayService: paymentGatewayService as any,
    paymentProcessorDAO: {
      findFirst: jest.fn().mockResolvedValue({ accountId: ACCOUNT_ID, chargesEnabled: true }),
    } as any,
    subscriptionPlanConfig: noop,
    emitterService: emitterService as any,
    subscriptionDAO: noop,
    smsService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
    invoiceDAO: noop,
    queueFactory: { getQueue: jest.fn().mockReturnValue(paymentQueue) } as any,
    profileDAO: profileDAO as any,
    paymentDAO: paymentDAO as any,
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
    profileDAO,
    tenantProfile,
    paymentGatewayService,
    emitterService,
    paymentQueue,
  };
};

const lateFeeUpdates = (paymentDAO: { updateById: jest.Mock }) =>
  paymentDAO.updateById.mock.calls.filter((call) => call[1].$push?.lineItems);

const overdueUpdates = (paymentDAO: { update: jest.Mock }) =>
  paymentDAO.update.mock.calls.filter(
    (call) => call[1].$set?.status === PaymentRecordStatus.OVERDUE
  );

describe('PaymentCronService — markOverduePayments', () => {
  afterEach(() => jest.useRealTimers());

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
    expect(overdueUpdates(paymentDAO)).toEqual([]);
  });

  it('marks a newly past-due payment overdue (conditionally on PENDING) without a late fee', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    const justPastDue = makePayment();
    paymentDAO.findOverduePayments.mockResolvedValueOnce({ items: [justPastDue] });

    await service.markOverduePayments();

    expect(lateFeeUpdates(paymentDAO)).toEqual([]);
    expect(paymentDAO.update).toHaveBeenCalledWith(
      { _id: justPastDue._id, status: PaymentRecordStatus.PENDING, deletedAt: null },
      { $set: { status: PaymentRecordStatus.OVERDUE, overdueAt: expect.any(Date) } }
    );
    expect(emitterService.emit).toHaveBeenCalledTimes(1);
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_OVERDUE,
      expect.objectContaining({ currency: 'CAD' })
    );
  });

  it('does not notify when the payment was settled between the query and the update', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    paymentDAO.findOverduePayments.mockResolvedValueOnce({ items: [makePayment()] });
    paymentDAO.update.mockResolvedValueOnce(null);

    await service.markOverduePayments();

    expect(emitterService.emit).not.toHaveBeenCalled();
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

  it('excludes PM-recorded manual entries from overdue marking and late fees', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    const manualEntry = makePayment({
      isManualEntry: true,
      dueDate: dayjs().subtract(10, 'day').toDate(),
    });
    paymentDAO.findOverduePayments.mockResolvedValueOnce({ items: [manualEntry] });

    await service.markOverduePayments('America/Toronto');

    expect(paymentDAO.findOverduePayments.mock.calls[0][0]).toEqual(
      expect.objectContaining({ isManualEntry: { $ne: true } })
    );
    // Even if one slips through the query, it is not touched
    expect(paymentDAO.update).not.toHaveBeenCalled();
    expect(paymentDAO.updateById).not.toHaveBeenCalled();
    expect(emitterService.emit).not.toHaveBeenCalled();
  });

  it('uses the start of the client-local day as the overdue cutoff (R12)', async () => {
    // 01:00 in Toronto on Oct 1 is 05:00 UTC — rent due Oct 1 (stored 00:00 UTC) is not overdue yet
    jest.useFakeTimers({ now: new Date('2026-10-01T05:00:00Z') });
    const { service, paymentDAO } = makeService();

    await service.markOverduePayments('America/Toronto');

    const cutoff: Date = paymentDAO.findOverduePayments.mock.calls[0][2];
    expect(cutoff).toEqual(new Date('2026-10-01T00:00:00Z'));
    expect(new Date('2026-10-01T00:00:00Z') < cutoff).toBe(false);
    // ...but rent due Sep 30 is
    expect(new Date('2026-09-30T00:00:00Z') < cutoff).toBe(true);
  });

  describe('auto-debit (Stripe-invoiced) rent', () => {
    const lateAutoDebitRent = (daysLate: number) =>
      makePayment({
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
    expect(paymentDAO.update).toHaveBeenCalledWith(
      expect.objectContaining({ _id: lastBatch[0]._id }),
      expect.objectContaining({ $set: expect.objectContaining({ status: 'overdue' }) })
    );
  });
});

describe('PaymentCronService — autoChargeDueRentPayments', () => {
  const dueRent = (overrides: Record<string, any> = {}) =>
    makePayment({
      gatewayPaymentId: 'in_rent_1',
      dueDate: dayjs().subtract(1, 'hour').toDate(),
      ...overrides,
    });

  const queuePayments = (
    paymentDAO: ReturnType<typeof makeService>['paymentDAO'],
    payments: any[]
  ) => {
    paymentDAO.list.mockResolvedValueOnce({ items: payments });
    // Fresh re-read before charging returns the same open record
    paymentDAO.findFirst.mockImplementation(
      async (filter: any) => payments.find((p) => filter._id && p._id.equals(filter._id)) ?? null
    );
  };

  it('marks the payment processing (only if still open) when Stripe accepted the charge', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = dueRent();
    queuePayments(paymentDAO, [payment]);

    await service.autoChargeDueRentPayments();

    expect(paymentGatewayService.payInvoice).toHaveBeenCalledWith('stripe', 'in_rent_1');
    expect(paymentDAO.update).toHaveBeenCalledWith(
      {
        _id: payment._id,
        status: { $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE] },
        deletedAt: null,
      },
      { $set: { status: PaymentRecordStatus.PROCESSING, chargedAt: expect.any(Date) } }
    );
  });

  it('excludes payments with an active dispute, including under_review', async () => {
    const { service, paymentDAO } = makeService();

    await service.autoChargeDueRentPayments();
    await service.autoChargeOverdueMaintenancePayments();

    paymentDAO.list.mock.calls.forEach(([filter]: [Record<string, any>]) => {
      expect(filter['dispute.status']).toEqual({
        $nin: ['open', 'needs_response', 'under_review'],
      });
    });
    expect(paymentDAO.list).toHaveBeenCalledTimes(2);
  });

  it('never charges a payment that was settled since the batch was read', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.list.mockResolvedValueOnce({ items: [dueRent()] });
    paymentDAO.findFirst.mockResolvedValue(null); // now PAID / CANCELLED / manual

    await service.autoChargeDueRentPayments();

    expect(paymentGatewayService.payInvoice).not.toHaveBeenCalled();
    expect(paymentDAO.update).not.toHaveBeenCalled();
    expect(paymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        status: { $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE] },
        isManualEntry: { $ne: true },
      })
    );
  });

  it('treats a declined charge as a failure instead of marking it processing', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = dueRent();
    queuePayments(paymentDAO, [payment]);
    paymentGatewayService.payInvoice.mockResolvedValue({
      success: false,
      data: null,
      message: 'Your card was declined.',
    });

    await service.autoChargeDueRentPayments();

    expect(paymentDAO.update).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({ status: PaymentRecordStatus.PROCESSING }),
      })
    );
    expect(paymentDAO.update).toHaveBeenCalledWith(expect.objectContaining({ _id: payment._id }), {
      $set: {
        status: PaymentRecordStatus.OVERDUE,
        'failure.reason': 'Your card was declined.',
        'failure.lastFailedAt': expect.any(Date),
        'failure.retryCount': 1,
      },
    });
  });

  it('marks FAILED and emits PAYMENT_FAILED with reason and currency once attempts are exhausted', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    const payment = dueRent({ failure: { retryCount: 1 } });
    queuePayments(paymentDAO, [payment]);
    paymentGatewayService.payInvoice.mockResolvedValue({
      success: false,
      data: null,
      message: 'The mandate for this payment method has been revoked.',
    });

    await service.autoChargeDueRentPayments();

    expect(paymentDAO.update).toHaveBeenCalledWith(expect.objectContaining({ _id: payment._id }), {
      $set: expect.objectContaining({
        status: PaymentRecordStatus.FAILED,
        'failure.retryCount': 2,
      }),
    });
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_FAILED,
      expect.objectContaining({
        pytuid: payment.pytuid,
        currency: 'CAD',
        failureReason: 'The mandate for this payment method has been revoked.',
      })
    );
  });

  it('does not treat every acss_debit error as the per-transaction limit (P5)', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = dueRent();
    queuePayments(paymentDAO, [payment]);
    paymentGatewayService.payInvoice.mockResolvedValue({
      success: false,
      data: null,
      message: 'The acss_debit mandate is inactive.',
    });

    await service.autoChargeDueRentPayments();

    // Counted as a normal retry, not silently parked
    expect(paymentDAO.update).toHaveBeenCalledWith(expect.objectContaining({ _id: payment._id }), {
      $set: expect.objectContaining({ 'failure.retryCount': 1 }),
    });
  });

  it('records the bank-debit limit failure and tells the tenant once to pay by card', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    const payment = dueRent();
    queuePayments(paymentDAO, [payment]);
    paymentGatewayService.payInvoice.mockResolvedValue({
      success: false,
      data: null,
      message: 'amount_too_large for acss_debit',
    });

    await service.autoChargeDueRentPayments();

    expect(paymentDAO.update).toHaveBeenCalledWith(expect.objectContaining({ _id: payment._id }), {
      $set: {
        'failure.reason': expect.stringContaining('per-transaction limit'),
        'failure.lastFailedAt': expect.any(Date),
        'failure.pmNotifiedAt': expect.any(Date),
      },
    });
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_FAILED,
      expect.objectContaining({ failureReason: expect.stringContaining('per-transaction limit') })
    );
  });

  describe('split invoices (R5)', () => {
    const splitRent = (rentStatus = 'pending', feesStatus = 'pending') =>
      dueRent({
        gatewayPaymentId: 'in_rent',
        splitInvoices: [
          { invoiceId: 'in_rent', amount: 300000, category: 'rent', status: rentStatus },
          { invoiceId: 'in_fees', amount: 10000, category: 'fees', status: feesStatus },
        ],
      });

    it('pays every pending split invoice', async () => {
      const { service, paymentDAO, paymentGatewayService } = makeService();
      queuePayments(paymentDAO, [splitRent()]);

      await service.autoChargeDueRentPayments();

      expect(paymentGatewayService.payInvoice.mock.calls.map((c: any[]) => c[1])).toEqual([
        'in_rent',
        'in_fees',
      ]);
    });

    it('skips a split that is already paid', async () => {
      const { service, paymentDAO, paymentGatewayService } = makeService();
      queuePayments(paymentDAO, [splitRent('paid', 'failed')]);

      await service.autoChargeDueRentPayments();

      expect(paymentGatewayService.payInvoice.mock.calls.map((c: any[]) => c[1])).toEqual([
        'in_fees',
      ]);
    });

    it('marks the failed split while still submitting the record when another split succeeded', async () => {
      const { service, paymentDAO, paymentGatewayService } = makeService();
      const payment = splitRent();
      queuePayments(paymentDAO, [payment]);
      paymentGatewayService.payInvoice
        .mockResolvedValueOnce({ success: true, data: null })
        .mockResolvedValueOnce({ success: false, data: null, message: 'declined' });

      await service.autoChargeDueRentPayments();

      expect(paymentDAO.update).toHaveBeenCalledWith(
        expect.objectContaining({ _id: payment._id }),
        {
          $set: expect.objectContaining({
            status: PaymentRecordStatus.PROCESSING,
            'splitInvoices.1.status': 'failed',
            'failure.reason': 'declined',
          }),
        }
      );
    });
  });

  describe('PAD advance notice (bank debits)', () => {
    const useAcssTenant = (
      ctx: ReturnType<typeof makeService>,
      mandateId: string | undefined = 'mandate_1'
    ) => {
      ctx.tenantProfile.tenantInfo.paymentMethods.set(ACCOUNT_ID, 'pm_acss');
      if (mandateId) ctx.tenantProfile.tenantInfo.paymentMandates.set(ACCOUNT_ID, mandateId);
      ctx.paymentGatewayService.retrievePaymentMethod.mockResolvedValue({
        success: true,
        data: { type: 'acss_debit', last4: '6789' },
      });
    };

    it('sends the notice instead of debiting when none was sent yet', async () => {
      const ctx = makeService();
      useAcssTenant(ctx);
      const payment = dueRent();
      queuePayments(ctx.paymentDAO, [payment]);

      await ctx.service.autoChargeDueRentPayments();

      expect(ctx.paymentGatewayService.payInvoice).not.toHaveBeenCalled();
      expect(ctx.paymentDAO.update).toHaveBeenCalledWith(
        { _id: payment._id, padNoticeSentAt: null, deletedAt: null },
        { $set: { padNoticeSentAt: expect.any(Date) } }
      );
      const [, payload] = ctx.emitterService.emit.mock.calls.find(
        ([type]: [string]) => type === EventTypes.PAD_PRE_DEBIT_NOTIFICATION
      );
      expect(payload).toEqual(
        expect.objectContaining({
          pytuid: payment.pytuid,
          tenantId: ctx.tenantProfile.user.toString(),
          amount: 150000,
          currency: 'CAD',
          paymentType: PaymentRecordType.RENT,
          accountLast4: '6789',
          mandateReference: 'mandate_1',
        })
      );
      // Debit date = notice day + 10 days (later than the due date)
      const expectedDebitDay = dayjs.utc().startOf('day').add(10, 'day');
      expect(dayjs.utc(payload.debitDate).isSame(expectedDebitDay)).toBe(true);
    });

    it('waits until the notice period has elapsed', async () => {
      const ctx = makeService();
      useAcssTenant(ctx);
      queuePayments(ctx.paymentDAO, [
        dueRent({ padNoticeSentAt: dayjs().subtract(9, 'day').toDate() }),
      ]);

      await ctx.service.autoChargeDueRentPayments();

      expect(ctx.paymentGatewayService.payInvoice).not.toHaveBeenCalled();
      expect(ctx.emitterService.emit).not.toHaveBeenCalled();
    });

    it('debits once the notice is at least 10 days old', async () => {
      const ctx = makeService();
      useAcssTenant(ctx);
      queuePayments(ctx.paymentDAO, [
        dueRent({ padNoticeSentAt: dayjs().subtract(10, 'day').toDate() }),
      ]);

      await ctx.service.autoChargeDueRentPayments();

      expect(ctx.paymentGatewayService.payInvoice).toHaveBeenCalledTimes(1);
    });

    it('treats an unknown method type with a mandate on file as a bank debit', async () => {
      const ctx = makeService();
      useAcssTenant(ctx);
      ctx.paymentGatewayService.retrievePaymentMethod.mockResolvedValue({
        success: false,
        data: null,
      });
      queuePayments(ctx.paymentDAO, [dueRent()]);

      await ctx.service.autoChargeDueRentPayments();

      expect(ctx.paymentGatewayService.payInvoice).not.toHaveBeenCalled();
    });

    it('does not delay card payments', async () => {
      const ctx = makeService();
      queuePayments(ctx.paymentDAO, [dueRent()]);

      await ctx.service.autoChargeDueRentPayments();

      expect(ctx.paymentGatewayService.payInvoice).toHaveBeenCalledTimes(1);
      expect(ctx.emitterService.emit).not.toHaveBeenCalledWith(
        EventTypes.PAD_PRE_DEBIT_NOTIFICATION,
        expect.anything()
      );
    });
  });

  it('pages through every due payment with an _id cursor', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const firstPage = Array.from({ length: 200 }, () => dueRent());
    const secondPage = [dueRent()];
    paymentDAO.list
      .mockResolvedValueOnce({ items: firstPage })
      .mockResolvedValueOnce({ items: secondPage });
    paymentDAO.findFirst.mockImplementation(
      async (filter: any) =>
        [...firstPage, ...secondPage].find((p) => filter._id && p._id.equals(filter._id)) ?? null
    );

    await service.autoChargeDueRentPayments();

    expect(paymentDAO.list).toHaveBeenCalledTimes(2);
    expect(paymentDAO.list.mock.calls[1][0]._id).toEqual({ $gt: firstPage[199]._id });
    expect(paymentDAO.list.mock.calls[1][1]).toEqual({ limit: 200, sort: { _id: 1 } });
    expect(paymentGatewayService.payInvoice).toHaveBeenCalledTimes(201);
  });
});

describe('PaymentCronService — autoChargeOverdueMaintenancePayments', () => {
  it('records the card method as ONLINE (not BANK_TRANSFER) and only updates an open record', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const charge = makePayment({
      paymentType: PaymentRecordType.MAINTENANCE,
      gatewayPaymentId: 'in_mnt_1',
      status: PaymentRecordStatus.OVERDUE,
    });
    paymentDAO.list.mockResolvedValueOnce({ items: [charge] });
    paymentDAO.findFirst.mockResolvedValueOnce(charge);
    service.subscriptionDAO = { findFirst: jest.fn().mockResolvedValue(null) };
    service.subscriptionPlanConfig = { calculatePaymentGatewayFee: jest.fn().mockReturnValue(0) };

    await service.autoChargeOverdueMaintenancePayments();

    expect(paymentGatewayService.payInvoice).toHaveBeenCalledWith('stripe', 'in_mnt_1', {
      paymentMethod: 'pm_card',
    });
    expect(paymentDAO.update).toHaveBeenCalledWith(
      expect.objectContaining({ _id: charge._id, status: expect.anything() }),
      {
        $set: {
          status: PaymentRecordStatus.PROCESSING,
          chargedAt: expect.any(Date),
          paymentMethod: PaymentMethod.ONLINE,
          stripePaymentMethodType: 'card',
        },
      }
    );
    expect(paymentDAO.list.mock.calls[0][0]).toEqual(
      expect.objectContaining({ isManualEntry: false, vendorId: { $exists: false } })
    );
  });

  it('holds an ACSS maintenance debit until the PAD notice period has passed (P2)', async () => {
    const ctx = makeService();
    ctx.tenantProfile.tenantInfo.paymentMethods.set(ACCOUNT_ID, 'pm_acss');
    ctx.tenantProfile.tenantInfo.paymentMandates.set(ACCOUNT_ID, 'mandate_1');
    ctx.paymentGatewayService.retrievePaymentMethod.mockResolvedValue({
      success: true,
      data: { type: 'acss_debit', last4: '6789' },
    });
    const charge = makePayment({
      paymentType: PaymentRecordType.LATE_FEE,
      status: PaymentRecordStatus.OVERDUE,
    });
    ctx.paymentDAO.list.mockResolvedValueOnce({ items: [charge] });
    ctx.paymentDAO.findFirst.mockResolvedValueOnce(charge);

    await ctx.service.autoChargeOverdueMaintenancePayments();

    expect(ctx.paymentGatewayService.payInvoice).not.toHaveBeenCalled();
    expect(ctx.emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAD_PRE_DEBIT_NOTIFICATION,
      expect.objectContaining({ paymentType: PaymentRecordType.LATE_FEE })
    );
  });
});
