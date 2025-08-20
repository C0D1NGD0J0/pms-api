import { ISuccessReturnData } from '@interfaces/utils.interface';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';

import { BaseCache } from './base.cache';

export class UserCache extends BaseCache {
  private readonly KEY_PREFIXES = {
    CLIENT_USER: 'cu:',
    CLIENT_USERS: 'cus:',
  };

  private readonly USER_DETAIL_CACHE_TTL: number;

  constructor(cacheName = 'UserCache') {
    super(cacheName);
    this.initializeClient().then(() => {
      if (process.env.NODE_ENV !== 'test') {
        console.info('UserCache connected to Redis');
      }
    });

    this.USER_DETAIL_CACHE_TTL = convertTimeToSecondsAndMilliseconds('2h').seconds;
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
   * Cache a user detail object with tenant isolation
   * @param cuid - Client identifier
   * @param userId - User identifier
   * @param userData - User detail data object
   */
  async cacheUserDetail(cuid: string, userId: string, userData: any): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !userId || !userData) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID, user ID, or user data',
        };
      }

      const userKey = `${this.KEY_PREFIXES.CLIENT_USER}:${cuid}:${userId}`;
      const userResult = await this.setItem(
        userKey,
        JSON.stringify(userData),
        this.USER_DETAIL_CACHE_TTL
      );

      // Also add to client's user set for easy lookup/invalidation
      const clientKey = `${this.KEY_PREFIXES.CLIENT_USERS}:${cuid}`;
      await this.client.sAdd(clientKey, userId);

      return userResult;
    } catch (error) {
      this.log.error('Failed to cache user detail:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached user detail by ID with tenant validation
   * @param cuid - Client/tenant identifier
   * @param userId - User identifier
   */
  async getUserDetail(cuid: string, userId: string): Promise<ISuccessReturnData<any | null>> {
    try {
      if (!cuid || !userId) {
        return {
          success: false,
          data: null,
          error: 'Client ID and user ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_USER}:${cuid}:${userId}`;
      const result = await this.getItem(key);
      return result;
    } catch (error) {
      this.log.error('Failed to get user detail from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate a user detail in the cache
   * @param cuid - Client/tenant identifier
   * @param userId - User identifier
   */
  async invalidateUserDetail(cuid: string, userId: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !userId) {
        return {
          data: null,
          success: false,
          error: 'Client ID and user ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_USER}:${cuid}:${userId}`;
      await this.deleteItems([key]);
      return { data: null, success: true };
    } catch (error) {
      this.log.error('Failed to invalidate user detail:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate all user details for a tenant
   * @param cuid - Client/tenant identifier
   */
  async invalidateClientUserDetails(cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      const clientKey = `${this.KEY_PREFIXES.CLIENT_USERS}:${cuid}`;
      const userIds = await this.client.sMembers(clientKey);

      if (userIds.length > 0) {
        const keys = userIds.map((uid) => `${this.KEY_PREFIXES.CLIENT_USER}:${cuid}:${uid}`);
        await this.deleteItems(keys);
      }

      // Also remove the client user set
      await this.deleteItems([clientKey]);

      return {
        data: { deletedCount: userIds.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate client user details:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }
}
