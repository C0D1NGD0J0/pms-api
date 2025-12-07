import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
import { generateShortUID, createLogger } from '@utils/index';
import { ResourceContext } from '@interfaces/utils.interface';
import {
  INotificationDocument,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

const logger = createLogger('NotificationModel');

const ResourceSchema = new Schema(
  {
    resourceName: {
      type: String,
      required: true,
      enum: Object.values(ResourceContext),
    },
    resourceUid: {
      type: String,
      required: true,
      trim: true,
    },
    resourceId: {
      type: Schema.Types.ObjectId,
      required: true,
    },
  },
  { _id: false, strict: false }
);

const NotificationSchema = new Schema<INotificationDocument>(
  {
    recipientType: {
      type: String,
      enum: Object.values(RecipientTypeEnum),
      required: true,
      default: RecipientTypeEnum.INDIVIDUAL,
      index: true,
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: function (this: INotificationDocument) {
        return this.recipientType === 'individual';
      },
      index: true,
    },
    cuid: {
      type: String,
      required: [true, 'Client ID (cuid) is required'],
      trim: true,
      index: true,
    },
    title: {
      type: String,
      required: [true, 'Notification title is required'],
      trim: true,
      maxlength: [200, 'Title cannot exceed 200 characters'],
    },
    message: {
      type: String,
      required: [true, 'Notification message is required'],
      trim: true,
      maxlength: [500, 'Message cannot exceed 500 characters'],
    },
    type: {
      type: String,
      required: [true, 'Notification type is required'],
      enum: {
        values: Object.values(NotificationTypeEnum),
        message: 'Invalid notification type: {VALUE}',
      },
      index: true,
    },
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'urgent'],
      default: 'medium',
    },
    resourceInfo: {
      type: ResourceSchema,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    readAt: {
      type: Date,
      default: null,
    },
    actionUrl: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
      default: {},
    },
    // Announcement targeting fields
    targetRoles: {
      type: [String],
      default: undefined,
    },
    targetVendor: {
      type: String,
      trim: true,
    },
    expiresAt: {
      type: Date,
      index: { expireAfterSeconds: 0 }, // TTL index for automatic cleanup
    },
    deletedAt: {
      type: Date,
      default: null,
      select: false,
    },
    nuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    author: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: undefined,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

NotificationSchema.index({ recipientType: 1, recipient: 1, cuid: 1, createdAt: -1 }); // List notifications for user
NotificationSchema.index({ recipientType: 1, recipient: 1, cuid: 1, isRead: 1 }); // Unread count queries
NotificationSchema.index({ recipientType: 1, cuid: 1, type: 1, createdAt: -1 }); // Announcements by client/type
NotificationSchema.index({ cuid: 1, type: 1, createdAt: -1 }); // Client notifications by type
NotificationSchema.index({ 'resourceInfo.resourceName': 1, 'resourceInfo.resourceId': 1, cuid: 1 }); // Resource-specific queries

// set expiration date if not provided (default 30 days)
NotificationSchema.pre('save', function (this: INotificationDocument, next) {
  if (this.isNew && !this.expiresAt) {
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    this.expiresAt = thirtyDaysFromNow;
  }
  next();
});

// static method to clean up soft-deleted notifications
NotificationSchema.statics.cleanupDeleted = async function () {
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const result = await this.deleteMany({
    deletedAt: { $lt: thirtyDaysAgo },
  });

  logger.info(`Cleaned up ${result.deletedCount} soft-deleted notifications`);
  return result;
};

NotificationSchema.methods.markAsRead = function () {
  if (!this.isRead) {
    this.isRead = true;
    this.readAt = new Date();
  }
  return this.save();
};

NotificationSchema.methods.softDelete = function () {
  this.deletedAt = new Date();
  return this.save();
};

NotificationSchema.plugin(uniqueValidator, {
  message: 'Error, {PATH} must be unique.',
});

// virtual for checking if notification is expired
NotificationSchema.virtual('isExpired').get(function (this: INotificationDocument) {
  return this.expiresAt ? this.expiresAt < new Date() : false;
});

// virtual for time since creation
NotificationSchema.virtual('timeAgo').get(function (this: INotificationDocument) {
  const now = new Date();
  const diffInMs = now.getTime() - this.createdAt.getTime();
  const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60));
  const diffInDays = Math.floor(diffInHours / 24);

  if (diffInDays > 0) {
    return `${diffInDays} day${diffInDays > 1 ? 's' : ''} ago`;
  } else if (diffInHours > 0) {
    return `${diffInHours} hour${diffInHours > 1 ? 's' : ''} ago`;
  } else {
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60));
    return `${diffInMinutes} minute${diffInMinutes > 1 ? 's' : ''} ago`;
  }
});

const NotificationModel = model<INotificationDocument>('Notification', NotificationSchema);
NotificationModel.cleanIndexes();
NotificationModel.syncIndexes();

export default NotificationModel;
