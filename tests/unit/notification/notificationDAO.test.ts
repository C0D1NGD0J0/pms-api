import { Types } from 'mongoose';
import { NotificationDAO } from '@dao/notificationDAO';
import { ResourceContext } from '@interfaces/utils.interface';
import { NotificationModel } from '@models/notification/notification.model';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  INotificationFilters,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import {
  createMockAnnouncementNotification,
  createMockNotificationPagination,
  createMockNotificationDocuments,
  createMockNotificationDocument,
} from '@tests/helpers/mocks/notification.mocks';

// Mock the notification model
jest.mock('@models/notification/notification.model');

describe('NotificationDAO', () => {
  let notificationDAO: NotificationDAO;
  let mockNotificationModel: jest.Mocked<typeof NotificationModel>;

  beforeEach(() => {
    mockNotificationModel = NotificationModel as jest.Mocked<typeof NotificationModel>;
    notificationDAO = new NotificationDAO({ notificationModel: mockNotificationModel });
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('should create a new notification', async () => {
      const mockNotification = createMockNotificationDocument();
      const notificationData = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId(),
        cuid: 'test-client',
        title: 'Test Notification',
        message: 'Test message',
        type: NotificationTypeEnum.SYSTEM,
        priority: NotificationPriorityEnum.HIGH,
      };

      mockNotificationModel.create = jest.fn().mockResolvedValue(mockNotification);

      const result = await notificationDAO.create(notificationData);

      expect(mockNotificationModel.create).toHaveBeenCalledWith(notificationData);
      expect(result).toEqual(mockNotification);
    });

    it('should create an announcement notification without recipient', async () => {
      const mockNotification = createMockAnnouncementNotification();
      const notificationData = {
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        cuid: 'test-client',
        title: 'System Announcement',
        message: 'Important update',
        type: NotificationTypeEnum.ANNOUNCEMENT,
        priority: NotificationPriorityEnum.HIGH,
      };

      mockNotificationModel.create = jest.fn().mockResolvedValue(mockNotification);

      const result = await notificationDAO.create(notificationData);

      expect(mockNotificationModel.create).toHaveBeenCalledWith(notificationData);
      expect(result).toEqual(mockNotification);
    });
  });

  describe('findById', () => {
    it('should find notification by id', async () => {
      const mockNotification = createMockNotificationDocument();
      const notificationId = new Types.ObjectId().toString();

      mockNotificationModel.findById = jest.fn().mockResolvedValue(mockNotification);

      const result = await notificationDAO.findById(notificationId);

      expect(mockNotificationModel.findById).toHaveBeenCalledWith(notificationId);
      expect(result).toEqual(mockNotification);
    });

    it('should return null if notification not found', async () => {
      const notificationId = new Types.ObjectId().toString();

      mockNotificationModel.findById = jest.fn().mockResolvedValue(null);

      const result = await notificationDAO.findById(notificationId);

      expect(result).toBeNull();
    });
  });

  describe('findByUid', () => {
    it('should find notification by uid', async () => {
      const mockNotification = createMockNotificationDocument();
      const uid = 'test-uid';

      mockNotificationModel.findOne = jest.fn().mockResolvedValue(mockNotification);

      const result = await notificationDAO.findByUid(uid);

      expect(mockNotificationModel.findOne).toHaveBeenCalledWith({ uid, deletedAt: null });
      expect(result).toEqual(mockNotification);
    });
  });

  describe('findForUser', () => {
    it('should find notifications for a user with default filters', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const mockNotifications = createMockNotificationDocuments(3);

      const mockQuery = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockNotifications),
      };

      mockNotificationModel.find = jest.fn().mockReturnValue(mockQuery);
      mockNotificationModel.countDocuments = jest.fn().mockResolvedValue(3);

      const result = await notificationDAO.findForUser(userId, cuid);

      expect(mockNotificationModel.find).toHaveBeenCalledWith({
        $or: [
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          { recipientType: RecipientTypeEnum.ANNOUNCEMENT },
        ],
        cuid,
        deletedAt: null,
      });
      expect(result).toEqual({
        data: mockNotifications,
        total: 3,
      });
    });

    it('should find notifications with filters and pagination', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const filters: INotificationFilters = {
        type: NotificationTypeEnum.MAINTENANCE,
        isRead: false,
        priority: NotificationPriorityEnum.HIGH,
      };
      const pagination = createMockNotificationPagination();
      const mockNotifications = createMockNotificationDocuments(2);

      const mockQuery = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue(mockNotifications),
      };

      mockNotificationModel.find = jest.fn().mockReturnValue(mockQuery);
      mockNotificationModel.countDocuments = jest.fn().mockResolvedValue(2);

      const result = await notificationDAO.findForUser(userId, cuid, filters, pagination);

      expect(mockNotificationModel.find).toHaveBeenCalledWith({
        $or: [
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          { recipientType: RecipientTypeEnum.ANNOUNCEMENT },
        ],
        cuid,
        deletedAt: null,
        type: NotificationTypeEnum.MAINTENANCE,
        isRead: false,
        priority: NotificationPriorityEnum.HIGH,
      });
      expect(result.data).toEqual(mockNotifications);
      expect(result.total).toBe(2);
    });

    it('should handle array filters', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const filters: INotificationFilters = {
        type: [NotificationTypeEnum.MAINTENANCE, NotificationTypeEnum.SYSTEM],
        priority: [NotificationPriorityEnum.HIGH, NotificationPriorityEnum.URGENT],
      };

      const mockQuery = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([]),
      };

      mockNotificationModel.find = jest.fn().mockReturnValue(mockQuery);
      mockNotificationModel.countDocuments = jest.fn().mockResolvedValue(0);

      await notificationDAO.findForUser(userId, cuid, filters);

      expect(mockNotificationModel.find).toHaveBeenCalledWith({
        $or: [
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          { recipientType: RecipientTypeEnum.ANNOUNCEMENT },
        ],
        cuid,
        deletedAt: null,
        type: { $in: [NotificationTypeEnum.MAINTENANCE, NotificationTypeEnum.SYSTEM] },
        priority: { $in: [NotificationPriorityEnum.HIGH, NotificationPriorityEnum.URGENT] },
      });
    });
  });

  describe('getUnreadCount', () => {
    it('should get unread count for user', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      mockNotificationModel.countDocuments = jest.fn().mockResolvedValue(5);

      const result = await notificationDAO.getUnreadCount(userId, cuid);

      expect(mockNotificationModel.countDocuments).toHaveBeenCalledWith({
        $or: [
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          { recipientType: RecipientTypeEnum.ANNOUNCEMENT },
        ],
        cuid,
        isRead: false,
        deletedAt: null,
      });
      expect(result).toBe(5);
    });

    it('should get unread count with filters', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const filters: INotificationFilters = {
        type: NotificationTypeEnum.MAINTENANCE,
      };

      mockNotificationModel.countDocuments = jest.fn().mockResolvedValue(2);

      const result = await notificationDAO.getUnreadCount(userId, cuid, filters);

      expect(mockNotificationModel.countDocuments).toHaveBeenCalledWith({
        $or: [
          { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
          { recipientType: RecipientTypeEnum.ANNOUNCEMENT },
        ],
        cuid,
        isRead: false,
        deletedAt: null,
        type: NotificationTypeEnum.MAINTENANCE,
      });
      expect(result).toBe(2);
    });
  });

  describe('getUnreadCountByType', () => {
    it('should get unread count by notification type', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      const mockAggregationResult = [
        { _id: NotificationTypeEnum.MAINTENANCE, count: 3 },
        { _id: NotificationTypeEnum.SYSTEM, count: 2 },
        { _id: NotificationTypeEnum.ANNOUNCEMENT, count: 1 },
      ];

      mockNotificationModel.aggregate = jest.fn().mockResolvedValue(mockAggregationResult);

      const result = await notificationDAO.getUnreadCountByType(userId, cuid);

      expect(mockNotificationModel.aggregate).toHaveBeenCalledWith([
        {
          $match: {
            $or: [
              {
                recipientType: RecipientTypeEnum.INDIVIDUAL,
                recipient: new Types.ObjectId(userId),
              },
              { recipientType: RecipientTypeEnum.ANNOUNCEMENT },
            ],
            cuid,
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
      ]);

      expect(result).toEqual({
        [NotificationTypeEnum.MAINTENANCE]: 3,
        [NotificationTypeEnum.SYSTEM]: 2,
        [NotificationTypeEnum.ANNOUNCEMENT]: 1,
        [NotificationTypeEnum.PROPERTY]: 0,
        [NotificationTypeEnum.MESSAGE]: 0,
        [NotificationTypeEnum.COMMENT]: 0,
        [NotificationTypeEnum.PAYMENT]: 0,
        [NotificationTypeEnum.TASK]: 0,
        [NotificationTypeEnum.USER]: 0,
      });
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read', async () => {
      const notificationId = new Types.ObjectId().toString();
      const mockNotification = createMockNotificationDocument({ isRead: true, readAt: new Date() });

      mockNotificationModel.findByIdAndUpdate = jest.fn().mockResolvedValue(mockNotification);

      const result = await notificationDAO.markAsRead(notificationId);

      expect(mockNotificationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        notificationId,
        {
          isRead: true,
          readAt: expect.any(Date),
        },
        { new: true }
      );
      expect(result).toEqual(mockNotification);
    });
  });

  describe('markAllAsReadForUser', () => {
    it('should mark all notifications as read for user', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      mockNotificationModel.updateMany = jest.fn().mockResolvedValue({
        acknowledged: true,
        modifiedCount: 3,
        upsertedId: null,
        upsertedCount: 0,
        matchedCount: 3,
      });

      const result = await notificationDAO.markAllAsReadForUser(userId, cuid);

      expect(mockNotificationModel.updateMany).toHaveBeenCalledWith(
        {
          $or: [
            { recipientType: RecipientTypeEnum.INDIVIDUAL, recipient: new Types.ObjectId(userId) },
            { recipientType: RecipientTypeEnum.ANNOUNCEMENT },
          ],
          cuid,
          isRead: false,
          deletedAt: null,
        },
        {
          isRead: true,
          readAt: expect.any(Date),
        }
      );
      expect(result).toBe(3);
    });
  });

  describe('findByResource', () => {
    it('should find notifications by resource', async () => {
      const resourceName = ResourceContext.PROPERTY;
      const resourceId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const mockNotifications = createMockNotificationDocuments(2);

      mockNotificationModel.find = jest.fn().mockResolvedValue(mockNotifications);

      const result = await notificationDAO.findByResource(resourceName, resourceId, cuid);

      expect(mockNotificationModel.find).toHaveBeenCalledWith({
        'resourceInfo.resourceName': resourceName,
        'resourceInfo.resourceId': new Types.ObjectId(resourceId),
        cuid,
        deletedAt: null,
      });
      expect(result).toEqual(mockNotifications);
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple notifications', async () => {
      const notificationsData = [
        {
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: new Types.ObjectId(),
          cuid: 'test-client',
          title: 'Notification 1',
          message: 'Message 1',
          type: NotificationTypeEnum.SYSTEM,
        },
        {
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: new Types.ObjectId(),
          cuid: 'test-client',
          title: 'Notification 2',
          message: 'Message 2',
          type: NotificationTypeEnum.USER,
        },
      ];
      const mockNotifications = createMockNotificationDocuments(2);

      mockNotificationModel.insertMany = jest.fn().mockResolvedValue(mockNotifications);

      const result = await notificationDAO.bulkCreate(notificationsData);

      expect(mockNotificationModel.insertMany).toHaveBeenCalledWith(notificationsData);
      expect(result).toEqual(mockNotifications);
    });
  });

  describe('updateById', () => {
    it('should update notification by id', async () => {
      const notificationId = new Types.ObjectId().toString();
      const updates = { title: 'Updated Title', message: 'Updated Message' };
      const mockNotification = createMockNotificationDocument(updates);

      mockNotificationModel.findByIdAndUpdate = jest.fn().mockResolvedValue(mockNotification);

      const result = await notificationDAO.updateById(notificationId, updates);

      expect(mockNotificationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        notificationId,
        updates,
        { new: true }
      );
      expect(result).toEqual(mockNotification);
    });
  });

  describe('deleteItem', () => {
    it('should hard delete notification by id', async () => {
      const notificationId = new Types.ObjectId().toString();

      mockNotificationModel.findByIdAndDelete = jest.fn().mockResolvedValue({});

      const result = await notificationDAO.deleteItem(notificationId);

      expect(mockNotificationModel.findByIdAndDelete).toHaveBeenCalledWith(notificationId);
      expect(result).toBe(true);
    });

    it('should return false if notification not found', async () => {
      const notificationId = new Types.ObjectId().toString();

      mockNotificationModel.findByIdAndDelete = jest.fn().mockResolvedValue(null);

      const result = await notificationDAO.deleteItem(notificationId);

      expect(result).toBe(false);
    });
  });

  describe('softdeleteItem', () => {
    it('should soft delete notification by id', async () => {
      const notificationId = new Types.ObjectId().toString();
      const mockNotification = createMockNotificationDocument({ deletedAt: new Date() });

      mockNotificationModel.findByIdAndUpdate = jest.fn().mockResolvedValue(mockNotification);

      const result = await notificationDAO.softdeleteItem(notificationId);

      expect(mockNotificationModel.findByIdAndUpdate).toHaveBeenCalledWith(
        notificationId,
        { deletedAt: expect.any(Date) },
        { new: true }
      );
      expect(result).toEqual(mockNotification);
    });
  });

  describe('cleanup', () => {
    it('should clean up old deleted notifications', async () => {
      const olderThanDays = 30;

      mockNotificationModel.deleteMany = jest.fn().mockResolvedValue({
        acknowledged: true,
        deletedCount: 5,
      });

      const result = await notificationDAO.cleanup(olderThanDays);

      const expectedDate = new Date();
      expectedDate.setDate(expectedDate.getDate() - olderThanDays);

      expect(mockNotificationModel.deleteMany).toHaveBeenCalledWith({
        deletedAt: { $lt: expect.any(Date) },
      });
      expect(result).toEqual({ deletedCount: 5 });
    });

    it('should use default cleanup period if not provided', async () => {
      mockNotificationModel.deleteMany = jest.fn().mockResolvedValue({
        acknowledged: true,
        deletedCount: 3,
      });

      const result = await notificationDAO.cleanup();

      expect(mockNotificationModel.deleteMany).toHaveBeenCalledWith({
        deletedAt: { $lt: expect.any(Date) },
      });
      expect(result).toEqual({ deletedCount: 3 });
    });
  });
});
