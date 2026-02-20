import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
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

      const event = await this.stripeService.verifyWebhookSignature(req.body, signature);
      this.log.info({ type: event.type, id: event.id }, 'Processing Stripe webhook event');

      switch (event.type) {
        // ── Subscription lifecycle ────────────────────────────────────────────
        case 'customer.subscription.updated': {
          const subscription = event.data.object as any;
          await this.subscriptionService.handleSubscriptionUpdated({
            stripeSubscriptionId: subscription.id,
            status: subscription.status,
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

        case 'invoice.payment_failed': {
          const invoice = event.data.object as any;
          const stripeSubscriptionId =
            invoice.subscription || invoice.parent?.subscription_details?.subscription;

          if (stripeSubscriptionId) {
            await this.subscriptionService.handlePaymentFailed({
              stripeSubscriptionId,
              invoiceId: invoice.id,
              attemptCount: invoice.attempt_count,
            });
          } else {
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

        // ── Connect account events ────────────────────────────────────────────
        case 'account.updated': {
          const account = event.data.object as any;
          await this.paymentService.handleAccountUpdated(account.id, account);
          break;
        }

        // ── Invoice events (subscription vs rent distinguished by invoice.subscription) ──
        case 'invoice.paid': {
          const invoice = event.data.object as any;
          const stripeSubscriptionId =
            invoice.subscription || invoice.parent?.subscription_details?.subscription;

          if (!stripeSubscriptionId) {
            this.log.info('Ignoring non-subscription invoice.paid', { invoiceId: invoice.id });
            break;
          }

          const customerId = invoice.customer;
          const lineItemMetadata = invoice.lines?.data?.[0]?.metadata || {};
          const clientId =
            lineItemMetadata.clientId || invoice.metadata?.clientId || invoice.customer_email;
          const subscriptionPeriod = invoice.lines?.data?.[0]?.period;
          const isInitialPayment = invoice.billing_reason === 'subscription_create';

          let cardLast4: string | undefined;
          let cardBrand: string | undefined;
          if (isInitialPayment && invoice.charge) {
            try {
              const chargeId =
                typeof invoice.charge === 'string' ? invoice.charge : invoice.charge.id;
              const charge = await this.stripeService.getCharge(chargeId);
              if (charge?.payment_method_details?.card) {
                cardLast4 = charge.payment_method_details.card.last4 ?? undefined;
                cardBrand = charge.payment_method_details.card.brand ?? undefined;
              }
            } catch (err) {
              this.log.warn({ err }, 'Failed to fetch card details for initial payment');
            }
          }

          if (isInitialPayment) {
            await this.subscriptionService.handlePaymentSuccess({
              stripeCustomerId: customerId,
              stripeSubscriptionId,
              currentPeriodStart: subscriptionPeriod?.start || invoice.period_start,
              currentPeriodEnd: subscriptionPeriod?.end || invoice.period_end,
              clientId,
              cardLast4,
              cardBrand,
            });
          } else {
            await this.subscriptionService.handleSubscriptionRenewal({
              stripeSubscriptionId,
              currentPeriodStart: subscriptionPeriod?.start || invoice.period_start,
              currentPeriodEnd: subscriptionPeriod?.end || invoice.period_end,
            });
          }
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
}
