import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { basicLimiter } from '@shared/middlewares';
import { SubscriptionController } from '@controllers/index';

export const router: Router = express.Router();

router.use(basicLimiter());

router.get(
  '/plans',
  asyncWrapper((req, res) => {
    const subscriptionController =
      req.container.resolve<SubscriptionController>('subscriptionController');
    return subscriptionController.getSubscriptionPlans(req, res);
  })
);

export default router;
