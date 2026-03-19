import { z } from 'zod';
import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { validateRequest } from '@shared/validations';
import { AdminController } from '@controllers/AdminController';
import { isAuthenticated, basicLimiter } from '@shared/middlewares';

const router = Router();

const invalidateCacheSchema = z.object({
  type: z.enum(['user', 'property', 'lease', 'vendor', 'auth']),
  cuid: z.string().optional(),
  id: z.string().optional(),
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

export default router;
