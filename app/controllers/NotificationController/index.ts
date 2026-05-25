import Logger from 'bunyan';
import { Response } from 'express';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { NotificationService, SSEService } from '@services/index';
import { UnauthorizedError, BadRequestError } from '@shared/customErrors';
import { INotificationFilters } from '@interfaces/notification.interface';
import { IPaginationQuery, AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  notificationService: NotificationService;
  sseService: SSEService;
}

export class NotificationController {
  private readonly log: Logger;
  private readonly notificationService: NotificationService;
  private readonly sseService: SSEService;

  constructor({ notificationService, sseService }: IConstructor) {
    this.sseService = sseService;
    this.notificationService = notificationService;
    this.log = createLogger('NotificationController');
  }

  markNotificationAsRead = async (req: AppRequest, res: Response) => {
    const { cuid, nuid } = req.params;
    const userId = req.context?.currentuser?.sub;

    if (!userId) {
      throw new UnauthorizedError({ message: 'User not authenticated' });
    }

    if (req.context.currentuser.client.cuid !== cuid) {
      throw new BadRequestError({ message: 'Invalid client context' });
    }

    const result = await this.notificationService.markAsRead(nuid, userId, cuid);
    if (!result.success) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: result.message,
      });
    }

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: result.data,
      message: result.message || t('notification.success.marked_as_read'),
    });
  };

  markAllNotificationsAsRead = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const userId = req.context?.currentuser?.sub;

    if (!userId) {
      throw new UnauthorizedError({ message: 'User not authenticated' });
    }

    if (req.context.currentuser.client.cuid !== cuid) {
      throw new BadRequestError({ message: 'Invalid client context' });
    }

    const result = await this.notificationService.markAllAsRead(userId, cuid);
    if (!result.success) {
      return res.status(httpStatusCodes.BAD_REQUEST).json({
        success: false,
        message: result.message,
      });
    }

    res.status(httpStatusCodes.OK).json({
      success: true,
      data: result.data,
      message: t('notification.success.all_marked_as_read'),
    });
  };

  getMyNotificationsStream = async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { cuid } = req.params;
      const userId = req.context?.currentuser?.sub;

      if (!userId) {
        throw new UnauthorizedError({ message: 'User not authenticated' });
      }

      if (req.context.currentuser.client.cuid !== cuid) {
        throw new BadRequestError({ message: 'Invalid client context' });
      }

      const { type, priority, isRead, last7days, last30days, since } = req.query as Record<
        string,
        string
      >;
      const filters: INotificationFilters = {
        type: type as INotificationFilters['type'],
        priority: priority as INotificationFilters['priority'],
        isRead: isRead ? isRead === 'true' : undefined,
        last7days: last7days ? last7days === 'true' : undefined,
        last30days: last30days ? last30days === 'true' : undefined,
      };

      const pagination: IPaginationQuery = {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 10,
        sortBy: (req.query.sortBy as string) || 'createdAt',
      };

      const validSince = since && !isNaN(Date.parse(since)) ? since : undefined;

      const [initialData, missedData] = await Promise.all([
        this.notificationService.getNotifications(cuid, userId, filters, pagination),
        validSince
          ? this.notificationService.getNotifications(
              cuid,
              userId,
              { since: validSince },
              { page: 1, limit: 50, sortBy: 'createdAt' }
            )
          : Promise.resolve(null),
      ]);

      const session = await this.sseService.connect(req, res, userId, cuid, 'individual');

      if (missedData?.success && missedData.data?.notifications?.length) {
        session.push({ ...missedData.data, isInitial: false, isMissed: true }, 'my-notifications');
      }

      if (initialData.success && initialData.data) {
        session.push({ ...initialData.data, isInitial: true }, 'my-notifications');
      }
    } catch (error) {
      this.log.error('Failed to start personal notifications SSE stream', { error });
      throw error;
    }
  };

  getAnnouncementsStream = async (req: AppRequest, res: Response): Promise<void> => {
    try {
      const { cuid } = req.params;
      const userId = req.context?.currentuser?.sub;

      if (!userId) {
        throw new UnauthorizedError({ message: 'User not authenticated' });
      }

      if (req.context.currentuser.client.cuid !== cuid) {
        throw new BadRequestError({ message: 'Invalid client context' });
      }

      const { type, priority, isRead, last7days, last30days, since } = req.query as Record<
        string,
        string
      >;
      const filters: INotificationFilters = {
        type: type as INotificationFilters['type'],
        priority: priority as INotificationFilters['priority'],
        isRead: isRead ? isRead === 'true' : undefined,
        last7days: last7days ? last7days === 'true' : undefined,
        last30days: last30days ? last30days === 'true' : undefined,
      };

      const pagination: IPaginationQuery = {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
        sortBy: (req.query.sortBy as string) || 'createdAt',
      };

      const validSince = since && !isNaN(Date.parse(since)) ? since : undefined;

      const [initialData, missedData] = await Promise.all([
        this.notificationService.getAnnouncements(cuid, userId, filters, pagination),
        validSince
          ? this.notificationService.getAnnouncements(
              cuid,
              userId,
              { since: validSince },
              { page: 1, limit: 50, sortBy: 'createdAt' }
            )
          : Promise.resolve(null),
      ]);

      const userRole = req.context?.currentuser?.client?.role;
      const session = await this.sseService.connect(
        req,
        res,
        userId,
        cuid,
        'announcement',
        userRole
      );

      if (missedData?.success && missedData.data?.notifications?.length) {
        session.push({ ...missedData.data, isInitial: false, isMissed: true }, 'announcements');
      }

      if (initialData.success && initialData.data) {
        session.push({ ...initialData.data, isInitial: true }, 'announcements');
      }
    } catch (error) {
      this.log.error('Failed to start announcements SSE stream', { error });
      throw error;
    }
  };
}
