import { Response, Request } from 'express';
import { LeaseService } from '@services/lease/lease.service';
import { WebhookController } from '@controllers/WebhookController';
import { StripeService } from '@services/external/stripe/stripe.service';
import { ISubscriptionStatus } from '@interfaces/subscription.interface';
import { BoldSignService } from '@services/external/esignature/boldSign.service';
import { SubscriptionService } from '@services/subscription/subscription.service';

describe('WebhookController - Stripe Webhooks', () => {
  let webhookController: WebhookController;
  let mockStripeService: jest.Mocked<StripeService>;
  let mockSubscriptionService: jest.Mocked<SubscriptionService>;
  let mockLeaseService: jest.Mocked<LeaseService>;
  let mockBoldSignService: jest.Mocked<BoldSignService>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockStripeService = {
      verifyWebhookSignature: jest.fn(),
    } as any;

    mockSubscriptionService = {
      handlePaymentSuccess: jest.fn(),
      handleSubscriptionRenewal: jest.fn(),
      handlePaymentFailed: jest.fn(),
      handleSubscriptionUpdated: jest.fn(),
      handleSubscriptionCanceled: jest.fn(),
    } as any;

    mockLeaseService = {} as any;
    mockBoldSignService = {} as any;

    webhookController = new WebhookController({
      stripeService: mockStripeService,
      subscriptionService: mockSubscriptionService,
      leaseService: mockLeaseService,
      boldSignService: mockBoldSignService,
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

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Missing signature',
      });
    });

    it('should handle invoice.paid event for initial subscription payment', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test123',
            customer: 'cus_test123',
            subscription: 'sub_test123',
            billing_reason: 'subscription_create',
            period_start: 1700000000,
            period_end: 1702592000,
            metadata: {
              clientId: 'client123',
            },
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handlePaymentSuccess.mockResolvedValue({
        success: true,
        data: {
          _id: 'sub_db_123',
          status: ISubscriptionStatus.ACTIVE,
        } as any,
      });

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockStripeService.verifyWebhookSignature).toHaveBeenCalledWith(
        mockRequest.body,
        'test_signature'
      );

      expect(mockSubscriptionService.handlePaymentSuccess).toHaveBeenCalledWith({
        stripeCustomerId: 'cus_test123',
        stripeSubscriptionId: 'sub_test123',
        currentPeriodStart: 1700000000,
        currentPeriodEnd: 1702592000,
        clientId: 'client123',
      });

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        received: true,
      });
    });

    it('should use line item period for subscription dates (not invoice period)', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test123',
            customer: 'cus_test123',
            subscription: 'sub_test123',
            billing_reason: 'subscription_create',
            period_start: 1769609328, // Invoice period (same day)
            period_end: 1769609328, // Invoice period (same day)
            lines: {
              data: [
                {
                  period: {
                    start: 1769609328, // Subscription start
                    end: 1772287728, // Subscription end (1 month later)
                  },
                  metadata: { clientId: 'client123' },
                },
              ],
            },
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handlePaymentSuccess.mockResolvedValue({
        success: true,
        data: {} as any,
      });

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      // Verify it used LINE ITEM period (not invoice period)
      expect(mockSubscriptionService.handlePaymentSuccess).toHaveBeenCalledWith(
        expect.objectContaining({
          currentPeriodStart: 1769609328, // Line item start
          currentPeriodEnd: 1772287728, // Line item end (different from invoice!)
          clientId: 'client123',
        })
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
    });

    it('should handle invoice.paid event for subscription renewal', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test123',
            customer: 'cus_test123',
            subscription: 'sub_test123',
            billing_reason: 'subscription_cycle',
            period_start: 1700000000,
            period_end: 1702592000,
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handleSubscriptionRenewal.mockResolvedValue({
        success: true,
        data: {} as any,
      });

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockSubscriptionService.handleSubscriptionRenewal).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_test123',
        currentPeriodStart: 1700000000,
        currentPeriodEnd: 1702592000,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockSubscriptionService.handlePaymentSuccess).not.toHaveBeenCalled();
    });

    it('should handle invoice.payment_failed event', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'in_test123',
            customer: 'cus_test123',
            subscription: 'sub_test123',
            attempt_count: 2,
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);
      mockSubscriptionService.handlePaymentFailed.mockResolvedValue({
        success: true,
        data: {} as any,
      });

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockSubscriptionService.handlePaymentFailed).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_test123',
        invoiceId: 'in_test123',
        attemptCount: 2,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        received: true,
      });
    });

    it('should handle customer.subscription.updated event', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'customer.subscription.updated',
        data: {
          object: {
            id: 'sub_test123',
            status: 'active',
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

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockSubscriptionService.handleSubscriptionUpdated).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_test123',
        status: 'active',
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

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockSubscriptionService.handleSubscriptionCanceled).toHaveBeenCalledWith({
        stripeSubscriptionId: 'sub_test123',
        canceledAt: 1700000000,
      });
      expect(mockResponse.status).toHaveBeenCalledWith(200);
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

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        received: true,
      });
    });

    it('should return 400 if signature verification fails', async () => {
      mockRequest.headers = { 'stripe-signature': 'invalid_signature' };
      mockStripeService.verifyWebhookSignature.mockRejectedValue(
        new Error('Invalid signature')
      );

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(400);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Invalid signature',
      });
    });

    it('should call handlePaymentSuccess for invoice.paid with subscription_create even when customer data is sparse', async () => {
      const mockEvent = {
        id: 'evt_test123',
        type: 'invoice.paid',
        data: {
          object: {
            id: 'in_test123',
            billing_reason: 'subscription_create',
            subscription: 'sub_test123',
          },
        },
      };

      mockRequest.headers = { 'stripe-signature': 'test_signature' };
      mockStripeService.verifyWebhookSignature.mockResolvedValue(mockEvent);

      await webhookController.handleStripeWebhook(
        mockRequest as Request,
        mockResponse as Response
      );

      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockSubscriptionService.handlePaymentSuccess).toHaveBeenCalledWith(
        expect.objectContaining({ stripeSubscriptionId: 'sub_test123' })
      );
    });
  });
});
