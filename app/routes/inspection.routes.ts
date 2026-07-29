import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { FeatureFlag } from '@interfaces/featureFlag.interface';
import { InspectionController } from '@controllers/InspectionController';
import { UtilsValidations, validateRequest } from '@shared/validations/index';
import { InspectionValidations } from '@shared/validations/InspectionValidation';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import {
  requirePermissionWithContext,
  subscriptionEntitlements,
  requireVerifiedClient,
  requireNotSuspended,
  requireFeatureFlag,
  requirePermission,
  roleBasedContext,
  isAuthenticated,
  requireFeature,
  basicLimiter,
  idempotency,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

const router = Router();
router.use(isAuthenticated, basicLimiter());

router
  .route('/:cuid')
  .post(
    requireNotSuspended,
    requirePermission(PermissionResource.INSPECTION, PermissionAction.CREATE),
    requireVerifiedClient,
    subscriptionEntitlements,
    requireFeature('inspectionService'),
    requireFeatureFlag(FeatureFlag.INSPECTION),
    idempotency,
    validateRequest({ params: UtilsValidations.cuid, body: InspectionValidations.createBody }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<InspectionController>('inspectionController');
      return controller.scheduleInspection(req, res);
    })
  )
  .get(
    requirePermissionWithContext(
      PermissionResource.INSPECTION,
      PermissionAction.LIST,
      roleBasedContext
    ),
    validateRequest({ params: UtilsValidations.cuid, query: InspectionValidations.listQuery }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<InspectionController>('inspectionController');
      return controller.listInspections(req, res);
    })
  );

router.get(
  '/:cuid/:iuid/ai-analysis',
  requirePermissionWithContext(
    PermissionResource.INSPECTION,
    PermissionAction.READ,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('aiInspectionAnalysis'),
  requireFeatureFlag(FeatureFlag.AI_INSPECTION_ANALYSIS),
  validateRequest({ params: InspectionValidations.iuidParam }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.getAIAnalysis(req, res);
  })
);

router.post(
  '/:cuid/:iuid/ai-analysis',
  requireNotSuspended,
  requirePermission(PermissionResource.INSPECTION, PermissionAction.MANAGE),
  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('aiInspectionAnalysis'),
  requireFeatureFlag(FeatureFlag.AI_INSPECTION_ANALYSIS),
  validateRequest({ params: InspectionValidations.iuidParam }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.triggerAIAnalysis(req, res);
  })
);

router.get(
  '/:cuid/:iuid/report',
  requirePermissionWithContext(
    PermissionResource.INSPECTION,
    PermissionAction.READ,
    roleBasedContext
  ),
  subscriptionEntitlements,
  requireFeature('inspectionService'),
  validateRequest({
    params: InspectionValidations.iuidParam,
    query: InspectionValidations.reportQuery,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.generateReport(req, res);
  })
);

router
  .route('/:cuid/:iuid')
  .get(
    requirePermissionWithContext(
      PermissionResource.INSPECTION,
      PermissionAction.READ,
      roleBasedContext
    ),
    validateRequest({ params: InspectionValidations.iuidParam }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<InspectionController>('inspectionController');
      return controller.getInspection(req, res);
    })
  )
  .patch(
    requireNotSuspended,
    requirePermissionWithContext(
      PermissionResource.INSPECTION,
      PermissionAction.UPDATE,
      roleBasedContext
    ),
    requireVerifiedClient,
    subscriptionEntitlements,
    requireFeature('inspectionService'),
    requireFeatureFlag(FeatureFlag.INSPECTION),
    diskUpload(['media[*].file']),
    scanFile,
    validateRequest({
      params: InspectionValidations.iuidParam,
      body: InspectionValidations.updateBody,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<InspectionController>('inspectionController');
      return controller.updateInspection(req, res);
    })
  )
  .delete(
    requireNotSuspended,
    requirePermission(PermissionResource.INSPECTION, PermissionAction.DELETE),
    requireVerifiedClient,
    subscriptionEntitlements,
    requireFeature('inspectionService'),
    requireFeatureFlag(FeatureFlag.INSPECTION),
    validateRequest({ params: InspectionValidations.iuidParam }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<InspectionController>('inspectionController');
      return controller.deleteInspection(req, res);
    })
  );

router.patch(
  '/:cuid/:iuid/submit',
  requireNotSuspended,
  requirePermissionWithContext(
    PermissionResource.INSPECTION,
    PermissionAction.UPDATE,
    roleBasedContext
  ),

  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('inspectionService'),
  requireFeatureFlag(FeatureFlag.INSPECTION),
  diskUpload(['media[*].file']),
  scanFile,
  validateRequest({ params: InspectionValidations.iuidParam }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.submitInspection(req, res);
  })
);

router.patch(
  '/:cuid/:iuid/approve',
  requireNotSuspended,
  requirePermission(PermissionResource.INSPECTION, PermissionAction.MANAGE),
  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('inspectionService'),
  requireFeatureFlag(FeatureFlag.INSPECTION),
  validateRequest({
    params: InspectionValidations.iuidParam,
    body: InspectionValidations.approveBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.approveInspection(req, res);
  })
);

router.patch(
  '/:cuid/:iuid/reject',
  requireNotSuspended,
  requirePermission(PermissionResource.INSPECTION, PermissionAction.MANAGE),
  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('inspectionService'),
  requireFeatureFlag(FeatureFlag.INSPECTION),
  validateRequest({
    params: InspectionValidations.iuidParam,
    body: InspectionValidations.rejectBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.rejectInspection(req, res);
  })
);

router.patch(
  '/:cuid/:iuid/acknowledge',
  requireNotSuspended,
  requirePermissionWithContext(
    PermissionResource.INSPECTION,
    PermissionAction.UPDATE,
    roleBasedContext
  ),

  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('inspectionService'),
  requireFeatureFlag(FeatureFlag.INSPECTION),
  validateRequest({ params: InspectionValidations.iuidParam }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.acknowledgeInspection(req, res);
  })
);

router.patch(
  '/:cuid/:iuid/dispute',
  requireNotSuspended,
  requirePermissionWithContext(
    PermissionResource.INSPECTION,
    PermissionAction.UPDATE,
    roleBasedContext
  ),

  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('inspectionService'),
  requireFeatureFlag(FeatureFlag.INSPECTION),
  validateRequest({
    params: InspectionValidations.iuidParam,
    body: InspectionValidations.disputeBody,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.disputeInspection(req, res);
  })
);

router.patch(
  '/:cuid/:iuid/cancel',
  requireNotSuspended,
  requirePermission(PermissionResource.INSPECTION, PermissionAction.UPDATE),
  requireVerifiedClient,
  subscriptionEntitlements,
  requireFeature('inspectionService'),
  requireFeatureFlag(FeatureFlag.INSPECTION),
  validateRequest({ params: InspectionValidations.iuidParam }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<InspectionController>('inspectionController');
    return controller.cancelInspection(req, res);
  })
);

export default router;
