import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations';
import { PropertyController } from '@controllers/index';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
import { isAuthenticated, speedLimiter, diskUpload, scanFile, limiter } from '@shared/middlewares';

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
  '/:cid/client_properties',
  limiter,
  speedLimiter,
  validateRequest({
    params: PropertyValidations.validateCid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getClientProperties(req, res);
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

router.put(
  '/:cid/:propertyId',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.updateProperty(req, res);
  })
);

router.patch(
  '/:cid/:propertyId/add_property_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.addMediaToProperty(req, res);
  })
);

router.patch(
  '/:cid/:propertyId/remove_property_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.deleteMediaFromProperty(req, res);
  })
);

router.delete(
  '/:cid/:propertyId',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.achiveProperty(req, res);
  })
);

export default router;
