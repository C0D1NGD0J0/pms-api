import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { UserController } from '@controllers/UserController';
import { ClientController } from '@controllers/ClientController';
import { VendorController } from '@controllers/VendorController';
import { PropertyController } from '@controllers/PropertyController';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  requireUserManagement,
  requirePermission,
  isAuthenticated,
  routeLimiter,
} from '@shared/middlewares';
import {
  PropertyValidations,
  ClientValidations,
  UtilsValidations,
  UserValidations,
  validateRequest,
} from '@shared/validations';

const router = Router();

router.get(
  '/:cuid/user_details/:uid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: UserValidations.userUidParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getClientUserInfo(req, res);
  })
);

router.get(
  '/:cuid/users',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getFilteredUsers(req, res);
  })
);

router.get(
  '/:cuid/filtered-users',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.clientIdParam,
    query: ClientValidations.filteredUsersQuery,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getFilteredUsers(req, res);
  })
);

router.get(
  '/:cuid/users/stats',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: UtilsValidations.cuid,
    query: ClientValidations.filteredUsersQuery,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getUserStats(req, res);
  })
);

router.get(
  '/:cuid/users/by-role',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.roleParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getUsersByRole(req, res);
  })
);

router.get(
  '/:cuid/users/:uid/roles',
  isAuthenticated,
  requireUserManagement(),
  validateRequest({
    params: ClientValidations.userIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.getUserRoles(req, res);
  })
);

router.post(
  '/:cuid/users/:uid/roles',
  isAuthenticated,
  requireUserManagement(),
  validateRequest({
    params: ClientValidations.userIdParam,
    body: ClientValidations.assignRole,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.assignUserRole(req, res);
  })
);

router.delete(
  '/:cuid/users/:uid/roles/:role',
  isAuthenticated,
  requireUserManagement(),
  validateRequest({
    params: ClientValidations.roleParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.removeUserRole(req, res);
  })
);

router.get(
  '/:cuid/property_managers',
  isAuthenticated,
  requirePermission(PermissionResource.PROPERTY, PermissionAction.READ),
  routeLimiter(),
  validateRequest({
    params: PropertyValidations.validatecuid,
    query: PropertyValidations.getAssignableUsers,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getAssignableUsers(req, res);
  })
);

router.get(
  '/:cuid/vendor_members/:uid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const vendorController = req.container.resolve<VendorController>('vendorController');
    return vendorController.getVendorTeamMembers(req, res);
  })
);

export default router;
