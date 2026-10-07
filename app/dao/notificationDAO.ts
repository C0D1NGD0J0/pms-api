import dayjs from 'dayjs';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { IPaginationQuery } from '@interfaces/utils.interface';
import { type QueryFilter, PipelineStage, Types, Model } from 'mongoose';
import {
  INotificationDocument,
  INotificationFilters,
  NotificationTypeEnum,
  NotificationCategory,
  RecipientTypeEnum,
  INotification,
} from '@interfaces/notification.interface';

import { BaseDAO } from './baseDAO';
import { INotificationDAO } from './interfaces/notificationDAO.interface';

/** Who an announcement can reach, plus the viewer's preference filters. */
export interface IAnnouncementTargeting {
  /** Categories the user switched off — hidden unless the announcement is required. */
  disabledCategories?: NotificationCategory[];
  /** Management roles see department-targeted announcements for every department. */
  seesAllDepartments?: boolean;
  /** In-app switched off — only required announcements remain. */
  inAppDisabled?: boolean;
  department?: string;
  vendorId?: string;
  roles: string[];
}

export class NotificationDAO extends BaseDAO<INotificationDocument> implements INotificationDAO {
  protected logger: Logger;

  constructor({ notificationModel }: { notificationModel: Model<INotificationDocument> }) {
    super(notificationModel);
    this.logger = createLogger('NotificationDAO');
  }

  async create(data: Partial<INotification>): Promise<INotificationDocument> {
    try {
      return await this.insert(data);
    } catch (error) {
      this.logger.error('Error creating notification:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async bulkCreate(notifications: Partial<INotification>[]): Promise<INotificationDocument[]> {
    try {
      return await this.insertMany(notifications);
    } catch (error) {
      this.logger.error('Error bulk creating notifications:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findByNuid(nuid: string, cuid: string): Promise<INotificationDocument | null> {
    try {
      const filter: QueryFilter<INotificationDocument> = { nuid, cuid };
      return await this.findFirst(filter);
    } catch (error) {
      this.logger.error('Error finding notification by NUID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async deleteByNuid(nuid: string, cuid: string): Promise<boolean> {
    try {
      return await this.deleteItem({ nuid, cuid });
    } catch (error) {
      this.logger.error('Error deleting notification by NUID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findForUser(
    userId: string,
    cuid: string,
    targetingInfo: IAnnouncementTargeting,
    filters?: INotificationFilters,
    pagination?: IPaginationQuery,
    extraFilter?: QueryFilter<INotificationDocument>
  ): Promise<{ data: INotificationDocument[]; total: number }> {
    try {
      const individual: QueryFilter<INotificationDocument> = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId(userId),
      };
      const orConditions: QueryFilter<INotificationDocument>[] =
        filters?.recipientType === 'individual'
          ? [individual]
          : filters?.recipientType === 'announcement'
            ? announcementConditions(targetingInfo)
            : [individual, ...announcementConditions(targetingInfo)];
      const excluded = preferenceExclusion(targetingInfo);

      const filter: QueryFilter<INotificationDocument> = {
        cuid,
        $or: orConditions,
        ...(excluded.length ? { $nor: excluded } : {}),
        deletedAt: null,
        ...extraFilter,
      };

      if (filters) {
        if (filters.type) {
          filter.type = Array.isArray(filters.type) ? { $in: filters.type } : filters.type;
        }
        if (filters.priority) {
          filter.priority = Array.isArray(filters.priority)
            ? { $in: filters.priority }
            : filters.priority;
        }
        if (filters.isRead !== undefined) {
          filter.isRead = filters.isRead;
        }
        if (filters.resourceName) {
          filter['resourceInfo.resourceName'] = filters.resourceName;
        }
        if (filters.resourceId) {
          filter['resourceInfo.resourceId'] = new Types.ObjectId(filters.resourceId);
        }
        if (filters.last7days || filters.last30days) {
          filter.createdAt = {};

          if (filters.last7days) {
            filter.createdAt.$gte = dayjs().subtract(7, 'days').toDate();
          } else if (filters.last30days) {
            filter.createdAt.$gte = dayjs().subtract(30, 'days').toDate();
          }
        }
        if (filters.since) {
          filter.createdAt = {
            ...((filter.createdAt as object) || {}),
            $gt: new Date(filters.since),
          };
        }
      }

      const options = {
        ...pagination,
        sort: pagination?.sort || { createdAt: -1 },
        populate: [
          {
            path: 'recipient',
            select: 'email uid',
            populate: { path: 'profile', select: 'personalInfo.firstName personalInfo.lastName' },
          },
        ],
      };

      const result = await this.list(filter, options);
      return {
        data: result.items || [],
        total: result.pagination?.total || 0,
      };
    } catch (error) {
      this.logger.error('Error finding notifications for user:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUnreadCount(
    userId: string,
    cuid: string,
    filters?: INotificationFilters,
    targetingInfo?: IAnnouncementTargeting
  ): Promise<number> {
    try {
      const announcements: QueryFilter<INotificationDocument>[] = targetingInfo?.roles?.length
        ? announcementConditions(targetingInfo)
        : [{ recipientType: RecipientTypeEnum.ANNOUNCEMENT }];
      const excluded = preferenceExclusion(targetingInfo);

      const filter: QueryFilter<INotificationDocument> = {
        cuid,
        $or: [
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          ...announcements,
        ],
        ...(excluded.length ? { $nor: excluded } : {}),
        isRead: false,
        deletedAt: null,
      };

      // Apply additional filters
      if (filters) {
        if (filters.type) {
          filter.type = Array.isArray(filters.type) ? { $in: filters.type } : filters.type;
        }
        if (filters.priority) {
          filter.priority = Array.isArray(filters.priority)
            ? { $in: filters.priority }
            : filters.priority;
        }
        if (filters.resourceName) {
          filter['resourceInfo.resourceName'] = filters.resourceName;
        }
        if (filters.resourceId) {
          filter['resourceInfo.resourceId'] = new Types.ObjectId(filters.resourceId);
        }
      }

      return await this.countDocuments(filter);
    } catch (error) {
      this.logger.error('Error getting unread count:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async getUnreadCountByType(
    userId: string,
    cuid: string,
    targetingInfo?: IAnnouncementTargeting
  ): Promise<Record<string, number>> {
    try {
      const announcements: QueryFilter<INotificationDocument>[] = targetingInfo?.roles?.length
        ? announcementConditions(targetingInfo)
        : [{ recipientType: RecipientTypeEnum.ANNOUNCEMENT }];
      const excluded = preferenceExclusion(targetingInfo);

      const pipeline: PipelineStage[] = [
        {
          $match: {
            cuid,
            $or: [
              { recipientType: 'individual', recipient: new Types.ObjectId(userId) },
              ...announcements,
            ],
            ...(excluded.length ? { $nor: excluded } : {}),
            isRead: false,
            deletedAt: null,
          },
        },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 },
          },
        },
      ];

      const results = await this.aggregate(pipeline);

      // Initialize all notification types with 0
      const countByType: Record<string, number> = {};
      Object.values(NotificationTypeEnum).forEach((type) => {
        countByType[type] = 0;
      });

      // Update with actual counts
      results.forEach((result: any) => {
        countByType[result._id] = result.count;
      });

      return countByType;
    } catch (error) {
      this.logger.error('Error getting unread count by type:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async markAllAsReadForUser(userId: string, cuid: string): Promise<{ modifiedCount: number }> {
    try {
      const filter: QueryFilter<INotificationDocument> = {
        cuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId(userId),
        isRead: false,
        deletedAt: null,
      };

      const updates = {
        isRead: true,
        readAt: new Date(),
      };

      const result = await this.updateMany(filter, updates);
      return { modifiedCount: result.modifiedCount };
    } catch (error) {
      this.logger.error('Error marking all notifications as read:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findByResource(
    resourceName: string,
    resourceId: string,
    cuid: string
  ): Promise<INotificationDocument[]> {
    try {
      const filter: QueryFilter<INotificationDocument> = {
        cuid,
        'resourceInfo.resourceName': resourceName as any,
        'resourceInfo.resourceId': new Types.ObjectId(resourceId),
        deletedAt: null,
      };

      const result = await this.list(filter, { sort: { createdAt: -1 } });
      return result.items || [];
    } catch (error) {
      this.logger.error('Error finding notifications by resource:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async findById(id: string): Promise<INotificationDocument | null> {
    try {
      return await this.findFirst({ _id: new Types.ObjectId(id) });
    } catch (error) {
      this.logger.error('Error finding notification by ID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async updateById(
    id: string,
    updates: Partial<INotification>
  ): Promise<INotificationDocument | null> {
    try {
      return await super.updateById(id, updates);
    } catch (error) {
      this.logger.error('Error updating notification by ID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  async cleanup(olderThanDays: number = 90): Promise<{ deletedCount: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const filter: QueryFilter<INotificationDocument> = {
        $or: [{ deletedAt: { $lt: cutoffDate } }, { expiresAt: { $lt: new Date() } }],
      };

      // First find all matching documents to get their IDs
      const documentsToDelete = await this.list(filter, { projection: '_id' });

      if (documentsToDelete.items && documentsToDelete.items.length > 0) {
        const ids = documentsToDelete.items.map((doc: INotificationDocument) => doc._id);
        const success = await this.deleteAll(ids);
        const deletedCount = success ? ids.length : 0;

        this.logger.info(`Cleaned up ${deletedCount} old notifications`);
        return { deletedCount };
      }

      this.logger.info('No old notifications found to cleanup');
      return { deletedCount: 0 };
    } catch (error) {
      this.logger.error('Error cleaning up notifications:', error);
      throw this.throwErrorHandler(error);
    }
  }
}

function announcementConditions(
  targeting: IAnnouncementTargeting
): QueryFilter<INotificationDocument>[] {
  const departmentMatch: QueryFilter<INotificationDocument> = targeting.seesAllDepartments
    ? {}
    : {
        $or: [
          { targetDepartments: { $exists: false } },
          { targetDepartments: { $size: 0 } },
          ...(targeting.department ? [{ targetDepartments: targeting.department }] : []),
        ],
      };

  return [
    {
      recipientType: RecipientTypeEnum.ANNOUNCEMENT,
      targetRoles: { $exists: false },
      targetVendor: { $exists: false },
    },
    ...(targeting.roles.length > 0
      ? [
          {
            recipientType: RecipientTypeEnum.ANNOUNCEMENT,
            targetRoles: { $in: targeting.roles },
            ...departmentMatch,
          } as QueryFilter<INotificationDocument>,
        ]
      : []),
    ...(targeting.vendorId
      ? [
          {
            recipientType: RecipientTypeEnum.ANNOUNCEMENT,
            targetVendor: targeting.vendorId,
          } as QueryFilter<INotificationDocument>,
        ]
      : []),
  ];
}

/** `$nor` clauses hiding announcements the user opted out of (required ones always show). */
function preferenceExclusion(
  targeting: IAnnouncementTargeting | undefined
): QueryFilter<INotificationDocument>[] {
  const notRequired = { recipientType: RecipientTypeEnum.ANNOUNCEMENT, required: { $ne: true } };
  if (targeting?.inAppDisabled) return [notRequired];
  if (targeting?.disabledCategories?.length) {
    return [{ ...notRequired, category: { $in: targeting.disabledCategories } }];
  }
  return [];
}
