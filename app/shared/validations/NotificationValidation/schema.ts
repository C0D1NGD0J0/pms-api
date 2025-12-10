import { z } from 'zod';
import { Types } from 'mongoose';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

export const ObjectIdSchema = z.string().refine((val) => Types.ObjectId.isValid(val), {
  message: 'Invalid ObjectId format',
});

export const ResourceInfoSchema = z.object({
  resourceName: z.string().min(1, 'Resource name is required'),
  resourceUid: z.string().min(1, 'Resource UID is required'),
  resourceId: z.union([z.string(), ObjectIdSchema]),
  displayName: z.string().optional(),
});

// Constrained metadata value types instead of any()
const MetadataValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.date(),
  z.null(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
  z.record(z.string(), z.unknown()).passthrough(), // For nested objects
]);

export const NotificationMetadataSchema = z.record(z.string(), MetadataValueSchema).optional();

export const CreateNotificationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  message: z.string().min(1, 'Message is required').max(1000, 'Message too long'),
  recipientType: z.nativeEnum(RecipientTypeEnum),
  recipient: z.union([z.string(), ObjectIdSchema]).optional(),
  priority: z.nativeEnum(NotificationPriorityEnum).default(NotificationPriorityEnum.LOW),
  actionUrl: z.string().url('Invalid action URL').optional(),
  metadata: NotificationMetadataSchema,
  resourceInfo: ResourceInfoSchema.optional(),
  expiresAt: z.date().optional(),
  targetRoles: z.array(z.string()).optional(),
  targetVendor: z.string().optional(),
});

export const UpdateNotificationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long').optional(),
  message: z.string().min(1, 'Message is required').max(1000, 'Message too long').optional(),
  priority: z.nativeEnum(NotificationPriorityEnum).optional(),
  actionUrl: z.string().url('Invalid action URL').optional(),
  metadata: NotificationMetadataSchema,
  isRead: z.boolean().optional(),
  expiresAt: z.date().optional(),
});

export const NotificationFiltersSchema = z.object({
  priority: z
    .union([
      z.nativeEnum(NotificationPriorityEnum),
      z.array(z.nativeEnum(NotificationPriorityEnum)),
    ])
    .optional(),
  type: z
    .union([z.nativeEnum(NotificationTypeEnum), z.array(z.nativeEnum(NotificationTypeEnum))])
    .optional(),
  resourceName: z.string().optional(),
  resourceId: z.string().optional(),
  isRead: z.boolean().optional(),
  dateFrom: z.date().optional(),
  dateTo: z.date().optional(),
});

export const BulkNotificationSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200, 'Title too long'),
  message: z.string().min(1, 'Message is required').max(1000, 'Message too long'),
  type: z.nativeEnum(NotificationTypeEnum),
  recipients: z.array(z.string()).min(1, 'At least one recipient is required'),
  priority: z.nativeEnum(NotificationPriorityEnum).optional().default(NotificationPriorityEnum.LOW),
  actionUrl: z.string().url('Invalid action URL').optional(),
  metadata: NotificationMetadataSchema,
  cuid: z.string().min(1, 'Client ID is required'),
});

export const NotificationQuerySchema = z.object({
  status: z.enum(['read', 'unread', 'all']).optional(),
  priority: z.string().optional(),
  resource: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(10),
});

export const MarkAsReadSchema = z.object({
  notificationId: z.string().min(1, 'Notification ID is required'),
  userId: z.string().min(1, 'User ID is required'),
  cuid: z.string().min(1, 'Client ID is required'),
});

export const NotificationIdSchema = z.object({
  notificationId: z.string().min(1, 'Notification ID is required'),
});

// Validation for creating notification with business rules
export const CreateNotificationWithRulesSchema = CreateNotificationSchema.superRefine(
  (data, ctx) => {
    // Business rule: individual notifications need recipient
    if (data.recipientType === RecipientTypeEnum.INDIVIDUAL && !data.recipient) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Recipient required for individual notifications',
        path: ['recipient'],
      });
    }

    // Business rule: announcement notifications don't need recipient
    if (data.recipientType === RecipientTypeEnum.ANNOUNCEMENT && data.recipient) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Announcement notifications should not have a specific recipient',
        path: ['recipient'],
      });
    }

    // Business rule: targeting fields only valid for announcements
    if (
      data.recipientType === RecipientTypeEnum.INDIVIDUAL &&
      (data.targetRoles || data.targetVendor)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          'Targeting fields (targetRoles, targetVendor) are only valid for announcement notifications',
        path: ['targetRoles'],
      });
    }
  }
);
