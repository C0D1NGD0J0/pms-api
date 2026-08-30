import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { ReportController } from '@controllers/ReportController';
import { ReportValidations } from '@shared/validations/ReportValidation';
import { UtilsValidations, validateRequest } from '@shared/validations/index';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import {
  requireActiveSubscription,
  subscriptionEntitlements,
  requireVerifiedClient,
  requireNotSuspended,
  requirePermission,
  isAuthenticated,
  requireFeature,
  basicLimiter,
} from '@shared/middlewares';

const router = Router();
router.use(isAuthenticated, basicLimiter());

// ─── On-demand generation ───────────────────────────────────────────
router.post(
  '/:cuid/generate',
  requireNotSuspended,
  requirePermission(PermissionResource.REPORT, PermissionAction.CREATE),
  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('reportingAnalytics'),
  requireActiveSubscription,
  validateRequest({ params: UtilsValidations.cuid, body: ReportValidations.generateBody }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<ReportController>('reportController');
    return controller.generate(req, res);
  })
);

router.get(
  '/:cuid/:reportId/status',
  requirePermission(PermissionResource.REPORT, PermissionAction.READ),
  subscriptionEntitlements,
  requireFeature('reportingAnalytics'),
  validateRequest({ params: ReportValidations.reportIdParam }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<ReportController>('reportController');
    return controller.getStatus(req, res);
  })
);

router.get(
  '/:cuid',
  requirePermission(PermissionResource.REPORT, PermissionAction.READ),
  subscriptionEntitlements,
  requireFeature('reportingAnalytics'),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<ReportController>('reportController');
    return controller.list(req, res);
  })
);

// ─── Schedule management ────────────────────────────────────────────

router.post(
  '/:cuid/schedule',
  requireNotSuspended,
  requirePermission(PermissionResource.REPORT, PermissionAction.CREATE),
  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('reportingAnalytics'),
  requireActiveSubscription,
  validateRequest({ params: UtilsValidations.cuid, body: ReportValidations.scheduleBody }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<ReportController>('reportController');
    return controller.upsertSchedule(req, res);
  })
);

router.get(
  '/:cuid/schedule',
  requirePermission(PermissionResource.REPORT, PermissionAction.READ),
  subscriptionEntitlements,
  requireFeature('reportingAnalytics'),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<ReportController>('reportController');
    return controller.getSchedule(req, res);
  })
);

router.delete(
  '/:cuid/schedule',
  requireNotSuspended,
  requirePermission(PermissionResource.REPORT, PermissionAction.CREATE),
  subscriptionEntitlements,
  requireFeature('reportingAnalytics'),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<ReportController>('reportController');
    return controller.deactivateSchedule(req, res);
  })
);

export default router;
