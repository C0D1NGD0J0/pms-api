import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { PropertyController } from '@controllers/index';
import { validateRequest } from '@shared/validations/setup';
import { PropertyValidations } from '@shared/validations/PropertyValidation';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import {
  requireActiveSubscription,
  subscriptionEntitlements,
  requireNotSuspended,
  requireVerification,
  requirePermission,
  isAuthenticated,
  basicLimiter,
  idempotency,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

import propertyUnitRoutes from './propertyUnit.routes';

export const router: Router = express.Router();

router.use(isAuthenticated);

router.get(
  '/property_form_metadata',
  basicLimiter(),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getPropertyFormMetadata(req, res);
  })
);

router.post(
  '/:cuid/add_property',
  basicLimiter(),
  requireNotSuspended,
  requireVerification,
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
  idempotency,
  subscriptionEntitlements,
  requireActiveSubscription,
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
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
  requireNotSuspended,
  requireVerification,
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
  basicLimiter({ max: 5, windowMs: 15 * 60 * 1000 }),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
  requireNotSuspended,
  requireVerification,
  idempotency,
  subscriptionEntitlements,
  requireActiveSubscription,
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
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.LIST),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getClientProperties(req, res);
  })
);

router.get(
  '/:cuid/client_property/:pid',
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.READ),
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
  basicLimiter(),
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
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  idempotency,
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
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  idempotency,
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
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  idempotency,
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
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  idempotency,
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
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.READ),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getMyPropertyRequests(req, res);
  })
);

router.get(
  '/:cuid/leaseable',
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.READ),
  validateRequest({
    params: PropertyValidations.validatecuid,
  }),
  asyncWrapper((req, res) => {
    const propertyController = req.container.resolve<PropertyController>('propertyController');
    return propertyController.getLeaseableProperties(req, res);
  })
);

router.patch(
  '/:cuid/client_properties/:pid',
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  idempotency,
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
  '/:cuid/client_properties/:pid/remove_media',
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.UPDATE),
  idempotency,
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
  basicLimiter(),
  requirePermission(PermissionResource.PROPERTY, PermissionAction.DELETE),
  idempotency,
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
