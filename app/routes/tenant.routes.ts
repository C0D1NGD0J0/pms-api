import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { UserController } from '@controllers/index';
import { requirePermission, isAuthenticated } from '@shared/middlewares';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { ClientValidations, validateRequest, UserValidations } from '@shared/validations';

const router = Router();

router.get(
  '/:cuid/filteredTenants',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.clientIdParam,
    query: UserValidations.userFilterQuery,
  }),
  asyncWrapper((req, res) => {
    const userController = req.container.resolve<UserController>('userController');
    return userController.getFilteredUsers(req, res);
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

router
  .route('/:cuid/tenant_details/:uid')
  .get(
    isAuthenticated,
    requirePermission(PermissionResource.USER, PermissionAction.READ),
    validateRequest({
      params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
      // Query params: ?include=lease,payments,maintenance,documents,notes
      // ?include=all for everything
    }),
    asyncWrapper((req, res) => {
      const userController = req.container.resolve<UserController>('userController');
      return userController.getClientUserInfo(req, res);
    })
  )
  .patch(
    isAuthenticated,
    requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
    validateRequest({
      params: ClientValidations.clientIdParam.merge(ClientValidations.userIdParam),
    }),
    asyncWrapper((req, res) => {
      const userController = req.container.resolve<UserController>('userController');
      return userController.updateUserProfile(req, res);
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
    return userController.archiveTenant(req, res);
  })
);

export default router;
