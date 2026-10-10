import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { SearchController } from '@controllers/SearchController';
import { requirePermission, isAuthenticated, basicLimiter } from '@shared/middlewares';
import { PermissionResource, PermissionAction, AppRequest } from '@interfaces/utils.interface';
import { SearchValidations, UtilsValidations, validateRequest } from '@shared/validations/index';

const router = Router();

router.use(basicLimiter({ max: 60, windowMs: 60_000, delayAfter: 60 }), isAuthenticated);

router.get(
  '/:cuid',
  requirePermission(PermissionResource.CLIENT, PermissionAction.READ),
  validateRequest({
    params: UtilsValidations.cuid,
    query: SearchValidations.globalSearchQuery,
  }),
  asyncWrapper(async (req: AppRequest, res) => {
    const controller = req.container.resolve<SearchController>('searchController');
    return controller.globalSearch(req, res);
  })
);

export default router;
