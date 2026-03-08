import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { LeaseService } from '@services/lease/lease.service';
import { PaymentService } from '@services/payments/payments.service';
import { StripeService } from '@services/external/stripe/stripe.service';
import { BoldSignService } from '@services/external/esignature/boldSign.service';
import { SubscriptionService } from '@services/subscription/subscription.service';

interface IConstructor {
  subscriptionService: SubscriptionService;
  boldSignService: BoldSignService;
  paymentService: PaymentService;
  stripeService: StripeService;
  leaseService: LeaseService;
}

export class WebhookController {
  private leaseService: LeaseService;
  private stripeService: StripeService;
  private boldSignService: BoldSignService;
  private subscriptionService: SubscriptionService;
  private paymentService: PaymentService;
  private log: Logger;

  constructor({
    leaseService,
    boldSignService,
    subscriptionService,
    stripeService,
    paymentService,
  }: IConstructor) {
    this.leaseService = leaseService;
    this.stripeService = stripeService;
    this.boldSignService = boldSignService;
    this.subscriptionService = subscriptionService;
    this.paymentService = paymentService;
    this.log = createLogger('WebhookController');
  }

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

  /**
   * Handle all Stripe webhook events
   * POST /api/webhooks/stripe
   */
  handleStripeWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const signature = req.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        this.log.warn('Missing Stripe signature header');
        return res.status(400).json({ success: false, message: 'Missing signature' });
      }

      const rawBody = (req as any).rawBody ?? req.body;
      const event = await this.stripeService.verifyWebhookSignature(rawBody, signature);
      this.log.info({ type: event.type, id: event.id }, 'Processing Stripe webhook event');

      switch (event.type) {
        // ── Dispute events ────────────────────────────────────────────────────
        case 'charge.dispute.funds_reinstated': {
          const dispute = event.data.object as any;
          await this.paymentService.handleDisputeWon(dispute.id, dispute);
          break;
        }

        // ── Subscription lifecycle ────────────────────────────────────────────
        case 'customer.subscription.created': {
          const subscription = event.data.object as any;
          await this.subscriptionService.handleSubscriptionCreated({
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer,
          });
          break;
        }

        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          await this.subscriptionService.handleSubscriptionUpdated({
            stripeSubscriptionId: subscription.id,
            stripeCustomerId: subscription.customer,
            status: subscription.status,
            currentPeriodStart: subscription.current_period_start,
            currentPeriodEnd: subscription.current_period_end,
          });
          break;
        }

        case 'customer.subscription.deleted': {
          const subscription = event.data.object as any;
          await this.subscriptionService.handleSubscriptionCanceled({
            stripeSubscriptionId: subscription.id,
            canceledAt: subscription.canceled_at,
          });
          break;
        }

        case 'invoice.payment_succeeded': {
          const invoice = event.data.object as any;
          // Rent invoices have no subscription ID
          if (!invoice.subscription) {
            await this.paymentService.handleInvoicePaymentSucceeded(invoice.id, invoice);
          }
          break;
        }

        case 'charge.dispute.created': {
          const dispute = event.data.object as any;
          await this.paymentService.handleDisputeCreated(dispute.id, dispute);
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          await this.subscriptionService.handleInvoicePaymentFailed(invoice);
          if (!invoice.subscription && !invoice.parent?.subscription_details?.subscription) {
            await this.paymentService.handleInvoicePaymentFailed(invoice.id, invoice);
          }
          break;
        }

        // ── Rent payment events ───────────────────────────────────────────────
        case 'charge.refunded': {
          const charge = event.data.object as any;
          await this.paymentService.handleChargeRefunded(charge.id, charge);
          break;
        }

        // ── Invoice events (subscription vs rent distinguished by invoice.subscription) ──
        case 'invoice.paid': {
          const invoice = event.data.object as any;
          await this.subscriptionService.handleInvoicePaid(invoice);
          break;
        }

        default:
          this.log.info({ type: event.type }, 'Unhandled Stripe webhook event type');
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

  /**
   * Handle Stripe Connect webhook events (connected account events)
   * POST /api/webhooks/stripe/connect
   * Requires a separate Stripe webhook endpoint configured with "Listen to events on Connected accounts"
   */
  handleStripeConnectWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const signature = req.headers['stripe-signature'];
      if (!signature || typeof signature !== 'string') {
        this.log.warn('Missing Stripe signature header on Connect webhook');
        return res.status(400).json({ success: false, message: 'Missing signature' });
      }

      const rawBody = (req as any).rawBody ?? req.body;
      const event = await this.stripeService.verifyWebhookSignature(
        rawBody,
        signature,
        envVariables.STRIPE.CONNECT_WEBHOOK_SECRET
      );
      this.log.info(
        { type: event.type, id: event.id, account: event.account },
        'Processing Stripe Connect webhook event'
      );

      switch (event.type) {
        case 'account.updated': {
          const account = event.data.object as any;
          await this.paymentService.handleAccountUpdated(account.id, account);
          break;
        }

        case 'person.updated': {
          const person = event.data.object as any;
          this.log.info(
            {
              account: event.account,
              person: person.id,
              verification: person.verification?.status,
            },
            'Stripe person verification updated'
          );
          break;
        }

        default:
          this.log.info({ type: event.type }, 'Unhandled Stripe Connect webhook event type');
      }

      return res.status(200).json({ success: true, received: true });
    } catch (error: any) {
      this.log.error('Error processing Stripe Connect webhook', {
        error: error.message,
        stack: error.stack,
      });
      return res.status(400).json({
        success: false,
        message: error.message || 'Webhook processing failed',
      });
    }
  };
}
