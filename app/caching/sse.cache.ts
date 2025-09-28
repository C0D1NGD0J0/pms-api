import { ISSEMessage } from '@interfaces/sse.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export class SSECache extends BaseCache {
  private subscriber: any = null;
  private readonly KEY_PREFIXES = {
    SSE_CHANNEL: 'sse:channel:',
    SSE_SESSION: 'sse:session:',
    USER_CHANNELS: 'sse:user:channels:',
  };

  constructor(cacheName = 'SSECache') {
    super(cacheName);
    this.initializeClient().then(() => {
      // Only log in non-test environments to avoid Jest warnings
      if (process.env.NODE_ENV !== 'test') {
        console.info('SSECache connected to Redis');
      }
    });
  }

  private async initializeClient() {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
    } catch (error) {
      this.log.error('Error connecting to Redis:', error);
    }
  }

  /**
   * Publish message to Redis channel
   */
  async publishToChannel(channel: string, message: ISSEMessage): Promise<ISuccessReturnData> {
    try {
      if (!channel || !message) {
        return {
          success: false,
          data: null,
          error: 'Channel and message are required',
        };
      }

      const serialized = JSON.stringify(message);
      await this.client.publish(channel, serialized);

      this.log.debug(`Published to channel: ${channel}`);

      return {
        success: true,
        data: { channel, messageId: message.id },
      };
    } catch (error) {
      this.log.error(`Failed to publish to ${channel}:`, error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Subscribe to Redis channels
   */
  async subscribeToChannels(
    channels: string[],
    cuid: string,
    callback: (channel: string, message: string) => void
  ): Promise<ISuccessReturnData> {
    try {
      if (!channels?.length || !cuid) {
        return {
          success: false,
          data: null,
          error: 'Channels array and client ID are required',
        };
      }

      // validate all channels belong to this client
      const invalidChannels = channels.filter((ch) => !ch.includes(cuid));
      if (invalidChannels.length > 0) {
        return {
          success: false,
          data: null,
          error: `Invalid channels for client ${cuid}: ${invalidChannels.join(', ')}`,
        };
      }

      this.subscriber = this.client.duplicate();
      await this.subscriber.connect();
      this.subscriber.on('message', callback);
      await this.subscriber.subscribe(channels);

      this.log.info(`Subscribed to channels: ${channels.join(', ')}`);

      return {
        success: true,
        data: { subscribedChannels: channels, clientId: cuid },
      };
    } catch (error) {
      this.log.error('Failed to subscribe:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Unsubscribe from channels with proper cleanup
   */
  async unsubscribeFromChannels(channels: string[]): Promise<ISuccessReturnData> {
    try {
      if (this.subscriber) {
        if (channels?.length) {
          await this.subscriber.unsubscribe(channels);
        }
        await this.subscriber.quit();
        this.subscriber = null;
      }

      this.log.info(`Unsubscribed from channels: ${channels?.join(', ') || 'all'}`);

      return {
        success: true,
        data: { unsubscribedChannels: channels || [] },
      };
    } catch (error) {
      this.log.error('Failed to unsubscribe:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Generate channel names for notifications
   */
  generatePersonalChannel(userId: string, cuid: string): string {
    return `notifications:${cuid}:user:${userId}`;
  }

  generateAnnouncementChannels(cuid: string): string[] {
    return [`announcements:${cuid}:general`];
  }

  /**
   * Store user's active channels in Redis
   */
  async storeUserChannels(
    userId: string,
    cuid: string,
    channels: string[]
  ): Promise<ISuccessReturnData> {
    try {
      if (!userId || !cuid || !channels?.length) {
        return {
          success: false,
          data: null,
          error: 'User ID, client ID, and channels are required',
        };
      }

      const key = `${this.KEY_PREFIXES.USER_CHANNELS}${cuid}:${userId}`;
      const data = {
        userId,
        cuid,
        channels: JSON.stringify(channels),
        updatedAt: new Date().toISOString(),
      };

      const result = await this.setObject(key, data, 7200); // ttl of 2 hours
      if (!result.success) {
        return {
          success: false,
          data: null,
          error: 'Failed to store user channels in Redis',
        };
      }

      this.log.debug(`Stored channels for user ${userId}: ${channels.join(', ')}`);
      return {
        success: true,
        data: { userId, cuid, channels },
      };
    } catch (error) {
      this.log.error('Error storing user channels:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get user's active channels from Redis
   */
  async getUserChannels(userId: string, cuid: string): Promise<ISuccessReturnData<string[]>> {
    try {
      if (!userId || !cuid) {
        return {
          success: false,
          data: [],
          error: 'User ID and client ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.USER_CHANNELS}${cuid}:${userId}`;
      const result = await this.getObject(key);

      if (result.success && result.data?.channels) {
        const channels = JSON.parse(result.data.channels as string);
        return {
          success: true,
          data: channels,
        };
      }

      return {
        success: true,
        data: [],
      };
    } catch (error) {
      this.log.error('Error getting user channels:', error);
      return {
        success: false,
        data: [],
        error: (error as Error).message,
      };
    }
  }

  /**
   * Remove user's channels from Redis
   */
  async removeUserChannels(userId: string, cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!userId || !cuid) {
        return {
          success: false,
          data: null,
          error: 'User ID and client ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.USER_CHANNELS}${cuid}:${userId}`;
      const result = await this.deleteItems([key]);

      if (!result.success) {
        return {
          success: false,
          data: null,
          error: 'Failed to remove user channels from Redis',
        };
      }

      this.log.debug(`Removed channels for user ${userId}`);
      return {
        success: true,
        data: { userId, cuid },
      };
    } catch (error) {
      this.log.error('Error removing user channels:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Store active channel subscribers (for efficient lookup)
   */
  async addUserToChannel(
    channel: string,
    userId: string,
    cuid: string
  ): Promise<ISuccessReturnData> {
    try {
      if (!channel || !userId || !cuid) {
        return {
          success: false,
          data: null,
          error: 'Channel, user ID, and client ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.SSE_CHANNEL}${channel}`;
      const result = await this.addToList(key, userId, 7200); // TTL of 2 hours

      if (!result.success) {
        return {
          success: false,
          data: null,
          error: 'Failed to add user to channel',
        };
      }

      return {
        success: true,
        data: { channel, userId },
      };
    } catch (error) {
      this.log.error('Error adding user to channel:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get all users subscribed to a specific channel
   */
  async getUsersForChannel(channel: string): Promise<ISuccessReturnData<string[]>> {
    try {
      if (!channel) {
        return {
          success: false,
          data: [],
          error: 'Channel is required',
        };
      }

      const key = `${this.KEY_PREFIXES.SSE_CHANNEL}${channel}`;
      const result = await this.getListRange<string>(key, 0, -1);

      if (!result.success) {
        return {
          success: false,
          data: [],
          error: 'Failed to get channel subscribers',
        };
      }

      return {
        success: true,
        data: result.data || [],
      };
    } catch (error) {
      this.log.error('Error getting users for channel:', error);
      return {
        success: false,
        data: [],
        error: (error as Error).message,
      };
    }
  }
}
