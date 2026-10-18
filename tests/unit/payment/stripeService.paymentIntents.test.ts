import { StripeService } from '@services/external/stripe/stripe.service';

const makeService = (paymentIntents: Record<string, jest.Mock>) => {
  const service = new StripeService();
  (service as any).stripe = { paymentIntents };
  return service;
};

const baseInput = {
  tenantCustomerId: 'cus_1',
  connectedAccountId: 'acct_pm',
  applicationFeeAmountInCents: 1500,
  currency: 'cad',
  description: 'Rent for 10/2026',
  lineItems: [
    { description: 'Monthly Rent', amountInCents: 150000 },
    { description: 'Pet Fee', amountInCents: 5000 },
  ],
  cuid: 'CUID-1',
};

describe('StripeService.createPaymentIntent', () => {
  it('creates an unconfirmed destination charge for the line-item total', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'pi_1', amount: 155000, status: 'requires_confirmation' });
    const service = makeService({ create });

    const result = await service.createPaymentIntent({
      ...baseInput,
      paymentMethodId: 'pm_acss',
      mandateId: 'mandate_1',
      leaseUid: 'LUID-1',
      idempotencyKey: 'rent-invoice-job:42:full',
    });

    expect(result).toEqual({ chargeId: 'pi_1', amount: 155000, status: 'requires_confirmation' });
    const [params, options] = create.mock.calls[0];
    expect(params).toMatchObject({
      amount: 155000,
      currency: 'cad',
      customer: 'cus_1',
      payment_method: 'pm_acss',
      application_fee_amount: 1500,
      transfer_data: { destination: 'acct_pm' },
      automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
      metadata: { cuid: 'CUID-1', leaseUid: 'LUID-1', mandateId: 'mandate_1' },
    });
    expect(params).not.toHaveProperty('confirm');
    expect(options).toEqual({ idempotencyKey: 'rent-invoice-job:42:full:create' });
  });

  it('keeps maintenance charges on the platform (no transfer, no application fee)', async () => {
    const create = jest
      .fn()
      .mockResolvedValue({ id: 'pi_m', amount: 155000, status: 'requires_confirmation' });
    const service = makeService({ create });

    await service.createPaymentIntent({ ...baseInput, skipDestinationTransfer: true });

    const [params, options] = create.mock.calls[0];
    expect(params).not.toHaveProperty('transfer_data');
    expect(params).not.toHaveProperty('application_fee_amount');
    expect(options).toBeUndefined();
  });
});

describe('StripeService.confirmPaymentIntent', () => {
  it('confirms off-session with the mandate stored at creation', async () => {
    const retrieve = jest
      .fn()
      .mockResolvedValue({ payment_method: 'pm_acss', metadata: { mandateId: 'mandate_1' } });
    const confirm = jest.fn().mockResolvedValue({});
    const service = makeService({ retrieve, confirm });

    await service.confirmPaymentIntent('pi_1');

    expect(confirm).toHaveBeenCalledWith('pi_1', { mandate: 'mandate_1', off_session: true });
  });

  it('never sends the stored bank mandate with a different payment method', async () => {
    const retrieve = jest
      .fn()
      .mockResolvedValue({ payment_method: 'pm_acss', metadata: { mandateId: 'mandate_1' } });
    const confirm = jest.fn().mockResolvedValue({});
    const service = makeService({ retrieve, confirm });

    await service.confirmPaymentIntent('pi_1', { paymentMethod: 'pm_card' });

    expect(confirm).toHaveBeenCalledWith('pi_1', { payment_method: 'pm_card', off_session: true });
  });

  it('uses an explicit mandate without looking up the PaymentIntent', async () => {
    const retrieve = jest.fn();
    const confirm = jest.fn().mockResolvedValue({});
    const service = makeService({ retrieve, confirm });

    await service.confirmPaymentIntent('pi_1', { paymentMethod: 'pm_acss', mandate: 'mandate_2' });

    expect(retrieve).not.toHaveBeenCalled();
    expect(confirm).toHaveBeenCalledWith('pi_1', {
      payment_method: 'pm_acss',
      mandate: 'mandate_2',
      off_session: true,
    });
  });

  it('treats an already-charged PaymentIntent as success (retried job)', async () => {
    const retrieve = jest
      .fn()
      .mockResolvedValueOnce({ payment_method: 'pm_acss', metadata: {} })
      .mockResolvedValueOnce({ status: 'processing' });
    const confirm = jest.fn().mockRejectedValue({ code: 'payment_intent_unexpected_state' });
    const service = makeService({ retrieve, confirm });

    await expect(service.confirmPaymentIntent('pi_1')).resolves.toBeUndefined();
  });

  it('rethrows a decline', async () => {
    const retrieve = jest.fn().mockResolvedValue({ payment_method: 'pm_card', metadata: {} });
    const confirm = jest.fn().mockRejectedValue({ code: 'card_declined' });
    const service = makeService({ retrieve, confirm });

    await expect(service.confirmPaymentIntent('pi_1')).rejects.toEqual({ code: 'card_declined' });
  });
});

describe('StripeService.cancelPaymentIntent', () => {
  it('ignores a PaymentIntent that is already canceled', async () => {
    const cancel = jest.fn().mockRejectedValue({ code: 'payment_intent_unexpected_state' });
    const retrieve = jest.fn().mockResolvedValue({ status: 'canceled' });
    const service = makeService({ cancel, retrieve });

    await expect(service.cancelPaymentIntent('pi_1')).resolves.toBeUndefined();
  });

  it('refuses to cancel a PaymentIntent that succeeded', async () => {
    const cancel = jest.fn().mockRejectedValue({ code: 'payment_intent_unexpected_state' });
    const retrieve = jest.fn().mockResolvedValue({ status: 'succeeded' });
    const service = makeService({ cancel, retrieve });

    await expect(service.cancelPaymentIntent('pi_1')).rejects.toBeDefined();
  });
});

describe('StripeService.getPaymentIntentDetails', () => {
  it('maps a succeeded PaymentIntent to paid with charge, receipt and method', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      id: 'pi_1',
      status: 'succeeded',
      payment_method_types: ['acss_debit'],
      latest_charge: {
        id: 'ch_1',
        created: 1790000000,
        receipt_url: 'https://pay.stripe.com/receipts/ch_1',
        payment_method_details: { type: 'acss_debit' },
      },
    });
    const service = makeService({ retrieve });

    const details = await service.getPaymentIntentDetails('pi_1');

    expect(retrieve).toHaveBeenCalledWith('pi_1', { expand: ['latest_charge'] });
    expect(details).toMatchObject({
      status: 'paid',
      chargeId: 'ch_1',
      paymentIntentId: 'pi_1',
      receiptUrl: 'https://pay.stripe.com/receipts/ch_1',
      paymentMethodType: 'acss_debit',
      paidAt: new Date(1790000000 * 1000),
    });
  });

  it('maps a declined PaymentIntent to open with the decline reason', async () => {
    const retrieve = jest.fn().mockResolvedValue({
      id: 'pi_1',
      status: 'requires_payment_method',
      payment_method_types: ['card'],
      latest_charge: null,
      last_payment_error: {
        message: 'Your card was declined.',
        code: 'card_declined',
        type: 'card_error',
        payment_method: { type: 'card' },
      },
    });
    const service = makeService({ retrieve });

    const details = await service.getPaymentIntentDetails('pi_1');

    expect(details.status).toBe('open');
    expect(details.paidAt).toBeUndefined();
    expect(details.lastPaymentError?.message).toBe('Your card was declined.');
    expect(details.paymentMethodType).toBe('card');
  });

  it('maps a canceled PaymentIntent to void', async () => {
    const retrieve = jest
      .fn()
      .mockResolvedValue({ id: 'pi_1', status: 'canceled', payment_method_types: ['card'] });
    const service = makeService({ retrieve });

    expect((await service.getPaymentIntentDetails('pi_1')).status).toBe('void');
  });
});
