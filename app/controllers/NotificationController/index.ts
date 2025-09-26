import Logger from 'bunyan';
import { Response } from 'express';
import { t } from '@shared/languages';
import { createLogger } from '@utils/index';
import { httpStatusCodes } from '@utils/constants';
import { NotificationService, ClientService } from '@services/index';
import { INotificationFilters } from '@interfaces/notification.interface';
import { UnauthorizedError, BadRequestError } from '@shared/customErrors';
import { IPaginationQuery, AppRequest } from '@interfaces/utils.interface';

interface IConstructor {
  notificationService: NotificationService;
  clientService: ClientService;
}

export class NotificationController {
  private readonly log: Logger;
  private readonly clientService: ClientService;
  private readonly notificationService: NotificationService;

  constructor({ clientService, notificationService }: IConstructor) {
    this.log = createLogger('NotificationController');
    this.clientService = clientService;
    this.notificationService = notificationService;
  }

  getMyNotifications = async (req: AppRequest, res: Response) => {
    const { cuid } = req.params;
    const userId = req.context?.currentuser?.sub;
    const { type, priority, isRead, last7days, last30days }: INotificationFilters = req.query;

    if (req.context.currentuser.client.cuid !== cuid) {
      throw new BadRequestError({ message: 'Invalid client context' });
    }

    const filters: INotificationFilters = {
      type,
      priority,
      isRead: isRead ? isRead === ('true' as unknown as boolean) : undefined,
      last7days: last7days ? last7days === ('true' as unknown as boolean) : undefined,
      last30days: last30days ? last30days === ('true' as unknown as boolean) : undefined,
    };

    const pagination: IPaginationQuery = {
      page: req.query.page ? parseInt(req.query.page as string) : 1,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
      sort: (req.query.sort as string) || 'createdAt',
      sortBy: (req.query.sortBy as string) || 'desc',
    };

    const result = await this.notificationService.getNotifications(
      cuid,
      userId,
      filters,
      pagination
    );

    res.status(httpStatusCodes.OK).json({
      data: result.data,
      success: result.success,
      message: result.message || t('notification.success.fetched'),
    });
  };

  getAnnouncements = async (req: AppRequest, res: Response) => {
    try {
      const { cuid } = req.params;
      const userId = req.context?.currentuser?.sub;

      if (!userId) {
        throw new UnauthorizedError({ message: 'User not authenticated' });
      }

      if (!cuid) {
        throw new BadRequestError({ message: 'Client ID (cuid) is required' });
      }

      // Validate user has access to this client
      if (req.context.currentuser.client.cuid !== cuid) {
        throw new BadRequestError({ message: 'Invalid client context' });
      }

      this.log.info('Fetching announcements', { userId, cuid });

      // Filter for announcements only
      const filters: INotificationFilters = {
        recipientType: 'announcement', // Only get announcements
        type: req.query.type as any,
        priority: req.query.priority as any,
        isRead: req.query.isRead ? req.query.isRead === 'true' : undefined,
        dateFrom: req.query.dateFrom ? new Date(req.query.dateFrom as string) : undefined,
        dateTo: req.query.dateTo ? new Date(req.query.dateTo as string) : undefined,
      };

      const pagination: IPaginationQuery = {
        page: req.query.page ? parseInt(req.query.page as string) : 1,
        limit: req.query.limit ? parseInt(req.query.limit as string) : 10,
        sort: (req.query.sort as string) || 'createdAt',
        sortBy: (req.query.sortBy as string) || 'desc',
      };

      const result = await this.notificationService.getNotifications(
        cuid,
        userId,
        filters,
        pagination
      );

      if (!result.success) {
        return res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: result.message,
        });
      }

      res.status(httpStatusCodes.OK).json({
        success: true,
        data: result.data,
        message: result.message || t('announcement.success.fetched'),
      });
    } catch (error) {
      this.log.error('Error fetching announcements:', error);

      if (error instanceof BadRequestError || error instanceof UnauthorizedError) {
        return res.status(error.statusCode).json({
          success: false,
          message: error.message,
        });
      }

      res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: 'Failed to fetch announcements',
      });
    }
  };

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
}
