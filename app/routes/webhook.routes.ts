import express, { Router } from 'express';
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
 * Uses express.raw() to preserve raw body for signature verification
 */
router.post(
  '/stripe',
  express.raw({ type: 'application/json' }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleStripeWebhook(req, res);
  })
);

export default router;
