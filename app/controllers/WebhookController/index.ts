import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { IdempotencyCache } from '@caching/index';
import { LeaseService } from '@services/lease/lease.service';
import { ClientService } from '@services/client/client.service';
import { PaymentService } from '@services/payments/payments.service';
import { StripeService } from '@services/external/stripe/stripe.service';
import { BoldSignService } from '@services/external/esignature/boldSign.service';
import { SubscriptionService } from '@services/subscription/subscription.service';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';
import { IInvoiceWebhookPayload, InvoiceSource } from '@interfaces/maintenanceRequest.interface';

interface IConstructor {
  maintenanceRequestService: MaintenanceRequestService;
  subscriptionService: SubscriptionService;
  idempotencyCache: IdempotencyCache;
  boldSignService: BoldSignService;
  paymentService: PaymentService;
  stripeService: StripeService;
  clientService: ClientService;
  leaseService: LeaseService;
}

export class WebhookController {
  private leaseService: LeaseService;
  private stripeService: StripeService;
  private boldSignService: BoldSignService;
  private subscriptionService: SubscriptionService;
  private paymentService: PaymentService;
  private clientService: ClientService;
  private idempotencyCache: IdempotencyCache;
  private maintenanceRequestService: MaintenanceRequestService;
  private log: Logger;

  constructor({
    leaseService,
    boldSignService,
    subscriptionService,
    stripeService,
    paymentService,
    clientService,
    idempotencyCache,
    maintenanceRequestService,
  }: IConstructor) {
    this.leaseService = leaseService;
    this.stripeService = stripeService;
    this.boldSignService = boldSignService;
    this.subscriptionService = subscriptionService;
    this.paymentService = paymentService;
    this.clientService = clientService;
    this.idempotencyCache = idempotencyCache;
    this.maintenanceRequestService = maintenanceRequestService;
    this.log = createLogger('WebhookController');
  }

  handleBoldSignWebhook = async (req: Request, res: Response): Promise<Response> => {
    try {
      const signature = req.headers['x-boldsign-signature'];
      if (!signature || typeof signature !== 'string') {
        this.log.warn('Missing BoldSign signature header');
        return res.status(400).json({ success: false, message: 'Missing signature' });
      }

      const rawBody = (req as any).rawBody ?? req.body;
      this.boldSignService.verifyWebhookSignature(rawBody, signature);

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

      // Deduplicate: BoldSign retries the same event if we don't respond in time.
      // Key = documentId + eventType so different events on the same doc are processed independently.
      const idempotencyKey = `boldsign:${documentId}:${eventType}`;
      const claimed = await this.idempotencyCache.claimWebhookEvent(idempotencyKey);
      if (!claimed) {
        this.log.info({ documentId, eventType }, 'Duplicate BoldSign webhook — skipping');
        return res.status(200).json({ success: true, received: true });
      }

      try {
        const processedData = this.boldSignService.processWebhookData(req.body);
        await this.leaseService.handleESignatureWebhook(eventType, documentId, data, processedData);

        await this.idempotencyCache.markWebhookProcessed(idempotencyKey);
        return res.status(200).json({ success: true, message: 'Webhook processed successfully' });
      } catch (processingError: any) {
        await this.idempotencyCache.releaseWebhookClaim(idempotencyKey);
        throw processingError;
      }
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

      const rawBody = (req as any).rawBody ?? req.body;
      const event = await this.stripeService.verifyWebhookSignature(rawBody, signature);
      this.log.info({ type: event.type, id: event.id }, 'Processing Stripe webhook event');

      const claimed = await this.idempotencyCache.claimWebhookEvent(event.id);
      if (!claimed) {
        this.log.info({ eventId: event.id }, 'Duplicate webhook — skipping');
        return res.status(200).json({ success: true, received: true });
      }

      try {
        switch (event.type) {
          case 'identity.verification_session.requires_input': {
            const session = event.data.object as any;
            await this.clientService.handleIdentityWebhookEvent('requires_input', session.id);
            break;
          }

          case 'identity.verification_session.verified': {
            const session = event.data.object as any;
            await this.clientService.handleIdentityWebhookEvent('verified', session.id);
            break;
          }

          case 'charge.dispute.funds_reinstated': {
            const dispute = event.data.object as any;
            await this.paymentService.handleDisputeWon(dispute.id, dispute);
            break;
          }

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

          case 'checkout.session.completed': {
            const session = event.data.object as any;
            if (session.mode === 'setup') {
              await this.paymentService.handleSetupSessionCompleted(session, 'platform');
            }
            break;
          }

          case 'invoice.payment_succeeded': {
            const invoice = event.data.object as any;
            if (!invoice.subscription) {
              await this.paymentService.handleInvoicePaymentSucceeded(invoice.id, invoice);
            }
            break;
          }

          case 'setup_intent.succeeded': {
            const setupIntent = event.data.object as any;
            await this.paymentService.handleSetupIntentSucceeded(setupIntent);
            break;
          }

          case 'charge.dispute.created': {
            const dispute = event.data.object as any;
            await this.paymentService.handleDisputeCreated(dispute.id, dispute);
            break;
          }

          case 'invoice.payment_failed': {
            const invoice = event.data.object as any;
            const hasSubscription =
              !!invoice.subscription || !!invoice.parent?.subscription_details?.subscription;
            if (hasSubscription) {
              await this.subscriptionService.handleInvoicePaymentFailed(invoice);
            } else {
              await this.paymentService.handleInvoicePaymentFailed(invoice.id, invoice);
            }
            break;
          }

          case 'charge.dispute.closed': {
            const dispute = event.data.object as any;
            if (dispute.status === 'won') {
              await this.paymentService.handleDisputeWon(dispute.id, dispute);
            } else if (dispute.status === 'lost') {
              await this.paymentService.handleDisputeLost(dispute.id, dispute);
            }
            break;
          }

          case 'charge.refunded': {
            const charge = event.data.object as any;
            await this.paymentService.handleChargeRefunded(charge.id, charge);
            break;
          }

          case 'invoice.paid': {
            const invoice = event.data.object as any;
            await this.subscriptionService.handleInvoicePaid(invoice);
            break;
          }

          default:
            this.log.info({ type: event.type }, 'Unhandled Stripe webhook event type');
        }

        await this.idempotencyCache.markWebhookProcessed(event.id);
        return res.status(200).json({ success: true, received: true });
      } catch (processingError: any) {
        await this.idempotencyCache.releaseWebhookClaim(event.id);
        throw processingError;
      }
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

      const claimed = await this.idempotencyCache.claimWebhookEvent(event.id);
      if (!claimed) {
        this.log.info({ eventId: event.id }, 'Duplicate Connect webhook — skipping');
        return res.status(200).json({ success: true, received: true });
      }

      try {
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

        await this.idempotencyCache.markWebhookProcessed(event.id);
        return res.status(200).json({ success: true, received: true });
      } catch (processingError: any) {
        await this.idempotencyCache.releaseWebhookClaim(event.id);
        throw processingError;
      }
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

  handleInvoiceWebhook = async (req: Request, res: Response): Promise<void> => {
    const source = req.params.source as InvoiceSource;
    const rawBody = (req as any).rawBody as Buffer;
    const headers = req.headers as Record<string, string>;

    if (!rawBody) {
      res.status(400).json({ success: false, error: 'Raw body unavailable' });
      return;
    }

    const parsed = req.body;
    const payload: IInvoiceWebhookPayload = { ...parsed, source, rawPayload: parsed };

    res.status(200).json({ received: true });

    this.maintenanceRequestService
      .handleInvoiceWebhook(source, rawBody, headers, payload)
      .catch((err: unknown) => {
        this.log.error('[WebhookController] invoice webhook processing error', err);
      });
  };
}
