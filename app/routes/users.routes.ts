import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { UserController } from '@controllers/UserController';
import { ClientController } from '@controllers/ClientController';
import { PropertyController } from '@controllers/PropertyController';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { PropertyValidations, ClientValidations, validateRequest } from '@shared/validations';
import {
  requireUserManagement,
  requirePermission,
  isAuthenticated,
  routeLimiter,
} from '@shared/middlewares';

const router = Router();

router.get(
  '/:cuid/user/:uid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.userIdParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getClientUser(req, res);
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

export default router;
