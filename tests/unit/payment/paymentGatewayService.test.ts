import { PaymentGatewayService } from '@services/paymentGateway';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';

const makeGateway = (stripeService: Record<string, jest.Mock>) =>
  new PaymentGatewayService({ stripeService: stripeService as any });

describe('PaymentGatewayService - getInvoiceIdForPaymentIntent', () => {
  it('returns the invoice id resolved by the provider', async () => {
    const stripeService = { getInvoiceIdForPaymentIntent: jest.fn().mockResolvedValue('in_1') };
    const gateway = makeGateway(stripeService);

    const result = await gateway.getInvoiceIdForPaymentIntent(
      IPaymentGatewayProvider.STRIPE,
      'pi_1'
    );

    expect(stripeService.getInvoiceIdForPaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(result).toEqual({ success: true, data: 'in_1' });
  });

  it('returns success with null when the PaymentIntent has no invoice', async () => {
    const gateway = makeGateway({
      getInvoiceIdForPaymentIntent: jest.fn().mockResolvedValue(null),
    });

    const result = await gateway.getInvoiceIdForPaymentIntent(
      IPaymentGatewayProvider.STRIPE,
      'pi_2'
    );

    expect(result).toEqual({ success: true, data: null });
  });

  it('returns success:false when the provider throws', async () => {
    const gateway = makeGateway({
      getInvoiceIdForPaymentIntent: jest.fn().mockRejectedValue(new Error('stripe down')),
    });

    const result = await gateway.getInvoiceIdForPaymentIntent(
      IPaymentGatewayProvider.STRIPE,
      'pi_3'
    );

    expect(result).toEqual({ success: false, data: null, message: 'stripe down' });
  });

  it('returns success:false when the provider does not implement the method', async () => {
    const gateway = makeGateway({});

    const result = await gateway.getInvoiceIdForPaymentIntent(
      IPaymentGatewayProvider.STRIPE,
      'pi_4'
    );

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
  });
});

describe('PaymentGatewayService - getInvoicePaymentDetails', () => {
  it('passes the provider details through, including receiptUrl', async () => {
    const details = {
      chargeId: 'ch_1',
      paymentIntentId: 'pi_1',
      receiptUrl: 'https://pay.stripe.com/receipts/ch_1',
      paymentMethodType: 'acss_debit',
    };
    const gateway = makeGateway({
      getInvoicePaymentDetails: jest.fn().mockResolvedValue(details),
    });

    const result = await gateway.getInvoicePaymentDetails(IPaymentGatewayProvider.STRIPE, 'in_1');

    expect(result).toEqual({ success: true, data: details });
  });

  it('returns success:false when the provider throws', async () => {
    const gateway = makeGateway({
      getInvoicePaymentDetails: jest.fn().mockRejectedValue(new Error('boom')),
    });

    const result = await gateway.getInvoicePaymentDetails(IPaymentGatewayProvider.STRIPE, 'in_x');

    expect(result).toEqual({ success: false, data: undefined, message: 'boom' });
  });
});

describe('PaymentGatewayService - tenant charges', () => {
  const STRIPE = IPaymentGatewayProvider.STRIPE;

  it('creates tenant charges as PaymentIntents', async () => {
    const createPaymentIntent = jest
      .fn()
      .mockResolvedValue({ chargeId: 'pi_1', amount: 100, status: 'requires_confirmation' });
    const gateway = makeGateway({ createPaymentIntent });

    const result = await gateway.createCharge(STRIPE, { cuid: 'C1' } as any);

    expect(result).toEqual({
      success: true,
      data: { chargeId: 'pi_1', amount: 100, status: 'requires_confirmation' },
    });
  });

  it('confirms PaymentIntents and still pays legacy invoices', async () => {
    const confirmPaymentIntent = jest.fn().mockResolvedValue(undefined);
    const payInvoice = jest.fn().mockResolvedValue(undefined);
    const gateway = makeGateway({ confirmPaymentIntent, payInvoice });
    const opts = { paymentMethod: 'pm_1', mandate: 'mandate_1' };

    await gateway.payCharge(STRIPE, 'pi_1', opts);
    await gateway.payCharge(STRIPE, 'in_1', opts);

    expect(confirmPaymentIntent).toHaveBeenCalledWith('pi_1', opts);
    expect(payInvoice).toHaveBeenCalledWith('in_1', opts);
  });

  it('cancels PaymentIntents and voids legacy invoices', async () => {
    const cancelPaymentIntent = jest.fn().mockResolvedValue(undefined);
    const voidInvoice = jest.fn().mockResolvedValue(undefined);
    const gateway = makeGateway({ cancelPaymentIntent, voidInvoice });

    await gateway.cancelCharge(STRIPE, 'pi_1');
    await gateway.cancelCharge(STRIPE, 'in_1');

    expect(cancelPaymentIntent).toHaveBeenCalledWith('pi_1');
    expect(voidInvoice).toHaveBeenCalledWith('in_1');
  });

  it('returns a failure instead of throwing when a charge cannot be paid', async () => {
    const confirmPaymentIntent = jest.fn().mockRejectedValue(new Error('card_declined'));
    const gateway = makeGateway({ confirmPaymentIntent });

    expect(await gateway.payCharge(STRIPE, 'pi_1')).toEqual({
      success: false,
      data: null,
      message: 'card_declined',
    });
  });

  it('reads PaymentIntent details directly', async () => {
    const details = { status: 'paid', chargeId: 'ch_1', receiptUrl: 'https://r' };
    const getPaymentIntentDetails = jest.fn().mockResolvedValue(details);
    const gateway = makeGateway({ getPaymentIntentDetails });

    expect(await gateway.getChargeDetails(STRIPE, 'pi_1')).toEqual({
      success: true,
      data: details,
    });
  });

  it('combines invoice status and payment details for legacy invoices', async () => {
    const getInvoice = jest.fn().mockResolvedValue({
      status: 'paid',
      hosted_invoice_url: 'https://invoice',
      status_transitions: { paid_at: 1790000000 },
    });
    const getInvoicePaymentDetails = jest.fn().mockResolvedValue({
      chargeId: 'ch_1',
      paymentMethodType: 'acss_debit',
      receiptUrl: 'https://r',
    });
    const gateway = makeGateway({ getInvoice, getInvoicePaymentDetails });

    const result = await gateway.getChargeDetails(STRIPE, 'in_1');

    expect(result.data).toEqual({
      status: 'paid',
      chargeId: 'ch_1',
      paymentMethodType: 'acss_debit',
      receiptUrl: 'https://invoice',
      paidAt: new Date(1790000000 * 1000),
    });
  });
});

describe('PaymentGatewayService - instant payouts', () => {
  const payoutInput = {
    amount: 97500,
    currency: 'usd',
    destination: 'card_1',
    idempotencyKey: 'instant-payout:acct_1:k1',
  };

  it('creates the instant payout through the provider', async () => {
    const stripeService = { createInstantPayout: jest.fn().mockResolvedValue({ id: 'po_1' }) };
    const gateway = makeGateway(stripeService);

    const result = await gateway.createInstantPayout(
      IPaymentGatewayProvider.STRIPE,
      'acct_1',
      payoutInput
    );

    expect(stripeService.createInstantPayout).toHaveBeenCalledWith('acct_1', payoutInput);
    expect(result).toEqual({ success: true, data: { id: 'po_1' } });
  });

  it('returns the Stripe error message instead of throwing', async () => {
    const gateway = makeGateway({
      createInstantPayout: jest
        .fn()
        .mockRejectedValue(new Error('Debit card does not support instant payouts')),
    });

    const result = await gateway.createInstantPayout(
      IPaymentGatewayProvider.STRIPE,
      'acct_1',
      payoutInput
    );

    expect(result).toEqual({
      success: false,
      data: null,
      message: 'Debit card does not support instant payouts',
    });
  });

  it('refunds an application fee through the provider', async () => {
    const stripeService = { refundApplicationFee: jest.fn().mockResolvedValue(undefined) };
    const gateway = makeGateway(stripeService);

    const result = await gateway.refundApplicationFee(
      IPaymentGatewayProvider.STRIPE,
      'fee_1',
      'refund-key'
    );

    expect(stripeService.refundApplicationFee).toHaveBeenCalledWith('fee_1', 'refund-key');
    expect(result).toEqual({ success: true, data: null });
  });

  it('reports a failed fee refund without throwing', async () => {
    const gateway = makeGateway({
      refundApplicationFee: jest.fn().mockRejectedValue(new Error('already refunded')),
    });

    const result = await gateway.refundApplicationFee(
      IPaymentGatewayProvider.STRIPE,
      'fee_1',
      'refund-key'
    );

    expect(result).toEqual({ success: false, data: null, message: 'already refunded' });
  });
});
