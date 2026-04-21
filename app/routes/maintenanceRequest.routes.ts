import express, { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { MaintenanceValidations } from '@shared/validations/index';
import { MaintenanceController } from '@controllers/MaintenanceController';
import { UtilsValidations, validateRequest } from '@shared/validations/index';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import {
  requirePermissionWithContext,
  subscriptionEntitlements,
  requireActiveTenant,
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

// Public webhook route — must be declared before isAuthenticated
// WARNING: HMAC signature verification is stubbed (Phase 2). Do not expose without network-level protection.
router.post(
  '/webhooks/invoice/:source',
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

router.use(isAuthenticated, basicLimiter());
router
  .route('/:cuid')
  .post(
    requirePermission(PermissionResource.MAINTENANCE, PermissionAction.CREATE),
    requireActiveTenant('maintenanceRequests'),
    subscriptionEntitlements,
    requireFeature('RepairRequestService'),
    idempotency,
    diskUpload(['media[*].file']),
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
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  subscriptionEntitlements,
  requireFeature('RepairRequestService'),
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
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('RepairRequestService'),
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
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  requireActiveTenant('maintenanceRequests'),
  idempotency,
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
  '/:cuid/:mruid/complete_request',
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  requireActiveTenant('maintenanceRequests'),
  idempotency,
  validateRequest({
    params: UtilsValidations.cuid.merge(MaintenanceValidations.mruidParam),
    body: MaintenanceValidations.completeBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MaintenanceController>('maintenanceController');
    return controller.completeRequest(req, res);
  })
);

router.patch(
  '/:cuid/:mruid/cancel_request',
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
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('RepairRequestService'),
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
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  subscriptionEntitlements,
  requireFeature('RepairRequestService'),
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
  '/:cuid/:mruid/create_invoice',
  requirePermissionWithContext(
    PermissionResource.MAINTENANCE,
    PermissionAction.UPDATE,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('RepairRequestService'),
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
  requirePermission(PermissionResource.MAINTENANCE, PermissionAction.UPDATE),
  subscriptionEntitlements,
  requireFeature('RepairRequestService'),
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

export default router;
