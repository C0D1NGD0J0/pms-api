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

describe('PaymentGatewayService - getInvoice', () => {
  it('maps status, hosted url and paid_at from the provider invoice', async () => {
    const stripeService = {
      getInvoice: jest.fn().mockResolvedValue({
        status: 'paid',
        hosted_invoice_url: 'https://invoice.stripe.com/i/1',
        status_transitions: { paid_at: 1_700_000_000 },
      }),
    };
    const gateway = makeGateway(stripeService);

    const result = await gateway.getInvoice(IPaymentGatewayProvider.STRIPE, 'in_1');

    expect(stripeService.getInvoice).toHaveBeenCalledWith('in_1');
    expect(result).toEqual({
      success: true,
      data: {
        status: 'paid',
        hostedInvoiceUrl: 'https://invoice.stripe.com/i/1',
        paidAt: new Date(1_700_000_000 * 1000),
      },
    });
  });

  it('leaves optional fields undefined for an unpaid invoice', async () => {
    const gateway = makeGateway({
      getInvoice: jest.fn().mockResolvedValue({ status: 'open', status_transitions: {} }),
    });

    const result = await gateway.getInvoice(IPaymentGatewayProvider.STRIPE, 'in_2');

    expect(result.data).toEqual({ status: 'open', hostedInvoiceUrl: undefined, paidAt: undefined });
  });

  it('returns success:false when the provider throws', async () => {
    const gateway = makeGateway({
      getInvoice: jest.fn().mockRejectedValue(new Error('No such invoice')),
    });

    const result = await gateway.getInvoice(IPaymentGatewayProvider.STRIPE, 'in_missing');

    expect(result).toEqual({ success: false, data: null, message: 'No such invoice' });
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
