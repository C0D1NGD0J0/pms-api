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

describe('StripeService.createInvoice', () => {
  it('sets default payment method without forcing a mandate on the invoice', async () => {
    const service = new StripeService();
    const stripe = {
      invoices: {
        create: jest.fn().mockResolvedValue({
          id: 'in_123',
          amount_due: 2500,
          status: 'draft',
        }),
      },
      invoiceItems: {
        create: jest.fn().mockResolvedValue({ id: 'ii_123' }),
      },
    };
    (service as any).stripe = stripe;

    await service.createInvoice({
      tenantCustomerId: 'cus_123',
      connectedAccountId: 'acct_123',
      applicationFeeAmountInCents: 100,
      currency: 'cad',
      description: 'Rent',
      lineItems: [{ description: 'Monthly Rent', amountInCents: 2500 }],
      autoChargeDueDate: new Date(),
      cuid: 'cuid_123',
      paymentMethodId: 'pm_123',
    });

    expect(stripe.invoices.create).toHaveBeenCalledWith(
      expect.objectContaining({
        default_payment_method: 'pm_123',
      }),
      undefined
    );
    expect(stripe.invoices.create.mock.calls[0][0]).not.toHaveProperty('payment_settings');
  });

  it('derives a separate idempotency key for the invoice and each line item', async () => {
    const service = new StripeService();
    const stripe = {
      invoices: { create: jest.fn().mockResolvedValue({ id: 'in_123', status: 'draft' }) },
      invoiceItems: { create: jest.fn().mockResolvedValue({ id: 'ii_123' }) },
    };
    (service as any).stripe = stripe;

    await service.createInvoice({
      tenantCustomerId: 'cus_123',
      connectedAccountId: 'acct_123',
      applicationFeeAmountInCents: 100,
      currency: 'cad',
      description: 'Rent',
      lineItems: [
        { description: 'Monthly Rent', amountInCents: 2500 },
        { description: 'Pet Fee', amountInCents: 500 },
      ],
      autoChargeDueDate: new Date(),
      cuid: 'cuid_123',
      idempotencyKey: 'rent-invoice-job:42:full',
    });

    expect(stripe.invoices.create.mock.calls[0][1]).toEqual({
      idempotencyKey: 'rent-invoice-job:42:full:create',
    });
    expect(stripe.invoiceItems.create.mock.calls.map((call: any[]) => call[1])).toEqual([
      { idempotencyKey: 'rent-invoice-job:42:full:item:0' },
      { idempotencyKey: 'rent-invoice-job:42:full:item:1' },
    ]);
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
