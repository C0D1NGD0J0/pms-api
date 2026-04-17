import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
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
  requirePrimaryVendor,
  requirePermission,
  isAuthenticated,
  basicLimiter,
  idempotency,
} from '@shared/middlewares';

const router = Router();
router.use(isAuthenticated, basicLimiter());

router.get(
  '/:cuid/vendors/stats',
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
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
  '/:cuid/filteredVendors',
  requirePermission(PermissionResource.USER, PermissionAction.READ),
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
  '/:cuid/vendor_details/:vuid',
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
  '/:cuid/team_members/:vuid',
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
  '/:cuid/vendor/:vuid/edit',
  requirePermission(PermissionResource.USER, PermissionAction.READ),
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
  '/:cuid/vendor/:vuid/team_members/:uid',
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
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
  '/:cuid/vendor/:vuid/team_members/:uid/status',
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
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
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
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

// ── Payout account endpoints ──────────────────────────────────────────────────

// Initiate payout account onboarding (creates provider account record)
// Restricted to primary vendor account holders only
router.post(
  '/:cuid/vendor/:vuid/payout_account/initiate',
  requirePrimaryVendor,
  idempotency,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.initiatePayoutOnboarding(req, res);
  })
);

// Get provider-hosted KYC onboarding link
// Restricted to primary vendor account holders only
router.get(
  '/:cuid/vendor/:vuid/payout_account/link',
  requirePrimaryVendor,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getPayoutOnboardingLink(req, res);
  })
);

// Sync payout account status from provider
// Restricted to primary vendor account holders only
router.post(
  '/:cuid/vendor/:vuid/payout_account/sync',
  requirePrimaryVendor,
  idempotency,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.syncPayoutAccountStatus(req, res);
  })
);

// Get Stripe Express Dashboard login link for payout management
// Restricted to primary vendor account holders only
router.get(
  '/:cuid/vendor/:vuid/payout_account/dashboard',
  requirePrimaryVendor,
  validateRequest({ params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid) }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getPayoutDashboardLink(req, res);
  })
);

export default router;
