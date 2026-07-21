import { Types } from 'mongoose';
import { ProfileDAO } from '@dao/profileDAO';
import { Profile, User } from '@models/index';
import { clearTestDatabase } from '@tests/helpers';

describe('ProfileDAO — Push Subscription Methods', () => {
  let profileDAO: ProfileDAO;
  let testUserId: Types.ObjectId;

  beforeAll(async () => {
    profileDAO = new ProfileDAO({ profileModel: Profile });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    testUserId = new Types.ObjectId();

    await User.create({
      _id: testUserId,
      uid: 'test-push-uid',
      email: 'push-test@example.com',
      password: 'hashed',
      activecuid: 'TEST_CUID',
      cuids: [
        {
          cuid: 'TEST_CUID',
          clientDisplayName: 'Test Client',
          roles: ['tenant'],
          isConnected: true,
        },
      ],
    });

    await Profile.create({
      user: testUserId,
      puid: 'test-push-puid',
      personalInfo: {
        displayName: 'Push Test User',
        firstName: 'Push',
        lastName: 'Test',
        location: 'Toronto',
        phoneNumber: '1234567890',
      },
      settings: {
        lang: 'en',
        timeZone: 'UTC',
        theme: 'light',
        loginType: 'password',
        notifications: {
          messages: false,
          comments: false,
          announcements: true,
          maintenance: true,
          payments: true,
          system: true,
          propertyUpdates: true,
          emailNotifications: true,
          inAppNotifications: true,
          pushNotifications: false,
          emailFrequency: 'immediate',
        },
      },
    });
  });

  describe('addPushSubscription', () => {
    const subscription = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
      keys: { p256dh: 'test-p256dh-key', auth: 'test-auth-key' },
      deviceLabel: 'Test Device',
    };

    it('should add subscription to profile', async () => {
      await profileDAO.addPushSubscription(testUserId.toString(), subscription);

      const profile = await Profile.findOne({ user: testUserId }).lean();
      expect(profile!.settings.pushSubscriptions).toHaveLength(1);
      expect(profile!.settings.pushSubscriptions![0].endpoint).toBe(subscription.endpoint);
      expect(profile!.settings.pushSubscriptions![0].keys.p256dh).toBe(subscription.keys.p256dh);
    });

    it('should set pushNotifications to true', async () => {
      await profileDAO.addPushSubscription(testUserId.toString(), subscription);

      const profile = await Profile.findOne({ user: testUserId }).lean();
      expect(profile!.settings.notifications?.pushNotifications).toBe(true);
    });

    it('should allow multiple subscriptions', async () => {
      await profileDAO.addPushSubscription(testUserId.toString(), subscription);
      await profileDAO.addPushSubscription(testUserId.toString(), {
        endpoint: 'https://push.service.com/device-2',
        keys: { p256dh: 'key-2', auth: 'auth-2' },
      });

      const profile = await Profile.findOne({ user: testUserId }).lean();
      expect(profile!.settings.pushSubscriptions).toHaveLength(2);
    });
  });

  describe('removePushSubscription', () => {
    it('should remove subscription by endpoint', async () => {
      await profileDAO.addPushSubscription(testUserId.toString(), {
        endpoint: 'https://push.service.com/to-remove',
        keys: { p256dh: 'key', auth: 'auth' },
      });

      await profileDAO.removePushSubscription(
        testUserId.toString(),
        'https://push.service.com/to-remove'
      );

      const profile = await Profile.findOne({ user: testUserId }).lean();
      expect(profile!.settings.pushSubscriptions).toHaveLength(0);
    });

    it('should not throw if endpoint not found', async () => {
      await expect(
        profileDAO.removePushSubscription(testUserId.toString(), 'https://nonexistent.com')
      ).resolves.not.toThrow();
    });
  });

  describe('getPushSubscriptions', () => {
    it('should return subscriptions when pushNotifications is true', async () => {
      await profileDAO.addPushSubscription(testUserId.toString(), {
        endpoint: 'https://push.service.com/device-1',
        keys: { p256dh: 'key1', auth: 'auth1' },
      });

      const subs = await profileDAO.getPushSubscriptions(testUserId.toString());
      expect(subs).toHaveLength(1);
      expect(subs[0].endpoint).toBe('https://push.service.com/device-1');
    });

    it('should return empty array when pushNotifications is false', async () => {
      // Add subscription (sets pushNotifications=true)
      await profileDAO.addPushSubscription(testUserId.toString(), {
        endpoint: 'https://push.service.com/device-1',
        keys: { p256dh: 'key1', auth: 'auth1' },
      });

      // Manually disable the toggle
      await Profile.updateOne(
        { user: testUserId },
        { $set: { 'settings.notifications.pushNotifications': false } }
      );

      const subs = await profileDAO.getPushSubscriptions(testUserId.toString());
      expect(subs).toHaveLength(0);
    });

    it('should return empty array when no subscriptions exist', async () => {
      const subs = await profileDAO.getPushSubscriptions(testUserId.toString());
      expect(subs).toHaveLength(0);
    });
  });
});
