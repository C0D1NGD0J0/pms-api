import { Types } from 'mongoose';
import { NotificationService } from '@services/notification/notification.service';
import {
  ICreateNotificationRequest,
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';

describe('NotificationService', () => {
  let notificationService: NotificationService;
  let mockNotificationDAO: jest.Mocked<any>;
  let mockProfileDAO: jest.Mocked<any>;
  let mockClientDAO: jest.Mocked<any>;
  let mockUserDAO: jest.Mocked<any>;
  let mockUserService: jest.Mocked<any>;
  let mockProfileService: jest.Mocked<any>;
  let mockSSEService: jest.Mocked<any>;
  let mockSSECache: jest.Mocked<any>;

  beforeEach(() => {
    mockNotificationDAO = {
      create: jest.fn(),
      findById: jest.fn(),
      findForUser: jest.fn(),
      updateById: jest.fn(),
      deleteItem: jest.fn(),
      getUnreadCount: jest.fn(),
      markAsRead: jest.fn(),
      markAllAsReadForUser: jest.fn(),
    };

    mockProfileDAO = {
      findByUserId: jest.fn(),
    };

    mockClientDAO = {
      findFirst: jest.fn(),
    };

    mockUserDAO = {
      findFirst: jest.fn(),
      list: jest.fn(),
    };

    mockUserService = {
      getUserSupervisor: jest.fn(),
      getUserDisplayName: jest.fn(),
      getUserAnnouncementFilters: jest.fn(),
    };

    mockProfileService = {
      getUserNotificationPreferences: jest.fn(),
    };

    // ADD SSE Service Mock
    mockSSEService = {
      sendToUser: jest.fn(),
      sendToChannel: jest.fn(),
      createPersonalSession: jest.fn(),
      createAnnouncementSession: jest.fn(),
      initializeConnection: jest.fn(),
      cleanup: jest.fn(),
    };

    // ADD SSE Cache Mock
    mockSSECache = {
      generatePersonalChannel: jest.fn(),
      generateAnnouncementChannels: jest.fn(),
      publishToChannel: jest.fn(),
      subscribeToChannels: jest.fn(),
      storeUserChannels: jest.fn(),
      removeUserChannels: jest.fn(),
    };

    notificationService = new NotificationService({
      notificationDAO: mockNotificationDAO,
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      userService: mockUserService,
      profileService: mockProfileService,
      sseService: mockSSEService,
      sseCache: mockSSECache,
    });

    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('should create an individual notification successfully and publish to SSE', async () => {
      const recipientId = new Types.ObjectId().toString();
      const requestData: ICreateNotificationRequest = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: recipientId,
        cuid: 'test-client',
        title: 'Test Notification',
        message: 'Test message',
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.MEDIUM,
      };

      const mockNotification = {
        _id: new Types.ObjectId(),
        nuid: 'notification-123',
        ...requestData,
        recipient: new Types.ObjectId(requestData.recipient),
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockNotificationDAO.create.mockResolvedValue(mockNotification);
      mockSSEService.sendToUser.mockResolvedValue(true);

      // Mock user preferences to allow notification
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: true,
        data: {
          inAppNotifications: true,
          system: true,
        },
      });

      const result = await notificationService.createNotification(
        'test-client',
        NotificationTypeEnum.USER,
        requestData
      );

      expect(mockNotificationDAO.create).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Verify SSE publishing for individual notification
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        recipientId,
        'test-client',
        expect.objectContaining({
          id: 'notification-123',
          event: 'notification',
          data: mockNotification,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should create an announcement and publish to SSE channels', async () => {
      const requestData: ICreateNotificationRequest = {
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        cuid: 'test-client',
        title: 'System Announcement',
        message: 'Important system update',
        type: NotificationTypeEnum.SYSTEM,
        priority: NotificationPriorityEnum.HIGH,
      };

      const mockNotification = {
        _id: new Types.ObjectId(),
        nuid: 'announcement-456',
        ...requestData,
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      const mockChannels = ['announcements:test-client:general'];

      mockNotificationDAO.create.mockResolvedValue(mockNotification);
      mockSSECache.generateAnnouncementChannels.mockReturnValue(mockChannels);
      mockSSEService.sendToChannel.mockResolvedValue(undefined);

      const result = await notificationService.createNotification(
        'test-client',
        NotificationTypeEnum.SYSTEM,
        requestData
      );

      expect(mockNotificationDAO.create).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Verify SSE publishing for announcement
      expect(mockSSECache.generateAnnouncementChannels).toHaveBeenCalledWith('test-client');
      expect(mockSSEService.sendToChannel).toHaveBeenCalledWith(
        'announcements:test-client:general',
        expect.objectContaining({
          id: 'announcement-456',
          event: 'announcement',
          data: mockNotification,
          timestamp: expect.any(Date),
        })
      );
    });

    it('should continue to create notification even if SSE publishing fails', async () => {
      const recipientId = new Types.ObjectId().toString();
      const requestData: ICreateNotificationRequest = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: recipientId,
        cuid: 'test-client',
        title: 'Test Notification',
        message: 'Test message',
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.MEDIUM,
      };

      const mockNotification = {
        _id: new Types.ObjectId(),
        nuid: 'notification-789',
        ...requestData,
        recipient: new Types.ObjectId(requestData.recipient),
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockNotificationDAO.create.mockResolvedValue(mockNotification);
      // Mock SSE failure
      mockSSEService.sendToUser.mockRejectedValue(new Error('SSE connection failed'));

      // Mock user preferences to allow notification
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: true,
        data: {
          inAppNotifications: true,
          system: true,
        },
      });

      const result = await notificationService.createNotification(
        'test-client',
        NotificationTypeEnum.USER,
        requestData
      );

      // Should still succeed even if SSE fails
      expect(mockNotificationDAO.create).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(mockSSEService.sendToUser).toHaveBeenCalled();
    });

    it('should not publish to SSE if notification creation fails', async () => {
      const requestData: ICreateNotificationRequest = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId().toString(),
        cuid: 'test-client',
        title: 'Test Notification',
        message: 'Test message',
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.MEDIUM,
      };

      // Mock notification creation failure
      mockNotificationDAO.create.mockResolvedValue(null);

      const result = await notificationService.createNotification(
        'test-client',
        NotificationTypeEnum.USER,
        requestData
      );

      expect(mockNotificationDAO.create).toHaveBeenCalled();
      expect(result.success).toBe(false);

      // Should not attempt SSE publishing if notification creation failed
      expect(mockSSEService.sendToUser).not.toHaveBeenCalled();
      expect(mockSSEService.sendToChannel).not.toHaveBeenCalled();
    });

    it('should skip notification if user preferences block it', async () => {
      const recipientId = new Types.ObjectId().toString();
      const requestData: ICreateNotificationRequest = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: recipientId,
        cuid: 'test-client',
        title: 'System Notification',
        message: 'System message',
        type: NotificationTypeEnum.SYSTEM,
        priority: NotificationPriorityEnum.LOW,
      };

      // Mock user preferences to block system notifications
      mockProfileService.getUserNotificationPreferences.mockResolvedValue({
        success: true,
        data: {
          inAppNotifications: false, // User disabled in-app notifications
          system: true,
        },
      });

      const result = await notificationService.createNotification(
        'test-client',
        NotificationTypeEnum.SYSTEM,
        requestData
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Notification skipped due to user preferences');
      expect(result.data).toBe(null);

      // Should not create notification or publish to SSE
      expect(mockNotificationDAO.create).not.toHaveBeenCalled();
      expect(mockSSEService.sendToUser).not.toHaveBeenCalled();
    });
  });

  describe('notifyPropertyUpdate', () => {
    it('should notify property manager and supervisor', async () => {
      const propertyId = 'PROP123';
      const propertyName = 'Test Property';
      const actorUserId = 'USER123';
      const actorDisplayName = 'John Doe';
      const cuid = 'CLIENT123';
      const changes = { name: 'updated' };
      const propertyManagerId = 'MANAGER456';

      mockUserService.getUserDisplayName.mockResolvedValue('Manager Name');
      mockUserService.getUserSupervisor.mockResolvedValue({ userId: 'SUPERVISOR789' });
      mockNotificationDAO.create.mockResolvedValue({});

      const result = await notificationService.notifyPropertyUpdate(
        propertyId,
        propertyName,
        actorUserId,
        actorDisplayName,
        cuid,
        changes,
        propertyManagerId
      );

      expect(result.success).toBe(true);
      expect(mockUserService.getUserDisplayName).toHaveBeenCalled();
      expect(mockUserService.getUserSupervisor).toHaveBeenCalled();
    });

    it('should prevent self-notification', async () => {
      const propertyId = 'PROP123';
      const propertyName = 'Test Property';
      const actorUserId = 'USER123';
      const actorDisplayName = 'John Doe';
      const cuid = 'CLIENT123';
      const changes = { name: 'updated' };
      const propertyManagerId = 'USER123'; // Same as actor

      mockUserService.getUserDisplayName.mockResolvedValue('Manager Name');
      mockUserService.getUserSupervisor.mockResolvedValue({ userId: 'USER123' }); // Same as actor
      mockNotificationDAO.create.mockResolvedValue({});

      const result = await notificationService.notifyPropertyUpdate(
        propertyId,
        propertyName,
        actorUserId,
        actorDisplayName,
        cuid,
        changes,
        propertyManagerId
      );

      expect(result.success).toBe(true);
      // Should not create notifications for self
      expect(mockNotificationDAO.create).not.toHaveBeenCalled();
    });
  });

  describe('notifyApprovalNeeded', () => {
    it('should send approval notification to approvers', async () => {
      const resourceId = 'RESOURCE123';
      const resourceName = 'Test Resource';
      const requesterId = 'USER123';
      const requesterDisplayName = 'John Requester';
      const cuid = 'CLIENT123';

      mockUserService.getUserSupervisor.mockResolvedValue({ userId: 'SUPERVISOR789' });
      mockClientDAO.findFirst.mockResolvedValue({ accountAdmin: 'ADMIN456' });
      mockUserDAO.findFirst.mockResolvedValue({ _id: 'ADMIN456' });
      mockNotificationDAO.create.mockResolvedValue({});

      const result = await notificationService.notifyApprovalNeeded(
        resourceId,
        resourceName,
        requesterId,
        requesterDisplayName,
        cuid
      );

      expect(result.success).toBe(true);
      expect(mockUserService.getUserSupervisor).toHaveBeenCalledWith(requesterId, cuid);
    });
  });

  describe('findUserSupervisor', () => {
    it('should delegate to UserService', async () => {
      const userId = 'USER123';
      const cuid = 'CLIENT123';
      const mockSupervisor = { userId: 'SUPERVISOR789' };

      mockUserService.getUserSupervisor.mockResolvedValue(mockSupervisor);

      const result = await notificationService.findUserSupervisor(userId, cuid);

      expect(mockUserService.getUserSupervisor).toHaveBeenCalledWith(userId, cuid);
      expect(result).toBe(mockSupervisor);
    });
  });

  describe('SSE Integration', () => {
    describe('publishToSSE', () => {
      it('should publish individual notifications to correct user channel', async () => {
        const mockNotification = {
          nuid: 'test-notification-123',
          recipientType: 'individual' as const,
          recipient: new Types.ObjectId(),
          cuid: 'test-client',
          title: 'Test Individual Notification',
          message: 'Test message',
          type: 'user',
          priority: 'medium',
          isRead: false,
          createdAt: new Date(),
        };

        mockSSEService.sendToUser.mockResolvedValue(true);

        // Access the private method through type assertion
        await (notificationService as any).publishToSSE(mockNotification);

        expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
          mockNotification.recipient.toString(),
          'test-client',
          expect.objectContaining({
            id: 'test-notification-123',
            event: 'notification',
            data: mockNotification,
            timestamp: expect.any(Date),
          })
        );
      });

      it('should publish announcements to correct channels', async () => {
        const mockNotification = {
          nuid: 'test-announcement-456',
          recipientType: 'announcement' as const,
          cuid: 'test-client',
          title: 'System Announcement',
          message: 'Important update',
          type: 'system',
          priority: 'high',
          isRead: false,
          createdAt: new Date(),
        };

        const mockChannels = [
          'announcements:test-client:general',
          'announcements:test-client:urgent'
        ];

        mockSSECache.generateAnnouncementChannels.mockReturnValue(mockChannels);
        mockSSEService.sendToChannel.mockResolvedValue(undefined);

        // Access the private method through type assertion
        await (notificationService as any).publishToSSE(mockNotification);

        expect(mockSSECache.generateAnnouncementChannels).toHaveBeenCalledWith('test-client');
        expect(mockSSEService.sendToChannel).toHaveBeenCalledTimes(2);
        expect(mockSSEService.sendToChannel).toHaveBeenCalledWith(
          'announcements:test-client:general',
          expect.objectContaining({
            id: 'test-announcement-456',
            event: 'announcement',
            data: mockNotification,
            timestamp: expect.any(Date),
          })
        );
        expect(mockSSEService.sendToChannel).toHaveBeenCalledWith(
          'announcements:test-client:urgent',
          expect.objectContaining({
            id: 'test-announcement-456',
            event: 'announcement',
            data: mockNotification,
            timestamp: expect.any(Date),
          })
        );
      });

      it('should handle SSE publishing errors gracefully', async () => {
        const mockNotification = {
          nuid: 'test-notification-error',
          recipientType: 'individual' as const,
          recipient: new Types.ObjectId(),
          cuid: 'test-client',
          title: 'Test Notification',
          message: 'Test message',
          type: 'user',
          priority: 'medium',
          isRead: false,
          createdAt: new Date(),
        };

        // Mock SSE service to throw an error
        mockSSEService.sendToUser.mockRejectedValue(new Error('Redis connection failed'));

        // Should not throw - errors are logged but not propagated
        await expect((notificationService as any).publishToSSE(mockNotification)).resolves.not.toThrow();

        expect(mockSSEService.sendToUser).toHaveBeenCalled();
      });

      it('should skip SSE publishing for notifications without recipient', async () => {
        const mockNotification = {
          nuid: 'test-notification-no-recipient',
          recipientType: 'individual' as const,
          recipient: null, // No recipient
          cuid: 'test-client',
          title: 'Test Notification',
          message: 'Test message',
          type: 'user',
          priority: 'medium',
          isRead: false,
          createdAt: new Date(),
        };

        await (notificationService as any).publishToSSE(mockNotification);

        // Should not call SSE service for notifications without recipient
        expect(mockSSEService.sendToUser).not.toHaveBeenCalled();
        expect(mockSSEService.sendToChannel).not.toHaveBeenCalled();
      });

      it('should generate correct SSE message format', async () => {
        const mockNotification = {
          nuid: 'test-format-123',
          recipientType: 'individual' as const,
          recipient: new Types.ObjectId(),
          cuid: 'test-client',
          title: 'Format Test',
          message: 'Testing message format',
          type: 'property',
          priority: 'high',
          isRead: false,
          createdAt: new Date(),
          metadata: { propertyId: 'PROP123' },
        };

        mockSSEService.sendToUser.mockResolvedValue(true);

        await (notificationService as any).publishToSSE(mockNotification);

        expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
          mockNotification.recipient.toString(),
          'test-client',
          expect.objectContaining({
            id: 'test-format-123',
            event: 'notification',
            data: expect.objectContaining({
              nuid: 'test-format-123',
              title: 'Format Test',
              message: 'Testing message format',
              type: 'property',
              priority: 'high',
              metadata: { propertyId: 'PROP123' },
            }),
            timestamp: expect.any(Date),
          })
        );
      });
    });
  });
});
