import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { SubscriptionController } from '@controllers/index';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  SubscriptionValidations,
  UtilsValidations,
  validateRequest,
  SMSValidations,
} from '@shared/validations';
import {
  subscriptionEntitlements,
  requirePermission,
  isAuthenticated,
  requireFeature,
  basicLimiter,
  idempotency,
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
  subscriptionEntitlements,
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
  idempotency,
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

router.post(
  '/:cuid/seats',
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  validateRequest({ body: SubscriptionValidations.manageSeats }),
  asyncWrapper((req, res) => {
    const subscriptionController =
      req.container.resolve<SubscriptionController>('subscriptionController');
    return subscriptionController.manageSeats(req, res);
  })
);

router.post(
  '/:cuid/sync-from-stripe',
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.MANAGE),
  asyncWrapper((req, res) => {
    const subscriptionController =
      req.container.resolve<SubscriptionController>('subscriptionController');
    return subscriptionController.syncFromStripe(req, res);
  })
);

router.get(
  '/:cuid/sms-quota',
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.READ),
  subscriptionEntitlements,
  requireFeature('smsService'),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<SubscriptionController>('subscriptionController');
    return controller.getSMSQuota(req, res);
  })
);

router.get(
  '/:cuid/sms-logs',
  isAuthenticated,
  requirePermission(PermissionResource.BILLING, PermissionAction.READ),
  subscriptionEntitlements,
  requireFeature('smsService'),
  validateRequest({ params: UtilsValidations.cuid, query: SMSValidations.logsQuery }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<SubscriptionController>('subscriptionController');
    return controller.getSMSLogs(req, res);
  })
);

export default router;
