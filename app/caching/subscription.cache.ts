import { RedisService } from '@database/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';
import { ISubscriptionEntitlements } from '@interfaces/subscription.interface';

import { BaseCache } from './base.cache';

export class SubscriptionCache extends BaseCache {
  private readonly KEY_PREFIX = 'entitlements';
  private readonly CACHE_TTL: number;

  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });
    this.CACHE_TTL = convertTimeToSecondsAndMilliseconds('5m').seconds;
  }

  async getEntitlements(
    cuid: string
  ): Promise<ISuccessReturnData<ISubscriptionEntitlements | null>> {
    try {
      if (!cuid) {
        return { success: false, data: null, error: 'Client ID is required' };
      }

      const key = `${this.KEY_PREFIX}:${cuid}`;
      const result = await this.getItem<ISubscriptionEntitlements>(key);

      if (result.success && result.data) {
        return { success: true, data: result.data as ISubscriptionEntitlements };
      }

      return { success: false, data: null };
    } catch (error) {
      this.log.error('Failed to get entitlements from cache:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }

  async cacheEntitlements(
    cuid: string,
    entitlements: ISubscriptionEntitlements
  ): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !entitlements) {
        return { success: false, data: null, error: 'Client ID and entitlements are required' };
      }

      const key = `${this.KEY_PREFIX}:${cuid}`;
      return await this.setItem(key, this.serialize(entitlements), this.CACHE_TTL);
    } catch (error) {
      this.log.error('Failed to cache entitlements:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }

  async invalidate(cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return { success: false, data: null, error: 'Client ID is required' };
      }

      const key = `${this.KEY_PREFIX}:${cuid}`;
      return await this.deleteItems([key]);
    } catch (error) {
      this.log.error('Failed to invalidate entitlements cache:', error);
      return { success: false, data: null, error: (error as Error).message };
    }
  }
}
