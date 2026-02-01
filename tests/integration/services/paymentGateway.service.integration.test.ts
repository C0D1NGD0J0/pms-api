import { StripeService } from '@services/external';
import { PaymentGatewayService } from '@services/paymentGateway';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';

describe('PaymentGatewayService Integration Tests', () => {
  let paymentGatewayService: PaymentGatewayService;
  let mockStripeService: jest.Mocked<StripeService>;

  // Mock external Stripe API (not our code - external service)

  beforeEach(() => {
    // Create mock StripeService
    mockStripeService = {
      createCustomer: jest.fn(),
      createCheckoutSession: jest.fn(),
      verifyWebhookSignature: jest.fn(),
    } as any;

    // Initialize service with mocked Stripe
    paymentGatewayService = new PaymentGatewayService({
      stripeService: mockStripeService,
    });
  });

  describe('createCustomer', () => {
    it('should create customer via Stripe provider', async () => {
      const mockCustomer = {
        customerId: 'cus_123',
        email: 'test@example.com',
        provider: IPaymentGatewayProvider.STRIPE,
        metadata: { clientId: 'client_123' },
        createdAt: new Date(),
      };

      mockStripeService.createCustomer.mockResolvedValue(mockCustomer);

      const result = await paymentGatewayService.createCustomer({
        provider: IPaymentGatewayProvider.STRIPE,
        email: 'test@example.com',
        metadata: { clientId: 'client_123' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCustomer);
      expect(mockStripeService.createCustomer).toHaveBeenCalledWith({
        email: 'test@example.com',
        metadata: { clientId: 'client_123' },
      });
    });

    it('should return error when customer creation fails', async () => {
      mockStripeService.createCustomer.mockRejectedValue(new Error('Stripe API error'));

      const result = await paymentGatewayService.createCustomer({
        provider: IPaymentGatewayProvider.STRIPE,
        email: 'test@example.com',
        metadata: {},
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Stripe API error');
    });

    it('should throw error for unsupported provider', async () => {
      const result = await paymentGatewayService.createCustomer({
        provider: 'unsupported' as any,
        email: 'test@example.com',
        metadata: {},
      });

      expect(result.success).toBe(false);
      expect(result.message).toContain('not registered');
    });
  });

  describe('createCheckoutSession', () => {
    it('should create checkout session via Stripe provider', async () => {
      const mockSession = {
        sessionId: 'cs_test_123',
        redirectUrl: 'https://checkout.stripe.com/pay/cs_test_123',
        customerId: 'cus_123',
        provider: IPaymentGatewayProvider.STRIPE,
        metadata: { subscriptionId: 'sub_123' },
      };

      mockStripeService.createCheckoutSession.mockResolvedValue(mockSession);

      const result = await paymentGatewayService.createCheckoutSession({
        provider: IPaymentGatewayProvider.STRIPE,
        customerId: 'cus_123',
        priceId: 'price_123',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        metadata: { subscriptionId: 'sub_123' },
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSession);
      expect(mockStripeService.createCheckoutSession).toHaveBeenCalledWith({
        customerId: 'cus_123',
        priceId: 'price_123',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        metadata: { subscriptionId: 'sub_123' },
      });
    });

    it('should return error when checkout session creation fails', async () => {
      mockStripeService.createCheckoutSession.mockRejectedValue(new Error('Invalid price ID'));

      const result = await paymentGatewayService.createCheckoutSession({
        provider: IPaymentGatewayProvider.STRIPE,
        customerId: 'cus_123',
        priceId: 'invalid_price',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        metadata: {},
      });

      expect(result.success).toBe(false);
      expect(result.message).toBe('Invalid price ID');
    });
  });

  describe('verifyWebhook', () => {
    it('should verify webhook signature via Stripe provider', async () => {
      const mockEvent = {
        id: 'evt_123',
        type: 'checkout.session.completed',
        data: { object: { id: 'cs_123' } },
      };

      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);

      const payload = JSON.stringify(mockEvent);
      const signature = 'whsec_test_signature';

      const result = await paymentGatewayService.verifyWebhook(
        IPaymentGatewayProvider.STRIPE,
        payload,
        signature
      );

      expect(result).toEqual(mockEvent);
      expect(mockStripeService.verifyWebhookSignature).toHaveBeenCalledWith(payload, signature);
    });

    it('should throw error when webhook verification fails', async () => {
      mockStripeService.verifyWebhookSignature.mockRejectedValue(new Error('Invalid signature'));

      await expect(
        paymentGatewayService.verifyWebhook(
          IPaymentGatewayProvider.STRIPE,
          'invalid_payload',
          'invalid_signature'
        )
      ).rejects.toThrow('Invalid signature');
    });
  });

  describe('cancelSubscription', () => {
    it('should return error when provider does not implement cancelSubscription', async () => {
      const result = await paymentGatewayService.cancelSubscription(
        IPaymentGatewayProvider.STRIPE,
        'sub_123'
      );

      expect(result.success).toBe(false);
      expect(result.message).toContain('does not implement cancelSubscription');
    });

    it('should call provider cancelSubscription if implemented', async () => {
      // Add cancelSubscription to mock
      mockStripeService.cancelSubscription = jest.fn().mockResolvedValue(undefined);

      // Recreate service with updated mock
      paymentGatewayService = new PaymentGatewayService({
        stripeService: mockStripeService,
      });

      const result = await paymentGatewayService.cancelSubscription(
        IPaymentGatewayProvider.STRIPE,
        'sub_123'
      );

      expect(result.success).toBe(true);
      expect(mockStripeService.cancelSubscription).toHaveBeenCalledWith('sub_123');
    });
  });

  describe('Provider Registration', () => {
    it('should initialize with provided StripeService', () => {
      const mockStripe = {
        createCustomer: jest.fn(),
        createCheckoutSession: jest.fn(),
        verifyWebhookSignature: jest.fn(),
      } as any;

      const service = new PaymentGatewayService({
        stripeService: mockStripe,
      });
      expect(service).toBeInstanceOf(PaymentGatewayService);
    });

    it('should use injected StripeService via DI', () => {
      const customMockStripe = {
        createCustomer: jest.fn(),
        createCheckoutSession: jest.fn(),
        verifyWebhookSignature: jest.fn(),
      } as any;

      const service = new PaymentGatewayService({
        stripeService: customMockStripe,
      });

      expect(service).toBeInstanceOf(PaymentGatewayService);
    });
  });
});
