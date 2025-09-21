import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { NotificationDAO } from '@dao/notificationDAO';
import { BaseDAO } from '@dao/baseDAO';
import {
  INotificationDocument,
  INotification,
  NotificationTypeEnum,
  NotificationPriorityEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import { ResourceContext } from '@interfaces/utils.interface';
import {
  createMockNotificationDocument,
  createMockNotificationDocuments,
} from '../../helpers/mocks/notification.mocks';
import { createMockNotificationModel } from '../../helpers/mocks/models.mocks';

// Mock BaseDAO
jest.mock('@dao/baseDAO');
const MockedBaseDAO = BaseDAO as jest.MockedClass<typeof BaseDAO>;

describe('NotificationDAO', () => {
  let notificationDAO: NotificationDAO;
  let mockLogger: any;
  let mockNotificationModel: any;
  let mockBaseDAOInstance: any;

  const testCuid = faker.string.uuid();
  const testUserId = new Types.ObjectId().toString();
  const testNuid = faker.string.uuid();

  beforeEach(() => {
    jest.clearAllMocks();

    mockLogger = {
      error: jest.fn(),
      info: jest.fn(),
    };

    mockNotificationModel = createMockNotificationModel();

    // Setup BaseDAO mock instance
    mockBaseDAOInstance = {
      insert: jest.fn(),
      insertMany: jest.fn(),
      findFirst: jest.fn(),
      deleteItem: jest.fn(),
      list: jest.fn(),
      updateMany: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
      model: mockNotificationModel,
      throwErrorHandler: jest.fn().mockImplementation((error) => {
        throw error;
      }),
    };

    MockedBaseDAO.mockImplementation(() => mockBaseDAOInstance);

    notificationDAO = new NotificationDAO({ notificationModel: mockNotificationModel });
    (notificationDAO as any).logger = mockLogger;
  });

  describe('create', () => {
    it('should create a notification successfully', async () => {
      const notificationData: Partial<INotification> = {
        cuid: testCuid,
        title: faker.lorem.sentence(),
        message: faker.lorem.paragraph(),
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.LOW,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: new Types.ObjectId(),
      };

      const mockCreatedNotification = createMockNotificationDocument(notificationData);
      mockBaseDAOInstance.insert.mockResolvedValue(mockCreatedNotification);

      const result = await notificationDAO.create(notificationData);

      expect(mockBaseDAOInstance.insert).toHaveBeenCalledWith(notificationData);
      expect(result).toEqual(mockCreatedNotification);
    });

    it('should handle creation errors', async () => {
      const notificationData: Partial<INotification> = {
        cuid: testCuid,
        title: faker.lorem.sentence(),
        message: faker.lorem.paragraph(),
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.LOW,
      };

      const error = new Error('Database error');
      mockBaseDAOInstance.insert.mockRejectedValue(error);
      mockBaseDAOInstance.throwErrorHandler.mockImplementation(() => {
        throw error;
      });

      await expect(notificationDAO.create(notificationData)).rejects.toThrow('Database error');
      expect(mockLogger.error).toHaveBeenCalledWith('Error creating notification:', error);
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple notifications successfully', async () => {
      const notifications: Partial<INotification>[] = [
        {
          cuid: testCuid,
          title: faker.lorem.sentence(),
          message: faker.lorem.paragraph(),
          type: NotificationTypeEnum.USER,
          priority: NotificationPriorityEnum.LOW,
        },
        {
          cuid: testCuid,
          title: faker.lorem.sentence(),
          message: faker.lorem.paragraph(),
          type: NotificationTypeEnum.SYSTEM,
          priority: NotificationPriorityEnum.HIGH,
        },
      ];

      const mockCreatedNotifications = createMockNotificationDocuments(2);
      mockBaseDAOInstance.insertMany.mockResolvedValue(mockCreatedNotifications);

      const result = await notificationDAO.bulkCreate(notifications);

      expect(mockBaseDAOInstance.insertMany).toHaveBeenCalledWith(notifications);
      expect(result).toEqual(mockCreatedNotifications);
    });
  });

  describe('findByNuid', () => {
    it('should find notification by nuid and cuid', async () => {
      const mockNotification = createMockNotificationDocument({ nuid: testNuid, cuid: testCuid });
      mockBaseDAOInstance.findFirst.mockResolvedValue(mockNotification);

      const result = await notificationDAO.findByNuid(testNuid, testCuid);

      expect(mockBaseDAOInstance.findFirst).toHaveBeenCalledWith({
        nuid: testNuid,
        cuid: testCuid,
      });
      expect(result).toEqual(mockNotification);
    });

    it('should return null when notification not found', async () => {
      mockBaseDAOInstance.findFirst.mockResolvedValue(null);

      const result = await notificationDAO.findByNuid(testNuid, testCuid);

      expect(result).toBeNull();
    });
  });

  describe('deleteByNuid', () => {
    it('should delete notification by nuid and cuid successfully', async () => {
      mockBaseDAOInstance.deleteItem.mockResolvedValue(true);

      const result = await notificationDAO.deleteByNuid(testNuid, testCuid);

      expect(mockBaseDAOInstance.deleteItem).toHaveBeenCalledWith({
        nuid: testNuid,
        cuid: testCuid,
      });
      expect(result).toBe(true);
    });

    it('should return false when notification not found', async () => {
      mockBaseDAOInstance.deleteItem.mockResolvedValue(false);

      const result = await notificationDAO.deleteByNuid(testNuid, testCuid);

      expect(result).toBe(false);
    });
  });

  describe('findForUser', () => {
    it('should find notifications for individual user', async () => {
      const mockNotifications = createMockNotificationDocuments(3);
      const mockResult = {
        items: mockNotifications,
        pagination: {
          total: 3,
          currentPage: 1,
          totalPages: 1,
          hasMoreResource: false,
        },
      };

      mockBaseDAOInstance.list.mockResolvedValue(mockResult);

      const result = await notificationDAO.findForUser(testUserId, testCuid);

      expect(mockBaseDAOInstance.list).toHaveBeenCalledWith(
        {
          cuid: testCuid,
          $or: [
            { recipientType: 'individual', recipient: new Types.ObjectId(testUserId) },
            { recipientType: 'announcement' },
          ],
          deletedAt: null,
        },
        {
          sort: { createdAt: -1 },
          populate: [{ path: 'recipient', select: 'firstName lastName email' }],
        }
      );
      expect(result).toEqual({
        data: mockNotifications,
        total: 3,
      });
    });

    it('should apply filters correctly', async () => {
      const filters = {
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.HIGH,
        isRead: false,
        resourceName: ResourceContext.PROPERTY,
        resourceId: new Types.ObjectId().toString(),
        dateFrom: new Date('2023-01-01'),
        dateTo: new Date('2023-12-31'),
      };

      const mockResult = { items: [], pagination: { total: 0 } };
      mockBaseDAOInstance.list.mockResolvedValue(mockResult);

      await notificationDAO.findForUser(testUserId, testCuid, filters);

      const expectedFilter = {
        cuid: testCuid,
        $or: [
          { recipientType: 'individual', recipient: new Types.ObjectId(testUserId) },
          { recipientType: 'announcement' },
        ],
        deletedAt: null,
        type: NotificationTypeEnum.USER,
        priority: NotificationPriorityEnum.HIGH,
        isRead: false,
        'resourceInfo.resourceName': ResourceContext.PROPERTY,
        'resourceInfo.resourceId': new Types.ObjectId(filters.resourceId),
        createdAt: {
          $gte: filters.dateFrom,
          $lte: filters.dateTo,
        },
      };

      expect(mockBaseDAOInstance.list).toHaveBeenCalledWith(
        expectedFilter,
        expect.objectContaining({
          sort: { createdAt: -1 },
          populate: [{ path: 'recipient', select: 'firstName lastName email' }],
        })
      );
    });
  });

  describe('getUnreadCount', () => {
    it('should get unread count for user', async () => {
      const expectedCount = 5;
      mockBaseDAOInstance.countDocuments.mockResolvedValue(expectedCount);

      const result = await notificationDAO.getUnreadCount(testUserId, testCuid);

      expect(mockBaseDAOInstance.countDocuments).toHaveBeenCalledWith({
        cuid: testCuid,
        $or: [
          { recipientType: 'individual', recipient: new Types.ObjectId(testUserId) },
          { recipientType: 'announcement' },
        ],
        isRead: false,
        deletedAt: null,
      });
      expect(result).toBe(expectedCount);
    });

    it('should apply filters to unread count', async () => {
      const filters = {
        type: NotificationTypeEnum.SYSTEM,
        priority: NotificationPriorityEnum.URGENT,
      };

      mockBaseDAOInstance.countDocuments.mockResolvedValue(2);

      await notificationDAO.getUnreadCount(testUserId, testCuid, filters);

      expect(mockBaseDAOInstance.countDocuments).toHaveBeenCalledWith({
        cuid: testCuid,
        $or: [
          { recipientType: 'individual', recipient: new Types.ObjectId(testUserId) },
          { recipientType: 'announcement' },
        ],
        isRead: false,
        deletedAt: null,
        type: NotificationTypeEnum.SYSTEM,
        priority: NotificationPriorityEnum.URGENT,
      });
    });
  });

  describe('getUnreadCountByType', () => {
    it('should get unread count by notification type', async () => {
      const mockAggregateResult = [
        { _id: NotificationTypeEnum.USER, count: 3 },
        { _id: NotificationTypeEnum.SYSTEM, count: 2 },
      ];

      mockBaseDAOInstance.aggregate.mockResolvedValue(mockAggregateResult);

      const result = await notificationDAO.getUnreadCountByType(testUserId, testCuid);

      expect(mockBaseDAOInstance.aggregate).toHaveBeenCalledWith([
        {
          $match: {
            cuid: testCuid,
            $or: [
              { recipientType: 'individual', recipient: new Types.ObjectId(testUserId) },
              { recipientType: 'announcement' },
            ],
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

      // Should initialize all types with 0 and update with actual counts
      expect(result[NotificationTypeEnum.USER]).toBe(3);
      expect(result[NotificationTypeEnum.SYSTEM]).toBe(2);
      expect(result[NotificationTypeEnum.ANNOUNCEMENT]).toBe(0); // Not in results, should be 0
    });
  });

  describe('markAllAsReadForUser', () => {
    it('should mark all individual notifications as read for user', async () => {
      const mockResult = { modifiedCount: 5 };
      mockBaseDAOInstance.updateMany.mockResolvedValue(mockResult);

      const result = await notificationDAO.markAllAsReadForUser(testUserId, testCuid);

      expect(mockBaseDAOInstance.updateMany).toHaveBeenCalledWith(
        {
          cuid: testCuid,
          recipientType: 'individual',
          recipient: new Types.ObjectId(testUserId),
          isRead: false,
          deletedAt: null,
        },
        {
          isRead: true,
          readAt: expect.any(Date),
        }
      );
      expect(result).toEqual({ modifiedCount: 5 });
    });
  });

  describe('findByResource', () => {
    it('should find notifications by resource reference', async () => {
      const resourceId = new Types.ObjectId().toString();
      const mockNotifications = createMockNotificationDocuments(2);
      const mockResult = { items: mockNotifications };

      mockBaseDAOInstance.list.mockResolvedValue(mockResult);

      const result = await notificationDAO.findByResource(
        ResourceContext.PROPERTY,
        resourceId,
        testCuid
      );

      expect(mockBaseDAOInstance.list).toHaveBeenCalledWith(
        {
          cuid: testCuid,
          'resourceInfo.resourceName': ResourceContext.PROPERTY,
          'resourceInfo.resourceId': new Types.ObjectId(resourceId),
          deletedAt: null,
        },
        { sort: { createdAt: -1 } }
      );
      expect(result).toEqual(mockNotifications);
    });

    it('should return empty array when no items found', async () => {
      const mockResult = { items: undefined };
      mockBaseDAOInstance.list.mockResolvedValue(mockResult);

      const result = await notificationDAO.findByResource(
        ResourceContext.PROPERTY,
        new Types.ObjectId().toString(),
        testCuid
      );

      expect(result).toEqual([]);
    });
  });

  describe('cleanup', () => {
    it('should cleanup old and expired notifications', async () => {
      const mockDocuments = [
        { _id: new Types.ObjectId() },
        { _id: new Types.ObjectId() },
      ];
      mockBaseDAOInstance.list.mockResolvedValue({ items: mockDocuments });
      mockBaseDAOInstance.deleteAll.mockResolvedValue(true);

      const result = await notificationDAO.cleanup(30);

      expect(mockBaseDAOInstance.list).toHaveBeenCalledWith(
        {
          $or: [{ deletedAt: { $lt: expect.any(Date) } }, { expiresAt: { $lt: expect.any(Date) } }],
        },
        { projection: '_id' }
      );
      expect(mockBaseDAOInstance.deleteAll).toHaveBeenCalledWith([
        mockDocuments[0]._id,
        mockDocuments[1]._id,
      ]);
      expect(result).toEqual({ deletedCount: 2 });
      expect(mockLogger.info).toHaveBeenCalledWith('Cleaned up 2 old notifications');
    });

    it('should use default 90 days if no parameter provided', async () => {
      mockBaseDAOInstance.list.mockResolvedValue({ items: [] });

      const result = await notificationDAO.cleanup();

      expect(mockBaseDAOInstance.list).toHaveBeenCalledWith(
        expect.objectContaining({
          $or: expect.any(Array),
        }),
        { projection: '_id' }
      );
      expect(result).toEqual({ deletedCount: 0 });
      expect(mockLogger.info).toHaveBeenCalledWith('No old notifications found to cleanup');
    });
  });

  describe('error handling', () => {
    it('should handle and log errors properly', async () => {
      const error = new Error('Database connection error');
      mockBaseDAOInstance.findFirst.mockRejectedValue(error);
      mockBaseDAOInstance.throwErrorHandler.mockImplementation(() => {
        throw error;
      });

      await expect(notificationDAO.findByNuid(testNuid, testCuid)).rejects.toThrow(
        'Database connection error'
      );

      expect(mockLogger.error).toHaveBeenCalledWith('Error finding notification by NUID:', error);
      expect(mockBaseDAOInstance.throwErrorHandler).toHaveBeenCalledWith(error);
    });
  });

  describe('multi-tenant security', () => {
    it('should always include cuid in NUID operations', async () => {
      const differentCuid = faker.string.uuid();

      mockBaseDAOInstance.findFirst.mockResolvedValue(null);

      await notificationDAO.findByNuid(testNuid, differentCuid);

      expect(mockBaseDAOInstance.findFirst).toHaveBeenCalledWith({
        nuid: testNuid,
        cuid: differentCuid,
      });
    });

    it('should include cuid in all user queries', async () => {
      mockBaseDAOInstance.list.mockResolvedValue({ items: [], pagination: { total: 0 } });

      await notificationDAO.findForUser(testUserId, testCuid);

      expect(mockBaseDAOInstance.list).toHaveBeenCalledWith(
        expect.objectContaining({
          cuid: testCuid,
        }),
        expect.any(Object)
      );
    });
  });
});
