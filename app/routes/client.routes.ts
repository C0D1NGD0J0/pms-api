import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { ClientController } from '@controllers/ClientController';
import { ClientValidations, validateRequest } from '@shared/validations';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  requireUserManagement,
  requirePermission,
  isAuthenticated,
  basicLimiter,
  idempotency,
} from '@shared/middlewares';

const router = Router();
router.use(isAuthenticated, basicLimiter());

router.get(
  '/:cuid/client_details',
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
  requirePermission(PermissionResource.CLIENT, PermissionAction.UPDATE),
  idempotency,
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
  requireUserManagement(),
  idempotency,
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
  requireUserManagement(),
  idempotency,
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
  requirePermission(PermissionResource.USER, PermissionAction.UPDATE),
  idempotency,
  validateRequest({
    params: ClientValidations.userIdParam,
    body: ClientValidations.assignDepartment,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.assignDepartment(req, res);
  })
);

router.post(
  '/:cuid/verify-account',
  requirePermission(PermissionResource.CLIENT, PermissionAction.UPDATE),
  idempotency,
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.verifyAccount(req, res);
  })
);

router.post(
  '/:cuid/identity_verification/session',
  requirePermission(PermissionResource.CLIENT, PermissionAction.UPDATE),
  idempotency,
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.initiateIdentityVerification(req, res);
  })
);

export default router;
