import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations';
import { PropertyController } from '@controllers/index';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';

const router: Router = express.Router();

router.use(isAuthenticated);

router.get(
  '/property_form_metadata',
  routeLimiter({ enableRateLimit: true }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getPropertyFormMetadata(req, res);
  })
);

router.post(
  '/:cid/add_property',
  routeLimiter(),
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
  '/:cid/validate_csv',
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
  '/:cid/import_properties_csv',
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
  routeLimiter(),
  validateRequest({
    params: PropertyValidations.validateCid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getClientProperties(req, res);
  })
);

router.get(
  '/:cid/client_property/:pid',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getProperty(req, res);
  })
);

router.post(
  '/:cid/generate_location',
  routeLimiter(),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getFormattedAddress(req, res);
  })
);

router.put(
  '/:cid/client_property/:pid',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.updateProperty(req, res);
  })
);

router.patch(
  '/:cid/client_property/:pid/add_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.addMediaToProperty(req, res);
  })
);

router.patch(
  '/:cid/client_property/:pid/remove_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.deleteMediaFromProperty(req, res);
  })
);

router.patch(
  '/:cid/archive_properties',
  validateRequest({
    body: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.archiveProperty(req, res);
  })
);

export default router;
