import { IPaginationQuery } from '@interfaces/utils.interface';
import {
  INotificationDocument,
  INotificationFilters,
  INotification,
} from '@interfaces/notification.interface';

/**
 * DAO Interface Definition - Streamlined with essential methods only
 */
export interface INotificationDAO {
  // Notification-specific methods
  findForUser(
    userId: string,
    cuid: string,
    filters?: INotificationFilters,
    pagination?: IPaginationQuery
  ): Promise<{ data: INotificationDocument[]; total: number }>;
  findByResource(
    resourceName: string,
    resourceId: string,
    cuid: string
  ): Promise<INotificationDocument[]>;
  getUnreadCount(userId: string, cuid: string, filters?: INotificationFilters): Promise<number>;
  markAllAsReadForUser(userId: string, cuid: string): Promise<{ modifiedCount: number }>;
  bulkCreate(notifications: Partial<INotification>[]): Promise<INotificationDocument[]>;
  getUnreadCountByType(userId: string, cuid: string): Promise<Record<string, number>>;
  findByNuid(nuid: string, cuid: string): Promise<INotificationDocument | null>;
  create(data: Partial<INotification>): Promise<INotificationDocument>;
  cleanup(olderThanDays?: number): Promise<{ deletedCount: number }>;
  deleteByNuid(nuid: string, cuid: string): Promise<boolean>;
}
