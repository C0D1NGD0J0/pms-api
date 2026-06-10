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
  let mockPaymentService: any;
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

    mockPaymentService = {
      handleInvoicePaymentSucceeded: jest.fn().mockResolvedValue(undefined),
      handleInvoicePaymentFailed: jest.fn().mockResolvedValue(undefined),
      handleInvoiceOverdue: jest.fn().mockResolvedValue(undefined),
      handleInvoiceUpcoming: jest.fn().mockResolvedValue(undefined),
      handlePayoutPaid: jest.fn().mockResolvedValue(undefined),
      handlePayoutFailed: jest.fn().mockResolvedValue(undefined),
    };

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
      paymentService: mockPaymentService,
      clientService: {} as any,
      idempotencyCache: mockIdempotencyCache,
      maintenanceInvoiceService: {} as any,
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
      const mockItems = [
        { id: 'si_base', price: { lookup_key: 'growth_monthly_price' }, quantity: 1 },
      ];
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
            items: { data: mockItems },
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
        items: mockItems,
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

    it('should handle invoice.paid by calling both subscriptionService and paymentService', async () => {
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
      expect(mockPaymentService.handleInvoicePaymentSucceeded).toHaveBeenCalledWith(mockInvoice.id, mockInvoice);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });

    it('should handle invoice.payment_failed by calling both subscriptionService and paymentService', async () => {
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
      expect(mockPaymentService.handleInvoicePaymentFailed).toHaveBeenCalledWith(mockInvoice.id, mockInvoice);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });

    it('should handle invoice.overdue by calling paymentService.handleInvoiceOverdue', async () => {
      const mockInvoice = {
        id: 'in_overdue123',
        amount_due: 150000,
        currency: 'cad',
        customer: 'cus_test123',
      };
      const mockEvent = {
        id: 'evt_overdue123',
        type: 'invoice.overdue',
        data: { object: mockInvoice },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockPaymentService.handleInvoiceOverdue).toHaveBeenCalledWith(mockInvoice.id, mockInvoice);
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });

    it('should handle invoice.upcoming by calling paymentService.handleInvoiceUpcoming', async () => {
      const mockInvoice = {
        id: 'in_upcoming123',
        subscription: 'sub_test123',
        amount_due: 9900,
        currency: 'cad',
        period_start: 1700000000,
      };
      const mockEvent = {
        id: 'evt_upcoming123',
        type: 'invoice.upcoming',
        data: { object: mockInvoice },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);

      await webhookController.handleStripeWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockPaymentService.handleInvoiceUpcoming).toHaveBeenCalledWith(mockInvoice);
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

  describe('handleStripeConnectWebhook', () => {
    it('should handle payout.paid by calling paymentService.handlePayoutPaid with event.account', async () => {
      const mockPayout = {
        id: 'po_test123',
        amount: 50000,
        currency: 'cad',
        arrival_date: 1700000000,
        destination: 'ba_test123',
        status: 'paid',
      };
      const mockEvent = {
        id: 'evt_connect_paid',
        type: 'payout.paid',
        account: 'acct_vendor123',
        data: { object: mockPayout },
      };

      mockRequest.headers = { 'stripe-signature': 'test_connect_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);

      await webhookController.handleStripeConnectWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockPaymentService.handlePayoutPaid).toHaveBeenCalledWith(
        mockPayout.id,
        mockPayout,
        'acct_vendor123'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });

    it('should handle payout.failed by calling paymentService.handlePayoutFailed with event.account', async () => {
      const mockPayout = {
        id: 'po_fail123',
        amount: 50000,
        currency: 'cad',
        arrival_date: 1700000000,
        destination: 'ba_test123',
        failure_code: 'insufficient_funds',
        failure_reason: 'The bank account has insufficient funds.',
        status: 'failed',
      };
      const mockEvent = {
        id: 'evt_connect_failed',
        type: 'payout.failed',
        account: 'acct_vendor123',
        data: { object: mockPayout },
      };

      mockRequest.headers = { 'stripe-signature': 'test_connect_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);

      await webhookController.handleStripeConnectWebhook(mockRequest as Request, mockResponse as Response);

      expect(mockPaymentService.handlePayoutFailed).toHaveBeenCalledWith(
        mockPayout.id,
        mockPayout,
        'acct_vendor123'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({ success: true, received: true });
    });
  });
});
