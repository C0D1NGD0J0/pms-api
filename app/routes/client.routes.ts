import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { ClientController } from '@controllers/ClientController';
import { ClientValidations, validateRequest } from '@shared/validations';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { requireUserManagement, requirePermission, isAuthenticated } from '@shared/middlewares';

const router = Router();

router.get(
  '/:cuid/client_details',
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
  '/:cuid/client_details',
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

router.post(
  '/:cuid/users/:uid/disconnect',
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
  '/:cuid/users/:uid/reconnect',
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

router.patch(
  '/:cuid/users/:uid/department',
  isAuthenticated,
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
  validateRequest({
    params: ClientValidations.userIdParam,
    body: ClientValidations.assignDepartment,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.assignDepartment(req, res);
  })
);

export default router;
