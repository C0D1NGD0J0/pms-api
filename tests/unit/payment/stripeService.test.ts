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
      })
    );
    expect(stripe.invoices.create.mock.calls[0][0]).not.toHaveProperty('payment_settings');
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
