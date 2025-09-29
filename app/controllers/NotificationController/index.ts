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
    try {
      const { cuid, nuid } = req.params;
      const userId = req.context?.currentuser?.sub;

      if (!userId) {
        throw new UnauthorizedError({ message: 'User not authenticated' });
      }

      if (!cuid || !nuid) {
        throw new BadRequestError({
          message: 'Client ID (cuid) and Notification ID (nuid) are required',
        });
      }

      // Validate user has access to this client
      if (req.context.currentuser.client.cuid !== cuid) {
        throw new BadRequestError({ message: 'Invalid client context' });
      }

      this.log.info('Marking notification as read', { nuid, userId, cuid });

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
    } catch (error) {
      this.log.error('Error marking notification as read:', error);

      if (error instanceof BadRequestError || error instanceof UnauthorizedError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }

      res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to mark notification as read',
      });
    }
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

      this.log.info(
        `Starting personal notifications SSE stream for user ${userId} in client ${cuid}`
      );

      const { type, priority, isRead, last7days, last30days }: INotificationFilters = req.query;

      const filters: INotificationFilters = {
        type,
        priority,
        isRead: isRead ? isRead === ('true' as unknown as boolean) : undefined,
        last7days: last7days ? last7days === ('true' as unknown as boolean) : undefined,
        last30days: last30days ? last30days === ('true' as unknown as boolean) : undefined,
      };

      const initialData = await this.notificationService.getNotifications(cuid, userId, filters, {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 10,
        sortBy: (req.query.sortBy as string) || 'createdAt',
      } as IPaginationQuery);

      const sessionData = await this.sseService.createPersonalSession(userId, cuid);
      const session = await this.sseService.initializeConnection(req, res, sessionData);

      if (initialData.success && initialData.data) {
        session.push(initialData.data, 'my-notifications');
      }

      this.log.info(`Personal notifications SSE stream established for user ${userId}`);
    } catch (error) {
      this.log.error('Failed to start personal notifications SSE stream:', error);
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

      this.log.info(`Starting announcements SSE stream for user ${userId} in client ${cuid}`);

      const { type, priority, isRead, last7days, last30days }: INotificationFilters = req.query;
      const filters: INotificationFilters = {
        type,
        priority,
        isRead: isRead ? isRead === ('true' as unknown as boolean) : undefined,
        last7days: last7days ? last7days === ('true' as unknown as boolean) : undefined,
        last30days: last30days ? last30days === ('true' as unknown as boolean) : undefined,
      };

      const initialData = await this.notificationService.getAnnouncements(cuid, userId, filters, {
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 20,
      });

      const sessionData = await this.sseService.createAnnouncementSession(userId, cuid);
      const session = await this.sseService.initializeConnection(req, res, sessionData);

      // Send initial data as the first SSE message
      if (initialData.success && initialData.data) {
        session.push(initialData.data, 'announcements');
      }

      this.log.info(`Announcements SSE stream established for user ${userId}`);
    } catch (error) {
      this.log.error('Failed to start announcements SSE stream:', error);
      throw error;
    }
  };
}
