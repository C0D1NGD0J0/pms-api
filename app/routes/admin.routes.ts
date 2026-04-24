import { z } from 'zod';
import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { AdminController } from '@controllers/AdminController';
import { isAuthenticated, basicLimiter } from '@shared/middlewares';
import { UtilsValidations, validateRequest } from '@shared/validations';

const router = Router();

const invalidateCacheSchema = z.object({
  type: z.enum(['user', 'property', 'lease', 'vendor', 'auth']),
  cuid: z.string().optional(),
  id: z.string().optional(),
});

const suspendClientSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});

router.post(
  '/cache/invalidate',
  isAuthenticated,
  basicLimiter(),
  validateRequest({ body: invalidateCacheSchema }),
  asyncWrapper((req, res) => {
    const adminController = req.container.resolve<AdminController>('adminController');
    return adminController.invalidateCache(req, res);
  })
);

router.patch(
  '/clients/:cuid/suspend',
  isAuthenticated,
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  validateRequest({ params: UtilsValidations.cuid, body: suspendClientSchema }),
  asyncWrapper((req, res) => {
    const adminController = req.container.resolve<AdminController>('adminController');
    return adminController.suspendClient(req, res);
  })
);

router.patch(
  '/clients/:cuid/unsuspend',
  isAuthenticated,
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const adminController = req.container.resolve<AdminController>('adminController');
    return adminController.unsuspendClient(req, res);
  })
);

export default router;
