import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
import { SSECache } from '@caching/sse.cache';
import { createSession, createChannel, Session, Channel } from 'better-sse';
import { ISSEService, ISSESession, ISSEMessage } from '@interfaces/sse.interface';

interface IConstructor {
  sseCache: SSECache;
}

export class SSEService implements ISSEService {
  private readonly log: Logger;
  private readonly sseCache: SSECache;
  private redisSubscriptionInitialized: boolean = false;
  private personalChannels: Map<string, Channel> = new Map(); // key: cuid
  private announcementChannels: Map<string, Channel> = new Map(); // key: cuid

  constructor({ sseCache }: IConstructor) {
    this.log = createLogger('SSEService');
    this.sseCache = sseCache;
    // Initialize Redis subscription asynchronously
    this.initializeRedisSubscription().catch((error) => {
      this.log.error('Failed to initialize Redis subscription in constructor:', error);
    });
  }

  /**
   * Get or create personal notification channel for a client
   */
  private getPersonalChannel(cuid: string): Channel {
    if (!this.personalChannels.has(cuid)) {
      const channel = createChannel();
      this.personalChannels.set(cuid, channel);
      this.log.debug(`Created personal notification channel for client: ${cuid}`);
    }
    return this.personalChannels.get(cuid)!;
  }

  /**
   * Get or create announcement channel for a client
   */
  private getAnnouncementChannel(cuid: string): Channel {
    if (!this.announcementChannels.has(cuid)) {
      const channel = createChannel();
      this.announcementChannels.set(cuid, channel);
      this.log.debug(`Created announcement channel for client: ${cuid}`);
    }
    return this.announcementChannels.get(cuid)!;
  }

  /**
   * Create session for personal notifications
   */
  async createPersonalSession(userId: string, cuid: string): Promise<ISSESession> {
    try {
      const personalChannels = [this.sseCache.generatePersonalChannel(userId, cuid)];

      const storeResult = await this.sseCache.storeUserChannels(userId, cuid, personalChannels);
      if (!storeResult.success) {
        throw new Error(`Failed to store user channels: ${storeResult.error}`);
      }

      for (const channel of personalChannels) {
        await this.sseCache.addUserToChannel(channel, userId, cuid);
      }

      const sessionData: ISSESession = {
        id: '', // to be set by better-sse
        userId,
        cuid,
        session: null as any, // to be set during connection initialization
        channels: personalChannels,
        connectedAt: new Date(),
      };

      this.log.info(
        `Created personal SSE session for user ${userId}, channels: ${personalChannels.join(', ')}`
      );
      return sessionData;
    } catch (error) {
      this.log.error('Failed to create personal SSE session:', error);
      throw error;
    }
  }

  async createAnnouncementSession(userId: string, cuid: string): Promise<ISSESession> {
    try {
      // Generate announcement channels for this client
      const announcementChannels = this.sseCache.generateAnnouncementChannels(cuid);

      const storeResult = await this.sseCache.storeUserChannels(userId, cuid, announcementChannels);
      if (!storeResult.success) {
        throw new Error(`Failed to store user channels: ${storeResult.error}`);
      }

      // Add user to channel subscriber lists for message targeting
      for (const channel of announcementChannels) {
        await this.sseCache.addUserToChannel(channel, userId, cuid);
      }

      const sessionData: ISSESession = {
        id: '', // Will be set by better-sse
        userId,
        cuid,
        session: null as any, // Will be set during connection initialization
        channels: announcementChannels,
        connectedAt: new Date(),
      };

      this.log.info(
        `Created announcement SSE session for user ${userId}, channels: ${announcementChannels.join(', ')}`
      );
      return sessionData;
    } catch (error) {
      this.log.error('Failed to create announcement SSE session:', error);
      throw error;
    }
  }

  /**
   * Initialize actual SSE connection using better-sse
   */
  async initializeConnection(
    req: Request,
    res: Response,
    sessionData: ISSESession
  ): Promise<Session> {
    try {
      const session = await createSession(req, res);

      sessionData.id = `${sessionData.userId}-${Date.now()}`;
      sessionData.session = session;

      session.state.userId = sessionData.userId;
      session.state.cuid = sessionData.cuid;
      session.state.channels = sessionData.channels;
      session.state.sessionId = sessionData.id;

      // Register session to appropriate better-sse channels
      if (sessionData.channels.some((ch) => ch.includes(':user:'))) {
        // Personal notification session
        const personalChannel = this.getPersonalChannel(sessionData.cuid);
        personalChannel.register(session);
        this.log.debug(`Registered session to personal channel for client: ${sessionData.cuid}`);
      }

      if (sessionData.channels.some((ch) => ch.includes('announcements:'))) {
        // Announcement session
        const announcementChannel = this.getAnnouncementChannel(sessionData.cuid);
        announcementChannel.register(session);
        this.log.debug(
          `Registered session to announcement channel for client: ${sessionData.cuid}`
        );
      }

      session.on('disconnected', () => {
        this.handleDisconnect(sessionData);
      });

      this.log.info(
        `SSE connection initialized for user ${sessionData.userId}, session: ${sessionData.id}`
      );
      return session;
    } catch (error) {
      this.log.error('Failed to initialize SSE connection:', error);
      throw error;
    }
  }

  /**
   * Send message to specific user via Redis pub/sub
   */
  async sendToUser(userId: string, cuid: string, message: ISSEMessage): Promise<boolean> {
    try {
      const personalChannel = this.sseCache.generatePersonalChannel(userId, cuid);
      await this.sendToChannel(personalChannel, message);
      return true;
    } catch (error) {
      this.log.error(`Failed to send to user ${userId}:`, error);
      return false;
    }
  }

  /**
   * Broadcast message to Redis channel (cross-server)
   */
  async sendToChannel(channel: string, message: ISSEMessage): Promise<void> {
    try {
      const result = await this.sseCache.publishToChannel(channel, message);
      if (!result.success) {
        throw new Error(`Failed to publish: ${result.error}`);
      }
      this.log.debug(`Published message to channel: ${channel}`);
    } catch (error) {
      this.log.error(`Failed to send to channel ${channel}:`, error);
      throw error;
    }
  }

  /**
   * Clean up session data (called by better-sse on disconnect)
   */
  async cleanup(sessionId: string): Promise<void> {
    try {
      this.log.info(`Session cleanup completed: ${sessionId}`);
    } catch (error) {
      this.log.error(`Failed to cleanup session ${sessionId}:`, error);
    }
  }

  /**
   * Handle session disconnect and cleanup
   */
  private async handleDisconnect(sessionData: ISSESession): Promise<void> {
    try {
      this.log.info(`SSE session disconnected: ${sessionData.id} (user: ${sessionData.userId})`);

      // Deregister from better-sse channels
      if (sessionData.session) {
        if (sessionData.channels.some((ch) => ch.includes(':user:'))) {
          const personalChannel = this.personalChannels.get(sessionData.cuid);
          if (personalChannel) {
            personalChannel.deregister(sessionData.session);
            this.log.debug(
              `Deregistered session from personal channel for client: ${sessionData.cuid}`
            );
          }
        }

        if (sessionData.channels.some((ch) => ch.includes('announcements:'))) {
          const announcementChannel = this.announcementChannels.get(sessionData.cuid);
          if (announcementChannel) {
            announcementChannel.deregister(sessionData.session);
            this.log.debug(
              `Deregistered session from announcement channel for client: ${sessionData.cuid}`
            );
          }
        }
      }

      // Clean up user channels from Redis
      // Note: In production with multiple servers, you might want more sophisticated
      // cleanup logic to check if user has sessions on other server instances
      await this.sseCache.removeUserChannels(sessionData.userId, sessionData.cuid);

      this.log.debug(`Cleaned up Redis data for user ${sessionData.userId}`);
    } catch (error) {
      this.log.error('Error handling session disconnect:', error);
    }
  }

  /**
   * Initialize Redis subscription for cross-server message forwarding
   */
  private async initializeRedisSubscription(): Promise<void> {
    try {
      if (this.redisSubscriptionInitialized) {
        return;
      }

      // Set up Redis subscription callback for message forwarding
      const messageCallback = (channel: string, messageData: string) => {
        this.handleRedisMessage(channel, messageData);
      };

      // For initial setup, subscribe to common announcement channels
      // Personal notification channels will be subscribed to dynamically as users connect
      const initialChannels = ['announcements:system:general']; // Add more as needed

      // Use SSECache to subscribe to Redis channels
      const subscribeResult = await this.sseCache.subscribeToChannels(
        initialChannels,
        'system', // Use system as cuid for global channels
        messageCallback
      );

      if (!subscribeResult.success) {
        throw new Error(`Failed to subscribe to Redis channels: ${subscribeResult.error}`);
      }

      this.log.info('Redis subscription initialized for SSE message forwarding');
      this.redisSubscriptionInitialized = true;
    } catch (error) {
      this.log.error('Failed to initialize Redis subscription:', error);
    }
  }

  /**
   * Handle incoming Redis messages and forward to local better-sse sessions
   */
  private async handleRedisMessage(channel: string, messageData: string): Promise<void> {
    try {
      const message: ISSEMessage = JSON.parse(messageData);

      // Extract cuid from channel for user lookup
      const cuidMatch = channel.match(/:([^:]+):/);
      if (!cuidMatch) {
        this.log.warn(`Could not extract cuid from channel: ${channel}`);
        return;
      }
      const cuid = cuidMatch[1];

      // Get users subscribed to this channel
      const usersResult = await this.sseCache.getUsersForChannel(channel);
      if (!usersResult.success || !usersResult.data?.length) {
        this.log.debug(`No users subscribed to channel: ${channel}`);
        return;
      }

      // Forward message to local better-sse sessions via channels
      let targetChannel: Channel | undefined;

      if (channel.includes(':user:')) {
        // Personal notification message
        targetChannel = this.personalChannels.get(cuid);
      } else if (channel.includes('announcements:')) {
        // Announcement message
        targetChannel = this.announcementChannels.get(cuid);
      }

      if (targetChannel) {
        targetChannel.broadcast(message.data, message.event);
        this.log.debug(
          `Broadcasted message from Redis channel ${channel} to ${targetChannel.sessionCount} local sessions`
        );
      } else {
        this.log.debug(`No local channel found for Redis channel: ${channel}`);
      }
    } catch (error) {
      this.log.error('Error handling Redis message:', error);
    }
  }
}
