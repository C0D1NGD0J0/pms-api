import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { GuestPassController } from '@controllers/GuestPassController';
import { UtilsValidations, validateRequest } from '@shared/validations';
import { GuestPassValidations } from '@shared/validations/GuestPassValidation';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  subscriptionEntitlements,
  requirePermission,
  isAuthenticated,
  requireFeature,
  basicLimiter,
  idempotency,
} from '@shared/middlewares';

export const router: Router = express.Router();

router.use(isAuthenticated);

router.get(
  '/:cuid/stats',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.READ),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.getStats(req, res);
  })
);

router.get(
  '/:cuid',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.LIST),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  validateRequest({ params: UtilsValidations.cuid, query: GuestPassValidations.listQuery }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.getMyPasses(req, res);
  })
);

router.post(
  '/:cuid',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.CREATE),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  idempotency,
  validateRequest({ params: UtilsValidations.cuid, body: GuestPassValidations.createPass }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.createPass(req, res);
  })
);

router.delete(
  '/:cuid/:vpuid',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.DELETE),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  idempotency,
  validateRequest({ params: UtilsValidations.cuid.merge(GuestPassValidations.vpuid) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.revokePass(req, res);
  })
);

export default router;
