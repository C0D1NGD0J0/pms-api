import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { CircuitBreakerOpenError } from '@utils/index';
import { EventTypes } from '@interfaces/events.interface';
import { ServiceUnavailableError, BadRequestError } from '@shared/customErrors';
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
  const profileDAO = {
    update: jest.fn().mockResolvedValue({}),
    findFirst: jest.fn().mockResolvedValue({
      tenantInfo: {
        paystackCards: new Map([
          [
            'ACCT_landlord1',
            {
              authorizationCode: 'AUTH_8dfhjjdt',
              email: 'tenant@example.com',
              last4: '4081',
              savedAt: new Date(),
            },
          ],
        ]),
      },
    }),
  };
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
    chargeSavedCard: jest.fn().mockResolvedValue(makeTransaction()),
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
    // PROCESSING is an in-flight automatic card charge, which settles like any other
    expect(filter.status).toEqual({
      $in: [
        PaymentRecordStatus.PENDING,
        PaymentRecordStatus.OVERDUE,
        PaymentRecordStatus.FAILED,
        PaymentRecordStatus.PROCESSING,
      ],
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
    const markedPaid = paymentDAO.update.mock.calls.some(
      ([, update]) => update.$set?.status === PaymentRecordStatus.PAID
    );
    expect(markedPaid).toBe(false);
  });

  it('alerts managers once about money that needs review, not on every re-check', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    paymentDAO.findFirst.mockResolvedValue(makePayment());
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ amount: 1_000 })
    );
    paymentDAO.update.mockResolvedValueOnce({}).mockResolvedValueOnce(null); // flagged already

    await service.settleTransaction(REFERENCE);
    await service.settleTransaction(REFERENCE);

    expect(paymentDAO.update.mock.calls[0]).toEqual([
      expect.objectContaining({ 'failure.reason': { $ne: t('payment.errors.needsReview') } }),
      { $set: expect.objectContaining({ 'failure.reason': t('payment.errors.needsReview') }) },
    ]);
    const alerts = emitterService.emit.mock.calls.filter(
      ([event]) => event === EventTypes.PAYMENT_NEEDS_REVIEW
    );
    expect(alerts).toEqual([
      [
        EventTypes.PAYMENT_NEEDS_REVIEW,
        { cuid: CUID, pytuid: PYTUID, reference: REFERENCE, amount: 1_000, currency: 'NGN' },
      ],
    ]);
  });

  it('alerts managers about paid money with no matching charge', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    paymentDAO.findFirst.mockResolvedValue(null);

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('not_found');
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_NEEDS_REVIEW,
      expect.objectContaining({ cuid: CUID, reference: REFERENCE })
    );
  });

  it('finishes the maintenance invoice when an already-recorded payment is seen again', async () => {
    const { service, paymentDAO, paymentWebhookService } = makeService();
    const payment = makePayment({
      paymentType: PaymentRecordType.MAINTENANCE,
      status: PaymentRecordStatus.PAID,
      gatewayPaymentId: REFERENCE,
    });
    paymentDAO.findFirst.mockResolvedValue(payment);

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('already_paid');
    expect(paymentWebhookService.markMaintenanceChargePaid).toHaveBeenCalledWith(
      payment,
      '4099260516'
    );
  });

  it('alerts managers when a duplicate payment could not be refunded', async () => {
    const { service, paymentDAO, paymentGatewayService, emitterService } = makeService();
    paymentDAO.findFirst.mockResolvedValue(
      makePayment({ status: PaymentRecordStatus.PAID, gatewayPaymentId: 'psk-older' })
    );
    paymentDAO.update.mockResolvedValue(null);
    paymentGatewayService.createRefund.mockResolvedValue({ success: false, message: 'refused' });

    await expect(service.settleTransaction(REFERENCE)).resolves.toBe('needs_review');
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_REFUND_FAILED,
      expect.objectContaining({ pytuid: PYTUID, amount: 120_000_000 })
    );
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

  it("doesn't show the tenant an error when only a step after recording the payment failed", async () => {
    const { service, paymentDAO, paymentWebhookService } = makeService();
    const payment = makePayment({ paymentType: PaymentRecordType.MAINTENANCE });
    const recorded = { ...payment, status: PaymentRecordStatus.PAID, gatewayPaymentId: REFERENCE };
    paymentDAO.findFirst.mockResolvedValueOnce(payment).mockResolvedValue(recorded);
    paymentDAO.update.mockResolvedValue({});
    paymentWebhookService.markMaintenanceChargePaid.mockRejectedValue(new Error('db blip'));

    await expect(service.confirmCheckout(payment as any, REFERENCE)).resolves.toEqual({
      outcome: 'paid',
      status: PaymentRecordStatus.PAID,
    });
  });

  it('passes the error on when nothing was recorded', async () => {
    const { service, paymentGatewayService } = makeService();
    paymentGatewayService.verifyPaystackTransaction.mockRejectedValue(
      new ServiceUnavailableError({ message: 'down' })
    );

    await expect(service.confirmCheckout(makePayment() as any, REFERENCE)).rejects.toBeInstanceOf(
      ServiceUnavailableError
    );
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

  it('flags a failed refund on its payment and alerts managers', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    paymentDAO.update.mockResolvedValue(makePayment({ status: PaymentRecordStatus.REFUNDED }));

    await service.handleWebhookEvent({
      event: 'refund.failed',
      data: { transaction_reference: REFERENCE, amount: 5_000_000 },
    });

    expect(paymentDAO.update).toHaveBeenCalledWith(
      { gatewayPaymentId: REFERENCE },
      { $set: expect.objectContaining({ 'refund.failedAt': expect.any(Date) }) }
    );
    expect(emitterService.emit).toHaveBeenCalledWith(EventTypes.PAYMENT_REFUND_FAILED, {
      cuid: CUID,
      pytuid: PYTUID,
      amount: 5_000_000,
      currency: 'NGN',
    });
  });

  it('uses the deposit alert (in-app + email) for a failed deposit refund', async () => {
    const { service, paymentDAO, emitterService } = makeService();
    const leaseId = new Types.ObjectId();
    paymentDAO.update.mockResolvedValue(
      makePayment({ paymentType: PaymentRecordType.SECURITY_DEPOSIT, lease: leaseId })
    );

    await service.handleWebhookEvent({
      event: 'refund.failed',
      data: { transaction_reference: REFERENCE },
    });

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.DEPOSIT_REFUND_FAILED,
      expect.objectContaining({ pytuid: PYTUID, leaseId: leaseId.toString(), amount: 120_000_000 })
    );
  });
});

describe('PaystackPaymentService - chargeSavedCard (automatic payments)', () => {
  const dueRent = () => makePayment({ cardCheckoutSessionId: undefined });

  it("charges the tenant's saved card to the landlord's subaccount, then records it", async () => {
    const { service, paymentDAO, paymentGatewayService, profileDAO } = makeService();
    const payment = dueRent();
    paymentDAO.update.mockResolvedValue({ ...payment });
    paymentDAO.findFirst.mockResolvedValue(payment);

    const outcome = await service.chargeSavedCard(payment as any);

    expect(outcome).toBe('paid');
    // The hidden saved-card field is read explicitly
    expect(profileDAO.findFirst).toHaveBeenCalledWith(
      { _id: TENANT_PROFILE_ID },
      { select: '+tenantInfo.paystackCards' }
    );
    const charge = paymentGatewayService.chargeSavedCard.mock.calls[0][0];
    expect(charge).toMatchObject({
      authorization_code: 'AUTH_8dfhjjdt',
      email: 'tenant@example.com',
      amount: 120_000_000,
      currency: 'NGN',
      subaccount: 'ACCT_landlord1',
      transaction_charge: 4_680_000, // 3.9% plan rate
      bearer: 'account',
    });
    expect(charge.reference).toMatch(/^psk-[a-f0-9]{20}$/);
    expect(JSON.parse(charge.metadata)).toMatchObject({ pytuid: PYTUID, cuid: CUID });
    // Claimed before charging, only while the charge is still open
    expect(paymentDAO.update.mock.calls[0][0]).toMatchObject({
      status: { $in: [PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE] },
    });
    expect(paymentGatewayService.verifyPaystackTransaction).toHaveBeenCalledWith(charge.reference);
  });

  it('charges a deposit to the subaccount without a platform fee', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue({});

    await service.chargeSavedCard(
      makePayment({ paymentType: PaymentRecordType.SECURITY_DEPOSIT, applicationFee: 0 }) as any
    );

    const charge = paymentGatewayService.chargeSavedCard.mock.calls[0][0];
    expect(charge.subaccount).toBe('ACCT_landlord1');
    expect(charge.transaction_charge).toBeUndefined();
  });

  it('does nothing when the tenant has no saved card yet', async () => {
    const { service, profileDAO, paymentGatewayService } = makeService();
    profileDAO.findFirst.mockResolvedValue({ tenantInfo: {} });

    await expect(service.chargeSavedCard(dueRent() as any)).resolves.toBe('no_saved_card');
    expect(paymentGatewayService.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('does not charge a non-naira charge', async () => {
    const { service, paymentGatewayService } = makeService();

    await expect(service.chargeSavedCard(makePayment({ currency: 'USD' }) as any)).resolves.toBe(
      'no_saved_card'
    );
    expect(paymentGatewayService.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('does not charge when the charge was paid or closed meanwhile', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue(null);

    await expect(service.chargeSavedCard(dueRent() as any)).resolves.toBe('no_saved_card');
    expect(paymentGatewayService.chargeSavedCard).not.toHaveBeenCalled();
  });

  it('reports a declined card and clears the attempt', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.chargeSavedCard.mockResolvedValue(
      makeTransaction({ status: 'failed', gateway_response: 'Declined' })
    );

    await expect(service.chargeSavedCard(dueRent() as any)).resolves.toBe('declined');
    expect(paymentDAO.update).toHaveBeenLastCalledWith(
      { _id: expect.anything() },
      { $unset: { cardCheckoutSessionId: '' } }
    );
    expect(paymentGatewayService.verifyPaystackTransaction).not.toHaveBeenCalled();
  });

  it('marks a charge Paystack is still working on as processing', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.chargeSavedCard.mockResolvedValue(makeTransaction({ status: 'pending' }));

    await expect(service.chargeSavedCard(dueRent() as any)).resolves.toBe('processing');
    expect(paymentDAO.update).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: { $in: expect.any(Array) } }),
      { $set: { status: PaymentRecordStatus.PROCESSING } }
    );
  });

  const lastUpdate = (paymentDAO: { update: jest.Mock }) =>
    paymentDAO.update.mock.calls[paymentDAO.update.mock.calls.length - 1][1];

  it('keeps a charged card that needs review out of the auto-charge, so it is never charged twice', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = dueRent();
    paymentDAO.findFirst.mockResolvedValue(payment);
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ amount: 1_000 })
    );

    await expect(service.chargeSavedCard(payment as any)).resolves.toBe('needs_review');
    expect(lastUpdate(paymentDAO)).toEqual({ $set: { status: PaymentRecordStatus.PROCESSING } });
  });

  it('leaves a charge processing when recording it failed after the card was charged', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue({});
    paymentDAO.findFirst.mockResolvedValue(dueRent()); // not recorded
    paymentGatewayService.verifyPaystackTransaction.mockRejectedValue(new Error('db blip'));

    await expect(service.chargeSavedCard(dueRent() as any)).resolves.toBe('processing');
    expect(lastUpdate(paymentDAO)).toEqual({ $set: { status: PaymentRecordStatus.PROCESSING } });
  });

  it('reopens the charge without charging when Paystack is known to be down', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.chargeSavedCard.mockRejectedValue(
      new ServiceUnavailableError({
        message: 'down',
        originalError: new CircuitBreakerOpenError('paystack'),
      })
    );

    await expect(service.chargeSavedCard(dueRent() as any)).resolves.toBe('unavailable');
    expect(lastUpdate(paymentDAO)).toEqual({ $unset: { cardCheckoutSessionId: '' } });
  });

  it('leaves the charge for the reconcile when a timeout leaves the result unknown', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.chargeSavedCard.mockRejectedValue(
      new ServiceUnavailableError({ message: 'timeout', originalError: new Error('aborted') })
    );

    await expect(service.chargeSavedCard(dueRent() as any)).resolves.toBe('processing');
    expect(lastUpdate(paymentDAO)).toEqual({ $set: { status: PaymentRecordStatus.PROCESSING } });
  });

  it('passes on a rejected charge request as a failed attempt', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentDAO.update.mockResolvedValue({});
    paymentGatewayService.chargeSavedCard.mockRejectedValue(
      new BadRequestError({ message: 'rejected' })
    );

    await expect(service.chargeSavedCard(dueRent() as any)).rejects.toBeInstanceOf(BadRequestError);
    expect(lastUpdate(paymentDAO)).toEqual({ $unset: { cardCheckoutSessionId: '' } });
  });
});

describe('PaystackPaymentService - reconcileProcessingCharge', () => {
  const processing = (hoursAgo: number) =>
    makePayment({
      status: PaymentRecordStatus.PROCESSING,
      chargedAt: new Date(Date.now() - hoursAgo * 3600_000),
    });

  it('records a charge Paystack now reports as successful', async () => {
    const { service, paymentDAO } = makeService();
    const payment = processing(30);
    paymentDAO.findFirst.mockResolvedValue(payment);
    paymentDAO.update.mockResolvedValue({});

    await expect(service.reconcileProcessingCharge(payment as any)).resolves.toBe('paid');
  });

  it('reopens a failed charge as overdue and counts the attempt', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ status: 'failed' })
    );

    await expect(service.reconcileProcessingCharge(processing(30) as any)).resolves.toBe(
      'reopened'
    );
    const [filter, update] = paymentDAO.update.mock.calls[0];
    expect(filter.status).toBe(PaymentRecordStatus.PROCESSING);
    expect(update.$set.status).toBe(PaymentRecordStatus.OVERDUE);
    expect(update.$inc).toEqual({ 'failure.retryCount': 1 });
  });

  it('waits on a recent pending charge but reopens one stuck for days', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ status: 'pending' })
    );

    await expect(service.reconcileProcessingCharge(processing(30) as any)).resolves.toBe('waiting');
    expect(paymentDAO.update).not.toHaveBeenCalled();

    await expect(service.reconcileProcessingCharge(processing(80) as any)).resolves.toBe(
      'reopened'
    );
  });

  it("reopens a charge Paystack never received, without counting it as the tenant's attempt", async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentGatewayService.verifyPaystackTransaction.mockRejectedValue(
      new BadRequestError({ message: 'Transaction reference not found' })
    );

    await expect(service.reconcileProcessingCharge(processing(30) as any)).resolves.toBe(
      'reopened'
    );
    const [, update] = paymentDAO.update.mock.calls[0];
    expect(update.$set.status).toBe(PaymentRecordStatus.OVERDUE);
    expect(update.$inc).toBeUndefined();
  });

  it('passes on an outage so the next run checks again', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    paymentGatewayService.verifyPaystackTransaction.mockRejectedValue(
      new ServiceUnavailableError({ message: 'down' })
    );

    await expect(service.reconcileProcessingCharge(processing(30) as any)).rejects.toBeInstanceOf(
      ServiceUnavailableError
    );
    expect(paymentDAO.update).not.toHaveBeenCalled();
  });

  it('reports a successful charge that does not match as needing review', async () => {
    const { service, paymentDAO, paymentGatewayService } = makeService();
    const payment = processing(30);
    paymentDAO.findFirst.mockResolvedValue(payment);
    paymentDAO.update.mockResolvedValue(null);
    paymentGatewayService.verifyPaystackTransaction.mockResolvedValue(
      makeTransaction({ amount: 1_000 })
    );

    await expect(service.reconcileProcessingCharge(payment as any)).resolves.toBe('needs_review');
  });
});
