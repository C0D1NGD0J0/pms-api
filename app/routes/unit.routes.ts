import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { UnitController } from '@controllers/UnitController';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';

// mergeParams: true ensures this router has access to params from parent router
const router: Router = express.Router({ mergeParams: true });

// All routes require authentication
router.use(isAuthenticated);

// Get all units for a property
router.get(
  '/',
  routeLimiter(),
// Removed commented-out validation middleware for clarity.
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<UnitController>('unitController');
    return unitController.getPropertyUnits(req, res);
  })
);

// Get a specific unit
router.get(
  '/:unitId',
  /* Unable to use validation here until we properly fix the UnitValidation schemas
  validateRequest({
    params: UnitValidation.schemas.unitExists,
  }),
  */
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<UnitController>('unitController');
    return unitController.getUnit(req, res);
  })
);

// Create a new unit
router.post(
  '/',
  diskUpload(['unit.media']),
  scanFile,
  /* Unable to use validation here until we properly fix the UnitValidation schemas
  validateRequest({
    body: UnitValidation.schemas.createUnit,
  }),
  */
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<UnitController>('unitController');
    return unitController.createUnit(req, res);
  })
);

// Update a unit
router.patch(
  '/:unitId',
  /* Unable to use validation here until we properly fix the UnitValidation schemas
  validateRequest({
    params: UnitValidation.schemas.unitExists,
    body: UnitValidation.schemas.updateUnit,
  }),
  */
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<UnitController>('unitController');
    return unitController.updateUnit(req, res);
  })
);

// Update unit status
router.patch(
  '/:unitId/status',
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<UnitController>('unitController');
    return unitController.updateUnitStatus(req, res);
  })
);

// Add inspection to unit
router.post(
  '/:unitId/inspections',
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<UnitController>('unitController');
    return unitController.addInspection(req, res);
  })
);

// Archive a unit
router.delete(
  '/:unitId',
  asyncWrapper((req, res) => {
    const unitController = req.container.resolve<UnitController>('unitController');
    return unitController.archiveUnit(req, res);
  })
);

export default router;
