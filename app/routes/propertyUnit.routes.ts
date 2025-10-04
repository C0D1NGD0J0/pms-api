import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations/setup';
import { PermissionAction } from '@interfaces/utils.interface';
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';
import {
  requirePropertyPermission,
  isAuthenticated,
  basicLimiter,
  diskUpload,
  scanFile,
} from '@shared/middlewares';

const router: Router = express.Router({ mergeParams: true });
router.use(isAuthenticated);

router.post(
  '/',
  requirePropertyPermission(PermissionAction.CREATE),
  basicLimiter,
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
  basicLimiter,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getPropertyUnits(req, res);
  })
);

router.get(
  '/:puid',
  requirePropertyPermission(PermissionAction.READ),
  basicLimiter,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getPropertyUnit(req, res);
  })
);

router.patch(
  '/:puid',
  requirePropertyPermission(PermissionAction.UPDATE),
  basicLimiter,
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
  basicLimiter,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.archiveUnit(req, res);
  })
);

router.patch(
  '/update_status/:puid',
  requirePropertyPermission(PermissionAction.UPDATE),
  basicLimiter,
  validateRequest({
    body: PropertyUnitValidations.updateUnit,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.updateUnitStatus(req, res);
  })
);

router.post(
  '/setup_inspection/:puid',
  requirePropertyPermission(PermissionAction.UPDATE),
  basicLimiter,
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
  '/upload_media/:puid',
  requirePropertyPermission(PermissionAction.UPDATE),
  basicLimiter,
  validateRequest({
    body: PropertyUnitValidations.uploadUnitMedia,
  }),
  diskUpload(['propertyUnit.media']),
  scanFile,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.addDocumentToUnit(req, res);
  })
);

router.post(
  '/validate_csv',
  requirePropertyPermission(PermissionAction.CREATE),
  basicLimiter,
  diskUpload(['csv_file']),
  scanFile,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.validateUnitsCsv(req, res);
  })
);

router.post(
  '/import_csv',
  requirePropertyPermission(PermissionAction.CREATE),
  basicLimiter,
  diskUpload(['csv_file']),
  scanFile,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.importUnitsFromCsv(req, res);
  })
);

export default router;
