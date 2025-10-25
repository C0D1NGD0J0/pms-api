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

router
  .route('/:cuid')
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
  )
  .get(
    // Get all leases (with optional filters via query params)
    requirePermission(PermissionResource.LEASE, PermissionAction.READ),
    validateRequest({
      params: UtilsValidations.cuid,
      query: LeaseValidations.filterLeases,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.getFilteredLeases(req, res);
    })
  );

router
  .route('/:cuid/:leaseId')
  .get(
    // Get single lease by ID
    requirePermission(PermissionResource.LEASE, PermissionAction.READ),
    validateRequest({
      params: UtilsValidations.cuid,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.getLeaseById(req, res);
    })
  )
  .patch(
    // Update existing lease
    requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
    diskUpload(['document']),
    scanFile,
    validateRequest({
      params: UtilsValidations.cuid,
      body: LeaseValidations.updateLease,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.updateLease(req, res);
    })
  )
  .delete(
    // Soft delete lease
    requirePermission(PermissionResource.LEASE, PermissionAction.DELETE),
    validateRequest({
      params: UtilsValidations.cuid,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.deleteLease(req, res);
    })
  );

// Lifecycle Management Routes
router.post(
  '/:cuid/:leaseId/activate',
  // Activate lease (after all signatures complete, marks unit as occupied)
  requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
  validateRequest({
    params: UtilsValidations.cuid,
    body: LeaseValidations.activateLease,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.activateLease(req, res);
  })
);

router.post(
  '/:cuid/:leaseId/terminate',
  // Terminate lease early (tenant moves out before end date)
  requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
  validateRequest({
    params: UtilsValidations.cuid,
    body: LeaseValidations.terminateLease,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.terminateLease(req, res);
  })
);

// Document Management Routes
router
  .route('/:cuid/:leaseId/document')
  .post(
    // Upload additional lease document (e.g., addendum, manual signed copy)
    requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
    diskUpload(['document']),
    scanFile,
    validateRequest({
      params: UtilsValidations.cuid,
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
  .route('/:cuid/:leaseId/signature')
  .post(
    // Send for e-signature OR mark as manually signed OR cancel signing
    requirePermission(PermissionResource.LEASE, PermissionAction.UPDATE),
    validateRequest({
      params: UtilsValidations.cuid,
      body: LeaseValidations.signatureAction,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      // const { action } = req.body;
      // switch (action) {
      //   case 'send': return controller.sendLeaseForSignature(req, res);
      //   case 'manual': return controller.markAsManualySigned(req, res);
      //   case 'cancel': return controller.cancelSignature(req, res);
      return controller.handleSignatureAction(req, res);
    })
  )
  .get(
    // Get signature status + signing URL
    // Returns: { status, signUrl, signers, completedAt, sentAt }
    requirePermission(PermissionResource.LEASE, PermissionAction.READ),
    validateRequest({
      params: UtilsValidations.cuid,
    }),
    asyncWrapper(async (req: AppRequest, res) => {
      const controller = req.container.resolve<LeaseController>('leaseController');
      return controller.getSignatureDetails(req, res);
    })
  );

// PDF Generation Routes
router.post(
  '/:cuid/:leaseId/pdf',
  // Generate PDF from lease JSON data using Puppeteer + EJS template
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.generateLeasePDF(req, res);
  })
);

router.get(
  '/:cuid/:leaseId/pdf/preview',
  // Preview HTML template before PDF generation (for debugging/testing)
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.previewLeaseHTML(req, res);
  })
);

router.get(
  '/:cuid/:leaseId/pdf/download',
  // Download generated PDF (triggers browser download)
  requirePermission(PermissionResource.LEASE, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<LeaseController>('leaseController');
    return controller.downloadLeasePDF(req, res);
  })
);

router.get(
  '/:cuid/stats',
  // Get lease statistics (active/pending/expired counts, occupancy rates)
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

export default router;
