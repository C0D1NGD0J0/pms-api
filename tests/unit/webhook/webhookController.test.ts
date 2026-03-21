import { Response, Request } from 'express';
import { LeaseService } from '@services/lease/lease.service';
import { IdempotencyCache } from '@caching/idempotency.cache';
import { WebhookController } from '@controllers/WebhookController';
import { StripeService } from '@services/external/stripe/stripe.service';
import { BoldSignService } from '@services/external/esignature/boldSign.service';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('WebhookController - Stripe Webhooks', () => {
  let webhookController: WebhookController;
  let mockStripeService: jest.Mocked<StripeService>;
  let mockSubscriptionService: jest.Mocked<SubscriptionService>;
  let mockLeaseService: jest.Mocked<LeaseService>;
  let mockBoldSignService: jest.Mocked<BoldSignService>;
  let mockIdempotencyCache: jest.Mocked<IdempotencyCache>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockStripeService = {
      verifyWebhookSignature: jest.fn(),
    } as any;

    mockSubscriptionService = {
      handleSubscriptionCreated: jest.fn(),
      handleInvoicePaid: jest.fn(),
      handleInvoicePaymentFailed: jest.fn(),
      handleSubscriptionUpdated: jest.fn(),
      handleSubscriptionCanceled: jest.fn(),
    } as any;

    mockLeaseService = {} as any;
    mockBoldSignService = {} as any;

    mockIdempotencyCache = {
      claimWebhookEvent: jest.fn(),
      markWebhookProcessed: jest.fn(),
      releaseWebhookClaim: jest.fn(),
    } as any;

    // Default: every event is a new (unclaimed) event — claim succeeds
    mockIdempotencyCache.claimWebhookEvent.mockResolvedValue(true);
    mockIdempotencyCache.markWebhookProcessed.mockResolvedValue(undefined);
    mockIdempotencyCache.releaseWebhookClaim.mockResolvedValue(undefined);

    webhookController = new WebhookController({
      stripeService: mockStripeService,
      subscriptionService: mockSubscriptionService,
      leaseService: mockLeaseService,
      boldSignService: mockBoldSignService,
      paymentService: {} as any,
      clientService: {} as any,
      idempotencyCache: mockIdempotencyCache,
    });

    mockRequest = {
      body: {},
      headers: {},
    };

    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
  });

  describe('handleStripeWebhook', () => {
    it('should return 400 if signature is missing', async () => {
      mockRequest.headers = {};

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Missing signature',
      });
    });

    it('should handle customer.subscription.created event', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'customer.subscription.created',
        data: {
          object: {
            id: 'sub_test123',
            customer: 'cus_test123',
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handleSubscriptionCreated.mockResolvedValue(undefined);

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSubscriptionService.handleSubscriptionCreated).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });

    it('should handle customer.subscription.updated event with full params', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test123',
            customer: 'cus_test123',
            status: 'active',
            current_period_start: 1700000000,
            current_period_end: 1702592000,
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handleSubscriptionUpdated.mockResolvedValue({
        success: true,
        data: {} as any,
      });

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSubscriptionService.handleSubscriptionUpdated).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_test123',
        stripeCustomerId: 'cus_test123',
        status: 'active',
        currentPeriodStart: 1700000000,
        currentPeriodEnd: 1702592000,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should handle customer.subscription.deleted event', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test123',
            canceled_at: 1700000000,
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handleSubscriptionCanceled.mockResolvedValue({
        success: true,
        data: {} as any,
      });

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSubscriptionService.handleSubscriptionCanceled).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_test123',
        canceledAt: 1700000000,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should handle invoice.paid event by delegating raw invoice to service', async () => {
      const mockInvoice = {
        id: 'in_test123',
        customer: 'cus_test123',
        subscription: 'sub_test123',
        billing_reason: 'subscription_create',
        latest_charge: 'ch_test123',
      };
      const mockEvent = {
        id: 'evt_test123',
        type: 'invoice.paid',
        data: { object: mockInvoice },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handleInvoicePaid.mockResolvedValue(undefined);

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSubscriptionService.handleInvoicePaid).toHaveBeenCalledWith(mockInvoice);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });

    it('should handle invoice.payment_failed event by delegating raw invoice to service', async () => {
      const mockInvoice = {
        id: 'in_test123',
        customer: 'cus_test123',
        subscription: 'sub_test123',
        attempt_count: 2,
      };
      const mockEvent = {
        id: 'evt_test123',
        type: 'invoice.payment_failed',
        data: { object: mockInvoice },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handleInvoicePaymentFailed.mockResolvedValue(undefined);

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockSubscriptionService.handleInvoicePaymentFailed).toHaveBeenCalledWith(mockInvoice);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });

    it('should handle unrecognized event types gracefully', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'customer.created',
        data: {
          object: {
            id: 'cus_test123',
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        received: true,
      });
    });

    it('should return 400 if signature verification fails', async () => {
      mockRequest.headers = { 'stripe-signature': 'invalid_signature' };
      mockStripeService.verifyWebhookSignature.mockRejectedValue(new Error('Invalid signature'));

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid signature',
      });
    });
  });
});
