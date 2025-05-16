import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';

// mergeParams: true ensures this router has access to params from parent router
const router: Router = express.Router({ mergeParams: true });

// All routes require authentication
router.use(isAuthenticated);

// Get all property units for a property
router.get(
  '/',
  routeLimiter(),
  validateRequest({
    query: PropertyUnitValidation.schemas.unitFilterQuery,
  }),
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getPropertyUnits(req, res);
  })
);

// Get a specific property unit
router.get(
  '/:unitId',
  /* Uncomment when UnitValidation is updated to PropertyUnitValidation
  validateRequest({
    params: PropertyUnitValidation.schemas.unitExists,
  }),
  */
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.getUnit(req, res);
  })
);

// Create a new property unit
router.post(
  '/',
  diskUpload(['propertyUnit.media']),
  scanFile,
  /* Uncomment when UnitValidation is updated to PropertyUnitValidation
  validateRequest({
    body: PropertyUnitValidation.schemas.createUnit,
  }),
  */
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.createUnit(req, res);
  })
);

// Update a property unit
router.patch(
  '/:unitId',
  /* Uncomment when UnitValidation is updated to PropertyUnitValidation
  validateRequest({
    params: PropertyUnitValidation.schemas.unitExists,
    body: PropertyUnitValidation.schemas.updateUnit,
  }),
  */
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.updateUnit(req, res);
  })
);

// Update property unit status
router.patch(
  '/:unitId/status',
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.updateUnitStatus(req, res);
  })
);

// Add inspection to property unit
router.post(
  '/:unitId/inspections',
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.addInspection(req, res);
  })
);

// Archive a property unit
router.delete(
  '/:unitId',
  asyncWrapper((req, res) => {
    const propertyUnitController =
      req.container.resolve<PropertyUnitController>('propertyUnitController');
    return propertyUnitController.archiveUnit(req, res);
  })
);

export default router;
