jest.mock('web-push', () => ({
  setVapidDetails: jest.fn(),
  sendNotification: jest.fn(),
}));

jest.mock('@shared/config', () => ({
  envVariables: {
    VAPID: {
      PUBLIC_KEY: 'test-public-key',
      PRIVATE_KEY: 'test-private-key',
      SUBJECT: 'mailto:test@example.com',
    },
    SERVER: { ENV: 'test' },
  },
}));

import webpush from 'web-push';
import { PushService, PushPayload } from '@services/pushService/push.service';
import { FeatureFlag } from '@interfaces/featureFlag.interface';

const MOCK_USER_ID = '507f1f77bcf86cd799439011';
const MOCK_ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc123';

const mockPayload: PushPayload = {
  title: 'Test Title',
  body: 'Test Body',
  url: '/dashboard',
  tag: 'test-tag',
};

const mockSubscriptions = [
  {
    endpoint: MOCK_ENDPOINT,
    keys: { p256dh: 'key1', auth: 'auth1' },
  },
  {
    endpoint: 'https://updates.push.services.mozilla.com/xyz789',
    keys: { p256dh: 'key2', auth: 'auth2' },
  },
];

describe('PushService', () => {
  let pushService: PushService;
  let mockProfileDAO: any;
  let mockFeatureFlagService: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockProfileDAO = {
      getPushSubscriptions: jest.fn().mockResolvedValue([]),
      addPushSubscription: jest.fn().mockResolvedValue({ success: true }),
      removePushSubscription: jest.fn().mockResolvedValue(undefined),
    };

    mockFeatureFlagService = {
      isEnabled: jest.fn().mockReturnValue(true),
    };

    pushService = new PushService({
      profileDAO: mockProfileDAO,
      featureFlagService: mockFeatureFlagService,
    });
  });

  describe('sendToUser', () => {
    it('should send push to all user subscriptions', async () => {
      mockProfileDAO.getPushSubscriptions.mockResolvedValue(mockSubscriptions);
      (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });

      await pushService.sendToUser(MOCK_USER_ID, mockPayload);

      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
      expect(webpush.sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint: MOCK_ENDPOINT }),
        expect.any(String),
        expect.objectContaining({ TTL: 86400 })
      );
    });

    it('should skip when feature flag is disabled', async () => {
      mockFeatureFlagService.isEnabled.mockReturnValue(false);

      await pushService.sendToUser(MOCK_USER_ID, mockPayload);

      expect(mockProfileDAO.getPushSubscriptions).not.toHaveBeenCalled();
    });

    it('should skip when user has no subscriptions', async () => {
      mockProfileDAO.getPushSubscriptions.mockResolvedValue([]);

      await pushService.sendToUser(MOCK_USER_ID, mockPayload);

      expect(webpush.sendNotification).not.toHaveBeenCalled();
    });

    it('should remove subscription on 410 Gone', async () => {
      mockProfileDAO.getPushSubscriptions.mockResolvedValue([mockSubscriptions[0]]);
      const error = Object.assign(new Error('Gone'), { statusCode: 410 });
      (webpush.sendNotification as jest.Mock).mockRejectedValue(error);

      await pushService.sendToUser(MOCK_USER_ID, mockPayload);

      expect(mockProfileDAO.removePushSubscription).toHaveBeenCalledWith(
        MOCK_USER_ID,
        MOCK_ENDPOINT
      );
    });

    it('should remove subscription on 404 Not Found', async () => {
      mockProfileDAO.getPushSubscriptions.mockResolvedValue([mockSubscriptions[0]]);
      const error = Object.assign(new Error('Not Found'), { statusCode: 404 });
      (webpush.sendNotification as jest.Mock).mockRejectedValue(error);

      await pushService.sendToUser(MOCK_USER_ID, mockPayload);

      expect(mockProfileDAO.removePushSubscription).toHaveBeenCalledWith(
        MOCK_USER_ID,
        MOCK_ENDPOINT
      );
    });

    it('should not throw on failure (fire-and-forget)', async () => {
      mockProfileDAO.getPushSubscriptions.mockResolvedValue([mockSubscriptions[0]]);
      (webpush.sendNotification as jest.Mock).mockRejectedValue(new Error('Network error'));

      await expect(pushService.sendToUser(MOCK_USER_ID, mockPayload)).resolves.not.toThrow();
    });

    it('should send to multiple devices in parallel', async () => {
      mockProfileDAO.getPushSubscriptions.mockResolvedValue(mockSubscriptions);
      (webpush.sendNotification as jest.Mock).mockResolvedValue({ statusCode: 201 });

      await pushService.sendToUser(MOCK_USER_ID, mockPayload);

      expect(webpush.sendNotification).toHaveBeenCalledTimes(2);
    });
  });

  describe('subscribe', () => {
    const subscription = {
      endpoint: MOCK_ENDPOINT,
      keys: { p256dh: 'key1', auth: 'auth1' },
    };

    it('should add push subscription via profileDAO', async () => {
      await pushService.subscribe(MOCK_USER_ID, subscription);

      expect(mockProfileDAO.addPushSubscription).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.objectContaining({
          endpoint: subscription.endpoint,
          keys: subscription.keys,
        })
      );
    });

    it('should pass deviceLabel when provided', async () => {
      await pushService.subscribe(MOCK_USER_ID, subscription, 'My iPhone');

      expect(mockProfileDAO.addPushSubscription).toHaveBeenCalledWith(
        MOCK_USER_ID,
        expect.objectContaining({ deviceLabel: 'My iPhone' })
      );
    });
  });

  describe('unsubscribe', () => {
    it('should remove subscription by endpoint', async () => {
      await pushService.unsubscribe(MOCK_USER_ID, MOCK_ENDPOINT);

      expect(mockProfileDAO.removePushSubscription).toHaveBeenCalledWith(
        MOCK_USER_ID,
        MOCK_ENDPOINT
      );
    });
  });

  describe('constructor', () => {
    it('should not configure VAPID when keys are missing', () => {
      jest.resetModules();
      jest.doMock('@shared/config', () => ({
        envVariables: {
          VAPID: { PUBLIC_KEY: '', PRIVATE_KEY: '', SUBJECT: '' },
          SERVER: { ENV: 'test' },
        },
      }));
      jest.doMock('web-push', () => ({
        setVapidDetails: jest.fn(),
        sendNotification: jest.fn(),
      }));

      const freshWebpush = require('web-push');
      const { PushService: FreshPushService } = require('@services/pushService/push.service');
      new FreshPushService({
        profileDAO: mockProfileDAO,
        featureFlagService: mockFeatureFlagService,
      });

      expect(freshWebpush.setVapidDetails).not.toHaveBeenCalled();
    });
  });
});
