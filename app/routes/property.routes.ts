import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { PropertyController } from '@controllers/index';
import { validateRequest } from '@shared/validations/setup';
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

export const router: Router = express.Router();

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
  '/:cuid/add_property',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
  routeLimiter(),
  diskUpload(['documents[*].file', 'images[*].file']),
  scanFile,
  validateRequest({
    params: PropertyValidations.validatecuid,
    body: PropertyValidations.create,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.create(req, res);
  })
);

router.post(
  '/:cuid/validate_csv',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.validateCsv(req, res);
  })
);

router.post(
  '/:cuid/import_properties_csv',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
  diskUpload(['csv_file']),
  scanFile,
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.createPropertiesFromCsv(req, res);
  })
);

router.get(
  '/:cuid/client_properties',
  routeLimiter(),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getClientProperties(req, res);
  })
);

router.get(
  '/:cuid/client_properties/:pid',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getProperty(req, res);
  })
);

router.get(
  '/:cuid/properties/pending',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getPendingApprovals(req, res);
  })
);

router.post(
  '/:cuid/properties/:pid/approve',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.approveProperty(req, res);
  })
);

router.post(
  '/:cuid/properties/:pid/reject',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.rejectProperty(req, res);
  })
);

router.post(
  '/:cuid/properties/bulk-approve',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.bulkApproveProperties(req, res);
  })
);

router.post(
  '/:cuid/properties/bulk-reject',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.bulkRejectProperties(req, res);
  })
);

router.get(
  '/:cuid/properties/my-requests',
  requirePermission(PermissionResource.PROPERTY, PermissionAction.READ),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getMyPropertyRequests(req, res);
  })
);

router.patch(
  '/:cuid/client_properties/:pid',
  diskUpload(['documents[*].file', 'images[*].file']),
  scanFile,
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
  '/:cuid/client_properties/:pid/add_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.addMediaToProperty(req, res);
  })
);

router.patch(
  '/:cuid/client_properties/:pid/remove_media',
  validateRequest({
    params: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.deleteMediaFromProperty(req, res);
  })
);

router.delete(
  '/:cuid/delete_properties/:pid',
  validateRequest({
    query: PropertyValidations.validatePropertyAndClientIds,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.archiveProperty(req, res);
  })
);

// Mount unit routes for properties
router.use('/:cuid/client_properties/:pid/units', propertyUnitRoutes);

export default router;
