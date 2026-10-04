import { RedisService } from '@database/index';
import { EventTypes } from '@interfaces/events.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export class EventsRegistryCache extends BaseCache {
  private readonly KEY_PREFIX = 'events:registry';
  private readonly DEFAULT_TTL = 60 * 60 * 24 * 30; // 30 days

  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });
  }

  async registerEvent(eventType: EventTypes | string): Promise<ISuccessReturnData> {
    return this.registerEvents([eventType]);
  }

  /** Adds several event types in two Redis commands, however many there are. */
  async registerEvents(eventTypes: Array<EventTypes | string>): Promise<ISuccessReturnData> {
    try {
      if (eventTypes.length === 0) return { success: true, data: null };
      if (!this.client.isReady) {
        return { success: false, data: null, error: 'Redis client not ready' };
      }

      const key = `${this.KEY_PREFIX}:events`;
      await this.client.sAdd(
        key,
        eventTypes.map((eventType) => eventType.toString())
      );
      await this.client.expire(key, this.DEFAULT_TTL);
      return { success: true, data: null };
    } catch (error) {
      this.log.error('Failed to register event:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }

  async getRegisteredEvents(): Promise<ISuccessReturnData<string[] | null>> {
    try {
      if (!this.client.isReady) {
        return { success: false, data: null, error: 'Redis client not ready' };
      }

      const key = `${this.KEY_PREFIX}:events`;
      const events = await this.client.sMembers(key);
      return { success: true, data: events };
    } catch (error) {
      this.log.error('Failed to get registered events:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }

  /** Removes several event types in one Redis command. */
  async unregisterEvents(eventTypes: Array<EventTypes | string>): Promise<{ success: boolean }> {
    try {
      if (eventTypes.length === 0 || !this.client.isReady) {
        return { success: eventTypes.length === 0 };
      }

      const key = `${this.KEY_PREFIX}:events`;
      await this.client.sRem(
        key,
        eventTypes.map((eventType) => eventType.toString())
      );
      return { success: true };
    } catch (error) {
      // During shutdown Redis may close before the registry is cleaned up — not an error
      this.log.warn(
        { count: eventTypes.length },
        'Failed to unregister events — Redis may be closing'
      );
      return { success: false };
    }
  }

  async unregisteEvent(eventType: EventTypes | string): Promise<{ success: boolean }> {
    try {
      if (!this.client.isReady) {
        return { success: false };
      }

      const key = `${this.KEY_PREFIX}:events`;
      await this.client.sRem(key, eventType.toString());
      return { success: true };
    } catch (error) {
      // During shutdown Redis may close before all listeners are unregistered — not an error
      this.log.warn({ eventType }, 'Failed to unregister event — Redis may be closing');
      return { success: false };
    }
  }

  async isEventRegistered(
    eventType: EventTypes | string
  ): Promise<ISuccessReturnData<boolean | null>> {
    try {
      if (!this.client.isReady) {
        return { success: false, data: null, error: 'Redis client not ready' };
      }

      const key = `${this.KEY_PREFIX}:events`;
      const exists = await this.client.sIsMember(key, eventType.toString());
      return { success: true, data: exists };
    } catch (error) {
      this.log.error('Failed to check if event is registered:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }
}
