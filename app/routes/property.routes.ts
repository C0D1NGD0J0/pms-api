import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { isAuthenticated } from '@shared/middlewares';
import { validateRequest } from '@shared/validations';
import { PropertyController } from '@controllers/index';
import { PropertyValidations } from '@shared/validations/PropertyValidation';

const router: Router = express.Router();

router.use(isAuthenticated);

router.post(
  '/:cid/',
  validateRequest({
    params: PropertyValidations.validateCid,
    body: PropertyValidations.create,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.create(req, res);
  })
);

router.get(
  '/:cid/:propertyId',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getProeprty(req, res);
  })
);

export default router;
