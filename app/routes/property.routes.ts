import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations';
import { PropertyController } from '@controllers/index';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  requirePermission,
  isAuthenticated,
  routeLimiter,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

import propertyUnitRoutes from './propertyUnit.routes';

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
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
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
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
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
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
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
  '/:cid/client_properties/:pid',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getProperty(req, res);
  })
);

router.patch(
  '/:cid/client_properties/:pid',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
    body: PropertyValidations.updateProperty,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.updateClientProperty(req, res);
  })
);

router.patch(
  '/:cid/client_properties/:pid/add_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.addMediaToProperty(req, res);
  })
);

router.patch(
  '/:cid/client_properties/:pid/remove_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.deleteMediaFromProperty(req, res);
  })
);

router.delete(
  '/:cid/delete_properties/:pid',
  validateRequest({
    query: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.archiveProperty(req, res);
  })
);

// Mount unit routes for properties
router.use('/:cid/client_properties/:pid/units', propertyUnitRoutes);

export default router;
