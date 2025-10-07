import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { UserController } from '@controllers/index';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { ClientValidations, validateRequest, UserValidations } from '@shared/validations';
import { requirePermission, isAuthenticated, diskUpload, scanFile } from '@shared/middlewares';

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
      return userController.getClientTenantInfo(req, res);
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
