import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { isAuthenticated } from '@shared/middlewares';
import { validateRequest } from '@shared/validations';
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
    const authController = req.container.resolve<PropertyController>('propertyController');
    return authController.login(req, res);
  })
);

export default router;
