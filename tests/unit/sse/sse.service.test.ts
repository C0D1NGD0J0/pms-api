import { Request, Response } from 'express';
import { Session } from 'better-sse';
import { SSEService } from '@services/sse/sse.service';
import { SSECache } from '@caching/sse.cache';
import { ISSESession, ISSEMessage } from '@interfaces/sse.interface';
import { INotificationDocument } from '@interfaces/notification.interface';
import { createLogger } from '@utils/index';
import { faker } from '@faker-js/faker';
import { createMockNotificationDocument } from '../../helpers';

// Mock better-sse
const mockSession = {
  push: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  state: {},
} as unknown as Session;

const mockChannel = {
  register: jest.fn(),
  deregister: jest.fn(),
  broadcast: jest.fn(),
  sessionCount: 1,
} as unknown as any;

const mockCreateSession = jest.fn().mockResolvedValue(mockSession);
const mockCreateChannel = jest.fn().mockReturnValue(mockChannel);

jest.mock('better-sse', () => ({
  createSession: jest.fn(),
  createChannel: jest.fn(),
}));

// Mock logger
jest.mock('@utils/index', () => ({
  createLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

describe('SSEService', () => {
  let sseService: SSEService;
  let mockSseCache: jest.Mocked<SSECache>;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;

  beforeEach(() => {
    // Create mock SSECache
    mockSseCache = {
      generatePersonalChannel: jest.fn(),
      generateAnnouncementChannels: jest.fn(),
      storeUserChannels: jest.fn(),
      addUserToChannel: jest.fn(),
      publishToChannel: jest.fn(),
      subscribeToChannels: jest.fn(),
      removeUserChannels: jest.fn(),
      getUsersForChannel: jest.fn(),
    } as unknown as jest.Mocked<SSECache>;

    sseService = new SSEService({ sseCache: mockSseCache });

    // Mock Express Request/Response
    mockRequest = {
      headers: {},
      connection: {},
    };

    mockResponse = {
      writeHead: jest.fn(),
      write: jest.fn(),
      end: jest.fn(),
      on: jest.fn(),
    };

    // Setup better-sse mocks
    const { createSession, createChannel } = require('better-sse');
    (createSession as jest.Mock).mockResolvedValue(mockSession);
    (createChannel as jest.Mock).mockReturnValue(mockChannel);

    jest.clearAllMocks();
  });

  describe('createPersonalSession', () => {
    it('should create personal session successfully', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const personalChannel = `notifications:${cuid}:user:${userId}`;

      mockSseCache.generatePersonalChannel.mockReturnValue(personalChannel);
      mockSseCache.storeUserChannels.mockResolvedValue({ success: true, data: null });
      mockSseCache.addUserToChannel.mockResolvedValue({ success: true, data: null });

      const result = await sseService.createPersonalSession(userId, cuid);

      expect(result).toEqual(
        expect.objectContaining({
          userId,
          cuid,
          channels: [personalChannel],
          connectedAt: expect.any(Date),
        })
      );
      expect(mockSseCache.generatePersonalChannel).toHaveBeenCalledWith(userId, cuid);
      expect(mockSseCache.storeUserChannels).toHaveBeenCalledWith(userId, cuid, [personalChannel]);
      expect(mockSseCache.addUserToChannel).toHaveBeenCalledWith(personalChannel, userId, cuid);
    });

    it('should handle cache store failure', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const personalChannel = `notifications:${cuid}:user:${userId}`;

      mockSseCache.generatePersonalChannel.mockReturnValue(personalChannel);
      mockSseCache.storeUserChannels.mockResolvedValue({
        success: false,
        data: null,
        error: 'Redis connection failed',
      });

      await expect(sseService.createPersonalSession(userId, cuid)).rejects.toThrow(
        'Failed to store user channels: Redis connection failed'
      );
    });

    it('should handle unexpected errors', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();

      mockSseCache.generatePersonalChannel.mockImplementation(() => {
        throw new Error('Cache error');
      });

      await expect(sseService.createPersonalSession(userId, cuid)).rejects.toThrow('Cache error');
    });
  });

  describe('createAnnouncementSession', () => {
    it('should create announcement session successfully', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const announcementChannels = [`announcements:${cuid}:general`, `announcements:${cuid}:urgent`];

      mockSseCache.generateAnnouncementChannels.mockReturnValue(announcementChannels);
      mockSseCache.storeUserChannels.mockResolvedValue({ success: true, data: null });
      mockSseCache.addUserToChannel.mockResolvedValue({ success: true, data: null });

      const result = await sseService.createAnnouncementSession(userId, cuid);

      expect(result).toEqual(
        expect.objectContaining({
          userId,
          cuid,
          channels: announcementChannels,
          connectedAt: expect.any(Date),
        })
      );
      expect(mockSseCache.generateAnnouncementChannels).toHaveBeenCalledWith(cuid);
      expect(mockSseCache.storeUserChannels).toHaveBeenCalledWith(userId, cuid, announcementChannels);
      expect(mockSseCache.addUserToChannel).toHaveBeenCalledTimes(2);
    });

    it('should handle multiple channel subscriptions', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const announcementChannels = [
        `announcements:${cuid}:general`,
        `announcements:${cuid}:urgent`,
        `announcements:${cuid}:maintenance`,
      ];

      mockSseCache.generateAnnouncementChannels.mockReturnValue(announcementChannels);
      mockSseCache.storeUserChannels.mockResolvedValue({ success: true, data: null });
      mockSseCache.addUserToChannel.mockResolvedValue({ success: true, data: null });

      await sseService.createAnnouncementSession(userId, cuid);

      expect(mockSseCache.addUserToChannel).toHaveBeenCalledTimes(3);
      announcementChannels.forEach((channel) => {
        expect(mockSseCache.addUserToChannel).toHaveBeenCalledWith(channel, userId, cuid);
      });
    });
  });

  describe('initializeConnection', () => {
    it('should initialize SSE connection successfully', async () => {
      const sessionData: ISSESession = {
        id: '',
        userId: faker.string.uuid(),
        cuid: faker.string.uuid(),
        session: null as any,
        channels: ['test-channel'],
        connectedAt: new Date(),
      };

      const result = await sseService.initializeConnection(
        mockRequest as Request,
        mockResponse as Response,
        sessionData
      );

      const { createSession } = require('better-sse');
      expect(createSession).toHaveBeenCalledWith(mockRequest, mockResponse);
      expect(result).toBe(mockSession);
      expect(sessionData.id).toMatch(/^.*-\d+$/); // Should have generated ID with timestamp
      expect(sessionData.session).toBe(mockSession);
      expect(mockSession.state).toEqual({
        userId: sessionData.userId,
        cuid: sessionData.cuid,
        channels: sessionData.channels,
        sessionId: sessionData.id,
      });
      expect(mockSession.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
    });

    it('should register session to personal channel', async () => {
      const sessionData: ISSESession = {
        id: '',
        userId: faker.string.uuid(),
        cuid: faker.string.uuid(),
        session: null as any,
        channels: [`notifications:test-client:user:${faker.string.uuid()}`],
        connectedAt: new Date(),
      };

      const { createChannel } = require('better-sse');

      await sseService.initializeConnection(
        mockRequest as Request,
        mockResponse as Response,
        sessionData
      );

      expect(createChannel).toHaveBeenCalled();
      expect(mockChannel.register).toHaveBeenCalledWith(mockSession);
    });

    it('should register session to announcement channel', async () => {
      const sessionData: ISSESession = {
        id: '',
        userId: faker.string.uuid(),
        cuid: faker.string.uuid(),
        session: null as any,
        channels: [`announcements:${faker.string.uuid()}:general`],
        connectedAt: new Date(),
      };

      await sseService.initializeConnection(
        mockRequest as Request,
        mockResponse as Response,
        sessionData
      );

      expect(mockChannel.register).toHaveBeenCalledWith(mockSession);
    });

    it('should handle better-sse initialization failure', async () => {
      const sessionData: ISSESession = {
        id: '',
        userId: faker.string.uuid(),
        cuid: faker.string.uuid(),
        session: null as any,
        channels: ['test-channel'],
        connectedAt: new Date(),
      };

      const { createSession } = require('better-sse');
      (createSession as jest.Mock).mockRejectedValueOnce(new Error('SSE initialization failed'));

      await expect(
        sseService.initializeConnection(mockRequest as Request, mockResponse as Response, sessionData)
      ).rejects.toThrow('SSE initialization failed');
    });

    it('should setup disconnect handler', async () => {
      const sessionData: ISSESession = {
        id: '',
        userId: faker.string.uuid(),
        cuid: faker.string.uuid(),
        session: null as any,
        channels: ['test-channel'],
        connectedAt: new Date(),
      };

      mockSseCache.removeUserChannels.mockResolvedValue({ success: true, data: null });

      await sseService.initializeConnection(
        mockRequest as Request,
        mockResponse as Response,
        sessionData
      );

      // Get the disconnect handler that was registered
      const disconnectHandler = (mockSession.on as jest.Mock).mock.calls.find(
        (call) => call[0] === 'disconnected'
      )[1];

      // Trigger the disconnect handler
      await disconnectHandler();

      expect(mockSseCache.removeUserChannels).toHaveBeenCalledWith(sessionData.userId, sessionData.cuid);
    });
  });

  describe('sendToUser', () => {
    it('should send message to user successfully', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const personalChannel = `notifications:${cuid}:user:${userId}`;
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockSseCache.generatePersonalChannel.mockReturnValue(personalChannel);
      mockSseCache.publishToChannel.mockResolvedValue({ success: true, data: null });

      const result = await sseService.sendToUser(userId, cuid, message);

      expect(result).toBe(true);
      expect(mockSseCache.generatePersonalChannel).toHaveBeenCalledWith(userId, cuid);
      expect(mockSseCache.publishToChannel).toHaveBeenCalledWith(personalChannel, message);
    });

    it('should handle send failure', async () => {
      const userId = faker.string.uuid();
      const cuid = faker.string.uuid();
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockSseCache.generatePersonalChannel.mockImplementation(() => {
        throw new Error('Cache error');
      });

      const result = await sseService.sendToUser(userId, cuid, message);

      expect(result).toBe(false);
    });
  });

  describe('Channel Broadcasting Integration', () => {
    it('should broadcast messages to registered sessions via better-sse channels', async () => {
      const cuid = faker.string.uuid();
      const userId = faker.string.uuid();
      const sessionData: ISSESession = {
        id: faker.string.uuid(),
        userId,
        cuid,
        channels: [`notifications:${cuid}:user:${userId}`],
        session: mockSession,
        connectedAt: new Date(),
      };

      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      // Initialize connection should register session to channel
      const result = await sseService.initializeConnection(
        mockRequest as Request,
        mockResponse as Response,
        sessionData
      );

      expect(result).toBe(mockSession);
      expect(mockChannel.register).toHaveBeenCalledWith(mockSession);

      // Simulate Redis message handling that should trigger channel broadcast
      await (sseService as any).handleRedisMessage('notifications:test:user:123', JSON.stringify(message));

      // Should broadcast to local channel
      expect(mockChannel.broadcast).toHaveBeenCalledWith(message.data, message.event);
    });

    it('should handle session disconnection and cleanup', async () => {
      const sessionData: ISSESession = {
        id: faker.string.uuid(),
        userId: faker.string.uuid(),
        cuid: faker.string.uuid(),
        channels: ['test-channel'],
        session: mockSession,
        connectedAt: new Date(),
      };

      mockSseCache.removeUserChannels.mockResolvedValue({ success: true, data: null });

      await sseService.cleanup(sessionData.id);

      expect(mockChannel.deregister).toHaveBeenCalledWith(mockSession);
      expect(mockSseCache.removeUserChannels).toHaveBeenCalledWith(sessionData.userId, sessionData.cuid);
    });

    it('should manage multiple channels per client (cuid)', async () => {
      const cuid = 'test-client';
      const userId1 = faker.string.uuid();
      const userId2 = faker.string.uuid();

      // Create personal sessions for different users in same client
      await sseService.createPersonalSession(userId1, cuid);
      await sseService.createPersonalSession(userId2, cuid);

      expect(mockSseCache.generatePersonalChannel).toHaveBeenCalledWith(userId1, cuid);
      expect(mockSseCache.generatePersonalChannel).toHaveBeenCalledWith(userId2, cuid);

      // Both users should use the same client's channels but different personal channels
      expect(mockSseCache.generatePersonalChannel).toHaveBeenCalledTimes(2);
    });

    it('should isolate channels between different clients', async () => {
      const userId = faker.string.uuid();
      const cuid1 = 'client-1';
      const cuid2 = 'client-2';

      await sseService.createPersonalSession(userId, cuid1);
      await sseService.createPersonalSession(userId, cuid2);

      // Should generate separate channels for different clients
      expect(mockSseCache.generatePersonalChannel).toHaveBeenCalledWith(userId, cuid1);
      expect(mockSseCache.generatePersonalChannel).toHaveBeenCalledWith(userId, cuid2);
    });
  });

  describe('sendToChannel', () => {
    it('should send message to channel successfully', async () => {
      const channel = 'test-channel';
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockSseCache.publishToChannel.mockResolvedValue({ success: true, data: null });

      await sseService.sendToChannel(channel, message);

      expect(mockSseCache.publishToChannel).toHaveBeenCalledWith(channel, message);
    });

    it('should handle publish failure', async () => {
      const channel = 'test-channel';
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockSseCache.publishToChannel.mockResolvedValue({
        success: false,
        data: null,
        error: 'Publish failed',
      });

      await expect(sseService.sendToChannel(channel, message)).rejects.toThrow(
        'Failed to publish: Publish failed'
      );
    });

    it('should handle unexpected errors', async () => {
      const channel = 'test-channel';
      const message: ISSEMessage = {
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockSseCache.publishToChannel.mockRejectedValue(new Error('Network error'));

      await expect(sseService.sendToChannel(channel, message)).rejects.toThrow('Network error');
    });
  });

  describe('cleanup', () => {
    it('should cleanup session successfully', async () => {
      const sessionId = faker.string.uuid();

      await sseService.cleanup(sessionId);

      // Should not throw any errors
      expect(true).toBe(true);
    });

    it('should handle cleanup errors gracefully', async () => {
      const sessionId = faker.string.uuid();

      // Even if cleanup logic is added later and fails, it should not throw
      await expect(sseService.cleanup(sessionId)).resolves.toBeUndefined();
    });
  });

  describe('Redis subscription handling', () => {
    it('should initialize Redis subscription on construction', async () => {
      // Wait a tick for async constructor logic
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(mockSseCache.subscribeToChannels).toHaveBeenCalledWith(
        ['announcements:system:general'],
        'system',
        expect.any(Function)
      );
    });

    it('should handle Redis subscription failure gracefully', async () => {
      mockSseCache.subscribeToChannels.mockResolvedValue({
        success: false,
        data: null,
        error: 'Redis unavailable',
      });

      // Create new service instance to test constructor error handling
      const newService = new SSEService({ sseCache: mockSseCache });

      // Wait for async constructor logic
      await new Promise((resolve) => setTimeout(resolve, 0));

      // Should not throw, just log error
      expect(newService).toBeInstanceOf(SSEService);
    });
  });

  describe('handleRedisMessage', () => {
    it('should parse and handle Redis messages correctly', async () => {
      const channel = 'notifications:test-client:user:test-user';
      const messageData = JSON.stringify({
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      });

      mockSseCache.getUsersForChannel.mockResolvedValue({
        success: true,
        data: ['user1', 'user2'],
      });

      // Access private method through reflection for testing
      const handleRedisMessage = (sseService as any).handleRedisMessage.bind(sseService);
      await handleRedisMessage(channel, messageData);

      expect(mockSseCache.getUsersForChannel).toHaveBeenCalledWith(channel);
    });

    it('should handle invalid JSON gracefully', async () => {
      const channel = 'test-channel';
      const invalidMessageData = 'invalid-json';

      const handleRedisMessage = (sseService as any).handleRedisMessage.bind(sseService);

      // Should not throw
      await expect(handleRedisMessage(channel, invalidMessageData)).resolves.toBeUndefined();
    });

    it('should handle channels without cuid match', async () => {
      const channel = 'invalid-channel-format';
      const messageData = JSON.stringify({
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      });

      const handleRedisMessage = (sseService as any).handleRedisMessage.bind(sseService);
      await handleRedisMessage(channel, messageData);

      // Should not call getUsersForChannel for invalid channel format
      expect(mockSseCache.getUsersForChannel).not.toHaveBeenCalled();
    });

    it('should handle empty user list', async () => {
      const channel = 'notifications:test-client:user:test-user';
      const messageData = JSON.stringify({
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      });

      mockSseCache.getUsersForChannel.mockResolvedValue({
        success: true,
        data: [],
      });

      const handleRedisMessage = (sseService as any).handleRedisMessage.bind(sseService);
      await handleRedisMessage(channel, messageData);

      expect(mockSseCache.getUsersForChannel).toHaveBeenCalledWith(channel);
    });

    it('should broadcast message via better-sse channel for personal notifications', async () => {
      const cuid = 'test-client';
      const channel = `notifications:${cuid}:user:test-user`;
      const messageData = JSON.stringify({
        id: faker.string.uuid(),
        event: 'notification',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      });

      mockSseCache.getUsersForChannel.mockResolvedValue({
        success: true,
        data: ['user1', 'user2'],
      });

      // First create a personal session to create the channel
      await sseService.createPersonalSession('test-user', cuid);
      await sseService.initializeConnection(
        mockRequest as Request,
        mockResponse as Response,
        {
          id: '',
          userId: 'test-user',
          cuid,
          session: null as any,
          channels: [channel],
          connectedAt: new Date(),
        }
      );

      const handleRedisMessage = (sseService as any).handleRedisMessage.bind(sseService);
      await handleRedisMessage(channel, messageData);

      expect(mockChannel.broadcast).toHaveBeenCalledWith(
        expect.any(Object), // message.data
        'notification' // message.event
      );
    });

    it('should broadcast message via better-sse channel for announcements', async () => {
      const cuid = 'test-client';
      const channel = `announcements:${cuid}:general`;
      const message = {
        id: faker.string.uuid(),
        event: 'announcement',
        data: createMockNotificationDocument(),
        timestamp: new Date(),
      };

      mockSseCache.getUsersForChannel.mockResolvedValue({
        success: true,
        data: ['user1', 'user2'],
      });

      // First create an announcement session to create the channel
      await sseService.createAnnouncementSession('test-user', cuid);
      await sseService.initializeConnection(
        mockRequest as Request,
        mockResponse as Response,
        {
          id: '',
          userId: 'test-user',
          cuid,
          session: null as any,
          channels: [channel],
          connectedAt: new Date(),
        }
      );

      const handleRedisMessage = (sseService as any).handleRedisMessage.bind(sseService);
      await handleRedisMessage(channel, JSON.stringify(message));

      expect(mockChannel.broadcast).toHaveBeenCalledWith(message.data, message.event);
    });
  });
});