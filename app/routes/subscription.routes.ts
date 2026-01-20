import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { SubscriptionController } from '@controllers/index';
import { subscriptionAccessControl, isAuthenticated, basicLimiter } from '@shared/middlewares';

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

router.get(
  '/:cuid/plan-usage',
  isAuthenticated,
  subscriptionAccessControl,
  asyncWrapper((req, res) => {
    const subscriptionController =
      req.container.resolve<SubscriptionController>('subscriptionController');
    return subscriptionController.getPlanUsage(req, res);
  })
);

export default router;
