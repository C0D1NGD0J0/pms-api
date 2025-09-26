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

    notificationService = new NotificationService({
      notificationDAO: mockNotificationDAO,
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      userService: mockUserService,
    });

    jest.clearAllMocks();
  });

  describe('createNotification', () => {
    it('should create an individual notification successfully', async () => {
      const requestData: ICreateNotificationRequest = {
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId().toString(),
        cuid: 'test-client',
        title: 'Test Notification',
        message: 'Test message',
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.MEDIUM,
      };

      const mockNotification = {
        _id: new Types.ObjectId(),
        ...requestData,
        recipient: new Types.ObjectId(requestData.recipient),
        isRead: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockNotificationDAO.create.mockResolvedValue(mockNotification);

      const result = await notificationService.createNotification(
        'test-client',
        NotificationTypeEnum.USER,
        requestData
      );

      expect(mockNotificationDAO.create).toHaveBeenCalled();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
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
});
