import { StripeService } from '@services/external/stripe/stripe.service';

describe('StripeService.payInvoice', () => {
  const makeService = () => {
    const service = new StripeService();
    const stripe = {
      invoices: {
        update: jest.fn().mockResolvedValue({}),
        pay: jest.fn().mockResolvedValue({}),
      },
    };

    (service as any).stripe = stripe;

    return { service, stripe };
  };

  it('pays without pay-time params when no payment method is supplied', async () => {
    const { service, stripe } = makeService();

    await service.payInvoice('in_123', {});

    expect(stripe.invoices.pay).toHaveBeenCalledWith('in_123', {});
  });

  it('updates only the invoice payment method and pays without mandate', async () => {
    const { service, stripe } = makeService();

    await service.payInvoice('in_123', { paymentMethod: 'pm_123' });

    expect(stripe.invoices.update).toHaveBeenCalledWith('in_123', {
      default_payment_method: 'pm_123',
    });
    expect(stripe.invoices.pay).toHaveBeenCalledWith('in_123', {});
  });

  it('passes mandate to invoices.pay when provided', async () => {
    const { service, stripe } = makeService();

    await service.payInvoice('in_123', {
      paymentMethod: 'pm_123',
      mandate: 'mandate_abc',
    });

    expect(stripe.invoices.update).toHaveBeenCalledWith('in_123', {
      default_payment_method: 'pm_123',
    });
    expect(stripe.invoices.pay).toHaveBeenCalledWith('in_123', {
      mandate: 'mandate_abc',
    });
  });

  it('pays without params when no options are supplied', async () => {
    const { service, stripe } = makeService();

    await service.payInvoice('in_123');

    expect(stripe.invoices.update).not.toHaveBeenCalled();
    expect(stripe.invoices.pay).toHaveBeenCalledWith('in_123', {});
  });
});

describe('StripeService.createRefund', () => {
  const makeService = (charge: Record<string, any>) => {
    const service = new StripeService();
    const stripe = {
      charges: { retrieve: jest.fn().mockResolvedValue(charge) },
      refunds: {
        create: jest
          .fn()
          .mockResolvedValue({ id: 're_1', status: 'succeeded', amount: 1000, currency: 'cad' }),
      },
    };
    (service as any).stripe = stripe;
    return { service, stripe };
  };

  it('pulls the money back from the connected account on a destination charge', async () => {
    const { service, stripe } = makeService({ id: 'ch_1', transfer: 'tr_1' });

    await service.createRefund({
      chargeId: 'ch_1',
      amountInCents: 1000,
      reason: 'requested_by_customer',
      note: 'Move-out inspection — security deposit refund',
      idempotencyKey: 'deposit-refund:PYT1',
    });

    expect(stripe.refunds.create).toHaveBeenCalledWith(
      {
        charge: 'ch_1',
        amount: 1000,
        reason: 'requested_by_customer',
        metadata: { note: 'Move-out inspection — security deposit refund' },
        reverse_transfer: true,
      },
      { idempotencyKey: 'deposit-refund:PYT1' }
    );
  });

  it('does not ask to reverse a transfer when the charge has none (e.g. maintenance)', async () => {
    const { service, stripe } = makeService({ id: 'ch_2', transfer: null });

    await service.createRefund({ chargeId: 'ch_2' });

    expect(stripe.refunds.create.mock.calls[0][0]).not.toHaveProperty('reverse_transfer');
    expect(stripe.refunds.create.mock.calls[0][1]).toBeUndefined();
  });
});

describe('StripeService.getDisputeReversedAmount', () => {
  it('sums only the reversals tagged with the dispute', async () => {
    const service = new StripeService();
    (service as any).stripe = {
      transfers: {
        listReversals: jest.fn().mockResolvedValue({
          data: [
            { amount: 30000, metadata: { disputeId: 'dp_1' } },
            { amount: 5000, metadata: {} },
            { amount: 10000, metadata: { disputeId: 'dp_2' } },
          ],
        }),
      },
    };

    await expect(service.getDisputeReversedAmount('tr_1', 'dp_1')).resolves.toBe(30000);
  });
});

describe('StripeService.createSetupCheckoutSession', () => {
  it('copies metadata onto the SetupIntent and requests an invoice-capable ACSS mandate', async () => {
    const service = new StripeService();
    const stripe = {
      checkout: {
        sessions: {
          create: jest.fn().mockResolvedValue({ url: 'https://checkout.test/session' }),
        },
      },
    };
    (service as any).stripe = stripe;

    await service.createSetupCheckoutSession(
      'cus_123',
      'https://app.test/success',
      'https://app.test/cancel',
      'cad',
      ['acss_debit'],
      { tenantId: 'tenant_123', cuid: 'cuid_123' }
    );

    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { tenantId: 'tenant_123', cuid: 'cuid_123' },
        setup_intent_data: { metadata: { tenantId: 'tenant_123', cuid: 'cuid_123' } },
        payment_method_options: expect.objectContaining({
          acss_debit: expect.objectContaining({
            currency: 'cad',
            mandate_options: expect.objectContaining({
              default_for: ['invoice', 'subscription'],
              transaction_type: 'personal',
            }),
          }),
        }),
      })
    );
    // Stripe rejects a payment schedule alongside default_for (checked in test mode)
    const mandateOptions =
      stripe.checkout.sessions.create.mock.calls[0][0].payment_method_options.acss_debit
        .mandate_options;
    expect(mandateOptions).not.toHaveProperty('payment_schedule');
    expect(mandateOptions).not.toHaveProperty('interval_description');
  });
});

describe('StripeService.retrieveSetupIntent', () => {
  it('returns ids when Stripe expands mandate and payment_method objects', async () => {
    const service = new StripeService();
    const stripe = {
      setupIntents: {
        retrieve: jest.fn().mockResolvedValue({
          payment_method: { id: 'pm_123' },
          mandate: { id: 'mandate_123' },
        }),
      },
    };
    (service as any).stripe = stripe;

    await expect(service.retrieveSetupIntent('seti_123')).resolves.toEqual({
      paymentMethodId: 'pm_123',
      mandateId: 'mandate_123',
    });
    expect(stripe.setupIntents.retrieve).toHaveBeenCalledWith('seti_123', {
      expand: ['mandate', 'payment_method'],
    });
  });
});

describe('StripeService.getInvoicePaymentDetails', () => {
  const makeService = (stripe: Record<string, any>) => {
    const service = new StripeService();
    (service as any).stripe = stripe;
    return service;
  };

  const paymentIntent = {
    id: 'pi_123',
    payment_method_types: ['acss_debit', 'card'],
    last_payment_error: null,
    latest_charge: {
      id: 'ch_123',
      receipt_url: 'https://pay.stripe.com/receipts/ch_123',
      payment_method_details: { type: 'card' },
    },
  };

  it('reads charge and payment_intent from the acacia invoice shape without invalid expands', async () => {
    const stripe = {
      invoices: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'in_123',
          charge: 'ch_123',
          payment_intent: 'pi_123',
        }),
      },
      paymentIntents: { retrieve: jest.fn().mockResolvedValue(paymentIntent) },
    };
    const service = makeService(stripe);

    const details = await service.getInvoicePaymentDetails('in_123');

    expect(stripe.invoices.retrieve).toHaveBeenCalledTimes(1);
    expect(stripe.invoices.retrieve).toHaveBeenCalledWith('in_123');
    expect(stripe.paymentIntents.retrieve).toHaveBeenCalledWith('pi_123', {
      expand: ['latest_charge'],
    });
    expect(details).toEqual(
      expect.objectContaining({
        chargeId: 'ch_123',
        paymentIntentId: 'pi_123',
        receiptUrl: 'https://pay.stripe.com/receipts/ch_123',
        paymentMethodType: 'card',
      })
    );
  });

  it('falls back to the payments sub-object on basil+ invoice shapes', async () => {
    const stripe = {
      invoices: {
        retrieve: jest
          .fn()
          .mockResolvedValueOnce({ id: 'in_456', status: 'paid' })
          .mockResolvedValueOnce({
            id: 'in_456',
            payments: {
              data: [{ payment: { type: 'payment_intent', payment_intent: 'pi_123' } }],
            },
          }),
      },
      paymentIntents: { retrieve: jest.fn().mockResolvedValue(paymentIntent) },
    };
    const service = makeService(stripe);

    const details = await service.getInvoicePaymentDetails('in_456');

    expect(stripe.invoices.retrieve).toHaveBeenNthCalledWith(2, 'in_456', {
      expand: ['payments'],
    });
    expect(details.chargeId).toBe('ch_123');
    expect(details.paymentIntentId).toBe('pi_123');
  });

  it('returns the failed payment method type from last_payment_error', async () => {
    const stripe = {
      invoices: {
        retrieve: jest
          .fn()
          .mockResolvedValue({ id: 'in_789', charge: null, payment_intent: 'pi_9' }),
      },
      paymentIntents: {
        retrieve: jest.fn().mockResolvedValue({
          id: 'pi_9',
          payment_method_types: ['card', 'acss_debit'],
          latest_charge: null,
          last_payment_error: {
            message: 'Insufficient funds',
            code: 'insufficient_funds',
            type: 'card_error',
            payment_method: { type: 'acss_debit' },
          },
        }),
      },
    };
    const service = makeService(stripe);

    const details = await service.getInvoicePaymentDetails('in_789');

    expect(details.chargeId).toBeUndefined();
    expect(details.paymentMethodType).toBe('acss_debit');
    expect(details.lastPaymentError).toEqual(
      expect.objectContaining({ message: 'Insufficient funds', code: 'insufficient_funds' })
    );
  });

  it('returns the charge id without a PaymentIntent lookup when the invoice has no payment intent', async () => {
    const stripe = {
      invoices: {
        retrieve: jest.fn().mockResolvedValue({ id: 'in_1', charge: 'ch_9', payment_intent: null }),
      },
      paymentIntents: { retrieve: jest.fn() },
    };
    const service = makeService(stripe);

    await expect(service.getInvoicePaymentDetails('in_1')).resolves.toEqual({ chargeId: 'ch_9' });
    expect(stripe.paymentIntents.retrieve).not.toHaveBeenCalled();
  });

  it('returns an empty object when Stripe errors', async () => {
    const stripe = {
      invoices: { retrieve: jest.fn().mockRejectedValue(new Error('boom')) },
      paymentIntents: { retrieve: jest.fn() },
    };
    const service = makeService(stripe);

    await expect(service.getInvoicePaymentDetails('in_x')).resolves.toEqual({});
  });
});

describe('StripeService.getInvoiceIdForPaymentIntent', () => {
  it('returns the invoice id from the PaymentIntent (string or expanded)', async () => {
    const service = new StripeService();
    const retrieve = jest
      .fn()
      .mockResolvedValueOnce({ id: 'pi_1', invoice: 'in_1' })
      .mockResolvedValueOnce({ id: 'pi_2', invoice: { id: 'in_2' } })
      .mockResolvedValueOnce({ id: 'pi_3', invoice: null });
    (service as any).stripe = { paymentIntents: { retrieve } };

    await expect(service.getInvoiceIdForPaymentIntent('pi_1')).resolves.toBe('in_1');
    await expect(service.getInvoiceIdForPaymentIntent('pi_2')).resolves.toBe('in_2');
    await expect(service.getInvoiceIdForPaymentIntent('pi_3')).resolves.toBeNull();
  });

  it('returns null when Stripe errors', async () => {
    const service = new StripeService();
    (service as any).stripe = {
      paymentIntents: { retrieve: jest.fn().mockRejectedValue(new Error('nope')) },
    };

    await expect(service.getInvoiceIdForPaymentIntent('pi_x')).resolves.toBeNull();
  });
});

describe('StripeService.createConnectAccount service agreement', () => {
  const makeService = () => {
    const service = new StripeService();
    const stripe = {
      accounts: {
        create: jest.fn().mockResolvedValue({
          id: 'acct_1',
          email: 'pm@example.com',
          country: 'US',
          default_currency: 'usd',
          charges_enabled: false,
          payouts_enabled: false,
          details_submitted: false,
        }),
      },
    };
    (service as any).stripe = stripe;
    return { service, stripe };
  };

  const input = { email: 'pm@example.com', country: 'US', businessType: 'individual' as const };

  it('creates the account under full terms when asked (instant payouts)', async () => {
    const { service, stripe } = makeService();

    await service.createConnectAccount({ ...input, cuid: 'C1', serviceAgreement: 'full' });

    expect(stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ tos_acceptance: { service_agreement: 'full' } })
    );
  });

  it('defaults to recipient terms', async () => {
    const { service, stripe } = makeService();

    await service.createConnectAccount({ ...input, cuid: 'C1' });

    expect(stripe.accounts.create).toHaveBeenCalledWith(
      expect.objectContaining({ tos_acceptance: { service_agreement: 'recipient' } })
    );
  });
});

describe('StripeService instant payouts', () => {
  const makeService = () => {
    const service = new StripeService();
    const stripe = {
      payouts: {
        create: jest.fn().mockResolvedValue({
          id: 'po_1',
          amount: 97500,
          currency: 'usd',
          application_fee_amount: 2500,
          arrival_date: 1760000000,
        }),
      },
      applicationFees: { createRefund: jest.fn().mockResolvedValue({}) },
    };
    (service as any).stripe = stripe;
    return { service, stripe };
  };

  it('creates an instant payout on the connected account with the idempotency key', async () => {
    const { service, stripe } = makeService();

    const result = await service.createInstantPayout('acct_1', {
      amount: 97500,
      currency: 'usd',
      destination: 'card_1',
      idempotencyKey: 'instant-payout:acct_1:k1',
    });

    expect(stripe.payouts.create).toHaveBeenCalledWith(
      { amount: 97500, currency: 'usd', method: 'instant', destination: 'card_1' },
      { stripeAccount: 'acct_1', idempotencyKey: 'instant-payout:acct_1:k1' }
    );
    expect(result).toEqual({
      payoutId: 'po_1',
      amount: 97500,
      currency: 'usd',
      applicationFeeAmount: 2500,
      arrivalDate: new Date(1760000000 * 1000),
    });
  });

  it('refunds an application fee in full from the platform account', async () => {
    const { service, stripe } = makeService();

    await service.refundApplicationFee('fee_1', 'refund-key');

    expect(stripe.applicationFees.createRefund).toHaveBeenCalledWith(
      'fee_1',
      {},
      { idempotencyKey: 'refund-key' }
    );
  });
});

describe('StripeService.getConnectBalance', () => {
  it('expands net_available so instant payouts can be priced', async () => {
    const service = new StripeService();
    const stripe = { balance: { retrieve: jest.fn().mockResolvedValue({}) } };
    (service as any).stripe = stripe;

    await service.getConnectBalance('acct_1');

    expect(stripe.balance.retrieve).toHaveBeenCalledWith(
      { expand: ['instant_available.net_available'] },
      { stripeAccount: 'acct_1' }
    );
  });
});
