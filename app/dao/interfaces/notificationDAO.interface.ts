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
  findForUser(
    userId: string,
    cuid: string,
    filters?: INotificationFilters,
    pagination?: IPaginationQuery
  ): Promise<{ data: INotificationDocument[]; total: number }>;
  updateMany(
    filter: Partial<INotification>,
    updates: Partial<INotification>
  ): Promise<{ modifiedCount: number }>;
  updateById(id: string, updates: Partial<INotification>): Promise<INotificationDocument | null>;
  getUnreadCount(userId: string, cuid: string, filters?: INotificationFilters): Promise<number>;
  bulkCreate(notifications: Partial<INotification>[]): Promise<INotificationDocument[]>;
  create(data: Partial<INotification>): Promise<INotificationDocument>;
  cleanup(olderThanDays?: number): Promise<{ deletedCount: number }>;
  findByUid(uid: string): Promise<INotificationDocument | null>;
  findById(id: string): Promise<INotificationDocument | null>;
  deleteById(id: string): Promise<boolean>;
}
