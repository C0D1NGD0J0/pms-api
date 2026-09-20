import { StripeService } from '@services/external/stripe/stripe.service';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';

describe('StripeService — requestId child logger', () => {
  let service: StripeService;
  let childLogSpy: jest.Mock;
  let childLogInstance: any;

  beforeEach(() => {
    service = new StripeService();

    childLogInstance = {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      child: jest.fn(),
    };
    childLogSpy = jest.fn().mockReturnValue(childLogInstance);
    (service as any).log.child = childLogSpy;
  });

  afterEach(() => jest.clearAllMocks());

  describe('createCustomer', () => {
    it('creates a child logger when requestId is provided', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        email: 'test@example.com',
        created: Math.floor(Date.now() / 1000),
      };
      (service as any).stripe = {
        customers: { create: jest.fn().mockResolvedValue(mockCustomer) },
      };

      await service.createCustomer(
        {
          email: 'test@example.com',
          name: 'Test User',
          metadata: {},
          provider: IPaymentGatewayProvider.STRIPE,
        },
        'req-stripe-001'
      );

      expect(childLogSpy).toHaveBeenCalledWith({ requestId: 'req-stripe-001' });
    });

    it('does NOT create a child logger when requestId is absent', async () => {
      const mockCustomer = {
        id: 'cus_test123',
        email: 'test@example.com',
        created: Math.floor(Date.now() / 1000),
      };
      (service as any).stripe = {
        customers: { create: jest.fn().mockResolvedValue(mockCustomer) },
      };

      await service.createCustomer({
        email: 'test@example.com',
        name: 'Test User',
        metadata: {},
        provider: IPaymentGatewayProvider.STRIPE,
      });

      expect(childLogSpy).not.toHaveBeenCalled();
    });

    it('uses child logger for error logging when requestId is provided', async () => {
      (service as any).stripe = {
        customers: { create: jest.fn().mockRejectedValue(new Error('Stripe error')) },
      };

      await expect(
        service.createCustomer(
          {
            email: 'fail@test.com',
            name: 'Fail',
            metadata: {},
            provider: IPaymentGatewayProvider.STRIPE,
          },
          'req-stripe-err'
        )
      ).rejects.toThrow('Stripe error');

      expect(childLogSpy).toHaveBeenCalledWith({ requestId: 'req-stripe-err' });
      expect(childLogInstance.error).toHaveBeenCalled();
    });
  });

  describe('createCheckoutSession', () => {
    it('creates a child logger when requestId is provided', async () => {
      const mockSession = { id: 'cs_test123', url: 'https://checkout.stripe.com/test' };

      // Mock withBreaker to pass through
      (service as any).withBreaker = jest.fn((fn: () => unknown) => fn());
      (service as any).stripe = {
        checkout: {
          sessions: { create: jest.fn().mockResolvedValue(mockSession) },
        },
      };

      await service.createCheckoutSession(
        {
          customerId: 'cus_123',
          priceId: 'price_123',
          successUrl: 'http://localhost/success',
          cancelUrl: 'http://localhost/cancel',
          metadata: {},
          provider: IPaymentGatewayProvider.STRIPE,
        },
        'req-checkout-001'
      );

      expect(childLogSpy).toHaveBeenCalledWith({ requestId: 'req-checkout-001' });
    });
  });
});
