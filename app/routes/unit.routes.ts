import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { validateRequest } from '@shared/validations';
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { PropertyUnitValidations } from '@shared/validations/PropertyUnitValidation';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';

// mergeParams: true ensures this router has access to params from parent router
const router: Router = express.Router({ mergeParams: true });
router.use(isAuthenticated);

// Get all units for a property
router.get(
  '/',
  routeLimiter(),
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<PropertyUnitController>('propertyUnitController');
    return unitController.getPropertyUnits(req, res);
  })
);

router.get(
  '/:puid',
  validateRequest({
    params: PropertyUnitValidations.validatePuid,
  }),
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<PropertyUnitController>('propertyUnitController');
    return unitController.getPropertyUnit(req, res);
  })
);

// Create a new unit
router.post(
  '/',
  diskUpload(['unit.media']),
  scanFile,
  validateRequest({
    body: PropertyUnitValidations.createUnit,
  }),
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<PropertyUnitController>('propertyUnitController');
    return unitController.addUnit(req, res);
  })
);

router.patch(
  '/:puid',
  validateRequest({
    params: PropertyUnitValidations.validatePuid,
    body: PropertyUnitValidations.updateUnit,
  }),
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<PropertyUnitController>('propertyUnitController');
    return unitController.updateUnit(req, res);
  })
);

router.patch(
  '/:puid/status',
  validateRequest({
    params: PropertyUnitValidations.validatePuid,
    body: PropertyUnitValidations.updateUnit,
  }),
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<PropertyUnitController>('propertyUnitController');
    return unitController.updateUnitStatus(req, res);
  })
);

// Add inspection to unit
router.post(
  '/:puid/inspections',
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<PropertyUnitController>('propertyUnitController');
    return unitController.setupInpection(req, res);
  })
);

// Archive a unit
router.delete(
  '/:puid',
  validateRequest({
    params: PropertyUnitValidations.validatePuid,
  }),
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<PropertyUnitController>('propertyUnitController');
    return unitController.archiveUnit(req, res);
  })
);

export default router;
