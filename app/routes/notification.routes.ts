import { Router } from 'express';
import { asyncWrapper } from '@utils/index';
import { AppRequest } from '@interfaces/utils.interface';
import { NotificationController } from '@controllers/index';
import { isAuthenticated, basicLimiter } from '@shared/middlewares';
import { UtilsValidations, validateRequest } from '@shared/validations/index';

const router = Router();
router.use(isAuthenticated);

router.patch(
  '/:cuid/mark-all-read',
  basicLimiter(),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.markAllNotificationsAsRead(req, res);
  })
);

router.patch(
  '/:cuid/mark-read/:nuid',
  basicLimiter(),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.nuid),
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.markNotificationAsRead(req, res);
  })
);

router.patch(
  '/:cuid/archive/:nuid',
  basicLimiter(),
  validateRequest({
    params: UtilsValidations.cuid.merge(UtilsValidations.nuid),
  }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.archiveNotification(req, res);
  })
);

router.patch(
  '/:cuid/archive-all-read',
  basicLimiter(),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.archiveAllRead(req, res);
  })
);

router.get(
  '/:cuid/my-notifications/stream',
  basicLimiter({ max: 10, windowMs: 5 * 60 * 1000 }),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.getMyNotificationsStream(req, res);
  })
);

router.get(
  '/:cuid/announcements/stream',
  basicLimiter({ max: 10, windowMs: 5 * 60 * 1000 }),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.getAnnouncementsStream(req, res);
  })
);

router.post(
  '/:cuid/push/subscribe',
  basicLimiter(),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.subscribeToPushNotifications(req, res);
  })
);

router.post(
  '/:cuid/push/unsubscribe',
  basicLimiter(),
  validateRequest({ params: UtilsValidations.cuid }),
  asyncWrapper((req: AppRequest, res) => {
    const controller = req.container.resolve<NotificationController>('notificationController');
    return controller.unsubscribeToPushNotifications(req, res);
  })
);

export default router;
