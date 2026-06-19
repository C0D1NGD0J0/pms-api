import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { basicLimiter } from '@shared/middlewares';
import { AppRequest } from '@interfaces/utils.interface';
import { WebhookController } from '@controllers/WebhookController';

const router = Router();
router.use(basicLimiter());

router.post(
  '/boldsign',
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleBoldSignWebhook(req, res);
  })
);

/**
 * Stripe webhooks (all events)
 * Raw body is already preserved by global middleware in app.ts (line 81-89)
 * which saves req.rawBody for /api/v1/webhooks/stripe endpoint
 */
router.post(
  '/stripe',
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleStripeWebhook(req, res);
  })
);

/**
 * Stripe Connect webhooks (connected account events: account.updated, person.updated)
 * Requires a separate Stripe webhook endpoint configured with "Listen to events on Connected accounts"
 * Raw body is preserved by global middleware in app.ts for /api/v1/webhooks/stripe/connect
 */
router.post(
  '/stripe/connect',
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleStripeConnectWebhook(req, res);
  })
);

/**
 * Invoice webhooks (all events)
 * Raw body is already preserved by global middleware in app.ts (line 81-89)
 * which saves req.rawBody for /api/v1/webhooks/invoices/:source endpoint
 */
router.post(
  '/invoices/:source',
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleInvoiceWebhook(req, res);
  })
);

/**
 * Twilio webhooks (SMS delivery status + Verify events)
 * No signature verification — Twilio sends form-encoded POST data
 */
router.post(
  '/twilio/status',
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleTwilioWebhook(req, res);
  })
);

export default router;
