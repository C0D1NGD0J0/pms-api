import dayjs from 'dayjs';
import { Types } from 'mongoose';

jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { t } from '@shared/languages';
import { PaymentCronService } from '@services/payments/paymentCron.service';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';

const NG_CUID = 'CLIENT_NG';
const OTHER_TZ_CUID = 'CLIENT_NG_ELSEWHERE';
const AUTO_DEBIT_LEASE_ID = new Types.ObjectId();

const makePayment = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: `PYT${Math.random().toString(36).slice(2, 8)}`,
  cuid: NG_CUID,
  status: PaymentRecordStatus.PENDING,
  paymentType: PaymentRecordType.RENT,
  baseAmount: 120_000_000,
  currency: 'NGN',
  dueDate: dayjs().subtract(1, 'day').toDate(),
  tenant: new Types.ObjectId(),
  lease: AUTO_DEBIT_LEASE_ID,
  isManualEntry: false,
  ...overrides,
});

const makeService = (payments: ReturnType<typeof makePayment>[] = []) => {
  const paymentDAO = {
    list: jest.fn().mockResolvedValueOnce({ items: payments }).mockResolvedValue({ items: [] }),
    findFirst: jest.fn(
      async (filter: any) => payments.find((p) => p._id.equals(filter._id)) ?? null
    ),
    update: jest.fn().mockResolvedValue({}),
    updateById: jest.fn().mockResolvedValue({}),
  };
  const paymentProcessorDAO = {
    findFirst: jest.fn().mockResolvedValue({ accountId: 'ACCT_landlord1', provider: 'paystack' }),
    list: jest.fn().mockResolvedValue({
      items: [{ cuid: NG_CUID }, { cuid: OTHER_TZ_CUID }],
    }),
  };
  const leaseDAO = {
    list: jest.fn().mockResolvedValue({ items: [{ _id: AUTO_DEBIT_LEASE_ID }] }),
  };
  const paystackPaymentService = {
    chargeSavedCard: jest.fn().mockResolvedValue('paid'),
    reconcileProcessingCharge: jest.fn().mockResolvedValue('paid'),
  };
  const paymentGatewayService = { payCharge: jest.fn(), retrievePaymentMethod: jest.fn() };
  const profileDAO = { findFirst: jest.fn() };
  const emitterService = { emit: jest.fn(), on: jest.fn() };

  const service = new PaymentCronService({
    paystackPaymentService: paystackPaymentService as any,
    maintenancePaymentService: {} as any,
    paymentGatewayService: paymentGatewayService as any,
    paymentProcessorDAO: paymentProcessorDAO as any,
    subscriptionPlanConfig: {} as any,
    emitterService: emitterService as any,
    subscriptionDAO: {} as any,
    smsService: { sendToUser: jest.fn() } as any,
    invoiceDAO: {} as any,
    queueFactory: { getQueue: jest.fn().mockReturnValue({}) } as any,
    profileDAO: profileDAO as any,
    paymentDAO: paymentDAO as any,
    clientDAO: {
      getCuidsByTimezone: jest.fn().mockResolvedValue([NG_CUID]),
      getClientByCuid: jest.fn().mockResolvedValue({ settings: {} }),
    } as any,
    leaseDAO: leaseDAO as any,
  });

  return {
    service: service as any,
    paymentDAO,
    paymentProcessorDAO,
    leaseDAO,
    paystackPaymentService,
    paymentGatewayService,
    profileDAO,
  };
};

const paystackPaymentQuery = (paymentDAO: { list: jest.Mock }) =>
  paymentDAO.list.mock.calls.map(([filter]) => filter).find((filter) => filter.lease);

describe('PaymentCronService — automatic Paystack card charges', () => {
  it("charges due rent on auto-debit leases of Paystack accounts in the timezone's clients", async () => {
    const payment = makePayment();
    const { service, paymentDAO, leaseDAO, paystackPaymentService, paymentGatewayService } =
      makeService([]);
    paymentDAO.list
      .mockReset()
      .mockResolvedValueOnce({ items: [] }) // Stripe pass: nothing invoiced
      .mockResolvedValueOnce({ items: [payment] })
      .mockResolvedValue({ items: [] });
    paymentDAO.findFirst.mockResolvedValue(payment);

    await service.autoChargeDueRentPayments('Africa/Lagos');

    // Only this timezone's client, and only its auto-debit leases
    expect(leaseDAO.list.mock.calls[0][0]).toMatchObject({
      cuid: { $in: [NG_CUID] },
      'fees.acceptedPaymentMethod': 'auto-debit',
    });
    const query = paystackPaymentQuery(paymentDAO);
    expect(query).toMatchObject({
      cuid: { $in: [NG_CUID] },
      lease: { $in: [AUTO_DEBIT_LEASE_ID] },
      gatewayPaymentId: { $in: [null] },
      isManualEntry: false,
    });
    expect(paystackPaymentService.chargeSavedCard).toHaveBeenCalledWith(payment);
    expect(paymentGatewayService.payCharge).not.toHaveBeenCalled();
  });

  it('does not look for Paystack charges when no client in the timezone uses Paystack', async () => {
    const { service, paymentDAO, paymentProcessorDAO, paystackPaymentService } = makeService();
    paymentProcessorDAO.list.mockResolvedValue({ items: [{ cuid: OTHER_TZ_CUID }] });

    await service.autoChargeDueRentPayments('Africa/Lagos');

    expect(paystackPaymentQuery(paymentDAO)).toBeUndefined();
    expect(paystackPaymentService.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('records a declined card like any failed auto-charge, with a neutral reason', async () => {
    const payment = makePayment();
    const { service, paymentDAO, paystackPaymentService } = makeService();
    paymentDAO.list
      .mockReset()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [payment] })
      .mockResolvedValue({ items: [] });
    paymentDAO.findFirst.mockResolvedValue(payment);
    paystackPaymentService.chargeSavedCard.mockResolvedValue('declined');

    await service.autoChargeDueRentPayments('Africa/Lagos');

    const failureUpdate = paymentDAO.update.mock.calls.find(
      ([, update]) => update.$set?.status === PaymentRecordStatus.OVERDUE
    );
    expect(failureUpdate?.[1].$set).toMatchObject({
      'failure.reason': t('payment.errors.cardDeclined'),
      'failure.retryCount': 1,
    });
  });

  it('leaves a charge alone when the tenant has no saved card yet', async () => {
    const payment = makePayment();
    const { service, paymentDAO, paystackPaymentService } = makeService();
    paymentDAO.list
      .mockReset()
      .mockResolvedValueOnce({ items: [] })
      .mockResolvedValueOnce({ items: [payment] })
      .mockResolvedValue({ items: [] });
    paymentDAO.findFirst.mockResolvedValue(payment);
    paystackPaymentService.chargeSavedCard.mockResolvedValue('no_saved_card');

    await service.autoChargeDueRentPayments('Africa/Lagos');

    expect(paymentDAO.update).not.toHaveBeenCalled();
  });

  it('keeps Stripe auto-charges running when the Paystack pass fails', async () => {
    const { service, paymentProcessorDAO, paystackPaymentService } = makeService();
    paymentProcessorDAO.list.mockRejectedValue(new Error('db down'));

    await expect(service.autoChargeDueRentPayments('Africa/Lagos')).resolves.toBeUndefined();
    expect(paystackPaymentService.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('charges overdue maintenance on a Paystack account to the saved card, not through Stripe', async () => {
    const payment = makePayment({ paymentType: PaymentRecordType.MAINTENANCE, lease: undefined });
    const { service, paystackPaymentService, paymentGatewayService, profileDAO } = makeService([
      payment,
    ]);

    await service.autoChargeOverdueMaintenancePayments('Africa/Lagos');

    expect(paystackPaymentService.chargeSavedCard).toHaveBeenCalledWith(payment);
    expect(profileDAO.findFirst).not.toHaveBeenCalled();
    expect(paymentGatewayService.payCharge).not.toHaveBeenCalled();
  });

  it('reconciles card charges still processing after a day', async () => {
    const payment = makePayment({
      status: PaymentRecordStatus.PROCESSING,
      cardCheckoutSessionId: 'psk-0a1b2c3d4e5f6a7b8c9d',
    });
    const { service, paymentDAO, paystackPaymentService } = makeService([payment]);

    await service.reconcilePaystackCardCharges();

    expect(paymentDAO.list.mock.calls[0][0]).toMatchObject({
      status: PaymentRecordStatus.PROCESSING,
      cardCheckoutSessionId: { $regex: '^psk-' },
    });
    expect(paystackPaymentService.reconcileProcessingCharge).toHaveBeenCalledWith(payment);
  });
});
