import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { GuestPassController } from '@controllers/GuestPassController';
import { UtilsValidations, validateRequest } from '@shared/validations';
import { GuestPassValidations } from '@shared/validations/GuestPassValidation';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  subscriptionEntitlements,
  requireActiveTenant,
  requirePermission,
  isAuthenticated,
  requireFeature,
  basicLimiter,
  idempotency,
} from '@shared/middlewares';

export const router: Router = express.Router();

router.use(isAuthenticated);

// ── Specific sub-path GETs (must be before generic /:cuid) ───────────

router.get(
  '/:cuid/stats',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.READ),
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.getStats(req, res);
  })
);

router.get(
  '/:cuid/expected',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.LIST),
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  validateRequest({
    params: UtilsValidations.cuid,
    query: GuestPassValidations.expectedVisitorsQuery,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.getExpectedVisitors(req, res);
  })
);

router.get(
  '/:cuid/unacknowledged-count',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.LIST),
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  validateRequest({
    params: UtilsValidations.cuid,
    query: GuestPassValidations.unacknowledgedCountQuery,
  }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.getUnacknowledgedCount(req, res);
  })
);

router.get(
  '/:cuid/property/:propertyId/unacknowledged',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.LIST),
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  validateRequest({ params: UtilsValidations.cuid.merge(GuestPassValidations.propertyIdParam) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.getUnacknowledged(req, res);
  })
);

// ── Generic /:cuid routes ────────────────────────────────────────────

router.get(
  '/:cuid',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.LIST),
  requireActiveTenant('guestPass'),
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
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  idempotency,
  validateRequest({ params: UtilsValidations.cuid, body: GuestPassValidations.createPass }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.createPass(req, res);
  })
);

router.post(
  '/:cuid/validate',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.UPDATE),
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  idempotency,
  validateRequest({ params: UtilsValidations.cuid, body: GuestPassValidations.validateCode }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.validateCode(req, res);
  })
);

router.post(
  '/:cuid/bulk-acknowledge',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.UPDATE),
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  idempotency,
  validateRequest({ params: UtilsValidations.cuid, body: GuestPassValidations.bulkAcknowledge }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.bulkAcknowledge(req, res);
  })
);

// ── Pass-specific routes (/:cuid/:vpuid) ─────────────────────────────

router.patch(
  '/:cuid/:vpuid/acknowledge',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.UPDATE),
  requireActiveTenant('guestPass'),
  subscriptionEntitlements,
  requireFeature('guestPassService'),
  validateRequest({ params: UtilsValidations.cuid.merge(GuestPassValidations.vpuid) }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<GuestPassController>('guestPassController');
    return controller.acknowledgePass(req, res);
  })
);

router.delete(
  '/:cuid/:vpuid',
  basicLimiter(),
  requirePermission(PermissionResource.GUEST_PASS, PermissionAction.DELETE),
  requireActiveTenant('guestPass'),
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
