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
    try {
      const key = `${this.KEY_PREFIX}:events`;
      await this.client.sAdd(key, eventType.toString());
      return { success: true, data: null };
    } catch (error) {
      this.log.error('Failed to register event:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }

  async getRegisteredEvents(): Promise<ISuccessReturnData<string[] | null>> {
    try {
      const key = `${this.KEY_PREFIX}:events`;
      const events = await this.client.sMembers(key);
      return { success: true, data: events };
    } catch (error) {
      this.log.error('Failed to get registered events:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }

  async unregisteEvent(eventType: EventTypes | string): Promise<{ success: boolean }> {
    try {
      const key = `${this.KEY_PREFIX}:events`;
      await this.client.sRem(key, eventType.toString());
      return { success: true };
    } catch (error) {
      this.log.error('Failed to unregister event: ', eventType);
      throw error;
    }
  }

  async isEventRegistered(
    eventType: EventTypes | string
  ): Promise<ISuccessReturnData<boolean | null>> {
    try {
      const key = `${this.KEY_PREFIX}:events`;
      const exists = await this.client.sIsMember(key, eventType.toString());
      return { success: true, data: exists };
    } catch (error) {
      this.log.error('Failed to check if event is registered:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }
}
