import { SSECache } from '@caching/sse.cache';
import { BaseCache } from '@caching/base.cache';
import { ISSEMessage } from '@interfaces/sse.interface';
import { createMockNotificationDocument } from '@tests/helpers';
import { faker } from '@faker-js/faker';

// Mock BaseCache and its dependencies
const mockClient = {
  isOpen: true,
  connect: jest.fn().mockResolvedValue(undefined),
  publish: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn().mockResolvedValue(undefined),
};

const mockLogger = {
  info: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

const mockBaseCache = {
  setObject: jest.fn(),
  getObject: jest.fn(),
  deleteItems: jest.fn(),
  addToList: jest.fn(),
  removeFromList: jest.fn(),
  getListItems: jest.fn(),
  publish: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
  validateTenant: jest.fn(),
  client: mockClient,
  log: mockLogger,
};

jest.mock('@caching/base.cache', () => ({
  BaseCache: jest.fn().mockImplementation(() => mockBaseCache),
}));

describe('SSECache', () => {
  let sseCache: SSECache;

  beforeEach(() => {
    sseCache = new SSECache();
    jest.clearAllMocks();
  });

  describe('generatePersonalChannel', () => {
    it('should generate personal channel with correct format', () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      const channel = sseCache.generatePersonalChannel(userId, cuid);

      expect(channel).toBe(`notifications:${cuid}:user:${userId}`);
    });

    it('should generate consistent channels for same user/client', () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      const channel1 = sseCache.generatePersonalChannel(userId, cuid);
      const channel2 = sseCache.generatePersonalChannel(userId, cuid);

      expect(channel1).toBe(channel2);
    });
  });

  describe('generateAnnouncementChannels', () => {
    it('should generate announcement channels for client', () => {
      const cuid = faker.string.uuid();

      const channels = sseCache.generateAnnouncementChannels(cuid);

      expect(channels).toEqual([
        `announcements:${cuid}:general`,
        `announcements:${cuid}:urgent`,
        `announcements:${cuid}:system`,
      ]);
    });

    it('should generate consistent channels for same client', () => {
      const cuid = faker.string.uuid();

      const channels1 = sseCache.generateAnnouncementChannels(cuid);
      const channels2 = sseCache.generateAnnouncementChannels(cuid);

      expect(channels1).toEqual(channels2);
    });
  });

  describe('storeUserChannels', () => {
    it('should store user channels with TTL', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const channels = ['channel1', 'channel2'];

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.setObject.mockResolvedValue({ success: true, data: null });

      const result = await sseCache.storeUserChannels(userId, cuid, channels);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      expect(mockBaseCache.setObject).toHaveBeenCalledWith(
        `sse:user:channels:${userId}:${cuid}`,
        { channels, userId, cuid, timestamp: expect.any(Date) },
        7200 // 2 hour TTL
      );
      expect(result).toEqual({ success: true, data: null });
    });

    it('should handle invalid tenant', async () => {
      const userId = faker.string.uuid();
      const cuid = 'invalid-cuid';
      const channels = ['channel1'];

      mockBaseCache.validateTenant.mockReturnValue(false);

      const result = await sseCache.storeUserChannels(userId, cuid, channels);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Invalid tenant ID format',
      });
      expect(mockBaseCache.setObject).not.toHaveBeenCalled();
    });

    it('should handle storage failure', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const channels = ['channel1'];

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.setObject.mockResolvedValue({
        success: false,
        data: null,
        error: 'Redis connection failed',
      });

      const result = await sseCache.storeUserChannels(userId, cuid, channels);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Redis connection failed',
      });
    });

    it('should handle unexpected errors', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const channels = ['channel1'];

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.setObject.mockRejectedValue(new Error('Network error'));

      const result = await sseCache.storeUserChannels(userId, cuid, channels);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Network error',
      });
    });
  });

  describe('getUserChannels', () => {
    it('should retrieve user channels', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const storedChannels = {
        channels: ['channel1', 'channel2'],
        userId,
        cuid,
        timestamp: new Date(),
      };

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.getObject.mockResolvedValue({ success: true, data: storedChannels });

      const result = await sseCache.getUserChannels(userId, cuid);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      expect(mockBaseCache.getObject).toHaveBeenCalledWith(`sse:user:channels:${userId}:${cuid}`);
      expect(result).toEqual({ success: true, data: storedChannels });
    });

    it('should handle invalid tenant', async () => {
      const userId = faker.string.uuid();
      const cuid = 'invalid-cuid';

      mockBaseCache.validateTenant.mockReturnValue(false);

      const result = await sseCache.getUserChannels(userId, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Invalid tenant ID format',
      });
      expect(mockBaseCache.getObject).not.toHaveBeenCalled();
    });

    it('should handle retrieval failure', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.getObject.mockResolvedValue({
        success: false,
        data: null,
        error: 'Key not found',
      });

      const result = await sseCache.getUserChannels(userId, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Key not found',
      });
    });
  });

  describe('removeUserChannels', () => {
    it('should remove user channels', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.deleteItems.mockResolvedValue({ success: true, data: 1 });

      const result = await sseCache.removeUserChannels(userId, cuid);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      expect(mockBaseCache.deleteItems).toHaveBeenCalledWith([`sse:user:channels:${userId}:${cuid}`]);
      expect(result).toEqual({ success: true, data: 1 });
    });

    it('should handle invalid tenant', async () => {
      const userId = faker.string.uuid();
      const cuid = 'invalid-cuid';

      mockBaseCache.validateTenant.mockReturnValue(false);

      const result = await sseCache.removeUserChannels(userId, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Invalid tenant ID format',
      });
      expect(mockBaseCache.deleteItems).not.toHaveBeenCalled();
    });

    it('should handle deletion failure', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.deleteItems.mockResolvedValue({
        success: false,
        data: null,
        error: 'Deletion failed',
      });

      const result = await sseCache.removeUserChannels(userId, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Deletion failed',
      });
    });
  });

  describe('addUserToChannel', () => {
    it('should add user to channel subscriber list', async () => {
      const channel = 'test-channel';
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.addToList.mockResolvedValue({ success: true, data: 1 });

      const result = await sseCache.addUserToChannel(channel, userId, cuid);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      expect(mockBaseCache.addToList).toHaveBeenCalledWith(
        `sse:channel:${channel}:subscribers`,
        `${userId}:${cuid}`
      );
      expect(result).toEqual({ success: true, data: 1 });
    });

    it('should handle invalid tenant', async () => {
      const channel = 'test-channel';
      const userId = faker.string.uuid();
      const cuid = 'invalid-cuid';

      mockBaseCache.validateTenant.mockReturnValue(false);

      const result = await sseCache.addUserToChannel(channel, userId, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Invalid tenant ID format',
      });
      expect(mockBaseCache.addToList).not.toHaveBeenCalled();
    });
  });

  describe('removeUserFromChannel', () => {
    it('should remove user from channel subscriber list', async () => {
      const channel = 'test-channel';
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.removeFromList.mockResolvedValue({ success: true, data: 1 });

      const result = await sseCache.removeUserFromChannel(channel, userId, cuid);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      expect(mockBaseCache.removeFromList).toHaveBeenCalledWith(
        `sse:channel:${channel}:subscribers`,
        `${userId}:${cuid}`
      );
      expect(result).toEqual({ success: true, data: 1 });
    });

    it('should handle invalid tenant', async () => {
      const channel = 'test-channel';
      const userId = faker.string.uuid();
      const cuid = 'invalid-cuid';

      mockBaseCache.validateTenant.mockReturnValue(false);

      const result = await sseCache.removeUserFromChannel(channel, userId, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Invalid tenant ID format',
      });
      expect(mockBaseCache.removeFromList).not.toHaveBeenCalled();
    });
  });

  describe('getUsersForChannel', () => {
    it('should get users subscribed to channel', async () => {
      const channel = 'test-channel';
      const subscribers = ['user1:cuid1', 'user2:cuid1', 'user3:cuid2'];

      mockBaseCache.getListItems.mockResolvedValue({ success: true, data: subscribers });

      const result = await sseCache.getUsersForChannel(channel);

      expect(mockBaseCache.getListItems).toHaveBeenCalledWith(`sse:channel:${channel}:subscribers`);
      expect(result).toEqual({ success: true, data: subscribers });
    });

    it('should handle empty subscriber list', async () => {
      const channel = 'test-channel';

      mockBaseCache.getListItems.mockResolvedValue({ success: true, data: [] });

      const result = await sseCache.getUsersForChannel(channel);

      expect(result).toEqual({ success: true, data: [] });
    });

    it('should handle retrieval failure', async () => {
      const channel = 'test-channel';

      mockBaseCache.getListItems.mockResolvedValue({
        success: false,
        data: null,
        error: 'Channel not found',
      });

      const result = await sseCache.getUsersForChannel(channel);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Channel not found',
      });
    });
  });

  describe('publishToChannel', () => {
    it('should publish message to channel', async () => {
      const channel = 'test-channel';
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockBaseCache.publish.mockResolvedValue({ success: true, data: 1 });

      const result = await sseCache.publishToChannel(channel, message);

      expect(mockBaseCache.publish).toHaveBeenCalledWith(channel, JSON.stringify(message));
      expect(result).toEqual({ success: true, data: 1 });
    });

    it('should handle publish failure', async () => {
      const channel = 'test-channel';
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockBaseCache.publish.mockResolvedValue({
        success: false,
        data: null,
        error: 'Publish failed',
      });

      const result = await sseCache.publishToChannel(channel, message);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Publish failed',
      });
    });

    it('should handle JSON serialization errors', async () => {
      const channel = 'test-channel';
      const circularMessage = {} as any;
      circularMessage.self = circularMessage; // Create circular reference

      const result = await sseCache.publishToChannel(channel, circularMessage);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Converting circular structure to JSON');
    });

    it('should handle unexpected errors', async () => {
      const channel = 'test-channel';
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockBaseCache.publish.mockRejectedValue(new Error('Network error'));

      const result = await sseCache.publishToChannel(channel, message);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Network error',
      });
    });
  });

  describe('subscribeToChannels', () => {
    it('should subscribe to channels with callback', async () => {
      const channels = ['channel1', 'channel2'];
      const cuid = faker.string.uuid();
      const callback = jest.fn();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.subscribe.mockResolvedValue({ success: true, data: null });

      const result = await sseCache.subscribeToChannels(channels, cuid, callback);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      expect(mockBaseCache.subscribe).toHaveBeenCalledWith(channels, callback);
      expect(result).toEqual({ success: true, data: null });
    });

    it('should handle invalid tenant', async () => {
      const channels = ['channel1'];
      const cuid = 'invalid-cuid';
      const callback = jest.fn();

      mockBaseCache.validateTenant.mockReturnValue(false);

      const result = await sseCache.subscribeToChannels(channels, cuid, callback);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Invalid tenant ID format',
      });
      expect(mockBaseCache.subscribe).not.toHaveBeenCalled();
    });

    it('should handle subscription failure', async () => {
      const channels = ['channel1'];
      const cuid = faker.string.uuid();
      const callback = jest.fn();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.subscribe.mockResolvedValue({
        success: false,
        data: null,
        error: 'Subscription failed',
      });

      const result = await sseCache.subscribeToChannels(channels, cuid, callback);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Subscription failed',
      });
    });

    it('should handle unexpected errors', async () => {
      const channels = ['channel1'];
      const cuid = faker.string.uuid();
      const callback = jest.fn();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.subscribe.mockRejectedValue(new Error('Network error'));

      const result = await sseCache.subscribeToChannels(channels, cuid, callback);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Network error',
      });
    });
  });

  describe('unsubscribeFromChannels', () => {
    it('should unsubscribe from channels', async () => {
      const channels = ['channel1', 'channel2'];
      const cuid = faker.string.uuid();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.unsubscribe.mockResolvedValue({ success: true, data: null });

      const result = await sseCache.unsubscribeFromChannels(channels, cuid);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      expect(mockBaseCache.unsubscribe).toHaveBeenCalledWith(channels);
      expect(result).toEqual({ success: true, data: null });
    });

    it('should handle invalid tenant', async () => {
      const channels = ['channel1'];
      const cuid = 'invalid-cuid';

      mockBaseCache.validateTenant.mockReturnValue(false);

      const result = await sseCache.unsubscribeFromChannels(channels, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Invalid tenant ID format',
      });
      expect(mockBaseCache.unsubscribe).not.toHaveBeenCalled();
    });

    it('should handle unsubscribe failure', async () => {
      const channels = ['channel1'];
      const cuid = faker.string.uuid();

      mockBaseCache.validateTenant.mockReturnValue(true);
      mockBaseCache.unsubscribe.mockResolvedValue({
        success: false,
        data: null,
        error: 'Unsubscribe failed',
      });

      const result = await sseCache.unsubscribeFromChannels(channels, cuid);

      expect(result).toEqual({
        success: false,
        data: null,
        error: 'Unsubscribe failed',
      });
    });
  });

  describe('error handling', () => {
    it('should handle missing channel parameter', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      const result = await sseCache.addUserToChannel('', userId, cuid);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle missing userId parameter', async () => {
      const channel = 'test-channel';
      const cuid = faker.string.uuid();

      const result = await sseCache.addUserToChannel(channel, '', cuid);

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should handle empty channels array', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      const result = await sseCache.storeUserChannels(userId, cuid, []);

      expect(mockBaseCache.validateTenant).toHaveBeenCalledWith(cuid);
      // Should still store empty array - that's valid
      if (mockBaseCache.validateTenant.mockReturnValue(true)) {
        expect(mockBaseCache.setObject).toHaveBeenCalled();
      }
    });
  });
});