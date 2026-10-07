import { IPaymentGatewayProvider } from '@interfaces/index';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('SubscriptionService — card details on sync', () => {
  const retrievePaymentMethod = jest.fn();
  const service = new SubscriptionService({
    paymentGatewayService: { retrievePaymentMethod },
  } as any);
  const cardUpdate = (stripeSub: unknown) => (service as any).getCardDetailsUpdate(stripeSub);

  beforeEach(() => retrievePaymentMethod.mockReset());

  it("saves the brand and last4 from the subscription's default payment method", async () => {
    retrievePaymentMethod.mockResolvedValue({
      success: true,
      data: { type: 'card', bankName: 'visa', last4: '4242' },
    });

    await expect(cardUpdate({ default_payment_method: 'pm_123' })).resolves.toEqual({
      'billing.cardLast4': '4242',
      'billing.cardBrand': 'visa',
    });
    expect(retrievePaymentMethod).toHaveBeenCalledWith(IPaymentGatewayProvider.STRIPE, 'pm_123');
  });

  it('accepts an expanded payment method object', async () => {
    retrievePaymentMethod.mockResolvedValue({
      success: true,
      data: { type: 'card', bankName: 'mastercard', last4: '4444' },
    });

    await cardUpdate({ default_payment_method: { id: 'pm_456' } });

    expect(retrievePaymentMethod).toHaveBeenCalledWith(IPaymentGatewayProvider.STRIPE, 'pm_456');
  });

  it('leaves the stored card alone when Stripe has none or the lookup fails', async () => {
    await expect(cardUpdate({})).resolves.toEqual({});
    expect(retrievePaymentMethod).not.toHaveBeenCalled();

    retrievePaymentMethod.mockResolvedValue({ success: false, data: null });
    await expect(cardUpdate({ default_payment_method: 'pm_789' })).resolves.toEqual({});
  });
});
