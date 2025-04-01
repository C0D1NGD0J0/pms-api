import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations';
import { PropertyController } from '@controllers/index';
import { isAuthenticated, diskUpload, scanFile } from '@shared/middlewares';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
// import { container } from '@di/index';

const router: Router = express.Router();

router.use(isAuthenticated);

router.post(
  '/:cid/',
  diskUpload,
  scanFile,
  // validateRequest({
  //   params: PropertyValidations.validateCid,
  //   body: PropertyValidations.create,
  // }),
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
