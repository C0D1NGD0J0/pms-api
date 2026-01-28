import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { SubscriptionController } from '@controllers/index';
import { SubscriptionValidations, validateRequest } from '@shared/validations';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  subscriptionAccessControl,
  requirePermission,
  isAuthenticated,
  basicLimiter,
} from '@shared/middlewares';

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

router.post(
  '/:cuid/init-subscription-payment',
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ body: SubscriptionValidations.initiateCheckout }),
  asyncWrapper((req, res) => {
    const subscriptionController =
      req.container.resolve<SubscriptionController>('subscriptionController');
    return subscriptionController.initSubscriptionPayment(req, res);
  })
);

router.delete(
  '/:cuid/cancel-subscription',
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  asyncWrapper((req, res) => {
    const subscriptionController =
      req.container.resolve<SubscriptionController>('subscriptionController');
    return subscriptionController.cancelSubscription(req, res);
  })
);

export default router;
