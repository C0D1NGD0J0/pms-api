import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { ResourceContext } from '@interfaces/utils.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import {
  INotificationUnreadCountResponse,
  ICreateNotificationRequest,
  INotificationListResponse,
  NotificationPriorityEnum,
  INotificationDocument,
  INotificationResponse,
  NotificationTypeEnum,
  RecipientTypeEnum,
  INotification,
} from '@interfaces/notification.interface';

/**
 * Create a mock notification document
 */
export const createMockNotificationDocument = (
  overrides?: Partial<INotification>
): INotificationDocument => {
  const baseNotification: INotification = {
    recipientType: RecipientTypeEnum.INDIVIDUAL,
    recipient: new Types.ObjectId(),
    cuid: faker.string.uuid(),
    title: faker.lorem.sentence(),
    message: faker.lorem.paragraph(),
    type: faker.helpers.enumValue(NotificationTypeEnum),
    priority: faker.helpers.enumValue(NotificationPriorityEnum),
    resourceInfo: {
      resourceName: faker.helpers.enumValue(ResourceContext),
      resourceUid: faker.string.uuid(),
      resourceId: new Types.ObjectId(),
      displayName: faker.lorem.words(3),
    },
    isRead: false,
    createdAt: faker.date.recent(),
    updatedAt: faker.date.recent(),
    nuid: faker.string.uuid(),
    ...overrides,
  };

  return {
    ...baseNotification,
    _id: new Types.ObjectId(),
    isExpired: false,
    timeAgo: '5 minutes ago',
    markAsRead: jest.fn().mockResolvedValue(baseNotification),
    softDelete: jest.fn().mockResolvedValue(baseNotification),
    save: jest.fn().mockResolvedValue(baseNotification),
    toJSON: jest.fn().mockReturnValue(baseNotification),
    toObject: jest.fn().mockReturnValue(baseNotification),
  } as unknown as INotificationDocument;
};

/**
 * Create a mock notification response
 */
export const createMockNotificationResponse = (
  overrides?: Partial<INotificationResponse>
): INotificationResponse => ({
  id: faker.string.uuid(),
  recipientType: RecipientTypeEnum.INDIVIDUAL,
  recipient: faker.string.uuid(),
  cuid: faker.string.uuid(),
  title: faker.lorem.sentence(),
  message: faker.lorem.paragraph(),
  type: faker.helpers.enumValue(NotificationTypeEnum),
  priority: faker.helpers.enumValue(NotificationPriorityEnum),
  resourceInfo: {
    resourceName: faker.helpers.enumValue(ResourceContext),
    resourceUid: faker.string.uuid(),
    resourceId: new Types.ObjectId(),
    displayName: faker.lorem.words(3),
  },
  isRead: false,
  isExpired: false,
  createdAt: faker.date.recent(),
  updatedAt: faker.date.recent(),
  uid: faker.string.uuid(),
  ...overrides,
});

/**
 * Create a mock create notification request
 */
export const createMockCreateNotificationRequest = (
  overrides?: Partial<ICreateNotificationRequest>
): ICreateNotificationRequest => ({
  recipientType: RecipientTypeEnum.INDIVIDUAL,
  recipient: new Types.ObjectId().toString(),
  cuid: faker.string.uuid(),
  title: faker.lorem.sentence(),
  message: faker.lorem.paragraph(),
  type: faker.helpers.enumValue(NotificationTypeEnum),
  priority: faker.helpers.enumValue(NotificationPriorityEnum),
  resourceInfo: {
    resourceName: faker.helpers.enumValue(ResourceContext),
    resourceUid: faker.string.uuid(),
    resourceId: new Types.ObjectId().toString(),
    displayName: faker.lorem.words(3),
  },
  actionUrl: faker.internet.url(),
  metadata: { source: 'test' },
  ...overrides,
});

/**
 * Create a mock announcement notification request
 */
export const createMockAnnouncementRequest = (
  overrides?: Partial<ICreateNotificationRequest>
): ICreateNotificationRequest => ({
  recipientType: RecipientTypeEnum.ANNOUNCEMENT,
  cuid: faker.string.uuid(),
  title: faker.lorem.sentence(),
  message: faker.lorem.paragraph(),
  type: NotificationTypeEnum.ANNOUNCEMENT,
  priority: NotificationPriorityEnum.HIGH,
  actionUrl: faker.internet.url(),
  metadata: { source: 'announcement' },
  ...overrides,
});

/**
 * Create a mock notification list response
 */
export const createMockNotificationListResponse = (count = 5): INotificationListResponse => {
  const notifications = Array.from({ length: count }, () => createMockNotificationResponse());

  return {
    notifications,
    pagination: {
      docs: notifications,
      totalDocs: count,
      limit: 10,
      totalPages: 1,
      pagingCounter: 1,
      hasPrevPage: false,
      hasNextPage: false,
      prevPage: null,
      nextPage: null,
    },
    unreadCount: faker.number.int({ min: 0, max: count }),
  };
};

/**
 * Create a mock unread count response
 */
export const createMockUnreadCountResponse = (): INotificationUnreadCountResponse => ({
  count: faker.number.int({ min: 0, max: 50 }),
  byType: {
    [NotificationTypeEnum.ANNOUNCEMENT]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.MAINTENANCE]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.PROPERTY]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.MESSAGE]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.COMMENT]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.PAYMENT]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.SYSTEM]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.TASK]: faker.number.int({ min: 0, max: 10 }),
    [NotificationTypeEnum.USER]: faker.number.int({ min: 0, max: 10 }),
  },
});

/**
 * Create a mock notification DAO
 */
export const createMockNotificationDAO = () => ({
  create: jest.fn(),
  findById: jest.fn(),
  findByUid: jest.fn(),
  findForUser: jest.fn(),
  updateById: jest.fn(),
  deleteItem: jest.fn(),
  softdeleteItem: jest.fn(),
  getUnreadCount: jest.fn(),
  getUnreadCountByType: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsReadForUser: jest.fn(),
  findByResource: jest.fn(),
  bulkCreate: jest.fn(),
  cleanup: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  updateOne: jest.fn(),
  deleteOne: jest.fn(),
});

/**
 * Create a mock notification service
 */
export const createMockNotificationService = () => ({
  createNotification: jest.fn(),
  getNotifications: jest.fn(),
  getAnnouncements: jest.fn(),
  getNotificationById: jest.fn(),
  updateNotification: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
  getUnreadCount: jest.fn(),
  deliverNotification: jest.fn(),
  createSystemNotification: jest.fn(),
});

/**
 * Create a mock notification controller
 */
export const createMockNotificationController = () => ({
  createNotification: jest.fn(),
  getNotifications: jest.fn(),
  getNotificationById: jest.fn(),
  updateNotification: jest.fn(),
  markAsRead: jest.fn(),
  markAllAsRead: jest.fn(),
  deleteNotification: jest.fn(),
  getUnreadCount: jest.fn(),
});

/**
 * Create a mock notification socket handler
 */
export const createMockNotificationSocketHandler = () => ({
  sendToUser: jest.fn(),
  broadcastToClient: jest.fn(),
  sendNotification: jest.fn(),
  joinUserRoom: jest.fn(),
  setupNotificationHandlers: jest.fn(),
});

/**
 * Create a mock notification cache
 */
export const createMockNotificationCache = () => ({
  getUnreadCount: jest.fn(),
  setUnreadCount: jest.fn(),
  invalidateUnreadCount: jest.fn(),
  getUserNotifications: jest.fn(),
  cacheUserNotifications: jest.fn(),
  invalidateUserNotifications: jest.fn(),
});

/**
 * Create a mock notification queue
 */
export const createMockNotificationQueue = () => ({
  add: jest.fn(),
  process: jest.fn(),
  on: jest.fn(),
  close: jest.fn(),
});

/**
 * Create a mock notification validation
 */
export const createMockNotificationValidation = () => ({
  validateCreateNotification: jest.fn(),
  validateUpdateNotification: jest.fn(),
  validateGetNotifications: jest.fn(),
  validateCuid: jest.fn(),
});

/**
 * Helper to create a success response for notifications
 */
export const createNotificationSuccessResponse = <T>(data: T): ISuccessReturnData<T> => ({
  success: true,
  data,
  message: 'Operation successful',
});

/**
 * Helper to create mock notification filters
 */
export const createMockNotificationFilters = () => ({
  type: faker.helpers.enumValue(NotificationTypeEnum),
  priority: faker.helpers.enumValue(NotificationPriorityEnum),
  isRead: faker.datatype.boolean(),
  resourceName: faker.helpers.enumValue(ResourceContext),
  resourceId: faker.string.uuid(),
  dateFrom: faker.date.past(),
  dateTo: faker.date.recent(),
});

/**
 * Helper to create mock pagination query
 */
export const createMockNotificationPagination = () => ({
  page: faker.number.int({ min: 1, max: 10 }),
  limit: faker.number.int({ min: 10, max: 50 }),
  sort: 'createdAt',
  sortBy: 'desc',
});

/**
 * Helper to create mock resource info
 */
export const createMockResourceInfo = (overrides?: any) => ({
  resourceName: faker.helpers.enumValue(ResourceContext),
  resourceUid: faker.string.uuid(),
  resourceId: new Types.ObjectId(),
  displayName: faker.lorem.words(3),
  ...overrides,
});

/**
 * Create multiple notification documents for testing
 */
export const createMockNotificationDocuments = (
  count = 5,
  overrides?: Partial<INotification>[]
): INotificationDocument[] => {
  return Array.from({ length: count }, (_, index) =>
    createMockNotificationDocument(overrides?.[index])
  );
};

/**
 * Create a mock SSE service
 */
export const createMockSSEService = () => ({
  createPersonalSession: jest.fn(),
  createAnnouncementSession: jest.fn(),
  initializeConnection: jest.fn(),
  sendToUser: jest.fn(),
  sendToChannel: jest.fn(),
  cleanup: jest.fn(),
});

/**
 * Create a mock SSE session
 */
export const createMockSSESession = () => ({
  id: faker.string.uuid(),
  userId: faker.string.uuid(),
  cuid: faker.string.uuid(),
  session: {
    push: jest.fn().mockResolvedValue(undefined),
    state: {},
    on: jest.fn(),
  },
  channels: ['test-channel'],
  connectedAt: new Date(),
});

/**
 * Create a mock SSE message
 */
export const createMockSSEMessage = () => ({
  id: faker.string.uuid(),
  event: 'notification',
  data: createMockNotificationDocument(),
  timestamp: new Date(),
});

/**
 * Create a mock client service
 */
export const createMockClientService = () => ({
  getClientById: jest.fn(),
  getClientByCuid: jest.fn(),
  createClient: jest.fn(),
  updateClient: jest.fn(),
  deleteClient: jest.fn(),
});

/**
 * Create mock notification for different recipient types
 */
export const createMockIndividualNotification = (
  overrides?: Partial<INotification>
): INotificationDocument =>
  createMockNotificationDocument({
    recipientType: RecipientTypeEnum.INDIVIDUAL,
    recipient: new Types.ObjectId(),
    type: NotificationTypeEnum.USER,
    ...overrides,
  });

export const createMockAnnouncementNotification = (
  overrides?: Partial<INotification>
): INotificationDocument =>
  createMockNotificationDocument({
    recipientType: RecipientTypeEnum.ANNOUNCEMENT,
    type: NotificationTypeEnum.ANNOUNCEMENT,
    ...overrides,
  });

/**
 * Create mock notification with specific resource
 */
export const createMockMaintenanceNotification = (
  overrides?: Partial<INotification>
): INotificationDocument =>
  createMockNotificationDocument({
    type: NotificationTypeEnum.MAINTENANCE,
    resourceInfo: {
      resourceName: ResourceContext.MAINTENANCE,
      resourceUid: faker.string.uuid(),
      resourceId: new Types.ObjectId(),
      displayName: 'Maintenance Request #123',
    },
    ...overrides,
  });

export const createMockPropertyNotification = (
  overrides?: Partial<INotification>
): INotificationDocument =>
  createMockNotificationDocument({
    type: NotificationTypeEnum.PROPERTY,
    resourceInfo: {
      resourceName: ResourceContext.PROPERTY,
      resourceUid: faker.string.uuid(),
      resourceId: new Types.ObjectId(),
      displayName: 'Property: Sunset Apartments',
    },
    ...overrides,
  });
