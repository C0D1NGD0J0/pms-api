// app/caching/property.cache.ts

import { BaseCache } from './base.cache';
import { envVariables } from '@shared/config';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';

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
      console.info('PropertyCache connected to Redis');
    });

    this.PROPERTY_CACHE_TTL = convertTimeToSecondsAndMilliseconds('10m').seconds;
    this.LIST_CACHE_TTL = convertTimeToSecondsAndMilliseconds('30m').seconds;
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
   * @param cid - client identifier
   * @param propertyId - property identifier
   * @param propertyData - pProperty data object
   */
  async cacheProperty(
    cid: string,
    propertyId: string,
    propertyData: any
  ): Promise<ISuccessReturnData> {
    try {
      if (!cid || !propertyId || !propertyData) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID, property ID, or property data',
        };
      }

      const propertyKey = `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cid}:${propertyId}`;
      const propertyResult = await this.setItem(
        propertyKey,
        JSON.stringify(propertyData),
        this.PROPERTY_CACHE_TTL
      );

      // Also add to client's property set for easy lookup/invalidation
      const clientKey = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cid}`;
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
   * @param cid - Client/tenant identifier
   * @param propertyId - Property identifier
   */
  async getProperty(cid: string, propertyId: string): Promise<ISuccessReturnData<any | null>> {
    try {
      if (!cid || !propertyId) {
        return {
          success: false,
          data: null,
          error: 'Client ID and property ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cid}:${propertyId}`;
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
   * @param cid - Client/tenant identifier
   * @param listKey - Unique key identifying this list (e.g., "all", "vacant", "commercial")
   * @param page - Page number
   * @param limit - Items per page
   * @param propertyList - Array of property data
   */
  async cachePropertyList(
    cid: string,
    listKey: string,
    page: number,
    limit: number,
    propertyList: any[]
  ): Promise<ISuccessReturnData> {
    try {
      if (!cid || !listKey || !propertyList) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID, list key, or property list',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cid}:${listKey}:${page}:${limit}`;
      return await this.setItem(key, JSON.stringify(propertyList), this.LIST_CACHE_TTL);
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
   * @param cid - Client/tenant identifier
   * @param listKey - Unique key identifying this list
   * @param page - Page number
   * @param limit - Items per page
   */
  async getPropertyList(
    cid: string,
    listKey: string,
    page: number,
    limit: number
  ): Promise<ISuccessReturnData<any[] | null>> {
    try {
      if (!cid || !listKey) {
        return {
          success: false,
          data: null,
          error: 'Client ID and list key are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cid}:${listKey}:${page}:${limit}`;
      const result = await this.getItem<any[]>(key);
      return result as ISuccessReturnData<any[] | null>;
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
   * @param cid - Client/tenant identifier
   * @param propertyId - Property identifier
   */
  async invalidateProperty(cid: string, propertyId: string): Promise<ISuccessReturnData> {
    try {
      if (!cid || !propertyId) {
        return {
          data: null,
          success: false,
          error: 'Client ID and property ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cid}:${propertyId}`;
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
   * @param cid - Client/tenant identifier
   */
  async invalidateClientProperties(cid: string): Promise<ISuccessReturnData> {
    try {
      if (!cid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      const clientKey = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cid}`;
      const propertyIds = await this.client.sMembers(clientKey);

      if (propertyIds.length > 0) {
        const keys = propertyIds.map((pid) => `${this.KEY_PREFIXES.CLIENT_PROPERTY}:${cid}:${pid}`);
        await this.deleteItems(keys);
      }

      const listPattern = `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cid}:*`;
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
   * @param cid - Client/tenant identifier
   * @param listKey - Optional list key to target specific lists
   */
  async invalidatePropertyLists(cid: string, listKey?: string): Promise<ISuccessReturnData> {
    try {
      if (!cid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      // Pattern to match all property lists or a specific list type for this tenant
      const pattern = listKey
        ? `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cid}:${listKey}:*`
        : `${this.KEY_PREFIXES.CLIENT_PROPERTIES}:${cid}:*`;

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
}
