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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
  isAuthenticated,
  requirePermission(PermissionResource.PROPERTY, PermissionAction.READ),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
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
  basicLimiter(),
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.READ),
  validateRequest({
    params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
    query: ClientValidations.tenantDetailsIncludeQuery,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getClientTenantDetails(req, res);
  })
);

router
  .route('/:cuid/tenant_details/:uid')
  .get(
    basicLimiter(),
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
    basicLimiter(),
    isAuthenticated,
    requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
    diskUpload(['documents.items[*].file', 'personalInfo.avatar.file']),
    scanFile,
    validateRequest({
      params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
      body: ClientValidations.updateTenantProfile,
    }),
    asyncWrapper((req, res) => {
      const userController = req.container.resolve<UserController>('userController');
      return userController.updateTenantProfile(req, res);
    })
  )
  .delete(
    basicLimiter(),
    isAuthenticated,
    requirePermission(PermissionResource.USER, PermissionAction.DELETE),
    validateRequest({
      params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
    }),
    asyncWrapper((req, res) => {
      const userController = req.container.resolve<UserController>('userController');
      return userController.deactivateTenant(req, res);
    })
  );

router.delete(
  '/:cuid/:uid',
  basicLimiter(),
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
