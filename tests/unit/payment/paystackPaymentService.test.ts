import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { BadRequestError } from '@shared/customErrors';
import { EventTypes } from '@interfaces/events.interface';
import { PaystackPaymentService } from '@services/payments/paystackPayment.service';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';

const CUID = 'CLIENT1';
const PYTUID = 'PY_RENT-1'; // nanoid ids can hold '_' and '-', which Paystack references can't
const REFERENCE = 'psk-0a1b2c3d4e5f6a7b8c9d';
const TENANT_PROFILE_ID = new Types.ObjectId();

const makePayment = (overrides: Record<string, unknown> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: PYTUID,
  cuid: CUID,
  tenant: TENANT_PROFILE_ID,
  paymentType: PaymentRecordType.RENT,
  status: PaymentRecordStatus.PENDING,
  baseAmount: 120_000_000, // ₦1,200,000 in kobo
  applicationFee: 0,
  currency: 'NGN',
  cardCheckoutSessionId: REFERENCE,
  ...overrides,
});

const processor = { accountId: 'ACCT_landlord1', provider: 'paystack', chargesEnabled: true };

const makeTransaction = (overrides: Record<string, unknown> = {}) => ({
  id: 4099260516,
  status: 'success',
  reference: REFERENCE,
  amount: 120_000_000,
  currency: 'NGN',
  fees: 200_000,
  paid_at: '2026-11-25T10:00:00.000Z',
  metadata: { pytuid: PYTUID, cuid: CUID, uid: 'TENANTUID', type: 'card_payment' },
  subaccount: { subaccount_code: 'ACCT_landlord1' },
  customer: { email: 'tenant@example.com' },
  authorization: {
    authorization_code: 'AUTH_8dfhjjdt',
    card_type: 'visa ',
    last4: '4081',
    exp_month: '12',
    exp_year: '2030',
    channel: 'card',
    reusable: true,
  },
  ...overrides,
});

const makeService = () => {
  const paymentDAO = {
    findFirst: jest.fn(),
    update: jest.fn(),
    updateById: jest.fn().mockResolvedValue({}),
  };
  const paymentProcessorDAO = { findFirst: jest.fn().mockResolvedValue(processor) };
  const profileDAO = { update: jest.fn().mockResolvedValue({}) };
  const subscriptionDAO = { findFirst: jest.fn().mockResolvedValue({ planName: 'growth' }) };
  const subscriptionPlanConfig = {
    getTransactionFeePercent: jest.fn().mockReturnValue(3.9),
    calculatePaymentGatewayFee: jest.fn().mockReturnValue(200_000),
  };
  const emitterService = { emit: jest.fn() };
  const paymentWebhookService = {
    markMaintenanceChargePaid: jest.fn().mockResolvedValue(undefined),
  };
  const paymentGatewayService = {
    initializeCardCheckout: jest.fn().mockResolvedValue({
      authorization_url: 'https://checkout.paystack.com/abc',
      access_code: 'abc',
      reference: REFERENCE,
    }),
    verifyPaystackTransaction: jest.fn().mockResolvedValue(makeTransaction()),
    createRefund: jest.fn().mockResolvedValue({ success: true, data: { refundId: '1' } }),
    providerForPayment: PaymentGatewayService.prototype.providerForPayment,
  };

  const service = new PaystackPaymentService({
    paymentDAO: paymentDAO as any,
    paymentProcessorDAO: paymentProcessorDAO as any,
    profileDAO: profileDAO as any,
    subscriptionDAO: subscriptionDAO as any,
    subscriptionPlanConfig: subscriptionPlanConfig as any,
    emitterService: emitterService as any,
    paymentWebhookService: paymentWebhookService as any,
    paymentGatewayService: paymentGatewayService as any,
  });
  return {
    service,
    paymentDAO,
    profileDAO,
    emitterService,
    paymentWebhookService,
    paymentGatewayService,
  };
};

describe('PaystackPaymentService - createCardCheckout', () => {
  const checkoutInput = (payment: ReturnType<typeof makePayment>) => ({
    payment: payment as any,
    processor: processor as any,
    applicationFee: 4_680_000,
    customerEmail: 'tenant@example.com',
    successUrl:
      'https://app.example.com/tenants/CLIENT1/U1/payments/PY_RENT-1?payment_success=true',
    cancelUrl:
      'https://app.example.com/tenants/CLIENT1/U1/payments/PY_RENT-1?payment_cancelled=true',
    tenantUid: 'TENANTUID',
  });

  it('sends rent to the landlord subaccount with the platform fee, and remembers the reference', async () => {
    const { service, paymentGatewayService, paymentDAO } = makeService();
    const payment = makePayment();

    const result = await service.createCardCheckout(checkoutInput(payment));

    const body = paymentGatewayService.initializeCardCheckout.mock.calls[0][0];
    expect(body).toMatchObject({
      email: 'tenant@example.com',
      amount: 120_000_000,
      currency: 'NGN',
      subaccount: 'ACCT_landlord1',
      transaction_charge: 4_680_000,
      bearer: 'account',
      metadata: { pytuid: PYTUID, cuid: CUID, uid: 'TENANTUID' },
    });
    // Paystack references allow only letters, digits, '-', '.' and '='
    expect(body.reference).toMatch(/^psk-[a-f0-9]{20}$/);
    expect(body.metadata.cancel_action).toContain('payment_cancelled=true');
    expect(paymentDAO.updateById).toHaveBeenCalledWith(payment._id.toString(), {
      $set: { cardCheckoutSessionId: body.reference },
    });
    expect(result).toEqual({ checkoutUrl: 'https://checkout.paystack.com/abc' });
  });

  it('keeps a maintenance charge in the platform balance (no subaccount or split)', async () => {
    const { service, paymentGatewayService } = makeService();

    await service.createCardCheckout(
      checkoutInput(makePayment({ paymentType: PaymentRecordType.MAINTENANCE }))
    );

    const body = paymentGatewayService.initializeCardCheckout.mock.calls[0][0];
    expect(body.subaccount).toBeUndefined();
    expect(body.transaction_charge).toBeUndefined();
    expect(body.bearer).toBeUndefined();
  });

  it('refuses a non-naira charge, which is paid by bank transfer instead', async () => {
    const { service, paymentGatewayService } = makeService();

    await expect(
      service.createCardCheckout(checkoutInput(makePayment({ currency: 'USD' })))
    ).rejects.toThrow(t('payment.errors.cardCheckoutCurrencyUnsupported'));
    expect(paymentGatewayService.initializeCardCheckout).not.toHaveBeenCalled();
  });
});

describe('PaystackPaymentService - settleTransaction', () => {
  it('marks the charge paid with fees, saves the card and announces the payment', async () => {
    const { service, paymentDAO, profileDAO, emitterService, paymentWebhookService } =
      makeService();
    const payment = makePayment();
    paymentDAO.findFirst.mockResolvedValue(payment);
    paymentDAO.update.mockResolvedValue({ ...payment, status: PaymentRecordStatus.PAID });

    const outcome = await service.settleTransaction(REFERENCE);

    expect(outcome).toBe('paid');
    const [filter, update] = paymentDAO.update.mock.calls[0];
    expect(filter.status).toEqual({
      $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE, PaymentRecordStatus.FAILED],
    });
    expect(update.$set).toMatchObject({
      status: PaymentRecordStatus.PAID,
      gatewayPaymentId: REFERENCE,
      gatewayChargeId: '4099260516',
      processingFee: 200_000, // Paystack's reported fee
      applicationFee: 4_680_000, // 3.9% plan rate
      platformRevenue: 4_480_000,
    });
    expect(update.$unset).toEqual({ cardCheckoutSessionId: '' });

    expect(profileDAO.update).toHaveBeenCalledWith(
      { _id: TENANT_PROFILE_ID, tenantInfo: null },
      { $set: { tenantInfo: {} } }
    );
    expect(profileDAO.update).toHaveBeenCalledWith(
      { _id: TENANT_PROFILE_ID },
      {
        $set: {
          'tenantInfo.paystackCards.ACCT_landlord1': expect.objectContaining({
            authorizationCode: 'AUTH_8dfhjjdt',
            email: 'tenant@example.com',
            brand: 'visa',
            last4: '4081',
          }),
        },
      }
    );
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_SUCCEEDED,
      expect.objectContaining({
        pytuid: PYTUID,
        amount: 120_000_000,
        currency: 'NGN',
        tenantId: TENANT_PROFILE_ID.toString(),
      })
    );
    expect(paymentWebhookService.markMaintenanceChargePaid).toHaveBeenCalled();
  });

  it('does nothing for a transaction that is not successful', async () => {
    const { service, paymentGatewayService, paymentDAO } = makeService();
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ status: 'abandoned' })
    );

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('not_successful');
    expect(paymentDAO.findFirst).not.toHaveBeenCalled();
  });

  it('records the same transaction only once', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    paymentDAO.findFirst.mockResolvedValue(
      makePayment({ status: PaymentRecordStatus.PAID, gatewayPaymentId: REFERENCE })
    );

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('already_paid');
    expect(paymentDAO.update).not.toHaveBeenCalled();
    expect(emitterService.emit).not.toHaveBeenCalled();
  });

  it.each([
    ['amount', { amount: 1_000 }],
    ['currency', { currency: 'USD' }],
    ['destination', { subaccount: { subaccount_code: 'ACCT_someone_else' } }],
  ])('leaves a %s mismatch for review instead of marking it paid', async (_label, change) => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.findFirst.mockResolvedValue(makePayment());
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(makeTransaction(change));

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('needs_review');
    expect(paymentDAO.update).not.toHaveBeenCalled();
  });

  it('refunds a second payment for a charge that was already settled another way', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    const payment = makePayment({
      status: PaymentRecordStatus.PAID,
      gatewayPaymentId: 'psk-older',
    });
    paymentDAO.findFirst.mockResolvedValue(payment);
    paymentDAO.update.mockResolvedValue(null); // no longer payable

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('refunded_duplicate');
    expect(paymentGatewayService.createRefund).toHaveBeenCalledWith(
      'paystack',
      expect.objectContaining({ chargeId: '4099260516', amountInCents: 120_000_000 })
    );
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_REFUNDED,
      expect.objectContaining({ pytuid: PYTUID, reason: 'duplicate_payment', isPartial: false })
    );
  });

  it('treats a race with the webhook as already paid, not as a duplicate', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = makePayment();
    paymentDAO.findFirst
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({ ...payment, gatewayPaymentId: REFERENCE });
    paymentDAO.update.mockResolvedValue(null);

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('already_paid');
    expect(paymentGatewayService.createRefund).not.toHaveBeenCalled();
  });

  it('reads metadata Paystack sends back as a JSON string', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.findFirst.mockResolvedValue(makePayment());
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ metadata: JSON.stringify({ pytuid: PYTUID, cuid: CUID }) })
    );

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('paid');
    expect(paymentDAO.findFirst).toHaveBeenCalledWith({
      pytuid: PYTUID,
      cuid: CUID,
      deletedAt: null,
    });
  });

  it('does not save a card that cannot be charged again', async () => {
    const { service, paymentDAO, profileDAO, paymentGatewayService } = makeService();
    paymentDAO.findFirst.mockResolvedValue(makePayment());
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ authorization: { channel: 'bank_transfer', reusable: false } })
    );

    await service.settleTransaction(REFERENCE);
    expect(profileDAO.update).not.toHaveBeenCalled();
  });
});

describe('PaystackPaymentService - confirmCheckout and webhook events', () => {
  it("refuses a reference that isn't this charge's checkout", async () => {
    const { service, paymentGatewayService } = makeService();

    await expect(
      service.confirmCheckout(makePayment() as any, 'psk-ffffffffffffffffffff')
    ).rejects.toThrow(BadRequestError);
    expect(paymentGatewayService.verifyPaystackTransaction).not.toHaveBeenCalled();
  });

  it('confirms the charge on the return page and reports its status', async () => {
    const { service, paymentDAO } = makeService();
    const payment = makePayment();
    paymentDAO.findFirst
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce({ ...payment, status: PaymentRecordStatus.PAID });
    paymentDAO.update.mockResolvedValue({});

    const result = await service.confirmCheckout(payment as any, REFERENCE);

    expect(result).toEqual({ outcome: 'paid', status: PaymentRecordStatus.PAID });
  });

  it('settles charge.success events and ignores transactions the app did not start', async () => {
    const { service, paymentGatewayService, paymentDAO } = makeService();
    paymentDAO.findFirst.mockResolvedValue(makePayment());
    paymentDAO.update.mockResolvedValue({});

    await service.handleWebhookEvent({
      event: 'charge.success',
      data: { reference: 'T123dashboard' },
    });
    expect(paymentGatewayService.verifyPaystackTransaction).not.toHaveBeenCalled();

    await service.handleWebhookEvent({ event: 'charge.success', data: { reference: REFERENCE } });
    expect(paymentGatewayService.verifyPaystackTransaction).toHaveBeenCalledWith(REFERENCE);
  });

  it('flags a failed refund on its payment', async () => {
    const { service, paymentDAO } = makeService();

    await service.handleWebhookEvent({
      event: 'refund.failed',
      data: { transaction_reference: REFERENCE },
    });

    expect(paymentDAO.update).toHaveBeenCalledWith(
      { gatewayPaymentId: REFERENCE },
      { $set: expect.objectContaining({ 'refund.failedAt': expect.any(Date) }) }
    );
  });
});
