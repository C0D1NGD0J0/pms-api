import { Request, Response } from 'express';
import { Types } from 'mongoose';
import { NotificationController } from '@controllers/NotificationController';
import {
  NotificationTypeEnum,
  NotificationPriorityEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import { httpStatusCodes } from '@utils/index';
import { BadRequestError, NotFoundError, UnauthorizedError } from '@shared/customErrors';
import {
  createMockNotificationService,
  createMockNotificationResponse,
  createMockNotificationListResponse,
  createMockUnreadCountResponse,
  createMockCreateNotificationRequest,
  createNotificationSuccessResponse,
  createMockCurrentUser,
  createMockRequestContext,
  createMockSSEService,
  createMockSSESession,
  createMockClientService,
} from '@tests/helpers';

describe('NotificationController', () => {
  let notificationController: NotificationController;
  let mockNotificationService: jest.Mocked<any>;
  let mockSSEService: jest.Mocked<any>;
  let mockClientService: jest.Mocked<any>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    mockNotificationService = createMockNotificationService();
    mockSSEService = createMockSSEService();
    mockClientService = createMockClientService();
    mockRequest = {
      params: {},
      query: {},
      body: {},
      context: createMockRequestContext(),
    };
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    notificationController = new NotificationController({
      notificationService: mockNotificationService,
      clientService: mockClientService,
      sseService: mockSSEService,
    });

    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('should create notification successfully', async () => {
      const notificationData = createMockCreateNotificationRequest();
      const mockNotificationResponse = createMockNotificationResponse();
      const currentUser = createMockCurrentUser();

      mockRequest.body = notificationData;
      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.createNotification.mockResolvedValue(
        createNotificationSuccessResponse(mockNotificationResponse)
      );

      await notificationController.createNotification(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.createNotification).toHaveBeenCalledWith({
        ...notificationData,
        cuid: 'test-client',
      });
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.CREATED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockNotificationResponse,
        message: 'Notification created successfully',
      });
    });

    it('should return 401 if user not authenticated', async () => {
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await notificationController.createNotification(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not authenticated',
      });
    });

    it('should handle service errors', async () => {
      const notificationData = createMockCreateNotificationRequest();
      const currentUser = createMockCurrentUser();

      mockRequest.body = notificationData;
      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      const error = new BadRequestError({ message: 'Invalid notification data' });
      mockNotificationService.createNotification.mockRejectedValue(error);

      await expect(
        notificationController.createNotification(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(BadRequestError);

      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });
  });

  describe('getNotifications', () => {
    it('should get notifications successfully', async () => {
      const currentUser = createMockCurrentUser();
      const mockListResponse = createMockNotificationListResponse();

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.query = {
        page: '1',
        limit: '10',
        type: NotificationTypeEnum.SYSTEM,
        status: 'unread',
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.getNotifications.mockResolvedValue(
        createNotificationSuccessResponse(mockListResponse)
      );

      await notificationController.getNotifications(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        currentUser.sub,
        'test-client',
        expect.objectContaining({
          type: NotificationTypeEnum.SYSTEM,
          isRead: false,
        }),
        expect.objectContaining({
          page: 1,
          limit: 10,
        })
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockListResponse,
      });
    });

    it('should handle query parameters correctly', async () => {
      const currentUser = createMockCurrentUser();
      const mockListResponse = createMockNotificationListResponse();

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.query = {
        page: '2',
        limit: '25',
        type: `${NotificationTypeEnum.MAINTENANCE},${NotificationTypeEnum.PROPERTY}`,
        priority: NotificationPriorityEnum.HIGH,
        status: 'all',
        dateFrom: '2023-01-01',
        dateTo: '2023-12-31',
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.getNotifications.mockResolvedValue(
        createNotificationSuccessResponse(mockListResponse)
      );

      await notificationController.getNotifications(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        currentUser.sub,
        'test-client',
        expect.objectContaining({
          type: [NotificationTypeEnum.MAINTENANCE, NotificationTypeEnum.PROPERTY],
          priority: NotificationPriorityEnum.HIGH,
          dateFrom: new Date('2023-01-01'),
          dateTo: new Date('2023-12-31'),
        }),
        expect.objectContaining({
          page: 2,
          limit: 25,
        })
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should return 401 if user not authenticated', async () => {
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await notificationController.getNotifications(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not authenticated',
      });
    });
  });

  describe('getNotificationById', () => {
    it('should get notification by id successfully', async () => {
      const currentUser = createMockCurrentUser();
      const mockNotificationResponse = createMockNotificationResponse();

      mockRequest.params = {
        cuid: 'test-client',
        notificationId: new Types.ObjectId().toString(),
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.getNotificationById.mockResolvedValue(
        createNotificationSuccessResponse(mockNotificationResponse)
      );

      await notificationController.getNotificationById(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.getNotificationById).toHaveBeenCalledWith(
        mockRequest.params.notificationId,
        currentUser.sub,
        'test-client'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockNotificationResponse,
      });
    });

    it('should handle not found error', async () => {
      const currentUser = createMockCurrentUser();

      mockRequest.params = {
        cuid: 'test-client',
        notificationId: new Types.ObjectId().toString(),
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      const error = new NotFoundError({ message: 'Notification not found' });
      mockNotificationService.getNotificationById.mockRejectedValue(error);

      await expect(
        notificationController.getNotificationById(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('markAsRead', () => {
    it('should mark notification as read successfully', async () => {
      const currentUser = createMockCurrentUser();
      const mockNotificationResponse = createMockNotificationResponse({ isRead: true });

      mockRequest.params = {
        cuid: 'test-client',
        notificationId: new Types.ObjectId().toString(),
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.markAsRead.mockResolvedValue(
        createNotificationSuccessResponse(mockNotificationResponse)
      );

      await notificationController.markAsRead(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith(
        mockRequest.params.notificationId,
        currentUser.sub,
        'test-client'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockNotificationResponse,
        message: 'Notification marked as read',
      });
    });

    it('should return 401 if user not authenticated', async () => {
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await notificationController.markAsRead(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not authenticated',
      });
    });
  });

  describe('markAllAsRead', () => {
    it('should mark all notifications as read successfully', async () => {
      const currentUser = createMockCurrentUser();

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.markAllAsRead.mockResolvedValue(
        createNotificationSuccessResponse({ markedCount: 5 })
      );

      await notificationController.markAllAsRead(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.markAllAsRead).toHaveBeenCalledWith(currentUser.sub, 'test-client');
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: { markedCount: 5 },
        message: 'All notifications marked as read',
      });
    });
  });

  describe('deleteNotification', () => {
    it('should delete notification successfully', async () => {
      const currentUser = createMockCurrentUser();

      mockRequest.params = {
        cuid: 'test-client',
        notificationId: new Types.ObjectId().toString(),
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.deleteNotification.mockResolvedValue(
        createNotificationSuccessResponse(true)
      );

      await notificationController.deleteNotification(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.deleteNotification).toHaveBeenCalledWith(
        mockRequest.params.notificationId,
        currentUser.sub,
        'test-client'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: true,
        message: 'Notification deleted successfully',
      });
    });

    it('should handle deletion errors', async () => {
      const currentUser = createMockCurrentUser();

      mockRequest.params = {
        cuid: 'test-client',
        notificationId: new Types.ObjectId().toString(),
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      const error = new NotFoundError({ message: 'Notification not found' });
      mockNotificationService.deleteNotification.mockRejectedValue(error);

      await expect(
        notificationController.deleteNotification(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('markNotificationAsRead', () => {
    it('should mark notification as read successfully', async () => {
      const currentUser = createMockCurrentUser();
      const mockNotificationResponse = createMockNotificationResponse({ isRead: true });

      mockRequest.params = {
        cuid: 'test-client',
        nuid: new Types.ObjectId().toString(),
      };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.markAsRead.mockResolvedValue(
        createNotificationSuccessResponse(mockNotificationResponse)
      );

      await notificationController.markNotificationAsRead(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.markAsRead).toHaveBeenCalledWith(
        mockRequest.params.nuid,
        currentUser.sub,
        'test-client'
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockNotificationResponse,
        message: 'Notification marked as read',
      });
    });

    it('should handle invalid client context', async () => {
      const currentUser = createMockCurrentUser();
      currentUser.client.cuid = 'different-client';

      mockRequest.params = { cuid: 'test-client', nuid: 'test-nuid' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      await expect(
        notificationController.markNotificationAsRead(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(BadRequestError);
    });

    it('should handle service failure', async () => {
      const currentUser = createMockCurrentUser();

      mockRequest.params = { cuid: 'test-client', nuid: 'test-nuid' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.markAsRead.mockResolvedValue({
        success: false,
        data: null,
        message: 'Notification not found',
      });

      await notificationController.markNotificationAsRead(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.BAD_REQUEST);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'Notification not found',
      });
    });

    it('should return 401 if user not authenticated', async () => {
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await expect(
        notificationController.markNotificationAsRead(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getUnreadCount', () => {
    it('should get unread count successfully', async () => {
      const currentUser = createMockCurrentUser();
      const mockUnreadCountResponse = createMockUnreadCountResponse();

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.getUnreadCount.mockResolvedValue(
        createNotificationSuccessResponse(mockUnreadCountResponse)
      );

      await notificationController.getUnreadCount(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.getUnreadCount).toHaveBeenCalledWith(currentUser.sub, 'test-client');
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockUnreadCountResponse,
      });
    });

    it('should return 401 if user not authenticated', async () => {
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await notificationController.getUnreadCount(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not authenticated',
      });
    });
  });

  describe('createAnnouncement', () => {
    it('should create announcement successfully', async () => {
      const currentUser = createMockCurrentUser();
      const announcementData = {
        title: 'System Announcement',
        message: 'Important update for all users',
        priority: NotificationPriorityEnum.HIGH,
      };
      const mockNotificationResponses = [
        createMockNotificationResponse({ type: NotificationTypeEnum.ANNOUNCEMENT }),
        createMockNotificationResponse({ type: NotificationTypeEnum.ANNOUNCEMENT }),
      ];

      mockRequest.body = announcementData;
      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.createSystemNotification.mockResolvedValue(
        createNotificationSuccessResponse(mockNotificationResponses)
      );

      await notificationController.createAnnouncement(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.createSystemNotification).toHaveBeenCalledWith(
        'test-client',
        announcementData.title,
        announcementData.message,
        undefined, // No target users - broadcast to all
        announcementData.priority
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.CREATED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockNotificationResponses,
        message: 'Announcement sent successfully',
      });
    });

    it('should create targeted announcement', async () => {
      const currentUser = createMockCurrentUser();
      const announcementData = {
        title: 'Targeted Announcement',
        message: 'Message for specific users',
        targetUsers: [new Types.ObjectId().toString(), new Types.ObjectId().toString()],
        priority: NotificationPriorityEnum.HIGH,
      };
      const mockNotificationResponses = [
        createMockNotificationResponse({ type: NotificationTypeEnum.ANNOUNCEMENT }),
        createMockNotificationResponse({ type: NotificationTypeEnum.ANNOUNCEMENT }),
      ];

      mockRequest.body = announcementData;
      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.createSystemNotification.mockResolvedValue(
        createNotificationSuccessResponse(mockNotificationResponses)
      );

      await notificationController.createAnnouncement(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.createSystemNotification).toHaveBeenCalledWith(
        'test-client',
        announcementData.title,
        announcementData.message,
        announcementData.targetUsers,
        announcementData.priority
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.CREATED);
    });

    it('should return 401 if user not authenticated', async () => {
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await notificationController.createAnnouncement(mockRequest as Request, mockResponse as Response);

      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: false,
        message: 'User not authenticated',
      });
    });
  });

  describe('updateNotification', () => {
    it('should update notification successfully', async () => {
      const currentUser = createMockCurrentUser();
      const updateData = {
        title: 'Updated Title',
        message: 'Updated message',
        priority: NotificationPriorityEnum.URGENT,
      };
      const mockNotificationResponse = createMockNotificationResponse(updateData);

      mockRequest.params = {
        cuid: 'test-client',
        notificationId: new Types.ObjectId().toString(),
      };
      mockRequest.body = updateData;
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.updateNotification.mockResolvedValue(
        createNotificationSuccessResponse(mockNotificationResponse)
      );

      await notificationController.updateNotification(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.updateNotification).toHaveBeenCalledWith(
        mockRequest.params.notificationId,
        currentUser.sub,
        'test-client',
        updateData
      );
      expect(mockResponse.status).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(mockResponse.json).toHaveBeenCalledWith({
        success: true,
        data: mockNotificationResponse,
        message: 'Notification updated successfully',
      });
    });
  });

  describe('getMyNotificationsStream (SSE)', () => {
    it('should establish personal notifications SSE stream successfully', async () => {
      const currentUser = createMockCurrentUser();
      currentUser.client.cuid = 'test-client'; // Ensure client cuid matches request
      const mockSession = { push: jest.fn().mockResolvedValue(undefined) };
      const mockSessionData = createMockSSESession();
      const mockInitialData = createMockNotificationListResponse(5);

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.query = { type: 'user', priority: 'high' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.getNotifications.mockResolvedValue(
        createNotificationSuccessResponse(mockInitialData)
      );
      mockSSEService.createPersonalSession.mockResolvedValue(mockSessionData);
      mockSSEService.initializeConnection.mockResolvedValue(mockSession);

      await notificationController.getMyNotificationsStream(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.getNotifications).toHaveBeenCalledWith(
        'test-client',
        currentUser.sub,
        expect.objectContaining({
          type: 'user',
          priority: 'high',
        }),
        expect.objectContaining({
          page: 1,
          limit: 10,
          sortBy: 'createdAt',
        })
      );
      expect(mockSSEService.createPersonalSession).toHaveBeenCalledWith(currentUser.sub, 'test-client');
      expect(mockSSEService.initializeConnection).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        mockSessionData
      );
      expect(mockSession.push).toHaveBeenCalledWith(mockInitialData, 'my-notifications');
    });

    it('should handle invalid client context', async () => {
      const currentUser = createMockCurrentUser();
      currentUser.client.cuid = 'different-client';

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      await expect(
        notificationController.getMyNotificationsStream(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(BadRequestError);
    });

    it('should handle unauthenticated user', async () => {
      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await expect(
        notificationController.getMyNotificationsStream(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getAnnouncementsStream (SSE)', () => {
    it('should establish announcements SSE stream successfully', async () => {
      const currentUser = createMockCurrentUser();
      currentUser.client.cuid = 'test-client'; // Ensure client cuid matches request
      const mockSession = { push: jest.fn().mockResolvedValue(undefined) };
      const mockSessionData = createMockSSESession();
      const mockInitialData = createMockNotificationListResponse(3);

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.query = { priority: 'urgent' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      mockNotificationService.getAnnouncements.mockResolvedValue(
        createNotificationSuccessResponse(mockInitialData)
      );
      mockSSEService.createAnnouncementSession.mockResolvedValue(mockSessionData);
      mockSSEService.initializeConnection.mockResolvedValue(mockSession);

      await notificationController.getAnnouncementsStream(mockRequest as Request, mockResponse as Response);

      expect(mockNotificationService.getAnnouncements).toHaveBeenCalledWith(
        'test-client',
        currentUser.sub,
        expect.objectContaining({
          priority: 'urgent',
        }),
        expect.objectContaining({
          page: 1,
          limit: 20,
        })
      );
      expect(mockSSEService.createAnnouncementSession).toHaveBeenCalledWith(currentUser.sub, 'test-client');
      expect(mockSSEService.initializeConnection).toHaveBeenCalledWith(
        mockRequest,
        mockResponse,
        mockSessionData
      );
      expect(mockSession.push).toHaveBeenCalledWith(mockInitialData, 'announcements');
    });

    it('should handle invalid client context for announcements', async () => {
      const currentUser = createMockCurrentUser();
      currentUser.client.cuid = 'different-client';

      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: currentUser };

      await expect(
        notificationController.getAnnouncementsStream(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(BadRequestError);
    });

    it('should handle unauthenticated user for announcements', async () => {
      mockRequest.params = { cuid: 'test-client' };
      mockRequest.context = { ...mockRequest.context, currentuser: null };

      await expect(
        notificationController.getAnnouncementsStream(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow(UnauthorizedError);
    });
  });
});