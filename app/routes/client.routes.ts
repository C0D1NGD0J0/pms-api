import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { isAuthenticated } from '@shared/middlewares';
import { validateRequest } from '@shared/validations';
import { ClientController } from '@controllers/ClientController';
import { ClientValidations } from '@shared/validations/ClientValidation';

const router = Router();

router.get(
  '/:cid/profile',
  isAuthenticated,
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.getClientProfile(req, res);
  })
);

router.patch(
  '/:cid/profile',
  isAuthenticated,
  validateRequest({
    params: ClientValidations.clientIdParam,
    body: ClientValidations.updateProfile,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.updateClientProfile(req, res);
  })
);

router.patch(
  '/:cid/settings',
  isAuthenticated,
  validateRequest({
    params: ClientValidations.clientIdParam,
    body: ClientValidations.updateSettings,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.updateClientSettings(req, res);
  })
);

router.get(
  '/:cid',
  isAuthenticated,
  validateRequest({
    params: ClientValidations.clientIdParam,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.getClient(req, res);
  })
);

router.patch(
  '/:cid/identification',
  isAuthenticated,
  validateRequest({
    params: ClientValidations.clientIdParam,
    body: ClientValidations.updateIdentification,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.updateClientIdentification(req, res);
  })
);

router.patch(
  '/:cid/subscription',
  isAuthenticated,
  validateRequest({
    params: ClientValidations.clientIdParam,
    body: ClientValidations.updateSubscription,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.updateClientSubscription(req, res);
  })
);

export default router;
