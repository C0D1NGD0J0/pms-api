import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { AppRequest } from '@interfaces/utils.interface';
import { NotificationController } from '@controllers/index';
import { isAuthenticated, basicLimiter } from '@shared/middlewares';
import { UtilsValidations, validateRequest } from '@shared/validations/index';

const router = Router();
router.use(isAuthenticated);

router.get(
  '/:cuid/announcements',
  basicLimiter,
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.getAnnouncements(req, res);
  })
);

router.get(
  '/:cuid/my_notifications',
  basicLimiter,
  validateRequest({
    params: UtilsValidations.cuid,
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.getMyNotifications(req, res);
  })
);

router.patch(
  '/:cuid/mark-read/:nuid',
  basicLimiter,
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.nuid),
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.markNotificationAsRead(req, res);
  })
);

export default router;
