import { FilterQuery } from 'mongoose';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';
import { ILeaseDocument, ILeaseListItem } from '@interfaces/lease.interface';
import { ISuccessReturnData, IPaginationQuery } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export class LeaseCache extends BaseCache {
  private readonly KEY_PREFIXES = {
    CLIENT_LEASE: 'cl:',
    CLIENT_LEASES: 'cls:',
  };

  private readonly LEASE_CACHE_TTL: number;
  private readonly LIST_CACHE_TTL: number;

  constructor(cacheName = 'LeaseCache') {
    super(cacheName);
    this.initializeClient();

    this.LEASE_CACHE_TTL = convertTimeToSecondsAndMilliseconds('5m').seconds;
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
   * Cache a single lease object with tenant isolation
   * @param cuid - Client identifier
   * @param leaseId - Lease identifier (luid)
   * @param leaseData - Lease data object
   */
  async cacheLease(cuid: string, leaseId: string, leaseData: any): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !leaseId || !leaseData) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID, lease ID, or lease data',
        };
      }

      const leaseKey = `${this.KEY_PREFIXES.CLIENT_LEASE}:${cuid}:${leaseId}`;
      const leaseResult = await this.setItem(
        leaseKey,
        JSON.stringify(leaseData),
        this.LEASE_CACHE_TTL
      );

      // Also add to client's lease set for easy lookup/invalidation
      const clientKey = `${this.KEY_PREFIXES.CLIENT_LEASES}:${cuid}`;
      await this.client.sAdd(clientKey, leaseId);

      return leaseResult;
    } catch (error) {
      this.log.error('Failed to cache lease:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached lease by ID with tenant validation
   * @param cuid - Client/tenant identifier
   * @param leaseId - Lease identifier (luid)
   */
  async getLease(cuid: string, leaseId: string): Promise<ISuccessReturnData<any | null>> {
    try {
      if (!cuid || !leaseId) {
        return {
          success: false,
          data: null,
          error: 'Client ID and lease ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_LEASE}:${cuid}:${leaseId}`;
      const result = await this.getItem(key);
      return result;
    } catch (error) {
      this.log.error('Failed to get lease from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Cache a list of leases with pagination
   * @param cuid - Client/tenant identifier
   * @param leaseList - Array of lease data
   * @param opts - Options including pagination and filters
   */
  async saveClientLeases(
    cuid: string,
    leaseList: ILeaseListItem[],
    opts: {
      pagination: IPaginationQuery;
      filter: FilterQuery<ILeaseDocument>;
      totalCount?: number;
    }
  ): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !leaseList) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID or lease list',
        };
      }

      const listKey = this.generateListKeyFromPagination(opts.pagination, opts.filter);
      const key = `${this.KEY_PREFIXES.CLIENT_LEASES}:${cuid}:${listKey}`;

      const totalToCache = opts.totalCount ?? leaseList.length;

      await this.deleteItems([key]);
      const multi = this.client.multi();

      for (const lease of leaseList) {
        multi.RPUSH(key, this.serialize(lease));
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
        data: { count: leaseList.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to cache lease list:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached lease list with tenant isolation
   * @param cuid - Client/tenant identifier
   * @param pagination - Pagination object
   * @param filter - Filter object
   * @returns - List of leases and pagination info
   */
  async getClientLeases(
    cuid: string,
    pagination: IPaginationQuery,
    filter: FilterQuery<ILeaseDocument>
  ): Promise<ISuccessReturnData<any>> {
    try {
      if (!cuid || !pagination) {
        return {
          success: false,
          data: null,
          error: 'Client ID and pagination are required',
        };
      }

      const listKey = this.generateListKeyFromPagination(pagination, filter);
      const key = `${this.KEY_PREFIXES.CLIENT_LEASES}:${cuid}:${listKey}`;

      const listResult = await this.getListRange(key, 0, -1);
      if (!listResult.success || !listResult.data || listResult.data.length === 0) {
        return {
          data: null,
          success: false,
          message: 'No cached leases found',
        };
      }

      // Get metadata for pagination info
      const metaKey = `${key}:meta`;
      const metaResult = await this.getObject<{ total: number }>(metaKey);
      const total = metaResult.success ? metaResult.data.total : listResult.data.length;

      return {
        success: true,
        data: {
          leases: listResult.data,
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total,
          },
        },
      };
    } catch (error) {
      this.log.error('Failed to get lease list from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate a single lease in the cache
   * @param cuid - Client/tenant identifier
   * @param leaseId - Lease identifier (luid)
   */
  async invalidateLease(cuid: string, leaseId: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !leaseId) {
        return {
          data: null,
          success: false,
          error: 'Client ID and lease ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.CLIENT_LEASE}:${cuid}:${leaseId}`;
      await this.deleteItems([key]);
      return { data: null, success: true };
    } catch (error) {
      this.log.error('Failed to invalidate lease:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate all leases for a tenant/client
   * @param cuid - Client/tenant identifier
   */
  async invalidateClientLeases(cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      const clientKey = `${this.KEY_PREFIXES.CLIENT_LEASES}:${cuid}`;
      const leaseIds = await this.client.sMembers(clientKey);

      if (leaseIds.length > 0) {
        const keys = leaseIds.map((lid) => `${this.KEY_PREFIXES.CLIENT_LEASE}:${cuid}:${lid}`);
        await this.deleteItems(keys);
      }

      const listPattern = `${this.KEY_PREFIXES.CLIENT_LEASES}:${cuid}:*`;
      const listKeys = await this.client.keys(listPattern);

      const allKeys = [...listKeys];
      if (allKeys.length > 0) {
        await this.deleteItems(allKeys);
      }

      return {
        data: { deletedCount: leaseIds.length + allKeys.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate client leases:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate lease lists matching a pattern with tenant isolation
   * @param cuid - Client/tenant identifier
   * @param listKey - Optional list key to target specific lists
   */
  async invalidateLeaseLists(cuid: string, listKey?: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      // Pattern to match all lease lists or a specific list type for this tenant
      const pattern = listKey
        ? `${this.KEY_PREFIXES.CLIENT_LEASES}:${cuid}:${listKey}:*`
        : `${this.KEY_PREFIXES.CLIENT_LEASES}:${cuid}:*`;

      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.deleteItems(keys);
      }

      return {
        data: { deletedCount: keys.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate lease lists:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Generate a unique list key from pagination and filter parameters
   * @param pagination - Pagination parameters
   * @param filter - Filter parameters
   * @returns Hash-based key string
   */
  private generateListKeyFromPagination(
    pagination: IPaginationQuery,
    filter?: FilterQuery<ILeaseDocument>
  ): string {
    const combined = { ...pagination, ...filter };
    const hash = this.hashData(combined);
    return `q:${hash}`;
  }
}
