import { Types } from 'mongoose';
import { NotificationService } from '@services/notification/notification.service';
import {
  NotificationTypeEnum,
  NotificationPriorityEnum,
  RecipientTypeEnum,
  ICreateNotificationRequest,
} from '@interfaces/notification.interface';
import { ResourceContext } from '@interfaces/utils.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  createMockNotificationDAO,
  createMockNotificationDocument,
  createMockNotificationDocuments,
  createMockCreateNotificationRequest,
  createMockAnnouncementRequest,
  createMockNotificationListResponse,
  createMockUnreadCountResponse,
  createMockNotificationSocketHandler,
  createMockNotificationCache,
  createMockEmailQueue,
  createNotificationSuccessResponse,
  createMockCurrentUser,
  createMockNotificationPagination,
} from '@tests/helpers';

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let mockNotificationDAO: jest.Mocked<any>;
  let mockNotificationSocketHandler: jest.Mocked<any>;
  let mockNotificationCache: jest.Mocked<any>;
  let mockEmailQueue: jest.Mocked<any>;
  let mockProfileDAO: jest.Mocked<any>;
  let mockUserDAO: jest.Mocked<any>;
  let mockPermissionService: jest.Mocked<any>;

  beforeEach(() => {
    mockNotificationDAO = createMockNotificationDAO();
    mockNotificationSocketHandler = createMockNotificationSocketHandler();
    mockNotificationCache = createMockNotificationCache();
    mockEmailQueue = createMockEmailQueue();
    mockProfileDAO = {
      findByUserId: jest.fn(),
      getNotificationPreferences: jest.fn(),
    };
    mockUserDAO = {
      findById: jest.fn(),
      findByIds: jest.fn(),
    };
    mockPermissionService = {
      canAccessResource: jest.fn().mockReturnValue(true),
      validateUserAccess: jest.fn().mockReturnValue(true),
    };

    notificationService = new NotificationService({
      notificationDAO: mockNotificationDAO,
      notificationSocketHandler: mockNotificationSocketHandler,
      notificationCache: mockNotificationCache,
      emailQueue: mockEmailQueue,
      profileDAO: mockProfileDAO,
      userDAO: mockUserDAO,
      permissionService: mockPermissionService,
    });

    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('should create an individual notification successfully', async () => {
      const requestData = createMockCreateNotificationRequest();
      const mockNotification = createMockNotificationDocument();
      const mockProfile = {
        settings: {
          notifications: {
            system: true,
            emailNotifications: true,
            inAppNotifications: true,
          },
        },
      };

      mockNotificationDAO.create.mockResolvedValue(mockNotification);
      mockProfileDAO.findByUserId.mockResolvedValue(mockProfile);
      mockUserDAO.findById.mockResolvedValue({
        email: 'test@example.com',
        personalInfo: { firstName: 'Test' },
      });

      const result = await notificationService.createNotification(requestData);

      expect(mockNotificationDAO.create).toHaveBeenCalledWith({
        ...requestData,
        recipient: new Types.ObjectId(requestData.recipient as string),
      });
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockNotificationSocketHandler.sendToUser).toHaveBeenCalled();
      expect(mockEmailQueue.add).toHaveBeenCalled();
    });

    it('should create an announcement notification successfully', async () => {
      const requestData = createMockAnnouncementRequest();
      const mockNotification = createMockNotificationDocument({
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
      });

      mockNotificationDAO.create.mockResolvedValue(mockNotification);

      const result = await notificationService.createNotification(requestData);

      expect(mockNotificationDAO.create).toHaveBeenCalledWith(requestData);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      // Announcements don't trigger individual socket/email delivery
      expect(mockNotificationSocketHandler.sendToUser).not.toHaveBeenCalled();
      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });

    it('should throw error if individual notification missing recipient', async () => {
      const requestData: ICreateNotificationRequest = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        cuid: 'test-client',
        title: 'Test',
        message: 'Test message',
        type: NotificationTypeEnum.SYSTEM,
        // Missing recipient for individual notification
      };

      await expect(notificationService.createNotification(requestData)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should respect user notification preferences', async () => {
      const requestData = createMockCreateNotificationRequest({
        type: NotificationTypeEnum.MAINTENANCE,
      });
      const mockNotification = createMockNotificationDocument();
      const mockProfile = {
        settings: {
          notifications: {
            maintenance: false, // User has disabled maintenance notifications
            emailNotifications: true,
            inAppNotifications: true,
          },
        },
      };

      mockNotificationDAO.create.mockResolvedValue(mockNotification);
      mockProfileDAO.findByUserId.mockResolvedValue(mockProfile);

      const result = await notificationService.createNotification(requestData);

      expect(result.success).toBe(true);
      // Should still create notification but not deliver it
      expect(mockNotificationSocketHandler.sendToUser).not.toHaveBeenCalled();
      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });

    it('should handle email-only delivery preference', async () => {
      const requestData = createMockCreateNotificationRequest();
      const mockNotification = createMockNotificationDocument();
      const mockProfile = {
        settings: {
          notifications: {
            system: true,
            emailNotifications: true,
            inAppNotifications: false, // No in-app notifications
          },
        },
      };

      mockNotificationDAO.create.mockResolvedValue(mockNotification);
      mockProfileDAO.findByUserId.mockResolvedValue(mockProfile);
      mockUserDAO.findById.mockResolvedValue({
        email: 'test@example.com',
        personalInfo: { firstName: 'Test' },
      });

      const result = await notificationService.createNotification(requestData);

      expect(result.success).toBe(true);
      expect(mockNotificationSocketHandler.sendToUser).not.toHaveBeenCalled();
      expect(mockEmailQueue.add).toHaveBeenCalled();
    });
  });

  describe('getNotifications', () => {
    it('should get notifications for a user successfully', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const currentUser = createMockCurrentUser();
      const mockNotifications = createMockNotificationDocuments(3);
      const pagination = createMockNotificationPagination();

      mockNotificationDAO.findForUser.mockResolvedValue({
        data: mockNotifications,
        total: 3,
      });
      mockNotificationDAO.getUnreadCount.mockResolvedValue(2);

      const result = await notificationService.getNotifications(userId, cuid, {}, pagination);

      expect(mockNotificationDAO.findForUser).toHaveBeenCalledWith(userId, cuid, {}, pagination);
      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(3);
      expect(result.data.unreadCount).toBe(2);
      expect(result.data.pagination).toBeDefined();
    });

    it('should get notifications with filters', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const filters = {
        type: NotificationTypeEnum.MAINTENANCE,
        isRead: false,
      };
      const mockNotifications = createMockNotificationDocuments(2);

      mockNotificationDAO.findForUser.mockResolvedValue({
        data: mockNotifications,
        total: 2,
      });
      mockNotificationDAO.getUnreadCount.mockResolvedValue(2);

      const result = await notificationService.getNotifications(userId, cuid, filters);

      expect(mockNotificationDAO.findForUser).toHaveBeenCalledWith(
        userId,
        cuid,
        filters,
        undefined
      );
      expect(result.success).toBe(true);
      expect(result.data.notifications).toHaveLength(2);
    });
  });

  describe('getNotificationById', () => {
    it('should get notification by id successfully', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const mockNotification = createMockNotificationDocument();

      mockNotificationDAO.findById.mockResolvedValue(mockNotification);

      const result = await notificationService.getNotificationById(notificationId, userId, cuid);

      expect(mockNotificationDAO.findById).toHaveBeenCalledWith(notificationId);
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
    });

    it('should throw error if notification not found', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      mockNotificationDAO.findById.mockResolvedValue(null);

      await expect(
        notificationService.getNotificationById(notificationId, userId, cuid)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw error if user cannot access notification', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const differentCuid = 'different-client';
      const mockNotification = createMockNotificationDocument({ cuid: differentCuid });

      mockNotificationDAO.findById.mockResolvedValue(mockNotification);

      await expect(
        notificationService.getNotificationById(notificationId, userId, cuid)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read successfully', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const mockNotification = createMockNotificationDocument({
        recipient: new Types.ObjectId(userId),
        cuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
      });

      mockNotificationDAO.findById.mockResolvedValue(mockNotification);
      mockNotificationDAO.markAsRead.mockResolvedValue({ ...mockNotification, isRead: true });
      mockNotificationCache.invalidateUnreadCount.mockResolvedValue({ success: true });

      const result = await notificationService.markAsRead(notificationId, userId, cuid);

      expect(mockNotificationDAO.markAsRead).toHaveBeenCalledWith(notificationId);
      expect(mockNotificationCache.invalidateUnreadCount).toHaveBeenCalledWith(userId);
      expect(result.success).toBe(true);
    });

    it('should throw error if notification not found', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      mockNotificationDAO.findById.mockResolvedValue(null);

      await expect(notificationService.markAsRead(notificationId, userId, cuid)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw error if user cannot access notification', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const differentUserId = new Types.ObjectId();
      const mockNotification = createMockNotificationDocument({
        recipient: differentUserId,
        cuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
      });

      mockNotificationDAO.findById.mockResolvedValue(mockNotification);

      await expect(notificationService.markAsRead(notificationId, userId, cuid)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications as read for user', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      mockNotificationDAO.markAllAsReadForUser.mockResolvedValue(5);
      mockNotificationCache.invalidateUnreadCount.mockResolvedValue({ success: true });

      const result = await notificationService.markAllAsRead(userId, cuid);

      expect(mockNotificationDAO.markAllAsReadForUser).toHaveBeenCalledWith(userId, cuid);
      expect(mockNotificationCache.invalidateUnreadCount).toHaveBeenCalledWith(userId);
      expect(result.success).toBe(true);
      expect(result.data.markedCount).toBe(5);
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification successfully', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const mockNotification = createMockNotificationDocument({
        recipient: new Types.ObjectId(userId),
        cuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
      });

      mockNotificationDAO.findById.mockResolvedValue(mockNotification);
      mockNotificationDAO.softdeleteItem.mockResolvedValue(mockNotification);

      const result = await notificationService.deleteNotification(notificationId, userId, cuid);

      expect(mockNotificationDAO.softdeleteItem).toHaveBeenCalledWith(notificationId);
      expect(result.success).toBe(true);
      expect(result.data).toBe(true);
    });

    it('should throw error if notification not found', async () => {
      const notificationId = new Types.ObjectId().toString();
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      mockNotificationDAO.findById.mockResolvedValue(null);

      await expect(
        notificationService.deleteNotification(notificationId, userId, cuid)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getUnreadCount', () => {
    it('should get unread count from cache', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';
      const mockUnreadCount = createMockUnreadCountResponse();

      mockNotificationCache.getUnreadCount.mockResolvedValue({
        success: true,
        data: mockUnreadCount,
      });

      const result = await notificationService.getUnreadCount(userId, cuid);

      expect(mockNotificationCache.getUnreadCount).toHaveBeenCalledWith(userId);
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUnreadCount);
    });

    it('should get unread count from database if not in cache', async () => {
      const userId = new Types.ObjectId().toString();
      const cuid = 'test-client';

      mockNotificationCache.getUnreadCount.mockResolvedValue({ success: false });
      mockNotificationDAO.getUnreadCount.mockResolvedValue(10);
      mockNotificationDAO.getUnreadCountByType.mockResolvedValue({
        [NotificationTypeEnum.MAINTENANCE]: 5,
        [NotificationTypeEnum.SYSTEM]: 3,
        [NotificationTypeEnum.ANNOUNCEMENT]: 2,
      });
      mockNotificationCache.setUnreadCount.mockResolvedValue({ success: true });

      const result = await notificationService.getUnreadCount(userId, cuid);

      expect(mockNotificationDAO.getUnreadCount).toHaveBeenCalledWith(userId, cuid);
      expect(mockNotificationDAO.getUnreadCountByType).toHaveBeenCalledWith(userId, cuid);
      expect(mockNotificationCache.setUnreadCount).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data.count).toBe(10);
    });
  });

  describe('createSystemNotification', () => {
    it('should create system notification for all users in client', async () => {
      const cuid = 'test-client';
      const title = 'System Announcement';
      const message = 'Important update';
      const mockUsers = [
        { _id: new Types.ObjectId(), email: 'user1@test.com' },
        { _id: new Types.ObjectId(), email: 'user2@test.com' },
      ];
      const mockNotifications = createMockNotificationDocuments(2);

      mockUserDAO.findByIds.mockResolvedValue(mockUsers);
      mockNotificationDAO.bulkCreate.mockResolvedValue(mockNotifications);

      const result = await notificationService.createSystemNotification(cuid, title, message);

      expect(mockNotificationDAO.bulkCreate).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            recipientType: RecipientTypeEnum.INDIVIDUAL,
            recipient: mockUsers[0]._id,
            cuid,
            title,
            message,
            type: NotificationTypeEnum.SYSTEM,
            priority: NotificationPriorityEnum.HIGH,
          }),
          expect.objectContaining({
            recipientType: RecipientTypeEnum.INDIVIDUAL,
            recipient: mockUsers[1]._id,
            cuid,
            title,
            message,
            type: NotificationTypeEnum.SYSTEM,
            priority: NotificationPriorityEnum.HIGH,
          }),
        ])
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
    });

    it('should create system notification for specific users', async () => {
      const cuid = 'test-client';
      const title = 'System Notification';
      const message = 'Targeted message';
      const targetUsers = [new Types.ObjectId().toString()];
      const mockUsers = [{ _id: new Types.ObjectId(targetUsers[0]), email: 'user1@test.com' }];
      const mockNotifications = createMockNotificationDocuments(1);

      mockUserDAO.findByIds.mockResolvedValue(mockUsers);
      mockNotificationDAO.bulkCreate.mockResolvedValue(mockNotifications);

      const result = await notificationService.createSystemNotification(
        cuid,
        title,
        message,
        targetUsers
      );

      expect(mockUserDAO.findByIds).toHaveBeenCalledWith(
        targetUsers.map((id) => new Types.ObjectId(id))
      );
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(1);
    });
  });

  describe('deliverNotification', () => {
    it('should deliver notification via socket and email', async () => {
      const mockNotification = createMockNotificationDocument({
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId(),
      });
      const mockProfile = {
        settings: {
          notifications: {
            system: true,
            emailNotifications: true,
            inAppNotifications: true,
          },
        },
      };
      const mockUser = {
        email: 'test@example.com',
        personalInfo: { firstName: 'Test', lastName: 'User' },
      };

      mockProfileDAO.findByUserId.mockResolvedValue(mockProfile);
      mockUserDAO.findById.mockResolvedValue(mockUser);

      await notificationService.deliverNotification(mockNotification);

      expect(mockNotificationSocketHandler.sendToUser).toHaveBeenCalledWith(
        mockNotification.recipient?.toString(),
        mockNotification.cuid,
        expect.objectContaining({
          id: mockNotification._id.toString(),
          title: mockNotification.title,
          message: mockNotification.message,
          type: mockNotification.type,
          recipientType: mockNotification.recipientType,
        })
      );
      expect(mockEmailQueue.add).toHaveBeenCalledWith(
        'send-notification-email',
        expect.objectContaining({
          recipientEmail: mockUser.email,
          recipientName: `${mockUser.personalInfo.firstName} ${mockUser.personalInfo.lastName}`,
          title: mockNotification.title,
          message: mockNotification.message,
          type: mockNotification.type,
        })
      );
    });

    it('should not deliver announcement notifications individually', async () => {
      const mockNotification = createMockNotificationDocument({
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
      });

      await notificationService.deliverNotification(mockNotification);

      expect(mockNotificationSocketHandler.sendToUser).not.toHaveBeenCalled();
      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });

    it('should respect user delivery preferences', async () => {
      const mockNotification = createMockNotificationDocument({
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId(),
        type: NotificationTypeEnum.MAINTENANCE,
      });
      const mockProfile = {
        settings: {
          notifications: {
            maintenance: true,
            emailNotifications: false, // Email disabled
            inAppNotifications: true,
          },
        },
      };

      mockProfileDAO.findByUserId.mockResolvedValue(mockProfile);

      await notificationService.deliverNotification(mockNotification);

      expect(mockNotificationSocketHandler.sendToUser).toHaveBeenCalled();
      expect(mockEmailQueue.add).not.toHaveBeenCalled();
    });
  });
});
