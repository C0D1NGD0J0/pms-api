import { StripeService } from '@services/external/stripe/stripe.service';

describe('StripeService.expireCheckoutSession', () => {
  const makeService = (status: string) => {
    const service = new StripeService();
    const stripe = {
      checkout: {
        sessions: {
          retrieve: jest.fn().mockResolvedValue({ id: 'cs_1', status }),
          expire: jest.fn().mockResolvedValue({ id: 'cs_1', status: 'expired' }),
        },
      },
    };
    (service as any).stripe = stripe;
    return { service, stripe };
  };

  it('expires an open session', async () => {
    const { service, stripe } = makeService('open');

    await expect(service.expireCheckoutSession('cs_1')).resolves.toEqual({ status: 'expired' });
    expect(stripe.checkout.sessions.expire).toHaveBeenCalledWith('cs_1');
  });

  it.each(['complete', 'expired'])(
    'leaves a %s session alone and reports its status',
    async (status) => {
      const { service, stripe } = makeService(status);

      await expect(service.expireCheckoutSession('cs_1')).resolves.toEqual({ status });
      expect(stripe.checkout.sessions.expire).not.toHaveBeenCalled();
    }
  );
});
