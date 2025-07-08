import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { ClientController } from '@controllers/ClientController';
import { ClientValidations, validateRequest } from '@shared/validations';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { requireUserManagement, requirePermission, isAuthenticated } from '@shared/middlewares';

const router = Router();

router.get(
  '/:cid/client_details',
  isAuthenticated,
  requirePermission(PermissionResource.CLIENT, PermissionAction.READ),
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.getClient(req, res);
  })
);

router.patch(
  '/:cid/client_details',
  isAuthenticated,
  requirePermission(PermissionResource.CLIENT, PermissionAction.UPDATE),
  validateRequest({
    params: ClientValidations.clientIdParam,
    body: ClientValidations.updateClientDetails,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.updateClientProfile(req, res);
  })
);

router.get(
  '/:cid/users',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.LIST),
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.getClientUsers(req, res);
  })
);

router.get(
  '/:cid/users/:uid/roles',
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
  '/:cid/users/:uid/roles',
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
  '/:cid/users/:uid/roles/:role',
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

// Admin Connection Management Routes

router.post(
  '/:cid/users/:uid/disconnect',
  isAuthenticated,
  requireUserManagement(),
  validateRequest({
    params: ClientValidations.userIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.disconnectUser(req, res);
  })
);

router.post(
  '/:cid/users/:uid/reconnect',
  isAuthenticated,
  requireUserManagement(),
  validateRequest({
    params: ClientValidations.userIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.reconnectUser(req, res);
  })
);

export default router;
