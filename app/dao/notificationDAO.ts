import dayjs from 'dayjs';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { IPaginationQuery } from '@interfaces/utils.interface';
import { type QueryFilter, PipelineStage, Types, Model } from 'mongoose';
import {
  INotificationDocument,
  INotificationFilters,
  NotificationTypeEnum,
  RecipientTypeEnum,
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
    targetingInfo: { roles: string[]; vendorId?: string; department?: string },
    filters?: INotificationFilters,
    pagination?: IPaginationQuery,
    extraFilter?: QueryFilter<INotificationDocument>
  ): Promise<{ data: INotificationDocument[]; total: number }> {
    try {
      // Build $or conditions based on recipientType filter
      let orConditions: QueryFilter<INotificationDocument>[] = [];

      if (filters?.recipientType) {
        // Filter by specific recipientType
        if (filters.recipientType === 'individual') {
          // Only individual notifications for this user
          orConditions = [
            { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          ];
        } else if (filters.recipientType === 'announcement') {
          // Only announcement notifications
          orConditions = [
            {
              recipientType: RecipientTypeEnum.ANNOUNCEMENT,
              targetRoles: { $exists: false },
              targetVendor: { $exists: false },
            },
            ...(targetingInfo.roles.length > 0
              ? [
                  {
                    recipientType: RecipientTypeEnum.ANNOUNCEMENT,
                    targetRoles: { $in: targetingInfo.roles },
                    $or: [
                      { targetDepartments: { $exists: false } },
                      { targetDepartments: { $size: 0 } },
                      ...(targetingInfo.department
                        ? [{ targetDepartments: targetingInfo.department }]
                        : []),
                    ],
                  } as QueryFilter<INotificationDocument>,
                ]
              : []),
            ...(targetingInfo.vendorId
              ? [
                  {
                    recipientType: RecipientTypeEnum.ANNOUNCEMENT,
                    targetVendor: targetingInfo.vendorId,
                  } as QueryFilter<INotificationDocument>,
                ]
              : []),
          ];
        }
      } else {
        // No recipientType filter - include both individual and announcements (existing behavior)
        orConditions = [
          // Individual notifications for this user
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          {
            recipientType: RecipientTypeEnum.ANNOUNCEMENT,
            targetRoles: { $exists: false },
            targetVendor: { $exists: false },
          },
          ...(targetingInfo.roles.length > 0
            ? [
                {
                  recipientType: RecipientTypeEnum.ANNOUNCEMENT,
                  targetRoles: { $in: targetingInfo.roles },
                  $or: [
                    { targetDepartments: { $exists: false } },
                    { targetDepartments: { $size: 0 } },
                    ...(targetingInfo.department
                      ? [{ targetDepartments: targetingInfo.department }]
                      : []),
                  ],
                } as QueryFilter<INotificationDocument>,
              ]
            : []),
          ...(targetingInfo.vendorId
            ? [
                {
                  recipientType: RecipientTypeEnum.ANNOUNCEMENT,
                  targetVendor: targetingInfo.vendorId,
                } as QueryFilter<INotificationDocument>,
              ]
            : []),
        ];
      }

      const filter: QueryFilter<INotificationDocument> = {
        cuid,
        $or: orConditions,
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
    targetingInfo?: { roles: string[]; department?: string }
  ): Promise<number> {
    try {
      const announcementConditions: QueryFilter<INotificationDocument>[] = targetingInfo?.roles
        ?.length
        ? [
            // role-matched announcements with department check
            {
              recipientType: RecipientTypeEnum.ANNOUNCEMENT,
              targetRoles: { $in: targetingInfo.roles },
              $or: [
                { targetDepartments: { $exists: false } },
                { targetDepartments: { $size: 0 } },
                ...(targetingInfo.department
                  ? [{ targetDepartments: targetingInfo.department }]
                  : []),
              ],
            } as QueryFilter<INotificationDocument>,
            // untargeted announcements (no roles, no vendor)
            {
              recipientType: RecipientTypeEnum.ANNOUNCEMENT,
              targetRoles: { $exists: false },
              targetVendor: { $exists: false },
            },
          ]
        : [{ recipientType: RecipientTypeEnum.ANNOUNCEMENT }];

      const filter: QueryFilter<INotificationDocument> = {
        cuid,
        $or: [
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          ...announcementConditions,
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

  async getUnreadCountByType(
    userId: string,
    cuid: string,
    targetingInfo?: { roles: string[]; department?: string }
  ): Promise<Record<string, number>> {
    try {
      const announcementConditions = targetingInfo?.roles?.length
        ? [
            {
              recipientType: 'announcement' as const,
              targetRoles: { $in: targetingInfo.roles },
              $or: [
                { targetDepartments: { $exists: false } },
                { targetDepartments: { $size: 0 } },
                ...(targetingInfo.department
                  ? [{ targetDepartments: targetingInfo.department }]
                  : []),
              ],
            },
            {
              recipientType: 'announcement' as const,
              targetRoles: { $exists: false },
              targetVendor: { $exists: false },
            },
          ]
        : [{ recipientType: 'announcement' as const }];

      const pipeline: PipelineStage[] = [
        {
          $match: {
            cuid,
            $or: [
              { recipientType: 'individual', recipient: new Types.ObjectId(userId) },
              ...announcementConditions,
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
