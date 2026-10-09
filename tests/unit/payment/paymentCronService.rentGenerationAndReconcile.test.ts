import dayjs from 'dayjs';
import { Types } from 'mongoose';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { EventTypes } from '@interfaces/events.interface';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';
import { rentDueDateForMonth, PaymentCronService } from '@services/payments/paymentCron.service';

const CUID = 'CLIENT_1';
const ACCOUNT_ID = 'acct_1';

const makeLease = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  luid: `L-${Math.random().toString(36).slice(2, 6)}`,
  cuid: CUID,
  tenantId: new Types.ObjectId(),
  duration: {
    startDate: new Date('2020-01-01'),
    endDate: new Date('2035-01-01'),
  },
  fees: { rentDueDay: 1, acceptedPaymentMethod: 'auto-debit', currency: 'CAD' },
  ...overrides,
});

const makeService = () => {
  const paymentDAO = {
    list: jest.fn().mockResolvedValue({ items: [] }),
    findFirst: jest.fn().mockResolvedValue(null),
    findByPeriod: jest.fn().mockResolvedValue(null),
    updateById: jest.fn().mockResolvedValue({}),
    update: jest.fn().mockResolvedValue({}),
    insert: jest.fn().mockResolvedValue({ pytuid: 'PYT-NEW' }),
  };
  const leaseDAO = { list: jest.fn().mockResolvedValue({ items: [] }) };
  const paymentQueue = { addCreateRentInvoiceJob: jest.fn().mockResolvedValue(undefined) };
  const tenantProfile = {
    _id: new Types.ObjectId(),
    user: new Types.ObjectId(),
    tenantInfo: {
      paymentMethods: new Map([[ACCOUNT_ID, 'pm_acss']]),
      paymentMandates: new Map([[ACCOUNT_ID, 'mandate_1']]),
    },
  };
  const profileDAO = { findFirst: jest.fn().mockResolvedValue(tenantProfile) };
  const paymentGatewayService = {
    getInvoice: jest.fn(),
    getInvoicePaymentDetails: jest.fn(),
    retrievePaymentMethod: jest
      .fn()
      .mockResolvedValue({ success: true, data: { type: 'acss_debit', last4: '6789' } }),
  };
  const invoiceDAO = {
    findPendingFundsCheck: jest.fn().mockResolvedValue([]),
    updateById: jest.fn().mockResolvedValue({}),
  };
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
    smsService: { sendToUser: jest.fn() } as any,
    invoiceDAO: invoiceDAO as any,
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
    paymentQueue,
    profileDAO,
    tenantProfile,
    paymentGatewayService,
    invoiceDAO,
    emitterService,
  };
};

const queuedDueDates = (paymentQueue: { addCreateRentInvoiceJob: jest.Mock }) =>
  paymentQueue.addCreateRentInvoiceJob.mock.calls.map((c: any[]) =>
    dayjs(c[0].dueDate).format('YYYY-MM-DD')
  );

describe('rentDueDateForMonth (R1)', () => {
  const cases: Array<[string, number, string]> = [
    // [any day in the month, rentDueDay, expected due date]
    ['2026-02-10', 28, '2026-02-28'],
    ['2026-02-10', 29, '2026-02-28'], // non-leap February
    ['2026-02-10', 30, '2026-02-28'],
    ['2026-02-10', 31, '2026-02-28'],
    ['2028-02-10', 29, '2028-02-29'], // leap February
    ['2028-02-10', 31, '2028-02-29'],
    ['2026-04-10', 30, '2026-04-30'],
    ['2026-04-10', 31, '2026-04-30'], // never rolls into May 1
    ['2026-01-10', 31, '2026-01-31'],
    ['2026-03-31', 15, '2026-03-15'],
  ];

  it.each(cases)('month of %s with due day %i → %s', (anchor, dueDay, expected) => {
    expect(rentDueDateForMonth(dayjs(anchor), dueDay).format('YYYY-MM-DD')).toBe(expected);
  });

  it('moves from Jan 31 to the end of February, not into March', () => {
    const jan31 = dayjs('2026-01-31');
    expect(rentDueDateForMonth(jan31.add(1, 'month'), 31).format('YYYY-MM-DD')).toBe('2026-02-28');
  });
});

describe('PaymentCronService — rent invoice crons', () => {
  afterEach(() => jest.useRealTimers());

  it('weekly: due day 31 in April is billed on April 30, not May 1 (R1)', async () => {
    jest.useFakeTimers({ now: new Date(2026, 3, 26, 2) }); // Sun Apr 26 2026, local time
    const { service, leaseDAO, paymentQueue } = makeService();
    leaseDAO.list.mockResolvedValueOnce({
      items: [makeLease({ fees: { rentDueDay: 31, acceptedPaymentMethod: 'auto-debit' } })],
    });

    await service.queueWeeklyRentInvoices();

    expect(queuedDueDates(paymentQueue)).toEqual(['2026-04-30']);
    expect(paymentQueue.addCreateRentInvoiceJob.mock.calls[0][0].period).toEqual({
      month: 4,
      year: 2026,
    });
  });

  it('weekly: creates auto-debit rent far enough ahead for the PAD notice (N + 8 days)', async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 4, 2) }); // Sun Oct 4 2026
    const { service, leaseDAO, paymentQueue } = makeService();
    leaseDAO.list.mockResolvedValueOnce({
      items: [
        makeLease({ fees: { rentDueDay: 21, acceptedPaymentMethod: 'auto-debit' } }), // 17 days
        makeLease({ fees: { rentDueDay: 23, acceptedPaymentMethod: 'auto-debit' } }), // 19 days
      ],
    });

    await service.queueWeeklyRentInvoices();

    expect(queuedDueDates(paymentQueue)).toEqual(['2026-10-21']);
  });

  it.each([
    PaymentRecordStatus.FAILED,
    PaymentRecordStatus.CANCELLED,
    PaymentRecordStatus.REFUNDED,
    PaymentRecordStatus.PAID,
  ])('weekly: never regenerates a period that already has a %s record (R3)', async (status) => {
    jest.useFakeTimers({ now: new Date(2026, 9, 4, 2) });
    const { service, leaseDAO, paymentDAO, paymentQueue } = makeService();
    leaseDAO.list.mockResolvedValueOnce({
      items: [makeLease({ fees: { rentDueDay: 6, acceptedPaymentMethod: 'cash' } })],
    });
    paymentDAO.findByPeriod.mockResolvedValue({
      _id: new Types.ObjectId(),
      status,
      failure: { retryCount: 2, pmNotifiedAt: new Date() },
    });

    await service.queueWeeklyRentInvoices();

    expect(paymentDAO.updateById).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ deletedAt: expect.anything() })
    );
    expect(paymentDAO.insert).not.toHaveBeenCalled();
    expect(paymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
  });

  it('safety net: surfaces a FAILED rent record once but does not soft-delete or re-invoice it (R3)', async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 7, 5) });
    const { service, leaseDAO, paymentDAO, paymentQueue, emitterService } = makeService();
    leaseDAO.list.mockResolvedValueOnce({
      items: [makeLease({ fees: { rentDueDay: 1, acceptedPaymentMethod: 'auto-debit' } })],
    });
    const failed = {
      _id: new Types.ObjectId(),
      cuid: CUID,
      pytuid: 'PYT-FAILED',
      status: PaymentRecordStatus.FAILED,
      baseAmount: 150000,
      currency: 'CAD',
      gatewayPaymentId: 'in_1',
      isManualEntry: false,
      failure: { retryCount: 2, reason: 'Card declined' },
    };
    paymentDAO.findByPeriod.mockResolvedValue(failed);

    await service.queueDailySafetyNetInvoices();

    expect(paymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
    expect(paymentDAO.updateById).toHaveBeenCalledTimes(1);
    expect(paymentDAO.updateById).toHaveBeenCalledWith(failed._id.toString(), {
      'failure.pmNotifiedAt': expect.any(Date),
    });
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_FAILED,
      expect.objectContaining({
        pytuid: 'PYT-FAILED',
        currency: 'CAD',
        failureReason: 'Card declined',
      })
    );
  });

  it('safety net: leaves a manually recorded rent payment alone (X4)', async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 7, 5) });
    const { service, leaseDAO, paymentDAO, paymentQueue, emitterService } = makeService();
    leaseDAO.list.mockResolvedValueOnce({
      items: [makeLease({ fees: { rentDueDay: 1, acceptedPaymentMethod: 'auto-debit' } })],
    });
    paymentDAO.findByPeriod.mockResolvedValue({
      _id: new Types.ObjectId(),
      status: PaymentRecordStatus.FAILED,
      isManualEntry: true,
    });

    await service.queueDailySafetyNetInvoices();

    expect(paymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
    expect(paymentDAO.updateById).not.toHaveBeenCalled();
    expect(emitterService.emit).not.toHaveBeenCalled();
  });

  it('safety net: queues a missing auto-debit period inside the PAD notice window', async () => {
    jest.useFakeTimers({ now: new Date(2026, 9, 7, 5) });
    const { service, leaseDAO, paymentQueue } = makeService();
    const lease = makeLease({ fees: { rentDueDay: 31, acceptedPaymentMethod: 'auto-debit' } });
    leaseDAO.list.mockResolvedValue({ items: [lease] });

    await service.queueDailySafetyNetInvoices();

    // Oct 31 is beyond today + 11 days — nothing yet
    expect(paymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();

    jest.setSystemTime(new Date(2026, 9, 20, 5));
    await service.queueDailySafetyNetInvoices();

    expect(queuedDueDates(paymentQueue)).toEqual(['2026-10-31']);
  });
});

describe('PaymentCronService — PAD pre-debit notice job', () => {
  it('sends a notice for upcoming ACSS charges and records padNoticeSentAt', async () => {
    const { service, paymentDAO, emitterService, tenantProfile } = makeService();
    const dueDate = dayjs.utc().startOf('day').add(10, 'day').toDate();
    const rent = {
      _id: new Types.ObjectId(),
      cuid: CUID,
      pytuid: 'PYT-RENT',
      tenant: tenantProfile._id,
      paymentType: PaymentRecordType.RENT,
      baseAmount: 200000,
      currency: 'CAD',
      dueDate,
    };
    paymentDAO.list.mockResolvedValueOnce({ items: [rent] });

    await service.sendPadPreDebitNotices();

    const filter = paymentDAO.list.mock.calls[0][0];
    expect(filter).toEqual(
      expect.objectContaining({
        padNoticeSentAt: null,
        isManualEntry: { $ne: true },
        status: { $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE] },
      })
    );
    expect(paymentDAO.update).toHaveBeenCalledWith(
      { _id: rent._id, padNoticeSentAt: null, deletedAt: null },
      { $set: { padNoticeSentAt: expect.any(Date) } }
    );
    expect(emitterService.emit).toHaveBeenCalledWith(EventTypes.PAD_PRE_DEBIT_NOTIFICATION, {
      cuid: CUID,
      pytuid: 'PYT-RENT',
      tenantId: tenantProfile.user.toString(),
      amount: 200000,
      currency: 'CAD',
      debitDate: dueDate,
      paymentType: PaymentRecordType.RENT,
      accountLast4: '6789',
      mandateReference: 'mandate_1',
    });
  });

  it('skips card payers', async () => {
    const { service, paymentDAO, emitterService, paymentGatewayService, tenantProfile } =
      makeService();
    tenantProfile.tenantInfo.paymentMandates.clear();
    paymentGatewayService.retrievePaymentMethod.mockResolvedValue({
      success: true,
      data: { type: 'card' },
    });
    paymentDAO.list.mockResolvedValueOnce({
      items: [
        { _id: new Types.ObjectId(), cuid: CUID, tenant: tenantProfile._id, dueDate: new Date() },
      ],
    });

    await service.sendPadPreDebitNotices();

    expect(paymentDAO.update).not.toHaveBeenCalled();
    expect(emitterService.emit).not.toHaveBeenCalled();
  });

  it('does not send twice when another run already claimed the notice', async () => {
    const { service, paymentDAO, emitterService, tenantProfile } = makeService();
    paymentDAO.list.mockResolvedValueOnce({
      items: [
        { _id: new Types.ObjectId(), cuid: CUID, tenant: tenantProfile._id, dueDate: new Date() },
      ],
    });
    paymentDAO.update.mockResolvedValueOnce(null);

    await service.sendPadPreDebitNotices();

    expect(emitterService.emit).not.toHaveBeenCalled();
  });
});

describe('PaymentCronService — reconcileStaleProcessingPayments', () => {
  const processingPayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    pytuid: 'PYT-PROC',
    tenant: new Types.ObjectId(),
    status: PaymentRecordStatus.PROCESSING,
    paymentType: PaymentRecordType.RENT,
    baseAmount: 150000,
    currency: 'CAD',
    gatewayPaymentId: 'in_rent',
    chargedAt: dayjs().subtract(2, 'day').toDate(),
    dueDate: dayjs().subtract(3, 'day').toDate(),
    ...overrides,
  });

  it('marks PAID through the gateway and emits PAYMENT_SUCCEEDED with tenant and currency (M3)', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService, tenantProfile } =
      makeService();
    const payment = processingPayment();
    paymentDAO.list.mockResolvedValueOnce({ items: [payment] });
    paymentGatewayService.getInvoice.mockResolvedValue({
      success: true,
      data: {
        status: 'paid',
        paidAt: new Date('2026-10-01T10:00:00Z'),
        hostedInvoiceUrl: 'https://x/inv',
      },
    });
    paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { chargeId: 'ch_1', paymentMethodType: 'acss_debit' },
    });

    await service.reconcileStaleProcessingPayments();

    expect(paymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id, status: PaymentRecordStatus.PROCESSING, deletedAt: null },
      {
        $set: {
          status: PaymentRecordStatus.PAID,
          paidAt: new Date('2026-10-01T10:00:00Z'),
          gatewayChargeId: 'ch_1',
          stripePaymentMethodType: 'acss_debit',
          'receipt.url': 'https://x/inv',
        },
      }
    );
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_SUCCEEDED,
      expect.objectContaining({
        pytuid: 'PYT-PROC',
        tenantId: tenantProfile.user.toString(),
        currency: 'CAD',
      })
    );
  });

  it('does not mark a split payment PAID while one split is unpaid (R5)', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    paymentDAO.list.mockResolvedValueOnce({
      items: [
        processingPayment({
          splitInvoices: [
            { invoiceId: 'in_rent', status: 'paid', category: 'rent', amount: 300000 },
            { invoiceId: 'in_fees', status: 'pending', category: 'fees', amount: 10000 },
          ],
        }),
      ],
    });
    paymentGatewayService.getInvoice.mockResolvedValue({ success: true, data: { status: 'open' } });
    paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { paymentMethodType: 'acss_debit' },
    });

    await service.reconcileStaleProcessingPayments();

    expect(paymentGatewayService.getInvoice).toHaveBeenCalledTimes(1);
    expect(paymentGatewayService.getInvoice).toHaveBeenCalledWith('stripe', 'in_fees');
    expect(paymentDAO.update).not.toHaveBeenCalled();
    expect(emitterService.emit).not.toHaveBeenCalled();
  });

  it('marks a split payment PAID once every split invoice is paid', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = processingPayment({
      splitInvoices: [
        { invoiceId: 'in_rent', status: 'paid', category: 'rent', amount: 300000 },
        { invoiceId: 'in_fees', status: 'pending', category: 'fees', amount: 10000 },
      ],
    });
    paymentDAO.list.mockResolvedValueOnce({ items: [payment] });
    paymentGatewayService.getInvoice.mockResolvedValue({ success: true, data: { status: 'paid' } });
    paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { chargeId: 'ch_rent' },
    });

    await service.reconcileStaleProcessingPayments();

    expect(paymentDAO.update).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({
        status: PaymentRecordStatus.PAID,
        'splitInvoices.1.status': 'paid',
      }),
    });
  });

  it('notifies PAYMENT_FAILED when the invoice is uncollectible (M3)', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    paymentDAO.list.mockResolvedValueOnce({ items: [processingPayment()] });
    paymentGatewayService.getInvoice.mockResolvedValue({
      success: true,
      data: { status: 'uncollectible' },
    });

    await service.reconcileStaleProcessingPayments();

    expect(paymentDAO.update).toHaveBeenCalledWith(expect.anything(), {
      $set: expect.objectContaining({ status: PaymentRecordStatus.OVERDUE }),
    });
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_FAILED,
      expect.objectContaining({
        pytuid: 'PYT-PROC',
        currency: 'CAD',
        failureReason: 'Stripe invoice status: uncollectible',
      })
    );
  });

  it('notifies PAYMENT_FAILED when an open invoice has a failed payment (M3)', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    paymentDAO.list.mockResolvedValueOnce({ items: [processingPayment()] });
    paymentGatewayService.getInvoice.mockResolvedValue({ success: true, data: { status: 'open' } });
    paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { lastPaymentError: { message: 'insufficient funds' } },
    });

    await service.reconcileStaleProcessingPayments();

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_FAILED,
      expect.objectContaining({ failureReason: expect.stringContaining('insufficient funds') })
    );
  });

  it('gives an open bank debit longer than 72 hours before flagging it', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.list.mockResolvedValueOnce({
      items: [processingPayment({ chargedAt: dayjs().subtract(4, 'day').toDate() })],
    });
    paymentGatewayService.getInvoice.mockResolvedValue({ success: true, data: { status: 'open' } });
    paymentGatewayService.getInvoicePaymentDetails.mockResolvedValue({
      success: true,
      data: { paymentMethodType: 'acss_debit' },
    });

    await service.reconcileStaleProcessingPayments();

    expect(paymentDAO.update).not.toHaveBeenCalled();
  });

  it('pages through every stale payment', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const firstPage = Array.from({ length: 200 }, () => processingPayment());
    paymentDAO.list
      .mockResolvedValueOnce({ items: firstPage })
      .mockResolvedValueOnce({ items: [processingPayment()] });
    paymentGatewayService.getInvoice.mockResolvedValue({
      success: true,
      data: { status: 'draft' },
    });

    await service.reconcileStaleProcessingPayments();

    expect(paymentDAO.list).toHaveBeenCalledTimes(2);
    expect(paymentGatewayService.getInvoice).toHaveBeenCalledTimes(201);
  });
});

describe('PaymentCronService — checkFundsAvailability (S13)', () => {
  const invoice = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    mruid: 'MR-1',
    invuid: 'INV-1',
    amountInCents: 50000,
    currency: 'cad',
    ...overrides,
  });

  it('flips fundsAvailable once the tenant charge succeeded, without reading a Connect balance', async () => {
    const { service, invoiceDAO, paymentDAO, emitterService } = makeService();
    const inv = invoice();
    invoiceDAO.findPendingFundsCheck.mockResolvedValue([inv]);
    paymentDAO.findFirst.mockResolvedValue({ gatewayChargeId: 'ch_tenant' });

    await service.checkFundsAvailability();

    expect(paymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: CUID,
        maintenanceRequestUid: 'MR-1',
        status: PaymentRecordStatus.PAID,
      })
    );
    expect(invoiceDAO.updateById).toHaveBeenCalledWith(inv._id.toString(), {
      $set: { fundsAvailable: true, fundsAvailableAt: expect.any(Date) },
    });
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_FUNDS_AVAILABLE,
      expect.objectContaining({ mruid: 'MR-1', cuid: CUID })
    );
  });

  it('leaves the invoice alone while the tenant charge has not succeeded', async () => {
    const { service, invoiceDAO, paymentDAO } = makeService();
    invoiceDAO.findPendingFundsCheck.mockResolvedValue([invoice()]);
    paymentDAO.findFirst.mockResolvedValue(null);

    await service.checkFundsAvailability();

    expect(invoiceDAO.updateById).not.toHaveBeenCalled();
  });
});
