import { FilterQuery } from 'mongoose';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';
import { IPropertyDocument, IProperty } from '@interfaces/property.interface';
import { ISuccessReturnData, IPaginationQuery } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export class PropertyCache extends BaseCache {
  private readonly KEY_PREFIXES = {
    CLIENT_PROPERTY: 'cp:',
    CLIENT_PROPERTIES: 'cps:',
  };

  private readonly PROPERTY_CACHE_TTL: number;
  private readonly LIST_CACHE_TTL: number;

  constructor(cacheName = 'PropertyCache') {
    super(cacheName);
    this.initializeClient().then(() => {
      // Only log in non-test environments to avoid Jest warnings
      if (process.env.NODE_ENV !== 'test') {
        console.info('PropertyCache connected to Redis');
      }
    });

    this.PROPERTY_CACHE_TTL = convertTimeToSecondsAndMilliseconds('5m').seconds;
    this.LIST_CACHE_TTL = convertTimeToSecondsAndMilliseconds('5m').seconds;
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
   * cache a property object with tenant isolation
   * @param cuid - client identifier
   * @param propertyId - property identifier
   * @param propertyData - pProperty data object
   */
  async cacheProperty(
    cuid: string,
    propertyId: string,
    propertyData: any
  ): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !propertyId || !propertyData) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID, property ID, or property data',
        };
      }

      const propertyKey = `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cuid}:${propertyId}`;
      const propertyResult = await this.setItem(
        propertyKey,
        JSON.stringify(propertyData),
        this.PROPERTY_CACHE_TTL
      );

      // Also add to client's property set for easy lookup/invalidation
      const clientKey = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cuid}`;
      await this.client.sAdd(clientKey, propertyId);

      return propertyResult;
    } catch (error) {
      this.log.error('Failed to cache property:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached property by ID with tenant validation
   * @param cuid - Client/tenant identifier
   * @param propertyId - Property identifier
   */
  async getProperty(cuid: string, propertyId: string): Promise<ISuccessReturnData<any | null>> {
    try {
      if (!cuid || !propertyId) {
        return {
          success: false,
          data: null,
          error: 'Client ID and property ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cuid}:${propertyId}`;
      const result = await this.getItem(key);
      return result;
    } catch (error) {
      this.log.error('Failed to get property from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Cache a list of properties with pagination
   * @param cuid - Client/tenant identifier
   * @param listKey - Unique key identifying this list (e.g., "all", "vacant", "commercial")
   * @param page - Page number
   * @param limit - Items per page
   * @param propertyList - Array of property data
   * @param totalCount - Total count across all pages
   */
  async saveClientProperties(
    cuid: string,
    propertyList: IProperty[],
    opts: {
      pagination: IPaginationQuery;
      filter: FilterQuery<IPropertyDocument>;
      totalCount?: number;
    }
  ): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !propertyList) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID, list key, or property list',
        };
      }
      const listKey = this.generateListKeyFromPagination(opts.pagination);
      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cuid}:${listKey}`;

      const totalToCache = opts.totalCount ?? propertyList.length;

      await this.deleteItems([key]);
      const multi = this.client.multi();

      for (const property of propertyList) {
        multi.RPUSH(key, this.serialize(property));
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

      multi.EXPIRE(key, this.LIST_CACHE_TTL);
      await multi.exec();

      return {
        data: { count: propertyList.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to cache property list:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached property list with tenant isolation
   * @param cuid - Client/tenant identifier
   * @param pagination - Pagination object
   * @returns - List of properties and pagination info
   * @throws - Error if client ID or pagination is invalid
   */
  async getClientProperties(
    cuid: string,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid || !pagination) {
        return {
          success: false,
          data: null,
          error: 'Client ID and list key are required',
        };
      }
      const listKey = this.generateListKeyFromPagination(pagination);
      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cuid}:${listKey}`;

      const listResult = await this.getListRange(key, 0, -1);
      if (!listResult.success || !listResult.data || listResult.data.length === 0) {
        return {
          data: null,
          success: false,
          message: 'No cached properties found',
        };
      }

      // get metadata for pagination info
      const metaKey = `${key}:meta`;
      const metaResult = await this.getObject<{ total: number }>(metaKey);
      const total = metaResult.success ? metaResult.data.total : listResult.data.length;

      return {
        success: true,
        data: {
          properties: listResult.data,
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total,
          },
        },
      };
    } catch (error) {
      this.log.error('Failed to get property list from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate a property in the cache
   * @param cuid - Client/tenant identifier
   * @param propertyId - Property identifier
   */
  async invalidateProperty(cuid: string, propertyId: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !propertyId) {
        return {
          data: null,
          success: false,
          error: 'Client ID and property ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cuid}:${propertyId}`;
      await this.deleteItems([key]);
      return { data: null, success: true };
    } catch (error) {
      this.log.error('Failed to invalidate property:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate all properties for a tenant
   * @param cuid - Client/tenant identifier
   */
  async invalidateClientProperties(cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      const clientKey = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cuid}`;
      const propertyIds = await this.client.sMembers(clientKey);

      if (propertyIds.length > 0) {
        const keys = propertyIds.map(
          (pid) => `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cuid}:${pid}`
        );
        await this.deleteItems(keys);
      }

      const listPattern = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cuid}:*`;
      const listKeys = await this.client.keys(listPattern);

      const allKeys = [...listKeys];
      if (allKeys.length > 0) {
        await this.deleteItems(allKeys);
      }

      return {
        data: { deletedCount: propertyIds.length + allKeys.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate client properties:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate property lists matching a pattern with tenant isolation
   * @param cuid - Client/tenant identifier
   * @param listKey - Optional list key to target specific lists
   */
  async invalidatePropertyLists(cuid: string, listKey?: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      // Pattern to match all property lists or a specific list type for this tenant
      const pattern = listKey
        ? `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cuid}:${listKey}:*`
        : `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cuid}:*`;

      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.deleteItems(keys);
      }

      return {
        data: { deletedCount: keys.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate property lists:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  private generateListKeyFromPagination(pagination: IPaginationQuery): string {
    const pstring = this.hashData(pagination);
    return `q:${pstring}`;
  }
}
