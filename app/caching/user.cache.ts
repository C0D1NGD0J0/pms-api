import { RedisService } from '@database/index';
import { FilteredUserTableData } from '@interfaces/user.interface';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import { ISuccessReturnData, IPaginationQuery } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export class UserCache extends BaseCache {
  private readonly KEY_PREFIXES = {
    CLIENT_USER: 'cu:',
    CLIENT_USERS: 'cus:',
    FILTERED_USERS: 'fu:',
  };

  private readonly USER_DETAIL_CACHE_TTL: number;
  private readonly LIST_CACHE_TTL: number;

  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });

    this.USER_DETAIL_CACHE_TTL = convertTimeToSecondsAndMilliseconds('5m').seconds;
    this.LIST_CACHE_TTL = convertTimeToSecondsAndMilliseconds('5m').seconds;
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

  /**
   * Cache a filtered users list with pagination
   * @param cuid - Client identifier
   * @param userList - Array of user data (FilteredUserTableData format)
   * @param opts - Filter and pagination options used to generate this list
   * @param opts.totalCount - Total count across all pages
   */
  async saveFilteredUsers(
    cuid: string,
    userList: FilteredUserTableData[],
    opts: {
      filters: IUserFilterOptions;
      pagination: IPaginationQuery;
      totalCount?: number;
    }
  ): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !userList) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID or user list',
        };
      }

      const listKey = this.generateListKeyFromOptions(opts.pagination);
      const key = `${this.KEY_PREFIXES.FILTERED_USERS}${cuid}:${listKey}`;

      const totalToCache = opts.totalCount ?? userList.length;

      await this.deleteItems([key]);
      const multi = this.client.multi();

      for (const user of userList) {
        multi.RPUSH(key, this.serialize(user));
      }

      const metaKey = `${key}:meta`;
      await this.setObject(
        metaKey,
        {
          total: totalToCache,
          lastUpdated: Date.now(),
          listKey,
          cuid,
        },
        this.LIST_CACHE_TTL
      );

      // Set TTL on the list
      multi.EXPIRE(key, this.LIST_CACHE_TTL);
      await multi.exec();

      return {
        data: { count: userList.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to cache filtered users:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached filtered users list
   * @param cuid - Client identifier
   * @param filters - Filter options
   * @param pagination - Pagination options
   */
  async getFilteredUsers(
    cuid: string,
    filters: IUserFilterOptions,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid) {
        return {
          success: false,
          data: null,
          error: 'Client ID is required',
        };
      }

      const listKey = this.generateListKeyFromOptions(pagination);
      const key = `${this.KEY_PREFIXES.FILTERED_USERS}${cuid}:${listKey}`;

      const listResult = await this.getListRange<FilteredUserTableData>(key, 0, -1);

      if (!listResult.success || !listResult.data || listResult.data.length === 0) {
        return {
          data: null,
          success: false,
          message: 'No cached users found',
        };
      }

      // Get metadata for pagination info
      const metaKey = `${key}:meta`;
      const metaResult = await this.getObject<{
        total: number;
        filters: IUserFilterOptions;
        pagination: IPaginationQuery;
      }>(metaKey);

      const total =
        metaResult.success && metaResult.data ? metaResult.data.total : listResult.data.length;

      this.log.info(`Retrieved ${listResult.data.length} cached users for client ${cuid}`, {
        listKey,
      });

      return {
        success: true,
        data: {
          items: listResult.data,
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total,
          },
        },
      };
    } catch (error) {
      this.log.error('Failed to get filtered users from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate filtered user lists for a client
   * @param cuid - Client identifier
   */
  async invalidateUserLists(cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      // Pattern to match all filtered user lists for this client
      const pattern = `${this.KEY_PREFIXES.FILTERED_USERS}${cuid}:*`;
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.deleteItems(keys);
        this.log.info(`Invalidated ${keys.length} user list caches for client ${cuid}`);
      }

      return {
        data: { deletedCount: keys.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate user lists:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Generate a cache key from filter and pagination options
   * @param filters - Filter options
   * @param pagination - Pagination options
   */
  private generateListKeyFromOptions(pagination: IPaginationQuery): string {
    const hash = this.hashData(pagination);
    return `q:${hash}`;
  }
}
