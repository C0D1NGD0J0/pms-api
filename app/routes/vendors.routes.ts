import { t } from '@shared/languages';
import { asyncWrapper } from '@utils/index';
import { ForbiddenError } from '@shared/customErrors';
import { NextFunction, Response, Router } from 'express';
import { VendorController } from '@controllers/VendorController';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import {
  ClientValidations,
  VendorValidations,
  UtilsValidations,
  validateRequest,
} from '@shared/validations';
import {
  requirePermissionWithContext,
  requireActiveSubscription,
  subscriptionEntitlements,
  requirePrimaryVendor,
  requirePermission,
  isAuthenticated,
  requireFeature,
  basicLimiter,
  idempotency,
} from '@shared/middlewares';

const router = Router();
router.use(isAuthenticated);

/**
 * Payout accounts belong to a single vendor organisation. The caller's own vuid is resolved
 * server-side (currentuser.vendorInfo.vuid), so a primary vendor cannot act on another
 * vendor's payout account by swapping :vuid. Must be placed after requirePrimaryVendor.
 */
const requireOwnVendorPayoutAccount = (req: AppRequest, _res: Response, next: NextFunction) => {
  const ownVuid = req.context?.currentuser?.vendorInfo?.vuid;
  if (!ownVuid || ownVuid !== req.params.vuid) {
    return next(
      new ForbiddenError({
        message: t('common.errors.insufficientPermissions', {
          resource: 'payout',
          action: 'manage',
          reason: "Vendors can only manage their own organisation's payout account",
        }),
      })
    );
  }
  next();
};

router.get(
  '/:cuid/vendors/stats',
  basicLimiter(),
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  subscriptionEntitlements,
  requireFeature('vendorManagement'),
  validateRequest({
    params: ClientValidations.clientIdParam,
    query: VendorValidations.vendorFilterQuery,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getVendorStats(req, res);
  })
);

router.get(
  '/:cuid',
  basicLimiter(),
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  subscriptionEntitlements,
  requireFeature('vendorManagement'),
  validateRequest({
    params: ClientValidations.clientIdParam,
    query: VendorValidations.vendorFilterQuery,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getFilteredVendors(req, res);
  })
);

// Single vendor details endpoint — vendors read their own record (mine), managers use any
router.get(
  '/:cuid/:vuid',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.USER,
    PermissionAction.READ,
    (req: AppRequest) => {
      if (req.context?.currentuser?.client?.role === 'vendor') {
        return { resourceId: req.params.vuid, ownerId: req.context.currentuser.sub };
      }
      return { resourceId: req.params.vuid };
    }
  ),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.vuid),
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getSingleVendor(req, res);
  })
);

// Team members — managers use vendor:list:any; primary vendor uses vendor:list:mine
router.get(
  '/:cuid/:vuid/team',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.VENDOR,
    PermissionAction.LIST,
    (req: AppRequest) => {
      if (req.context?.currentuser?.client?.role === 'vendor') {
        return { ownerId: req.context.currentuser.sub };
      }
      return {};
    }
  ),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getVendorTeamMembers(req, res);
  })
);

// Get vendor business data for editing (primaryAccountHolderUserId only)
router.get(
  '/:cuid/:vuid/form',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.USER,
    PermissionAction.READ,
    (req: AppRequest) => {
      if (req.context?.currentuser?.client?.role === 'vendor') {
        return { resourceId: req.params.vuid, ownerId: req.context.currentuser.sub };
      }
      return { resourceId: req.params.vuid };
    }
  ),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getVendorForEdit(req, res);
  })
);

// Update team member profile fields (ADMIN/MANAGER or primaryAccountHolderUserId)
router.patch(
  '/:cuid/:vuid/team/:uid',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.USER,
    PermissionAction.UPDATE,
    (req: AppRequest) => {
      if (req.context?.currentuser?.client?.role === 'vendor') {
        return { resourceId: req.params.uid, ownerId: req.context.currentuser.sub };
      }
      return { resourceId: req.params.uid };
    }
  ),
  idempotency,
  validateRequest({
    params: ClientValidations.clientIdParam
      .merge(UtilsValidations.vuid)
      .merge(UtilsValidations.uid),
    body: VendorValidations.updateTeamMember,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.updateTeamMember(req, res);
  })
);

// Toggle team member active status (ADMIN/MANAGER or primaryAccountHolderUserId)
router.patch(
  '/:cuid/:vuid/team/:uid/status',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.USER,
    PermissionAction.UPDATE,
    (req: AppRequest) => {
      if (req.context?.currentuser?.client?.role === 'vendor') {
        return { resourceId: req.params.uid, ownerId: req.context.currentuser.sub };
      }
      return { resourceId: req.params.uid };
    }
  ),
  idempotency,
  validateRequest({
    params: ClientValidations.clientIdParam
      .merge(UtilsValidations.vuid)
      .merge(UtilsValidations.uid),
    body: VendorValidations.toggleTeamMemberStatus,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.toggleTeamMemberStatus(req, res);
  })
);

// Update vendor business details (primaryAccountHolderUserId only)
router.patch(
  '/:cuid/vendor/:vuid',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.USER,
    PermissionAction.UPDATE,
    (req: AppRequest) => {
      if (req.context?.currentuser?.client?.role === 'vendor') {
        return { resourceId: req.params.vuid, ownerId: req.context.currentuser.sub };
      }
      return { resourceId: req.params.vuid };
    }
  ),
  requireActiveSubscription,
  idempotency,
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
    body: VendorValidations.updateVendor,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.updateVendorDetails(req, res);
  })
);

// Vendor reviews — confirmed tenant feedback with ratings
router.get(
  '/:cuid/vendor/:vuid/reviews',
  basicLimiter(),
  requirePermissionWithContext(
    PermissionResource.USER,
    PermissionAction.READ,
    (req: AppRequest) => {
      if (req.context?.currentuser?.client?.role === 'vendor') {
        return { resourceId: req.params.vuid, ownerId: req.context.currentuser.sub };
      }
      return { resourceId: req.params.vuid };
    }
  ),
  subscriptionEntitlements,
  requireActiveSubscription,
  requireFeature('vendorManagement'),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
    query: VendorValidations.vendorReviewsQuery,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getVendorReviews(req, res);
  })
);

// ── Payout account endpoints ──────────────────────────────────────────────────

// Initiate payout account onboarding (creates provider account record)
// Restricted to the primary account holder of the vendor identified by :vuid
router.post(
  '/:cuid/vendor/:vuid/payout_account/initiate',
  basicLimiter(),
  requirePrimaryVendor,
  requireOwnVendorPayoutAccount,
  idempotency,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.initiatePayoutOnboarding(req, res);
  })
);

// Get provider-hosted KYC onboarding link
// Restricted to the primary account holder of the vendor identified by :vuid
router.get(
  '/:cuid/vendor/:vuid/payout_account/link',
  basicLimiter(),
  requirePrimaryVendor,
  requireOwnVendorPayoutAccount,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getPayoutOnboardingLink(req, res);
  })
);

// Sync payout account status from provider
// Restricted to the primary account holder of the vendor identified by :vuid
router.post(
  '/:cuid/vendor/:vuid/payout_account/sync',
  basicLimiter(),
  requirePrimaryVendor,
  requireOwnVendorPayoutAccount,
  idempotency,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.syncPayoutAccountStatus(req, res);
  })
);

// Get Stripe Express Dashboard login link for payout management
// Restricted to the primary account holder of the vendor identified by :vuid
router.get(
  '/:cuid/vendor/:vuid/payout_account/dashboard',
  basicLimiter(),
  requirePrimaryVendor,
  requireOwnVendorPayoutAccount,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getPayoutDashboardLink(req, res);
  })
);

export default router;
