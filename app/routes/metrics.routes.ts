import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { MetricsController } from '@controllers/MetricsController';
import { requirePermission, isAuthenticated, basicLimiter } from '@shared/middlewares';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import { MetricsValidations, UtilsValidations, validateRequest } from '@shared/validations/index';

const router = Router();

router.use(isAuthenticated);

router.get(
  '/:cuid/dashboard',
  basicLimiter(),
  requirePermission(PermissionResource.CLIENT, PermissionAction.READ),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MetricsController>('metricsController');
    return controller.getDashboard(req, res);
  })
);

router.get(
  '/:cuid/history/:metricType',
  basicLimiter(),
  requirePermission(PermissionResource.CLIENT, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid.merge(MetricsValidations.metricTypeParam),
    query: MetricsValidations.historyQuery,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MetricsController>('metricsController');
    return controller.getHistory(req, res);
  })
);

router.get(
  '/:cuid/trend/:metricType',
  basicLimiter(),
  requirePermission(PermissionResource.CLIENT, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid.merge(MetricsValidations.metricTypeParam),
    query: MetricsValidations.trendQuery,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<MetricsController>('metricsController');
    return controller.getTrend(req, res);
  })
);

export default router;
