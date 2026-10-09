import { asyncWrapper } from '@utils/index';
import { basicLimiter } from '@shared/middlewares';
import { AppRequest } from '@interfaces/utils.interface';
import { NextFunction, Response, Request, Router } from 'express';
import { WebhookController } from '@controllers/WebhookController';

const router = Router();
router.use(basicLimiter());

/**
 * Invoice-provider webhooks are unauthenticated and their HMAC signature verification is
 * not implemented yet, so the endpoint is disabled in production until it is.
 */
export const blockUnverifiedInvoiceWebhookInProduction = (
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(501).json({ success: false, error: 'Invoice webhooks are not enabled' });
    return;
  }
  next();
};

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
  blockUnverifiedInvoiceWebhookInProduction,
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleInvoiceWebhook(req, res);
  })
);

/**
 * Twilio webhooks (SMS delivery status + Verify events)
 * Signature verified via X-Twilio-Signature in the controller
 */
router.post(
  '/twilio/status',
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleTwilioWebhook(req, res);
  })
);

export default router;
