import { Document, Types } from 'mongoose';

import {
  ISuccessReturnData,
  IPaginationQuery,
  ResourceContext,
  PaginateResult,
} from './utils.interface';

/**
 * Notification Enums
 */
export enum NotificationTypeEnum {
  ANNOUNCEMENT = 'announcement',
  MAINTENANCE = 'maintenance',
  PROPERTY = 'property',
  MESSAGE = 'message',
  COMMENT = 'comment',
  PAYMENT = 'payment',
  SYSTEM = 'system',
  TASK = 'task',
  USER = 'user',
}

export enum RecipientTypeEnum {
  ANNOUNCEMENT = 'announcement',
  INDIVIDUAL = 'individual',
}

export enum NotificationPriorityEnum {
  URGENT = 'urgent',
  HIGH = 'high',
  LOW = 'low',
}

/**
 * Service Interface Definitions
 */
export interface INotificationService {
  createSystemNotification(
    cuid: string,
    title: string,
    message: string,
    targetUsers?: string[],
    priority?: NotificationPriorityEnum
  ): Promise<ISuccessReturnData<INotificationResponse[]>>;
  getNotifications(
    cuid: string,
    userId: string,
    filters?: INotificationFilters,
    pagination?: IPaginationQuery
  ): Promise<ISuccessReturnData<INotificationListResponse>>;
  updateNotification(
    notificationId: string,
    userId: string,
    cuid: string,
    updates: IUpdateNotificationRequest
  ): Promise<ISuccessReturnData<INotificationResponse>>;
  createNotification(
    cuid: string,
    notificationType: NotificationTypeEnum,
    data: ICreateNotificationRequest
  ): Promise<ISuccessReturnData<INotificationResponse>>;
  getNotificationById(
    notificationId: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<INotificationResponse>>;
  markAsRead(
    notificationUid: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<INotificationResponse>>;
  deleteNotification(
    notificationUid: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<boolean>>;
  getUnreadCount(
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData<INotificationUnreadCountResponse>>;
  markAllAsRead(userId: string, cuid: string): Promise<ISuccessReturnData<{ markedCount: number }>>;
  deliverNotification(notification: INotificationDocument): Promise<void>;
}

/**
 * Core Notification Interface
 */
export interface INotification {
  resourceInfo?: INotificationResource;
  priority: NotificationPriorityEnum;
  recipientType: RecipientTypeEnum;
  metadata?: Record<string, any>;
  type: NotificationTypeEnum;
  recipient?: Types.ObjectId; // Optional - only required for individual notifications
  // Announcement targeting fields
  author?: Types.ObjectId; // User who created the notification
  targetRoles?: string[];
  targetVendor?: string;
  actionUrl?: string;
  expiresAt?: Date;
  deletedAt?: Date;
  message: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  readAt?: Date;
  cuid: string;
  nuid: string;
}

export interface ICreateNotificationRequest {
  resourceInfo?: {
    resourceName: ResourceContext;
    resourceUid: string;
    resourceId: string | Types.ObjectId;
    displayName?: string;
  };
  priority?: NotificationPriorityEnum;
  recipient?: string | Types.ObjectId; // Optional - only required for individual
  recipientType: RecipientTypeEnum;
  author?: string | Types.ObjectId; // User who created the notification
  metadata?: Record<string, any>;
  type: NotificationTypeEnum;
  targetRoles?: string[];
  targetVendor?: string;
  actionUrl?: string;
  expiresAt?: Date;
  message: string;
  title: string;
  cuid: string;
}
export interface INotificationResponse {
  resourceInfo?: INotificationResource;
  priority: NotificationPriorityEnum;
  recipientType: RecipientTypeEnum;
  metadata?: Record<string, any>;
  type: NotificationTypeEnum;
  actionUrl?: string;
  isExpired: boolean;
  recipient?: string;
  message: string;
  isRead: boolean;
  createdAt: Date;
  updatedAt: Date;
  title: string;
  readAt?: Date;
  cuid: string;
  nuid: string;
  id: string;
}

export interface INotificationFilters {
  priority?: NotificationPriorityEnum | NotificationPriorityEnum[];
  type?: NotificationTypeEnum | NotificationTypeEnum[];
  recipientType?: RecipientTypeEnum;
  resourceName?: ResourceContext;
  last30days?: boolean;
  resourceId?: string;
  last7days?: boolean;
  isRead?: boolean;
}

/**
 * Socket.IO Event Interfaces
 */
export interface INotificationSocketData {
  resourceInfo?: INotificationResource;
  priority: NotificationPriorityEnum;
  recipientType: RecipientTypeEnum;
  type: NotificationTypeEnum;
  unreadCount: number;
  actionUrl?: string;
  message: string;
  createdAt: Date;
  title: string;
  id: string;
}

/**
 * Notification Preferences (extends profile interface)
 */
export interface INotificationPreferences {
  emailFrequency: 'immediate' | 'daily' | 'weekly';
  propertyUpdates: boolean;
  announcements: boolean;

  maintenance: boolean;
  messages: boolean;
  comments: boolean;
  emails: boolean;
  system: boolean;
  inApp: boolean;
}

/**
 * Bulk Operations
 */
export interface IBulkNotificationRequest {
  priority?: NotificationPriorityEnum;
  metadata?: Record<string, any>;
  type: NotificationTypeEnum;
  recipients: string[]; // Array of user IDs
  actionUrl?: string;
  message: string;
  title: string;
  cuid: string;
}

/**
 * Email Notification Interface
 */
export interface IEmailNotificationData {
  resourceInfo?: INotificationResource;
  metadata?: Record<string, any>;
  type: NotificationTypeEnum;
  recipientEmail: string;
  recipientName: string;
  actionUrl?: string;
  message: string;
  title: string;
}

/**
 * Notification Document Interface for Mongoose
 */
export interface INotificationDocument extends INotification, Document {
  markAsRead(): Promise<INotificationDocument>;
  softDelete(): Promise<INotificationDocument>;
  _id: Types.ObjectId;
  isExpired: boolean;
  timeAgo: string;
}

export interface IUpdateNotificationRequest {
  priority?: NotificationPriorityEnum;
  metadata?: Record<string, any>;
  message?: string;
  expiresAt?: Date;
  isRead?: boolean;
  title?: string;
  readAt?: Date;
}

export interface IGetNotificationsQuery extends IPaginationQuery {
  status?: 'read' | 'unread' | 'all';
  priority?: string;
  resource?: string;
  dateFrom?: string;
  dateTo?: string;
  type?: string;
}

/**
 * Resource Reference Interface
 */
export interface INotificationResource {
  resourceName: ResourceContext;
  resourceId: Types.ObjectId;
  displayName?: string;
  resourceUid: string;
}

export interface IBulkNotificationResponse {
  notifications: INotificationResponse[];
  errors?: string[];
  created: number;
  failed: number;
}

export interface INotificationListResponse {
  notifications: INotificationResponse[];
  pagination?: PaginateResult;
  unreadCount: number;
}

export interface INotificationUnreadCountResponse {
  byType: Record<NotificationTypeEnum, number>;
  count: number;
}

export interface ISocketMarkAsReadData {
  notificationId: string;
  userId: string;
  cuid: string;
}

export interface ISocketJoinNotificationsData {
  userId: string;
  cuid: string;
}

/**
 * Notification Model Static Methods
 */
export interface INotificationModel {
  cleanupDeleted(): Promise<any>;
}
