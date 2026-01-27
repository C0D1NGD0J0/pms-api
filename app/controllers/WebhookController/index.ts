import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
import { LeaseService } from '@services/lease/lease.service';
import { StripeService } from '@services/external/stripe/stripe.service';
import { BoldSignService } from '@services/external/esignature/boldSign.service';
import { SubscriptionService } from '@services/subscription/subscription.service';

interface IConstructor {
  subscriptionService: SubscriptionService;
  boldSignService: BoldSignService;
  stripeService: StripeService;
  leaseService: LeaseService;
}

export class WebhookController {
  private leaseService: LeaseService;
  private stripeService: StripeService;
  private boldSignService: BoldSignService;
  private subscriptionService: SubscriptionService;
  private log: Logger;

  constructor({ leaseService, boldSignService, subscriptionService, stripeService }: IConstructor) {
    this.leaseService = leaseService;
    this.stripeService = stripeService;
    this.boldSignService = boldSignService;
    this.subscriptionService = subscriptionService;
    this.log = createLogger('WebhookController');
  }

  /**
   * Handle BoldSign webhook events
   * Receives webhook notifications from BoldSign for document events
   * POST /api/webhooks/boldsign
   */
  handleBoldSignWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const { event, data } = req.body;

      if (event.eventType == 'Verification') {
        return res.status(200).json({ success: true, message: 'Verification event ignored' });
      }

      const eventType = event?.eventType;
      const documentId = data?.documentId;
      if (!eventType || !documentId) {
        this.log.warn('Invalid webhook payload - missing eventType or documentId', req.body);
        return res.status(400).json({
          success: false,
          message: 'Missing required fields: event.eventType, data.documentId',
        });
      }

      const processedData = this.boldSignService.processWebhookData(req.body);
      await this.leaseService.handleESignatureWebhook(eventType, documentId, data, processedData);

      return res.status(200).json({ success: true, message: 'Webhook processed successfully' });
    } catch (error: any) {
      this.log.error('Error processing BoldSign webhook', {
        error: error.message,
        stack: error.stack,
        body: req.body,
      });
      return res.status(500).json({
        success: false,
        message: 'Internal server error',
      });
    }
  };

  handleStripeWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const signature = req.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        this.log.warn('Missing Stripe signature header');
        return res.status(400).json({ success: false, message: 'Missing signature' });
      }

      const event = await this.stripeService.verifyWebhookSignature(req.body, signature);

      this.log.info({ type: event.type, id: event.id }, 'Processing Stripe webhook event');

      switch (event.type) {
        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          await this.handleSubscriptionUpdated(subscription);
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          await this.handleSubscriptionCanceled(subscription);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          await this.handlePaymentFailed(invoice);
          break;
        }

        case 'invoice.paid': {
          const invoice = event.data.object as any;

          // Extract subscription ID from correct location (Stripe changed API structure)
          const stripeSubscriptionId =
            invoice.subscription || invoice.parent?.subscription_details?.subscription;

          this.log.info('Invoice paid event', {
            invoiceId: invoice.id,
            stripeSubscriptionId,
            billingReason: invoice.billing_reason,
            hasLineItems: !!invoice.lines?.data?.length,
            lineItemMetadata: invoice.lines?.data?.[0]?.metadata || {},
          });

          if (invoice.billing_reason === 'subscription_create' && stripeSubscriptionId) {
            await this.handleInitialSubscriptionPayment(invoice);
          } else if (stripeSubscriptionId) {
            await this.handleSubscriptionRenewal(invoice);
          } else {
            this.log.warn('No subscription ID found in invoice', {
              invoiceId: invoice.id,
              hasParent: !!invoice.parent,
              parentType: invoice.parent?.type,
            });
          }
          break;
        }

        default:
          this.log.info({ type: event.type }, 'Unhandled webhook event type');
      }

      return res.status(200).json({ success: true, received: true });
    } catch (error: any) {
      this.log.error('Error processing Stripe webhook', {
        error: error.message,
        stack: error.stack,
      });
      return res.status(400).json({
        success: false,
        message: error.message || 'Webhook processing failed',
      });
    }
  };

  private async handleInitialSubscriptionPayment(invoice: any): Promise<void> {
    try {
      const customerId = invoice.customer;

      // Extract subscription ID from correct location
      const stripeSubscriptionId =
        invoice.subscription || invoice.parent?.subscription_details?.subscription;

      // Extract metadata from line items (Stripe sends it there, not in invoice.metadata)
      const lineItemMetadata = invoice.lines?.data?.[0]?.metadata || {};
      const clientId =
        lineItemMetadata.clientId || invoice.metadata?.clientId || invoice.customer_email;

      this.log.info('Processing initial payment with extracted data:', {
        customerId,
        stripeSubscriptionId,
        clientId,
        lineItemMetadata,
        invoiceMetadata: invoice.metadata,
        hasParent: !!invoice.parent,
      });

      if (!customerId || !stripeSubscriptionId) {
        this.log.warn('Missing required data', {
          invoice: invoice.id,
          hasCustomerId: !!customerId,
          hasSubscriptionId: !!stripeSubscriptionId,
          parent: invoice.parent,
        });
        return;
      }

      this.log.info(
        {
          customerId,
          stripeSubscriptionId,
          clientId,
          invoiceId: invoice.id,
        },
        'Processing initial subscription payment'
      );

      const result = await this.subscriptionService.handlePaymentSuccess({
        stripeCustomerId: customerId,
        stripeSubscriptionId,
        currentPeriodStart: invoice.period_start,
        currentPeriodEnd: invoice.period_end,
        clientId,
      });

      if (result.success) {
        this.log.info({ invoiceId: invoice.id }, 'Subscription activated successfully');
      } else {
        this.log.error(
          { invoiceId: invoice.id, error: result.message },
          'Failed to activate subscription'
        );
      }
    } catch (error) {
      this.log.error('Error handling initial subscription payment', {
        error,
        invoiceId: invoice.id,
      });
      throw error;
    }
  }

  private async handleSubscriptionRenewal(invoice: any): Promise<void> {
    try {
      // Extract subscription ID from correct location
      const stripeSubscriptionId =
        invoice.subscription || invoice.parent?.subscription_details?.subscription;

      if (!stripeSubscriptionId) {
        this.log.warn('Missing subscription ID', {
          invoiceId: invoice.id,
          parent: invoice.parent,
          subscription: invoice.subscription,
        });
        return;
      }

      this.log.info(
        {
          invoiceId: invoice.id,
          stripeSubscriptionId,
          periodStart: invoice.period_start,
          periodEnd: invoice.period_end,
        },
        'Processing subscription renewal'
      );

      const result = await this.subscriptionService.handleSubscriptionRenewal({
        stripeSubscriptionId,
        currentPeriodStart: invoice.period_start,
        currentPeriodEnd: invoice.period_end,
      });

      if (result.success) {
        this.log.info({ invoiceId: invoice.id }, 'Subscription renewal processed successfully');
      } else {
        this.log.error(
          { invoiceId: invoice.id, error: result.message },
          'Failed to process renewal'
        );
      }
    } catch (error) {
      this.log.error('Error handling subscription renewal', { error, invoiceId: invoice.id });
      throw error;
    }
  }

  private async handlePaymentFailed(invoice: any): Promise<void> {
    try {
      // Extract subscription ID from correct location
      const stripeSubscriptionId =
        invoice.subscription || invoice.parent?.subscription_details?.subscription;

      if (!stripeSubscriptionId) {
        this.log.warn('Missing subscription ID in failed invoice', {
          invoiceId: invoice.id,
          parent: invoice.parent,
          subscription: invoice.subscription,
        });
        return;
      }

      this.log.warn(
        {
          invoiceId: invoice.id,
          stripeSubscriptionId,
          attemptCount: invoice.attempt_count,
        },
        'Processing payment failure'
      );

      const result = await this.subscriptionService.handlePaymentFailed({
        stripeSubscriptionId,
        invoiceId: invoice.id,
        attemptCount: invoice.attempt_count,
      });

      if (result.success) {
        this.log.warn(
          { invoiceId: invoice.id },
          'Payment failure processed - subscription deactivated'
        );
      } else {
        this.log.error(
          { invoiceId: invoice.id, error: result.message },
          'Failed to process payment failure'
        );
      }
    } catch (error) {
      this.log.error('Error handling payment failure', { error, invoiceId: invoice.id });
      throw error;
    }
  }

  private async handleSubscriptionUpdated(subscription: any): Promise<void> {
    try {
      const stripeSubscriptionId = subscription.id;
      if (!stripeSubscriptionId) {
        this.log.warn('Missing subscription ID in updated subscription');
        return;
      }

      this.log.info(
        {
          stripeSubscriptionId,
          status: subscription.status,
          currentPeriodEnd: subscription.current_period_end,
        },
        'Processing subscription update'
      );

      const result = await this.subscriptionService.handleSubscriptionUpdated({
        stripeSubscriptionId,
        status: subscription.status,
        currentPeriodEnd: subscription.current_period_end,
      });

      if (result.success) {
        this.log.info({ stripeSubscriptionId }, 'Subscription update processed successfully');
      } else {
        this.log.error(
          { stripeSubscriptionId, error: result.message },
          'Failed to process subscription update'
        );
      }
    } catch (error) {
      this.log.error('Error handling subscription update', {
        error,
        subscriptionId: subscription.id,
      });
      throw error;
    }
  }

  private async handleSubscriptionCanceled(subscription: any): Promise<void> {
    try {
      const stripeSubscriptionId = subscription.id;
      if (!stripeSubscriptionId) {
        this.log.warn('Missing subscription ID in canceled subscription');
        return;
      }

      this.log.info(
        {
          stripeSubscriptionId,
          canceledAt: subscription.canceled_at,
        },
        'Processing subscription cancellation'
      );

      const result = await this.subscriptionService.handleSubscriptionCanceled({
        stripeSubscriptionId,
        canceledAt: subscription.canceled_at,
      });

      if (result.success) {
        this.log.info({ stripeSubscriptionId }, 'Subscription cancellation processed successfully');
      } else {
        this.log.error(
          { stripeSubscriptionId, error: result.message },
          'Failed to process cancellation'
        );
      }
    } catch (error) {
      this.log.error('Error handling subscription cancellation', {
        error,
        subscriptionId: subscription.id,
      });
      throw error;
    }
  }
}
