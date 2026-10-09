import { Types } from 'mongoose';
import { PaymentDAO } from '@dao/paymentDAO';
import { ProfileDAO } from '@dao/profileDAO';
import { clearTestDatabase } from '@tests/helpers';
import { SubscriptionDAO } from '@dao/subscriptionDAO';
import { EventTypes } from '@interfaces/events.interface';
import { Subscription, Payment, Profile } from '@models/index';
import { PaymentService } from '@services/payments/payments.service';
import { subscriptionPlanConfig } from '@services/subscription/subscription_plans.config';
import { SubscriptionWebhookService } from '@services/subscription/subscriptionWebhook.service';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';

describe('PaymentService.refundPayment — cumulative, atomic refunds (integration)', () => {
  const CUID = 'REFUND_INT_CUID';
  const ADMIN_ID = new Types.ObjectId().toString();
  let tenantProfileId: Types.ObjectId;

  const mockGateway = { createRefund: jest.fn(), createTransferReversal: jest.fn() };
  const mockEmitter = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
  let paymentService: PaymentService;

  const createPaid = (overrides: Record<string, any> = {}) =>
    Payment.create({
      cuid: CUID,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PAID,
      baseAmount: 150000,
      currency: 'CAD',
      tenant: tenantProfileId,
      dueDate: new Date('2026-09-01'),
      gatewayChargeId: `ch_${new Types.ObjectId().toString()}`,
      isManualEntry: false,
      ...overrides,
    });

  const refund = (pytuid: string, amount?: number) =>
    paymentService.refundPayment(CUID, pytuid, ADMIN_ID, { amount, reason: 'test' });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
    mockGateway.createRefund.mockImplementation(async (_provider: string, params: any) => ({
      success: true,
      data: { refundId: `re_${params.idempotencyKey}`, status: 'succeeded', amount: 1 },
    }));

    const profile = await Profile.create({
      puid: `puid-${new Types.ObjectId().toString()}`,
      user: new Types.ObjectId(),
      personalInfo: {
        firstName: 'Test',
        lastName: 'Tenant',
        displayName: 'Test Tenant',
        location: 'Toronto',
      },
      settings: { lang: 'en' },
    });
    tenantProfileId = profile._id as Types.ObjectId;

    paymentService = new PaymentService({
      paymentDAO: new PaymentDAO({ paymentModel: Payment }),
      profileDAO: new ProfileDAO({ profileModel: Profile }),
      paymentProcessorDAO: { findFirst: jest.fn().mockResolvedValue({ accountId: 'acct_1' }) },
      paymentGatewayService: mockGateway,
      emitterService: mockEmitter,
      invoiceDAO: {},
    } as any);
  });

  it('keeps the payment PAID across partial refunds and marks it REFUNDED when complete', async () => {
    const payment = await createPaid();

    await refund(payment.pytuid, 50000);
    let stored = await Payment.findById(payment._id).lean();
    expect(stored!.status).toBe(PaymentRecordStatus.PAID);
    expect(stored!.refund!.amount).toBe(50000);

    await refund(payment.pytuid);
    stored = await Payment.findById(payment._id).lean();
    expect(stored!.status).toBe(PaymentRecordStatus.REFUNDED);
    expect(stored!.refund!.amount).toBe(150000);
    expect(mockGateway.createRefund).toHaveBeenLastCalledWith(
      'stripe',
      expect.objectContaining({
        amountInCents: 100000,
        idempotencyKey: `refund:${payment.pytuid}:150000`,
      })
    );

    await expect(refund(payment.pytuid, 1)).rejects.toThrow('Cannot refund a payment with status');
  });

  it('lets only one of two concurrent refunds through', async () => {
    const payment = await createPaid();

    const results = await Promise.allSettled([
      refund(payment.pytuid, 100000),
      refund(payment.pytuid, 100000),
    ]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(mockGateway.createRefund).toHaveBeenCalledTimes(1);
    expect((await Payment.findById(payment._id).lean())!.refund!.amount).toBe(100000);
  });

  it('releases the claimed amount when Stripe fails so the refund can be retried', async () => {
    const payment = await createPaid();
    mockGateway.createRefund.mockResolvedValueOnce({ success: false, data: null, message: 'boom' });

    await expect(refund(payment.pytuid, 40000)).rejects.toThrow('boom');
    expect((await Payment.findById(payment._id).lean())!.refund?.amount).toBeUndefined();

    await refund(payment.pytuid, 40000);
    expect((await Payment.findById(payment._id).lean())!.refund!.amount).toBe(40000);
  });
});

describe('PaymentService.releaseDepositRefund — tenant is told once the refund succeeds (integration)', () => {
  const CUID = 'DEPOSIT_RELEASE_CUID';
  const MANAGER_ID = new Types.ObjectId().toString();
  const tenantUserId = new Types.ObjectId();
  let tenantProfileId: Types.ObjectId;

  const mockGateway = { createRefund: jest.fn() };
  const mockEmitter = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
  let paymentService: PaymentService;

  const createStagedDeposit = (overrides: Record<string, any> = {}) =>
    Payment.create({
      cuid: CUID,
      paymentType: PaymentRecordType.SECURITY_DEPOSIT,
      paymentMethod: PaymentMethod.ONLINE,
      status: PaymentRecordStatus.PENDING_REFUND,
      baseAmount: 200000,
      currency: 'CAD',
      tenant: tenantProfileId,
      dueDate: new Date('2026-01-01'),
      gatewayChargeId: `ch_${new Types.ObjectId().toString()}`,
      refund: { amount: 150000 }, // PM-approved refund, staged before Stripe confirms
      isManualEntry: false,
      ...overrides,
    });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
    mockGateway.createRefund.mockResolvedValue({
      success: true,
      data: { refundId: 're_dep_1', status: 'succeeded', amount: 150000 },
    });

    const profile = await Profile.create({
      puid: `puid-${new Types.ObjectId().toString()}`,
      user: tenantUserId,
      personalInfo: {
        firstName: 'Test',
        lastName: 'Tenant',
        displayName: 'Test Tenant',
        location: 'Toronto',
      },
      settings: { lang: 'en' },
    });
    tenantProfileId = profile._id as Types.ObjectId;

    paymentService = new PaymentService({
      paymentDAO: new PaymentDAO({ paymentModel: Payment }),
      profileDAO: new ProfileDAO({ profileModel: Profile }),
      paymentGatewayService: mockGateway,
      emitterService: mockEmitter,
    } as any);
  });

  const expectRefundAnnounced = () =>
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_REFUNDED,
      expect.objectContaining({
        cuid: CUID,
        tenantId: tenantUserId.toString(),
        amount: 150000,
        totalRefunded: 150000,
        currency: 'CAD',
        isPartial: true,
      })
    );

  it('emits PAYMENT_REFUNDED after a successful Stripe deposit refund', async () => {
    const deposit = await createStagedDeposit();

    await paymentService.releaseDepositRefund(CUID, deposit.pytuid, MANAGER_ID);

    const stored = await Payment.findById(deposit._id).lean();
    expect(stored!.status).toBe(PaymentRecordStatus.REFUNDED);
    expectRefundAnnounced();
  });

  it('emits PAYMENT_REFUNDED for an offline (cash/cheque) release too', async () => {
    const deposit = await createStagedDeposit();

    await paymentService.releaseDepositRefund(CUID, deposit.pytuid, MANAGER_ID, {
      isManualRelease: true,
    });

    expect(mockGateway.createRefund).not.toHaveBeenCalled();
    expectRefundAnnounced();
  });

  it('does not announce anything when the Stripe refund fails', async () => {
    const deposit = await createStagedDeposit();
    mockGateway.createRefund.mockResolvedValue({ success: false, data: null, message: 'nope' });

    await expect(
      paymentService.releaseDepositRefund(CUID, deposit.pytuid, MANAGER_ID)
    ).rejects.toThrow();

    expect(mockEmitter.emit).not.toHaveBeenCalledWith(
      EventTypes.PAYMENT_REFUNDED,
      expect.anything()
    );
  });
});

describe('SubscriptionWebhookService — manual record overage period (integration)', () => {
  const CUID = 'OVERAGE_INT_CUID';
  const PERIOD_1 = new Date('2026-09-01T00:00:00Z');
  const PERIOD_2 = new Date('2026-10-01T00:00:00Z');

  const mockGateway = { createInvoiceItem: jest.fn() };
  let webhookService: SubscriptionWebhookService;
  let subscription: any;

  const closePeriod = (periodStart: Date) =>
    (webhookService as any).closeManualRecordPeriod(subscription, periodStart);

  const storedCounter = async () =>
    ((await Subscription.collection.findOne({ cuid: CUID })) as any).manualRecords;

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
    jest.spyOn(subscriptionPlanConfig, 'getManualRecordQuota').mockReturnValue(2);
    jest.spyOn(subscriptionPlanConfig, 'getManualRecordOverageFeeCents').mockReturnValue(50);
    mockGateway.createInvoiceItem.mockResolvedValue({ success: true, data: {} });

    const { insertedId } = await Subscription.collection.insertOne({
      cuid: CUID,
      planName: 'starter',
      billing: { customerId: 'cus_1' },
      manualRecords: { countThisPeriod: 5, periodStart: PERIOD_1 },
    });
    subscription = { _id: insertedId, cuid: CUID };

    webhookService = new SubscriptionWebhookService({
      subscriptionDAO: new SubscriptionDAO(),
      paymentGatewayService: mockGateway,
    } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('bills the overage and resets the counter when the billing period advances', async () => {
    await closePeriod(PERIOD_2);

    expect(mockGateway.createInvoiceItem).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({ customerId: 'cus_1', amountInCents: 150 })
    );
    expect(await storedCounter()).toEqual({ countThisPeriod: 0, periodStart: PERIOD_2 });
  });

  it('does nothing when the update is for the same billing period (plan/seat/status change)', async () => {
    await closePeriod(PERIOD_1);

    expect(mockGateway.createInvoiceItem).not.toHaveBeenCalled();
    expect(await storedCounter()).toEqual({ countThisPeriod: 5, periodStart: PERIOD_1 });
  });

  it('bills a period once even when the webhook is delivered twice at the same time', async () => {
    await Promise.all([closePeriod(PERIOD_2), closePeriod(PERIOD_2)]);

    expect(mockGateway.createInvoiceItem).toHaveBeenCalledTimes(1);
  });

  it('counts concurrent manual records atomically with $inc', async () => {
    const subscriptionDAO = new SubscriptionDAO();
    await Promise.all([
      subscriptionDAO.incrementUsageCounter(CUID, 'manualRecords.countThisPeriod'),
      subscriptionDAO.incrementUsageCounter(CUID, 'manualRecords.countThisPeriod'),
    ]);

    expect((await storedCounter()).countThisPeriod).toBe(7);
  });
});
