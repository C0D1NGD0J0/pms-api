import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { UserController } from '@controllers/UserController';
import { ClientController } from '@controllers/ClientController';
import { PropertyController } from '@controllers/PropertyController';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  requireUserManagement,
  requirePermission,
  isAuthenticated,
  basicLimiter,
  diskUpload,
  scanFile,
} from '@shared/middlewares';
import {
  PropertyValidations,
  ProfileValidations,
  ClientValidations,
  UtilsValidations,
  UserValidations,
  validateRequest,
} from '@shared/validations';

const router = Router();

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
  basicLimiter(),
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
  basicLimiter(),
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
  '/:cuid/profile_details',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
    query: UserValidations.userIdParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getUserProfile(req, res);
  })
);

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

router.patch(
  '/:cuid/update_profile',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
  diskUpload(['documents.items[*].file', 'personalInfo.avatar.file']),
  scanFile,
  validateRequest({
    body: ProfileValidations.profileUpdate,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.updateUserProfile(req, res);
  })
);

router.get(
  '/:cuid/notification-preferences',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
    query: UserValidations.userIdParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getNotificationPreferences(req, res);
  })
);

router.get(
  '/:cuid/filtered-tenants',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.clientIdParam,
    query: UserValidations.userFilterQuery,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getFilteredTenants(req, res);
  })
);

router.get(
  '/:cuid/stats',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getTenantsStats(req, res);
  })
);

router.get(
  '/:cuid/client_tenant/:uid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
    // Query params: ?include=lease,payments,maintenance,documents,notes
    // ?include=all for everything
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getClientTenantDetails(req, res);
  })
);

router
  .route('/:cuid/tenant_details/:uid')
  .get(
    isAuthenticated,
    requirePermission(PermissionResource.USER, PermissionAction.READ),
    validateRequest({
      params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
    }),
    asyncWrapper((req, res) => {
      const userController = req.container.resolve<UserController>('userController');
      return userController.getTenantUserInfo(req, res);
    })
  )
  .patch(
    isAuthenticated,
    requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
    diskUpload(['documents.items[*].file', 'personalInfo.avatar.file']),
    scanFile,
    validateRequest({
      params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
    }),
    asyncWrapper((req, res) => {
      const userController = req.container.resolve<UserController>('userController');
      return userController.updateTenantProfile(req, res);
    })
  );

router.delete(
  '/:cuid/:uid',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.DELETE),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.archiveUser(req, res);
  })
);

export default router;
