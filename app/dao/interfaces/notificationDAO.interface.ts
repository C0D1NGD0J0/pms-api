import { IPaginationQuery } from '@interfaces/utils.interface';
import {
  INotificationDocument,
  INotificationFilters,
  INotification,
} from '@interfaces/notification.interface';

export interface INotificationDAO {
  // Notification-specific methods
  findForUser(
    userId: string,
    cuid: string,
    targetingInfo: { roles: string[]; vendorId?: string; department?: string },
    filters?: INotificationFilters,
    pagination?: IPaginationQuery
  ): Promise<{ data: INotificationDocument[]; total: number }>;
  getUnreadCount(
    userId: string,
    cuid: string,
    filters?: INotificationFilters,
    targetingInfo?: { roles: string[]; department?: string }
  ): Promise<number>;
  getUnreadCountByType(
    userId: string,
    cuid: string,
    targetingInfo?: { roles: string[]; department?: string }
  ): Promise<Record<string, number>>;
  findByResource(
    resourceName: string,
    resourceId: string,
    cuid: string
  ): Promise<INotificationDocument[]>;
  markAllAsReadForUser(userId: string, cuid: string): Promise<{ modifiedCount: number }>;
  bulkCreate(notifications: Partial<INotification>[]): Promise<INotificationDocument[]>;
  findByNuid(nuid: string, cuid: string): Promise<INotificationDocument | null>;
  create(data: Partial<INotification>): Promise<INotificationDocument>;
  cleanup(olderThanDays?: number): Promise<{ deletedCount: number }>;
  deleteByNuid(nuid: string, cuid: string): Promise<boolean>;
}
