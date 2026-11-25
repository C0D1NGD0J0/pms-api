import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';

const makeGateway = ({
  processor = null as Record<string, unknown> | null,
  defaultCurrency = 'CAD',
  paystackEnabled = false,
} = {}) => {
  const paymentProcessorDAO = { findFirst: jest.fn().mockResolvedValue(processor) };
  const clientDAO = {
    getClientByCuid: jest.fn().mockResolvedValue({ settings: { defaultCurrency } }),
  };
  const featureFlagService = { isEnabled: jest.fn().mockReturnValue(paystackEnabled) };
  const paystackService = {
    listBanks: jest.fn().mockResolvedValue([{ code: '058', name: 'GTBank' }]),
  };
  const gateway = new PaymentGatewayService({
    stripeService: {} as any,
    paymentProcessorDAO: paymentProcessorDAO as any,
    clientDAO: clientDAO as any,
    featureFlagService: featureFlagService as any,
    paystackService: paystackService as any,
  });
  return { gateway, paymentProcessorDAO, paystackService };
};

describe('PaymentGatewayService - getProviderForClient', () => {
  it("uses the provider on the landlord's payout account", async () => {
    const { gateway, paymentProcessorDAO } = makeGateway({
      processor: { provider: 'paystack' },
      defaultCurrency: 'CAD',
    });

    await expect(gateway.getProviderForClient('C1')).resolves.toBe(
      IPaymentGatewayProvider.PAYSTACK
    );
    // Vendor payout accounts share the cuid and must not decide the landlord's provider
    expect(paymentProcessorDAO.findFirst).toHaveBeenCalledWith({
      cuid: 'C1',
      ownerType: { $ne: 'vendor' },
      deletedAt: null,
    });
  });

  it('keeps an existing Stripe account on Stripe, even for a naira account', async () => {
    const { gateway } = makeGateway({
      processor: { provider: 'stripe' },
      defaultCurrency: 'NGN',
      paystackEnabled: true,
    });

    await expect(gateway.getProviderForClient('C1')).resolves.toBe(IPaymentGatewayProvider.STRIPE);
  });

  it('treats an older payout account with no provider as Stripe', async () => {
    const { gateway } = makeGateway({ processor: { accountId: 'acct_1' } });

    await expect(gateway.getProviderForClient('C1')).resolves.toBe(IPaymentGatewayProvider.STRIPE);
  });

  it('sends a naira account with no payout account yet to Paystack while the switch is on', async () => {
    const { gateway } = makeGateway({ defaultCurrency: 'NGN', paystackEnabled: true });

    await expect(gateway.getProviderForClient('C1')).resolves.toBe(
      IPaymentGatewayProvider.PAYSTACK
    );
  });

  it('keeps a naira account on Stripe while the switch is off', async () => {
    const { gateway } = makeGateway({ defaultCurrency: 'NGN', paystackEnabled: false });

    await expect(gateway.getProviderForClient('C1')).resolves.toBe(IPaymentGatewayProvider.STRIPE);
  });

  it('keeps other currencies on Stripe', async () => {
    const { gateway } = makeGateway({ defaultCurrency: 'CAD', paystackEnabled: true });

    await expect(gateway.getProviderForClient('C1')).resolves.toBe(IPaymentGatewayProvider.STRIPE);
  });
});

describe('PaymentGatewayService - providerForPayment', () => {
  const { gateway } = makeGateway();

  it('reads Paystack from the psk_ reference', () => {
    expect(gateway.providerForPayment({ gatewayPaymentId: 'psk_PY123_1' })).toBe(
      IPaymentGatewayProvider.PAYSTACK
    );
  });

  it('treats Stripe ids and payments without a reference as Stripe', () => {
    expect(gateway.providerForPayment({ gatewayPaymentId: 'pi_123' })).toBe(
      IPaymentGatewayProvider.STRIPE
    );
    expect(gateway.providerForPayment({ gatewayPaymentId: 'in_123' })).toBe(
      IPaymentGatewayProvider.STRIPE
    );
    expect(gateway.providerForPayment({})).toBe(IPaymentGatewayProvider.STRIPE);
  });
});

describe('PaymentGatewayService - Paystack calls', () => {
  it('passes Paystack-only calls through to the Paystack service', async () => {
    const { gateway, paystackService } = makeGateway();

    await expect(gateway.listBanks()).resolves.toEqual([{ code: '058', name: 'GTBank' }]);
    expect(paystackService.listBanks).toHaveBeenCalled();
  });

  it('refuses a Stripe-shaped call made with the Paystack provider', async () => {
    const { gateway } = makeGateway();

    const result = await gateway.getInvoiceIdForPaymentIntent(
      IPaymentGatewayProvider.PAYSTACK,
      'psk_PY1_1'
    );

    expect(result.success).toBe(false);
  });

  it('fails clearly when Paystack is not wired in', () => {
    const gateway = new PaymentGatewayService({ stripeService: {} as any });

    expect(() => gateway.listBanks()).toThrow("Payment provider 'paystack' not registered");
  });
});
