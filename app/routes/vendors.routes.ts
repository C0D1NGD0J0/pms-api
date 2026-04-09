import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { VendorController } from '@controllers/VendorController';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import {
  requirePermissionWithContext,
  requirePermission,
  isAuthenticated,
  basicLimiter,
} from '@shared/middlewares';
import {
  ClientValidations,
  VendorValidations,
  UtilsValidations,
  validateRequest,
} from '@shared/validations';

const router = Router();
router.use(basicLimiter());

router.get(
  '/:cuid/vendors/stats',
  isAuthenticated,
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
  isAuthenticated,
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
  isAuthenticated,
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
  isAuthenticated,
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

// Get vendor business data for editing (primaryAccountHolder only)
router.get(
  '/:cuid/vendor/:vuid/edit',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getVendorForEdit(req, res);
  })
);

// Update team member profile fields (ADMIN/MANAGER or primaryAccountHolder)
router.patch(
  '/:cuid/vendor/:vuid/team_members/:uid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
    body: VendorValidations.updateTeamMember,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.updateTeamMember(req, res);
  })
);

// Toggle team member active status (ADMIN/MANAGER or primaryAccountHolder)
router.patch(
  '/:cuid/vendor/:vuid/team_members/:uid/status',
  basicLimiter(),
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
    body: VendorValidations.toggleTeamMemberStatus,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.toggleTeamMemberStatus(req, res);
  })
);

// Update vendor business details (primaryAccountHolder only)
router.patch(
  '/:cuid/vendor/:vuid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(UtilsValidations.vuid),
    body: VendorValidations.updateVendor,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.updateVendorDetails(req, res);
  })
);

export default router;
