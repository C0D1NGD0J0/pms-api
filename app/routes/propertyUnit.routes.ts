import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations/setup';
import { PermissionAction } from '@interfaces/utils.interface';
import { ROLE_GROUPS } from '@shared/constants/roles.constants';
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';
import {
  requirePropertyPermission,
  requireActiveSubscription,
  subscriptionEntitlements,
  isAuthenticated,
  basicLimiter,
  idempotency,
  requireRole,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

const router: Router = express.Router({ mergeParams: true });
router.use(isAuthenticated);

router.post(
  '/',
  requirePropertyPermission(PermissionAction.CREATE),
  idempotency,
  subscriptionEntitlements,
  requireActiveSubscription,
  basicLimiter(),
  diskUpload(['propertyUnit.media']),
  scanFile,
  validateRequest({
    body: PropertyUnitValidations.createUnits,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.addUnit(req, res);
  })
);

router.get(
  '/',
  requirePropertyPermission(PermissionAction.READ),
  basicLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getPropertyUnits(req, res);
  })
);

// Two-segment paths, so they never collide with GET /:puid
router.get(
  '/csv/template',
  requirePropertyPermission(PermissionAction.CREATE),
  basicLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getCsvTemplate(req, res);
  })
);

router.get(
  '/csv/import-fields',
  requirePropertyPermission(PermissionAction.CREATE),
  basicLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getCsvImportFields(req, res);
  })
);

router.get(
  '/:puid',
  requirePropertyPermission(PermissionAction.READ),
  basicLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getPropertyUnit(req, res);
  })
);

router.patch(
  '/:puid',
  requirePropertyPermission(PermissionAction.UPDATE),
  idempotency,
  basicLimiter(),
  diskUpload(['propertyUnit.media']),
  scanFile,
  validateRequest({
    params: PropertyUnitValidations.validatePuid,
    body: PropertyUnitValidations.updateUnit,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.updateUnit(req, res);
  })
);

router.delete(
  '/:puid',
  requirePropertyPermission(PermissionAction.DELETE),
  idempotency,
  basicLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.archiveUnit(req, res);
  })
);

router.patch(
  '/:puid/status',
  requirePropertyPermission(PermissionAction.UPDATE),
  idempotency,
  basicLimiter(),
  validateRequest({
    body: PropertyUnitValidations.updateUnitStatus,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.updateUnitStatus(req, res);
  })
);

// Reviewing a staff member's pending high-impact changes — approval roles only
router.post(
  '/:puid/approve',
  requirePropertyPermission(PermissionAction.UPDATE),
  requireRole([...ROLE_GROUPS.PROPERTY_APPROVAL_ROLES]),
  idempotency,
  basicLimiter(),
  validateRequest({
    params: PropertyUnitValidations.validatePuid,
    body: PropertyUnitValidations.approveUnitChanges,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.approveUnitChanges(req, res);
  })
);

router.post(
  '/:puid/reject',
  requirePropertyPermission(PermissionAction.UPDATE),
  requireRole([...ROLE_GROUPS.PROPERTY_APPROVAL_ROLES]),
  idempotency,
  basicLimiter(),
  validateRequest({
    params: PropertyUnitValidations.validatePuid,
    body: PropertyUnitValidations.rejectUnitChanges,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.rejectUnitChanges(req, res);
  })
);

router.post(
  '/:puid/inspection',
  requirePropertyPermission(PermissionAction.UPDATE),
  idempotency,
  basicLimiter(),
  validateRequest({
    body: PropertyUnitValidations.inspectUnit,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.setupInpection(req, res);
  })
);

router.patch(
  '/:puid/media',
  requirePropertyPermission(PermissionAction.UPDATE),
  idempotency,
  basicLimiter(),
  diskUpload(['propertyUnit.media']),
  scanFile,
  validateRequest({
    body: PropertyUnitValidations.uploadUnitMedia,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.addDocumentToUnit(req, res);
  })
);

router.post(
  '/csv/validate',
  requirePropertyPermission(PermissionAction.CREATE),
  basicLimiter(),
  diskUpload(['csv_file']),
  scanFile,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.validateUnitsCsv(req, res);
  })
);

router.post(
  '/csv/import',
  requirePropertyPermission(PermissionAction.CREATE),
  idempotency,
  basicLimiter(),
  diskUpload(['csv_file']),
  scanFile,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.importUnitsFromCsv(req, res);
  })
);

export default router;
