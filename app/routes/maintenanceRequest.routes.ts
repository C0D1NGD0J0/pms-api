import express, { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { MaintenanceValidations } from '@shared/validations/index';
import { MaintenanceController } from '@controllers/MaintenanceController';
import { UtilsValidations, validateRequest } from '@shared/validations/index';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import {
  requirePermissionWithContext,
  subscriptionEntitlements,
  requireActiveTenant,
  requireFeatureFlag,
  requirePermission,
  isAuthenticated,
  requireFeature,
  basicLimiter,
  idempotency,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

// Context extractor for routes vendors/tenants access via MINE scope.
// Admins/managers resolve to ANY scope (no ownerId → defaults to ANY).
const roleBasedContext = (req: AppRequest) => {
  const role = req.context?.currentuser?.client?.role;
  if (role === 'vendor' || role === 'tenant') {
    return { ownerId: req.context?.currentuser?.sub ?? '' };
  }
  return {};
};

const router = Router();

// Public webhook route — must be declared before isAuthenticated.
// Gated behind INVOICE_WEBHOOK feature flag (disabled by default).
// WARNING: HMAC signature verification is stubbed (Phase 2). Do not enable in production
// without network-level protection (IP allowlist, reverse-proxy HMAC verification).
router.post(
  '/webhooks/invoice/:source',
  requireFeatureFlag(FeatureFlag.INVOICE_WEBHOOK),
  basicLimiter({ max: 30, windowMs: 60 * 1000 }),
  express.json(),
  validateRequest({
    params: MaintenanceValidations.webhookSourceParam,
    body: MaintenanceValidations.webhookBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.handleWebhook(req, res);
  })
);

router.use(isAuthenticated);
router
  .route('/:cuid')
  .post(
    basicLimiter(),
    requirePermission(PermissionResource.MAINTENANCE, PermissionAction.CREATE),
    requireActiveTenant('maintenanceRequests'),
    subscriptionEntitlements,
    requireFeature('MaintenanceRequestService'),
    idempotency,
    diskUpload(['media[*][file]']),
    scanFile,
    validateRequest({ params: UtilsValidations.cuid, body: MaintenanceValidations.createBody }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<MaintenanceController>('maintenanceController');
      return controller.createRequest(req, res);
    })
  )
  .get(
    basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
    requirePermissionWithContext(
      PermissionResource.MAINTENANCE,
      PermissionAction.LIST,
      roleBasedContext
    ),
    requireActiveTenant('maintenanceRequests'),
    validateRequest({ params: UtilsValidations.cuid, query: MaintenanceValidations.listQuery }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<MaintenanceController>('maintenanceController');
      return controller.listRequests(req, res);
    })
  );

router.get(
  '/:cuid/stats',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.STATS),
  requireActiveTenant('maintenanceRequests'),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.getStats(req, res);
  })
);

router.get(
  '/:cuid/:mruid',
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.READ,
    roleBasedContext
  ),
  requireActiveTenant('maintenanceRequests'),
  validateRequest({ params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam) }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.getRequest(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/vendor_assignment',
  basicLimiter(),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  subscriptionEntitlements,
  requireFeature('MaintenanceRequestService'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.assignBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.assignVendor(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/assignment',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('MaintenanceRequestService'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.assignmentBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.respondToAssignment(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/status',
  basicLimiter(),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  requireActiveTenant('maintenanceRequests'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.statusBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.updateStatus(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/update_request',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  requireActiveTenant('maintenanceRequests'),
  requireActiveTenant('maintenanceRequests'),
  idempotency,
  diskUpload(['media[*][file]']),
  scanFile,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.updateBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.updateRequest(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/mark_work_done',
  basicLimiter(),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  requireActiveTenant('maintenanceRequests'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.completeBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.markWorkDone(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/finalize',
  basicLimiter(),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.finalizeCompletion(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/tenant_feedback',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.tenantFeedbackBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.submitTenantFeedback(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/ai_suggestion/accept',
  basicLimiter(),
  // Manager+ only — vendors/tenants are excluded via service-layer role check.
  // requirePermissionWithContext additionally restricts non-managers to their own resources.
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.acceptAISuggestion(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/ai_suggestion/dismiss',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.dismissAISuggestion(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/cancel_request',
  basicLimiter(),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  requireActiveTenant('maintenanceRequests'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.cancelBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.cancelRequest(req, res);
  })
);

router.post(
  '/:cuid/:mruid/work_order',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('MaintenanceRequestService'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.workOrderBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.submitWorkOrder(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/work_order_review',
  basicLimiter(),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  subscriptionEntitlements,
  requireFeature('MaintenanceRequestService'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.workOrderReviewBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.reviewWorkOrder(req, res);
  })
);

router.post(
  '/:cuid/:mruid/scan_invoice',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('MaintenanceRequestService'),
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
  }),
  diskUpload(['invoice']),
  scanFile,
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.scanInvoice(req, res);
  })
);

router.post(
  '/:cuid/:mruid/create_invoice',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('MaintenanceRequestService'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.invoiceBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.submitInvoice(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/invoice_review',
  basicLimiter(),
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  subscriptionEntitlements,
  requireFeature('MaintenanceRequestService'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.invoiceReviewBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.reviewInvoice(req, res);
  })
);

// ── Dev-only: flush an idempotency key so the same form action can be retried ─
if (process.env.NODE_ENV !== 'production') {
  router.delete(
    '/:cuid/dev/idempotency-key',
    isAuthenticated,
    asyncWrapper(async (req: AppRequest, res) => {
      const { cuid } = req.params;
      const { method = 'PATCH', routePath, idempotencyKey } = req.query as Record<string, string>;
      if (!routePath || !idempotencyKey) {
        return res
          .status(400)
          .json({ success: false, message: 'routePath and idempotencyKey are required' });
      }
      const cache =
        req.container.resolve<import('@caching/idempotency.cache').IdempotencyCache>(
          'idempotencyCache'
        );
      await cache.deleteRouteKey(
        method,
        routePath,
        req.context!.currentuser.sub,
        cuid,
        idempotencyKey
      );
      return res.status(200).json({ success: true, message: 'Idempotency key flushed' });
    })
  );
}

export default router;
