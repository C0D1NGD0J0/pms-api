import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { validateRequest } from '@shared/validations';
import { isAuthenticated } from '@shared/middlewares';
import { ClientController } from '@controllers/ClientController';
import { ClientValidations } from '@shared/validations/ClientValidation';

const router = Router();

router.get(
  '/:cid/client_details',
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
  '/:cid/client_details',
  isAuthenticated,
  validateRequest({
    params: ClientValidations.clientIdParam,
    body: ClientValidations.updateClientDetails,
  }),
  asyncWrapper((req, res) => {
    const clientController = req.container.resolve<ClientController>('clientController');
    return clientController.updateClientProfile(req, res);
  })
);

export default router;
