import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { UserController } from '@controllers/UserController';
import { VendorController } from '@controllers/VendorController';
import { requirePermission, isAuthenticated } from '@shared/middlewares';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  ClientValidations,
  VendorValidations,
  UtilsValidations,
  validateRequest,
} from '@shared/validations';

const router = Router();

router.get(
  '/:cuid/vendors/stats',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.clientIdParam,
    query: VendorValidations.vendorFilterQuery.pick({ status: true }),
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

// Single vendor details endpoint
router.get(
  '/:cuid/vendor_details/:vuid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.vuid),
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getSingleVendor(req, res);
  })
);

router.get(
  '/:cuid/vendor_members/:vuid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getVendorTeamMembers(req, res);
  })
);

export default router;
