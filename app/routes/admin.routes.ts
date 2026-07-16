import { z } from 'zod';
import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { IUserRole } from '@shared/constants/roles.constants';
import { AdminController } from '@controllers/AdminController';
import { PaymentController } from '@controllers/PaymentController';
import { UtilsValidations, validateRequest } from '@shared/validations';
import { EmailTemplateController } from '@controllers/EmailTemplateController';
import { isAuthenticated, basicLimiter, requireRole } from '@shared/middlewares';

const router = Router();

// All admin routes require authentication + super-admin role at the router level.
// Controller-level checks are a secondary defense — this is the primary gate.
router.use(isAuthenticated, requireRole([IUserRole.ROOT_ADMIN]));

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
  basicLimiter(),
  validateRequest({ body: invalidateCacheSchema }),
  asyncWrapper((req, res) => {
    const adminController = req.container.resolve<AdminController>('adminController');
    return adminController.invalidateCache(req, res);
  })
);

router.patch(
  '/clients/:cuid/suspend',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  validateRequest({ params: UtilsValidations.cuid, body: suspendClientSchema }),
  asyncWrapper((req, res) => {
    const adminController = req.container.resolve<AdminController>('adminController');
    return adminController.suspendClient(req, res);
  })
);

router.patch(
  '/clients/:cuid/unsuspend',
  basicLimiter({ max: 10, windowMs: 15 * 60 * 1000 }),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req, res) => {
    const adminController = req.container.resolve<AdminController>('adminController');
    return adminController.unsuspendClient(req, res);
  })
);

router.post(
  '/maintenance/finalize-paid',
  basicLimiter({ max: 5, windowMs: 60 * 60 * 1000 }),
  asyncWrapper((req, res) => {
    const adminController = req.container.resolve<AdminController>('adminController');
    return adminController.finalizePaidMaintenanceRequests(req, res);
  })
);

// ── Dev-only: manually trigger cron handlers ──────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/dev/trigger-cron/:jobName',
    basicLimiter(),
    asyncWrapper((req, res) => {
      const controller = req.container.resolve<PaymentController>('paymentController');
      return controller.triggerCronJob(req, res);
    })
  );

  // ── Dev-only: email template preview ────────────────────────────────────────
  router.get(
    '/dev/email-templates',
    asyncWrapper((req, res) => {
      const controller = req.container.resolve<EmailTemplateController>('emailTemplateController');
      return controller.getTemplateList(req, res);
    })
  );

  router.get(
    '/dev/email-templates/:templateType/preview',
    asyncWrapper((req, res) => {
      const controller = req.container.resolve<EmailTemplateController>('emailTemplateController');
      return controller.previewTemplate(req, res);
    })
  );
}

export default router;
