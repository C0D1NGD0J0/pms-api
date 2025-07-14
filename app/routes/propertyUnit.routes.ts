import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations/setup';
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';

const router: Router = express.Router({ mergeParams: true });
router.use(isAuthenticated);

router.post(
  '/',
  routeLimiter(),
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
  routeLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getPropertyUnits(req, res);
  })
);

router.get(
  '/:puid',
  routeLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getPropertyUnit(req, res);
  })
);

router.patch(
  '/:puid',
  routeLimiter(),
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
  routeLimiter(),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.archiveUnit(req, res);
  })
);

router.patch(
  '/update_status/:puid',
  routeLimiter(),
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
  routeLimiter(),
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
  routeLimiter(),
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
  routeLimiter(),
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
  routeLimiter(),
  diskUpload(['csv_file']),
  scanFile,
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.importUnitsFromCsv(req, res);
  })
);

export default router;
