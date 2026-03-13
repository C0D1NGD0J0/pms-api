import { Types } from 'mongoose';
import { clearTestDatabase } from '@tests/helpers';
import { NotificationDAO } from '@dao/notificationDAO';
import { NotificationModel, User } from '@models/index';
import { ResourceContext } from '@interfaces/utils.interface';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,} from '@interfaces/notification.interface';

describe('NotificationDAO Integration Tests', () => {
  let notificationDAO: NotificationDAO;
  let testUserId: Types.ObjectId;
  let testUserId2: Types.ObjectId;
  let testCuid: string;

  beforeAll(async () => {
    notificationDAO = new NotificationDAO({ notificationModel: NotificationModel });
  });
  beforeEach(async () => {
    await clearTestDatabase();
    testCuid = 'TEST_CLIENT';
    testUserId = new Types.ObjectId();
    testUserId2 = new Types.ObjectId();

    // Create test users
    await User.create({
      _id: testUserId,
      uid: 'user-1-uid',
      email: 'user1@example.com',
      firstName: 'User',
      lastName: 'One',
      password: 'hashed',
      activecuid: testCuid,
      cuids: [],
    });

    await User.create({
      _id: testUserId2,
      uid: 'user-2-uid',
      email: 'user2@example.com',
      firstName: 'User',
      lastName: 'Two',
      password: 'hashed',
      activecuid: testCuid,
      cuids: [],
    });
  });

  describe('create', () => {
    it('should create a notification with auto-generated nuid', async () => {
      const notification = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Test Notification',
        message: 'This is a test message',
        type: NotificationTypeEnum.INFO,
        priority: NotificationPriorityEnum.MEDIUM,
      });

      expect(notification).toBeDefined();
      expect(notification.nuid).toBeDefined();
      expect(notification.title).toBe('Test Notification');
      expect(notification.cuid).toBe(testCuid);
    });

    it('should create notification with resource info', async () => {
      const resourceId = new Types.ObjectId();
      const notification = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Property Update',
        message: 'Property has been updated',
        type: NotificationTypeEnum.PROPERTY,
        priority: NotificationPriorityEnum.HIGH,
        resourceInfo: {
          resourceName: ResourceContext.PROPERTY,
          resourceUid: 'PROP-123',
          resourceId: resourceId,
        },
      });

      expect(notification.resourceInfo).toBeDefined();
      expect(notification.resourceInfo?.resourceName).toBe(ResourceContext.PROPERTY);
      expect(notification.resourceInfo?.resourceUid).toBe('PROP-123');
    });

    it('should create announcement notification', async () => {
      const notification = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        title: 'System Announcement',
        message: 'Scheduled maintenance tonight',
        type: NotificationTypeEnum.ANNOUNCEMENT,
        priority: NotificationPriorityEnum.URGENT,
        targetRoles: ['tenant', 'landlord'],
      });

      expect(notification.recipientType).toBe(RecipientTypeEnum.ANNOUNCEMENT);
      expect(notification.targetRoles).toEqual(['tenant', 'landlord']);
      expect(notification.recipient).toBeUndefined();
    });

    it('should set default expiresAt to 30 days', async () => {
      const notification = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Test',
        message: 'Test message',
        type: NotificationTypeEnum.INFO,
      });

      expect(notification.expiresAt).toBeDefined();
      const diffInDays = Math.floor(
        (notification.expiresAt!.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
      );
      expect(diffInDays).toBeGreaterThanOrEqual(29);
      expect(diffInDays).toBeLessThanOrEqual(30);
    });

    it('should create notification with custom expiresAt', async () => {
      const customExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days
      const notification = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Urgent Notice',
        message: 'Expires in 7 days',
        type: NotificationTypeEnum.INFO,
        expiresAt: customExpiry,
      });

      expect(notification.expiresAt).toBeDefined();
      expect(notification.expiresAt?.getTime()).toBeCloseTo(customExpiry.getTime(), -3);
    });

    it('should create notification with actionUrl', async () => {
      const notification = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Payment Required',
        message: 'Your payment is due',
        type: NotificationTypeEnum.PAYMENT,
        actionUrl: '/payments/123',
      });

      expect(notification.actionUrl).toBe('/payments/123');
    });

    it('should create notification with metadata', async () => {
      const metadata = { invoiceId: '12345', amount: 500 };
      const notification = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Invoice Ready',
        message: 'Your invoice is ready',
        type: NotificationTypeEnum.PAYMENT,
        metadata,
      });

      expect(notification.metadata).toEqual(metadata);
    });
  });

  describe('bulkCreate', () => {
    it('should create multiple notifications at once', async () => {
      const notifications = await notificationDAO.bulkCreate([
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Notification 1',
          message: 'Message 1',
          type: NotificationTypeEnum.INFO,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId2,
          title: 'Notification 2',
          message: 'Message 2',
          type: NotificationTypeEnum.INFO,
        },
      ]);

      expect(notifications).toHaveLength(2);
      expect(notifications[0].title).toBe('Notification 1');
      expect(notifications[1].title).toBe('Notification 2');
    });

    it('should generate unique nuids for bulk created notifications', async () => {
      const notifications = await notificationDAO.bulkCreate([
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Test 1',
          message: 'Message 1',
          type: NotificationTypeEnum.INFO,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Test 2',
          message: 'Message 2',
          type: NotificationTypeEnum.INFO,
        },
      ]);

      expect(notifications[0].nuid).toBeDefined();
      expect(notifications[1].nuid).toBeDefined();
      expect(notifications[0].nuid).not.toBe(notifications[1].nuid);
    });

    it('should bulk create announcement notifications', async () => {
      const notifications = await notificationDAO.bulkCreate([
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          title: 'Announcement 1',
          message: 'System update',
          type: NotificationTypeEnum.ANNOUNCEMENT,
          targetRoles: ['admin'],
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          title: 'Announcement 2',
          message: 'Maintenance notice',
          type: NotificationTypeEnum.MAINTENANCE,
        },
      ]);

      expect(notifications).toHaveLength(2);
      expect(notifications[0].recipientType).toBe(RecipientTypeEnum.ANNOUNCEMENT);
      expect(notifications[1].recipientType).toBe(RecipientTypeEnum.ANNOUNCEMENT);
    });
  });

  describe('findByNuid', () => {
    it('should find notification by nuid and cuid', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Findable',
        message: 'Find me',
        type: NotificationTypeEnum.INFO,
      });

      const found = await notificationDAO.findByNuid(created.nuid, testCuid);

      expect(found).not.toBeNull();
      expect(found?.nuid).toBe(created.nuid);
      expect(found?.title).toBe('Findable');
    });

    it('should return null for non-existent nuid', async () => {
      const found = await notificationDAO.findByNuid('NON_EXISTENT', testCuid);

      expect(found).toBeNull();
    });

    it('should not find notification with wrong cuid', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Test',
        message: 'Test',
        type: NotificationTypeEnum.INFO,
      });

      const found = await notificationDAO.findByNuid(created.nuid, 'WRONG_CUID');

      expect(found).toBeNull();
    });
  });

  describe('deleteByNuid', () => {
    it('should delete notification by nuid and cuid', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Delete Me',
        message: 'Will be deleted',
        type: NotificationTypeEnum.INFO,
      });

      const result = await notificationDAO.deleteByNuid(created.nuid, testCuid);

      expect(result).toBe(true);

      const found = await notificationDAO.findByNuid(created.nuid, testCuid);
      expect(found).toBeNull();
    });

    it('should return false when deleting non-existent notification', async () => {
      const result = await notificationDAO.deleteByNuid('NON_EXISTENT', testCuid);

      expect(result).toBe(false);
    });

    it('should not delete notification with wrong cuid', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Protected',
        message: 'Cannot delete',
        type: NotificationTypeEnum.INFO,
      });

      const result = await notificationDAO.deleteByNuid(created.nuid, 'WRONG_CUID');

      expect(result).toBe(false);

      const found = await notificationDAO.findByNuid(created.nuid, testCuid);
      expect(found).not.toBeNull();
    });
  });

  describe('findForUser', () => {
    beforeEach(async () => {
      // Create individual notifications
      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Personal 1',
        message: 'Personal message 1',
        type: NotificationTypeEnum.INFO,
        priority: NotificationPriorityEnum.HIGH,
      });

      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Personal 2',
        message: 'Personal message 2',
        type: NotificationTypeEnum.MESSAGE,
        priority: NotificationPriorityEnum.MEDIUM,
        isRead: true,
      });

      // Create announcement notifications
      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        title: 'Global Announcement',
        message: 'For everyone',
        type: NotificationTypeEnum.ANNOUNCEMENT,
      });

      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        title: 'Role Announcement',
        message: 'For tenants',
        type: NotificationTypeEnum.ANNOUNCEMENT,
        targetRoles: ['tenant'],
      });
    });

    it('should find all notifications for user including announcements', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: ['tenant'] }
      );

      expect(result.data.length).toBeGreaterThanOrEqual(3);
      expect(result.total).toBeGreaterThanOrEqual(3);
    });

    it('should filter by individual recipientType', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: [] },
        { recipientType: RecipientTypeEnum.INDIVIDUAL }
      );

      expect(result.data.length).toBe(2);
      result.data.forEach((n) => {
        expect(n.recipientType).toBe(RecipientTypeEnum.INDIVIDUAL);
      });
    });

    it('should filter by announcement recipientType', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: ['tenant'] },
        { recipientType: RecipientTypeEnum.ANNOUNCEMENT }
      );

      expect(result.data.length).toBe(2);
      result.data.forEach((n) => {
        expect(n.recipientType).toBe(RecipientTypeEnum.ANNOUNCEMENT);
      });
    });

    it('should filter by notification type', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: [] },
        { type: NotificationTypeEnum.INFO }
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0].type).toBe(NotificationTypeEnum.INFO);
    });

    it('should filter by multiple notification types', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: [] },
        { type: [NotificationTypeEnum.INFO, NotificationTypeEnum.MESSAGE] }
      );

      expect(result.data.length).toBe(2);
    });

    it('should filter by priority', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: [] },
        { priority: NotificationPriorityEnum.HIGH }
      );

      expect(result.data.length).toBeGreaterThanOrEqual(1);
      expect(result.data[0].priority).toBe(NotificationPriorityEnum.HIGH);
    });

    it('should filter by isRead status', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: [] },
        { isRead: false }
      );

      expect(result.data.length).toBeGreaterThanOrEqual(2);
      result.data.forEach((n) => {
        expect(n.isRead).toBe(false);
      });
    });

    it('should filter by resourceName', async () => {
      const resourceId = new Types.ObjectId();
      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Property Update',
        message: 'Property updated',
        type: NotificationTypeEnum.PROPERTY,
        resourceInfo: {
          resourceName: ResourceContext.PROPERTY,
          resourceUid: 'PROP-123',
          resourceId: resourceId,
        },
      });

      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: [] },
        { resourceName: ResourceContext.PROPERTY }
      );

      expect(result.data.length).toBe(1);
      expect(result.data[0].resourceInfo?.resourceName).toBe(ResourceContext.PROPERTY);
    });

    it('should support pagination', async () => {
      const result = await notificationDAO.findForUser(
        testUserId.toString(),
        testCuid,
        { roles: [] },
        undefined,
        { page: 1, limit: 2 }
      );

      expect(result.data.length).toBeLessThanOrEqual(2);
    });

    it('should only include non-deleted notifications', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'To Delete',
        message: 'Will be soft deleted',
        type: NotificationTypeEnum.INFO,
      });

      await NotificationModel.updateOne({ _id: created._id }, { deletedAt: new Date() });

      const result = await notificationDAO.findForUser(testUserId.toString(), testCuid, {
        roles: [],
      });

      const foundDeleted = result.data.find((n) => n._id.toString() === created._id.toString());
      expect(foundDeleted).toBeUndefined();
    });
  });

  describe('getUnreadCount', () => {
    beforeEach(async () => {
      await notificationDAO.bulkCreate([
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Unread 1',
          message: 'Unread',
          type: NotificationTypeEnum.INFO,
          isRead: false,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Unread 2',
          message: 'Unread',
          type: NotificationTypeEnum.MESSAGE,
          isRead: false,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Read',
          message: 'Already read',
          type: NotificationTypeEnum.INFO,
          isRead: true,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          title: 'Unread Announcement',
          message: 'Announcement',
          type: NotificationTypeEnum.ANNOUNCEMENT,
          isRead: false,
        },
      ]);
    });

    it('should count unread notifications for user', async () => {
      const count = await notificationDAO.getUnreadCount(testUserId.toString(), testCuid);

      expect(count).toBe(3);
    });

    it('should filter unread count by type', async () => {
      const count = await notificationDAO.getUnreadCount(testUserId.toString(), testCuid, {
        type: NotificationTypeEnum.INFO,
      });

      expect(count).toBe(1);
    });

    it('should filter unread count by priority', async () => {
      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Urgent',
        message: 'Urgent message',
        type: NotificationTypeEnum.INFO,
        priority: NotificationPriorityEnum.URGENT,
        isRead: false,
      });

      const count = await notificationDAO.getUnreadCount(testUserId.toString(), testCuid, {
        priority: NotificationPriorityEnum.URGENT,
      });

      expect(count).toBe(1);
    });

    it('should not count deleted notifications', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Deleted',
        message: 'Will be deleted',
        type: NotificationTypeEnum.INFO,
        isRead: false,
      });

      await NotificationModel.updateOne({ _id: created._id }, { deletedAt: new Date() });

      const count = await notificationDAO.getUnreadCount(testUserId.toString(), testCuid);

      expect(count).toBe(3);
    });
  });

  describe('getUnreadCountByType', () => {
    beforeEach(async () => {
      await notificationDAO.bulkCreate([
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Info 1',
          message: 'Info',
          type: NotificationTypeEnum.INFO,
          isRead: false,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Info 2',
          message: 'Info',
          type: NotificationTypeEnum.INFO,
          isRead: false,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Message',
          message: 'Message',
          type: NotificationTypeEnum.MESSAGE,
          isRead: false,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.ANNOUNCEMENT,
          title: 'Announcement',
          message: 'Announcement',
          type: NotificationTypeEnum.ANNOUNCEMENT,
          isRead: false,
        },
      ]);
    });

    it('should return unread counts grouped by type', async () => {
      const counts = await notificationDAO.getUnreadCountByType(testUserId.toString(), testCuid);

      expect(counts[NotificationTypeEnum.INFO]).toBe(2);
      expect(counts[NotificationTypeEnum.MESSAGE]).toBe(1);
      expect(counts[NotificationTypeEnum.ANNOUNCEMENT]).toBe(1);
    });

    it('should initialize all types with 0', async () => {
      const counts = await notificationDAO.getUnreadCountByType(testUserId.toString(), testCuid);

      expect(counts[NotificationTypeEnum.PAYMENT]).toBe(0);
      expect(counts[NotificationTypeEnum.TASK]).toBe(0);
      expect(counts[NotificationTypeEnum.SYSTEM]).toBe(0);
    });

    it('should only count unread notifications', async () => {
      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Read Payment',
        message: 'Read',
        type: NotificationTypeEnum.PAYMENT,
        isRead: true,
      });

      const counts = await notificationDAO.getUnreadCountByType(testUserId.toString(), testCuid);

      expect(counts[NotificationTypeEnum.PAYMENT]).toBe(0);
    });
  });

  describe('markAllAsReadForUser', () => {
    beforeEach(async () => {
      await notificationDAO.bulkCreate([
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Unread 1',
          message: 'Unread',
          type: NotificationTypeEnum.INFO,
          isRead: false,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Unread 2',
          message: 'Unread',
          type: NotificationTypeEnum.INFO,
          isRead: false,
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId2,
          title: 'Other User',
          message: 'Should not be marked',
          type: NotificationTypeEnum.INFO,
          isRead: false,
        },
      ]);
    });

    it('should mark all user notifications as read', async () => {
      const result = await notificationDAO.markAllAsReadForUser(
        testUserId.toString(),
        testCuid
      );

      expect(result.modifiedCount).toBe(2);

      const count = await notificationDAO.getUnreadCount(testUserId.toString(), testCuid);
      expect(count).toBe(0);
    });

    it('should not mark other users notifications as read', async () => {
      await notificationDAO.markAllAsReadForUser(testUserId.toString(), testCuid);

      const count = await notificationDAO.getUnreadCount(testUserId2.toString(), testCuid);
      expect(count).toBe(1);
    });

    it('should only mark individual notifications not announcements', async () => {
      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        title: 'Announcement',
        message: 'Should not be marked',
        type: NotificationTypeEnum.ANNOUNCEMENT,
        isRead: false,
      });

      await notificationDAO.markAllAsReadForUser(testUserId.toString(), testCuid);

      const announcements = await NotificationModel.find({
        recipientType: RecipientTypeEnum.ANNOUNCEMENT,
        isRead: false,
      });
      expect(announcements.length).toBe(1);
    });

    it('should set readAt timestamp', async () => {
      const beforeMark = new Date();
      await notificationDAO.markAllAsReadForUser(testUserId.toString(), testCuid);

      const notifications = await NotificationModel.find({
        recipient: testUserId,
        isRead: true,
      });

      notifications.forEach((n) => {
        expect(n.readAt).toBeDefined();
        expect(n.readAt!.getTime()).toBeGreaterThanOrEqual(beforeMark.getTime());
      });
    });

    it('should return 0 modifiedCount when no unread notifications', async () => {
      await notificationDAO.markAllAsReadForUser(testUserId.toString(), testCuid);
      const result = await notificationDAO.markAllAsReadForUser(testUserId.toString(), testCuid);

      expect(result.modifiedCount).toBe(0);
    });
  });

  describe('findByResource', () => {
    const resourceId = new Types.ObjectId();
    const resourceUid = 'PROP-123';

    beforeEach(async () => {
      await notificationDAO.bulkCreate([
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Property Update 1',
          message: 'Update 1',
          type: NotificationTypeEnum.PROPERTY,
          resourceInfo: {
            resourceName: ResourceContext.PROPERTY,
            resourceUid: resourceUid,
            resourceId: resourceId,
          },
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Property Update 2',
          message: 'Update 2',
          type: NotificationTypeEnum.PROPERTY,
          resourceInfo: {
            resourceName: ResourceContext.PROPERTY,
            resourceUid: resourceUid,
            resourceId: resourceId,
          },
        },
        {
          cuid: testCuid,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: testUserId,
          title: 'Other Resource',
          message: 'Different resource',
          type: NotificationTypeEnum.MAINTENANCE,
          resourceInfo: {
            resourceName: ResourceContext.MAINTENANCE,
            resourceUid: 'MAINT-456',
            resourceId: new Types.ObjectId(),
          },
        },
      ]);
    });

    it('should find all notifications for a resource', async () => {
      const notifications = await notificationDAO.findByResource(
        ResourceContext.PROPERTY,
        resourceId.toString(),
        testCuid
      );

      expect(notifications.length).toBe(2);
      notifications.forEach((n) => {
        expect(n.resourceInfo?.resourceName).toBe(ResourceContext.PROPERTY);
        expect(n.resourceInfo?.resourceId.toString()).toBe(resourceId.toString());
      });
    });

    it('should return empty array for non-existent resource', async () => {
      const notifications = await notificationDAO.findByResource(
        ResourceContext.PROPERTY,
        new Types.ObjectId().toString(),
        testCuid
      );

      expect(notifications).toEqual([]);
    });

    it('should sort by createdAt descending', async () => {
      const notifications = await notificationDAO.findByResource(
        ResourceContext.PROPERTY,
        resourceId.toString(),
        testCuid
      );

      expect(notifications.length).toBe(2);
      expect(notifications[0].createdAt.getTime()).toBeGreaterThanOrEqual(
        notifications[1].createdAt.getTime()
      );
    });

    it('should not return deleted notifications', async () => {
      const notifications = await NotificationModel.find({
        'resourceInfo.resourceId': resourceId,
      });
      await NotificationModel.updateOne(
        { _id: notifications[0]._id },
        { deletedAt: new Date() }
      );

      const result = await notificationDAO.findByResource(
        ResourceContext.PROPERTY,
        resourceId.toString(),
        testCuid
      );

      expect(result.length).toBe(1);
    });
  });

  describe('findById', () => {
    it('should find notification by MongoDB _id', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Find by ID',
        message: 'Test message',
        type: NotificationTypeEnum.INFO,
      });

      const found = await notificationDAO.findById(created._id.toString());

      expect(found).not.toBeNull();
      expect(found?._id.toString()).toBe(created._id.toString());
      expect(found?.title).toBe('Find by ID');
    });

    it('should return null for non-existent id', async () => {
      const found = await notificationDAO.findById(new Types.ObjectId().toString());

      expect(found).toBeNull();
    });

    it('should throw error for invalid id format', async () => {
      await expect(notificationDAO.findById('invalid-id')).rejects.toThrow();
    });
  });

  describe('updateById', () => {
    it('should update notification by id', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Original Title',
        message: 'Original message',
        type: NotificationTypeEnum.INFO,
        priority: NotificationPriorityEnum.MEDIUM,
      });

      const updated = await notificationDAO.updateById(created._id.toString(), {
        title: 'Updated Title',
        priority: NotificationPriorityEnum.HIGH,
      });

      expect(updated).not.toBeNull();
      expect(updated?.title).toBe('Updated Title');
      expect(updated?.priority).toBe(NotificationPriorityEnum.HIGH);
    });

    it('should mark notification as read', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Unread',
        message: 'Mark as read',
        type: NotificationTypeEnum.INFO,
        isRead: false,
      });

      const updated = await notificationDAO.updateById(created._id.toString(), {
        isRead: true,
        readAt: new Date(),
      });

      expect(updated?.isRead).toBe(true);
      expect(updated?.readAt).toBeDefined();
    });

    it('should update metadata', async () => {
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'With Metadata',
        message: 'Test',
        type: NotificationTypeEnum.INFO,
        metadata: { key: 'value' },
      });

      const updated = await notificationDAO.updateById(created._id.toString(), {
        metadata: { key: 'newValue', additionalKey: 'additionalValue' },
      });

      expect(updated?.metadata).toEqual({
        key: 'newValue',
        additionalKey: 'additionalValue',
      });
    });

    it('should return null when updating non-existent notification', async () => {
      const updated = await notificationDAO.updateById(new Types.ObjectId().toString(), {
        title: 'Updated',
      });

      expect(updated).toBeNull();
    });
  });

  describe('cleanup', () => {
    it('should cleanup notifications deleted more than specified days ago', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Old Deleted',
        message: 'Old',
        type: NotificationTypeEnum.INFO,
      });

      await NotificationModel.updateOne({ _id: created._id }, { deletedAt: oldDate });

      const result = await notificationDAO.cleanup(90);

      expect(result.deletedCount).toBe(1);

      const found = await NotificationModel.findById(created._id);
      expect(found).toBeNull();
    });

    it('should cleanup expired notifications', async () => {
      const expiredDate = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000); // 1 day ago
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Expired',
        message: 'Expired',
        type: NotificationTypeEnum.INFO,
        expiresAt: expiredDate,
      });

      const result = await notificationDAO.cleanup(90);

      expect(result.deletedCount).toBe(1);

      const found = await NotificationModel.findById(created._id);
      expect(found).toBeNull();
    });

    it('should not cleanup recently deleted notifications', async () => {
      const recentDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Recent Deleted',
        message: 'Recent',
        type: NotificationTypeEnum.INFO,
      });

      await NotificationModel.updateOne({ _id: created._id }, { deletedAt: recentDate });

      const result = await notificationDAO.cleanup(90);

      expect(result.deletedCount).toBe(0);

      const found = await NotificationModel.findById(created._id);
      expect(found).not.toBeNull();
    });

    it('should not cleanup active notifications', async () => {
      await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Active',
        message: 'Active',
        type: NotificationTypeEnum.INFO,
      });

      const result = await notificationDAO.cleanup(90);

      expect(result.deletedCount).toBe(0);
    });

    it('should return 0 when no notifications to cleanup', async () => {
      const result = await notificationDAO.cleanup(90);

      expect(result.deletedCount).toBe(0);
    });

    it('should use default 90 days when no parameter provided', async () => {
      const oldDate = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000);
      const created = await notificationDAO.create({
        cuid: testCuid,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: testUserId,
        title: 'Old',
        message: 'Old',
        type: NotificationTypeEnum.INFO,
      });

      await NotificationModel.updateOne({ _id: created._id }, { deletedAt: oldDate });

      const result = await notificationDAO.cleanup();

      expect(result.deletedCount).toBe(1);
    });
  });
});
