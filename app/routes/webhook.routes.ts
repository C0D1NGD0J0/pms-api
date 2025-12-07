import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { basicLimiter } from '@shared/middlewares';
import { AppRequest } from '@interfaces/utils.interface';
import { WebhookController } from '@controllers/WebhookController';

const router = Router();
router.use(basicLimiter());

/**
 * BoldSign webhook endpoint
 * POST /api/webhooks/boldsign
 */
router.post(
  '/boldsign',
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<WebhookController>('webhookController');
    return controller.handleBoldSignWebhook(req, res);
  })
);

export default router;
