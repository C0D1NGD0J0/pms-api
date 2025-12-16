import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { LeaseController } from '@controllers/LeaseController';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import { UtilsValidations, LeaseValidations, validateRequest } from '@shared/validations/index';
import {
  requirePermission,
  isAuthenticated,
  basicLimiter,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

const router = Router();
router.use(isAuthenticated, basicLimiter());

router.get(
  '/:cuid/stats',
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
    query: LeaseValidations.statsQuery,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.getLeaseStats(req, res);
  })
);

router.get(
  '/:cuid/expiring',
  // Get leases expiring within X days
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.getExpiringLeases(req, res);
  })
);

router.get(
  '/:cuid/templates',
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.getLeaseTemplates(req, res);
  })
);

router
  .route('/:cuid')
  .get(
    requirePermission(PermissionResource.LEASE, PermissionAction.LIST),
    validateRequest({
      params: UtilsValidations.cuid,
      query: LeaseValidations.filterLeases,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.getFilteredLeases(req, res);
    })
  )
  .post(
    requirePermission(PermissionResource.LEASE, PermissionAction.CREATE),
    diskUpload(['document']),
    scanFile,
    validateRequest({
      params: UtilsValidations.cuid,
      body: LeaseValidations.createLease,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.createLease(req, res);
    })
  );

// PDF Generation Routes (MUST be before /:cuid/:leaseId to avoid route conflicts)
router.post(
  '/:cuid/:leaseId/pdf',
  // Generate PDF from lease JSON data using Puppeteer + EJS template
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuidAndLeaseId,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.generateLeasePDF(req, res);
  })
);

router.get(
  '/pdf-status/:jobId',
  // Get PDF generation job status
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.getPdfJobStatus(req, res);
  })
);

router
  .route('/:cuid/:luid')
  .get(
    requirePermission(PermissionResource.LEASE, PermissionAction.READ),
    validateRequest({
      params: UtilsValidations.cuid.merge(UtilsValidations.luid),
      query: LeaseValidations.filterLeases,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.getLeaseById(req, res);
    })
  )
  .patch(
    requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
    diskUpload(['document']),
    scanFile,
    validateRequest({
      params: UtilsValidations.cuid.merge(UtilsValidations.luid),
      body: LeaseValidations.updateLease,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.updateLease(req, res);
    })
  )
  .delete(
    requirePermission(PermissionResource.LEASE, PermissionAction.DELETE),
    validateRequest({
      params: UtilsValidations.cuid.merge(UtilsValidations.luid),
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.deleteLease(req, res);
    })
  );

// Lifecycle Management Routes
router.post(
  '/:cuid/:luid/activate',
  // Activate lease (after all signatures complete, marks unit as occupied)
  requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.luid),
    body: LeaseValidations.activateLease,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.activateLease(req, res);
  })
);

router.post(
  '/:cuid/:luid/terminate',
  // Terminate lease early (tenant moves out before end date)
  requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.luid),
    body: LeaseValidations.terminateLease,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.terminateLease(req, res);
  })
);

// Document Management Routes
router
  .route('/:cuid/:luid/document')
  .post(
    // Upload additional lease document (e.g., addendum, manual signed copy)
    requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
    diskUpload(['document']),
    scanFile,
    validateRequest({
      params: UtilsValidations.cuid.merge(UtilsValidations.luid),
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.uploadLeaseDocument(req, res);
    })
  )
  .get(
    // Get/download lease document
    requirePermission(PermissionResource.LEASE, PermissionAction.READ),
    validateRequest({
      params: UtilsValidations.cuid,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.getLeaseDocument(req, res);
    })
  )
  .delete(
    // Remove lease document
    requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
    validateRequest({
      params: UtilsValidations.cuid,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.removeLeaseDocument(req, res);
    })
  );

// Signature Management Routes
router
  .route('/:cuid/:luid/signature_request')
  .post(
    // Send for e-signature OR mark as manually signed OR cancel signing
    requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
    validateRequest({
      params: UtilsValidations.cuid.merge(UtilsValidations.luid),
      body: LeaseValidations.signatureAction,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');

      return controller.handleSignatureAction(req, res);
    })
  )
  .get(
    // Get signature status + signing URL
    // Returns: { status, signUrl, signers, completedAt, sentAt }
    requirePermission(PermissionResource.LEASE, PermissionAction.READ),
    validateRequest({
      params: UtilsValidations.cuid.merge(UtilsValidations.luid),
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.getSignatureDetails(req, res);
    })
  );

// PDF Generation Routes
router.post(
  '/:cuid/:luid/pdf',
  // Generate PDF from lease JSON data using Puppeteer + EJS template
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.luid),
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.generateLeasePDF(req, res);
  })
);

router.get(
  '/:cuid/:luid/pdf/download',
  // Download generated PDF (triggers browser download)
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.luid),
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.downloadLeasePDF(req, res);
  })
);

router.get(
  '/:cuid/:luid/preview_lease',
  // Preview lease document HTML with provided data
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.luid),
    body: LeaseValidations.previewLease,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.previewLeaseContract(req, res);
  })
);

router.post(
  '/:cuid/:luid/lease_renewal',
  requirePermission(PermissionResource.LEASE, PermissionAction.CREATE),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.luid),
    body: LeaseValidations.renewLease,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.renewLease(req, res);
  })
);

export default router;
