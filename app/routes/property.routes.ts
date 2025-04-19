import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations';
import { PropertyController } from '@controllers/index';
import { isAuthenticated, diskUpload, scanFile } from '@shared/middlewares';
import { PropertyValidations } from '@shared/validations/PropertyValidation';

const router: Router = express.Router();

router.use(isAuthenticated);

router.post(
  '/:cid/',
  diskUpload(['document.photos']),
  scanFile,
  validateRequest({
    params: PropertyValidations.validateCid,
    body: PropertyValidations.create,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.create(req, res);
  })
);

router.post(
  '/:cid/validate_properties_csv',
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: PropertyValidations.validateCid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.validateCsv(req, res);
  })
);

router.post(
  '/:cid/create_properties_csv',
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: PropertyValidations.validateCid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.createPropertiesFromCsv(req, res);
  })
);

router.get(
  '/:cid/:propertyId',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getProperty(req, res);
  })
);

export default router;
