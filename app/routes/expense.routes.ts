import express, { Router } from 'express';
import { asyncWrapper } from '@utils/helpers';
import { ExpenseController } from '@controllers/ExpenseController';
import { UtilsValidations, validateRequest } from '@shared/validations';
import { ExpenseValidations } from '@shared/validations/ExpenseValidation';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';
import { requirePermission, isAuthenticated, basicLimiter } from '@shared/middlewares';

export const router: Router = express.Router();

router.use(isAuthenticated, basicLimiter());

// GET /:cuid/summary — must be before /:cuid/:expuid to avoid route conflict
router.get(
  '/:cuid/summary',
  requirePermission(PermissionResource.REPORT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid, query: ExpenseValidations.pnlQuery }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<ExpenseController>('expenseController');
    return controller.getPnLSummary(req, res);
  })
);

router.get(
  '/:cuid',
  requirePermission(PermissionResource.REPORT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid, query: ExpenseValidations.listExpensesQuery }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<ExpenseController>('expenseController');
    return controller.listExpenses(req, res);
  })
);

router.post(
  '/:cuid',
  requirePermission(PermissionResource.REPORT, PermissionAction.CREATE),
  validateRequest({ params: UtilsValidations.cuid, body: ExpenseValidations.createExpense }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<ExpenseController>('expenseController');
    return controller.createExpense(req, res);
  })
);

router.get(
  '/:cuid/:expuid',
  requirePermission(PermissionResource.REPORT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<ExpenseController>('expenseController');
    return controller.getExpense(req, res);
  })
);

router.patch(
  '/:cuid/:expuid',
  requirePermission(PermissionResource.REPORT, PermissionAction.UPDATE),
  validateRequest({ params: UtilsValidations.cuid, body: ExpenseValidations.updateExpense }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<ExpenseController>('expenseController');
    return controller.updateExpense(req, res);
  })
);

router.delete(
  '/:cuid/:expuid',
  requirePermission(PermissionResource.REPORT, PermissionAction.DELETE),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const controller = req.container.resolve<ExpenseController>('expenseController');
    return controller.deleteExpense(req, res);
  })
);

export default router;
