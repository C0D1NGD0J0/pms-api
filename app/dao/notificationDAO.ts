import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { IPaginationQuery } from '@interfaces/utils.interface';
import { PipelineStage, FilterQuery, Types, Model } from 'mongoose';
import {
  INotificationDocument,
  INotificationFilters,
  NotificationTypeEnum,
  INotification,
} from '@interfaces/notification.interface';

import { BaseDAO } from './baseDAO';
import { INotificationDAO } from './interfaces/notificationDAO.interface';

export class NotificationDAO extends BaseDAO<INotificationDocument> implements INotificationDAO {
  protected logger: Logger;

  constructor({ notificationModel }: { notificationModel: Model<INotificationDocument> }) {
    super(notificationModel);
    this.logger = createLogger('NotificationDAO');
  }

  /**
   * Create a notification with automatic UID generation
   */
  async create(data: Partial<INotification>): Promise<INotificationDocument> {
    try {
      return await this.insert(data);
    } catch (error) {
      this.logger.error('Error creating notification:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Bulk create multiple notifications
   */
  async bulkCreate(notifications: Partial<INotification>[]): Promise<INotificationDocument[]> {
    try {
      return await this.insertMany(notifications);
    } catch (error) {
      this.logger.error('Error bulk creating notifications:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find notification by NUID with multi-tenant security
   */
  async findByNuid(nuid: string, cuid: string): Promise<INotificationDocument | null> {
    try {
      const filter: FilterQuery<INotificationDocument> = { nuid, cuid };
      return await this.findFirst(filter);
    } catch (error) {
      this.logger.error('Error finding notification by NUID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Delete notification by NUID with multi-tenant security
   */
  async deleteByNuid(nuid: string, cuid: string): Promise<boolean> {
    try {
      const result = await this.deleteItem({ nuid, cuid });
      return result;
    } catch (error) {
      this.logger.error('Error deleting notification by NUID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Find notifications for a specific user with filtering and pagination
   */
  async findForUser(
    userId: string,
    cuid: string,
    targetingInfo: { roles: string[]; vendorId?: string },
    filters?: INotificationFilters,
    pagination?: IPaginationQuery
  ): Promise<{ data: INotificationDocument[]; total: number }> {
    try {
      const filter: FilterQuery<INotificationDocument> = {
        cuid,
        $or: [
          // Individual notifications for this user
          { recipientType: 'individual', recipient: new Types.ObjectId(userId) },
          {
            recipientType: 'announcement',
            targetRoles: { $exists: false },
            targetVendor: { $exists: false },
          },
          ...(targetingInfo.roles.length > 0
            ? [
                {
                  recipientType: 'announcement',
                  targetRoles: { $in: targetingInfo.roles },
                },
              ]
            : []),
          ...(targetingInfo.vendorId
            ? [
                {
                  recipientType: 'announcement',
                  targetVendor: targetingInfo.vendorId,
                },
              ]
            : []),
        ],
        deletedAt: null,
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
        if (filters.dateFrom || filters.dateTo) {
          filter.createdAt = {};
          if (filters.dateFrom) filter.createdAt.$gte = filters.dateFrom;
          if (filters.dateTo) filter.createdAt.$lte = filters.dateTo;
        }
      }

      const options = {
        ...pagination,
        sort: pagination?.sort || { createdAt: -1 },
        populate: [{ path: 'recipient', select: 'firstName lastName email' }],
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

  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(
    userId: string,
    cuid: string,
    filters?: INotificationFilters
  ): Promise<number> {
    try {
      const filter: FilterQuery<INotificationDocument> = {
        cuid,
        $or: [
          { recipientType: 'individual', recipient: new Types.ObjectId(userId) },
          { recipientType: 'announcement' },
        ],
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

  /**
   * Get unread notification count by type for a user
   */
  async getUnreadCountByType(userId: string, cuid: string): Promise<Record<string, number>> {
    try {
      const pipeline: PipelineStage[] = [
        {
          $match: {
            cuid,
            $or: [
              { recipientType: 'individual', recipient: new Types.ObjectId(userId) },
              { recipientType: 'announcement' },
            ],
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

  /**
   * Mark all individual notifications as read for a user
   */
  async markAllAsReadForUser(userId: string, cuid: string): Promise<{ modifiedCount: number }> {
    try {
      const filter: FilterQuery<INotificationDocument> = {
        cuid,
        recipientType: 'individual',
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

  /**
   * Find notifications by resource reference
   */
  async findByResource(
    resourceName: string,
    resourceId: string,
    cuid: string
  ): Promise<INotificationDocument[]> {
    try {
      const filter: FilterQuery<INotificationDocument> = {
        cuid,
        'resourceInfo.resourceName': resourceName,
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

  /**
   * Find notification by ID
   */
  async findById(id: string): Promise<INotificationDocument | null> {
    try {
      return await this.findFirst({ _id: new Types.ObjectId(id) });
    } catch (error) {
      this.logger.error('Error finding notification by ID:', error);
      throw this.throwErrorHandler(error);
    }
  }

  /**
   * Update notification by ID
   */
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

  /**
   * Cleanup old notifications
   */
  async cleanup(olderThanDays: number = 90): Promise<{ deletedCount: number }> {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      const filter: FilterQuery<INotificationDocument> = {
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
