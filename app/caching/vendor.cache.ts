import { RedisService } from '@database/index';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';
import { FilteredUserTableData } from '@interfaces/user.interface';
import { IVendorFilterOptions } from '@dao/interfaces/vendorDAO.interface';
import { ISuccessReturnData, IPaginationQuery } from '@interfaces/utils.interface';

import { BaseCache } from './base.cache';

export class VendorCache extends BaseCache {
  private readonly KEY_PREFIXES = {
    FILTERED_VENDORS: 'fv:',
    VENDOR_DETAIL: 'v:',
    CLIENT_VENDORS: 'cvs:',
  };

  private readonly VENDOR_DETAIL_CACHE_TTL: number;
  private readonly LIST_CACHE_TTL: number;

  constructor({ redisService }: { redisService: RedisService }) {
    super({ redisService });

    this.VENDOR_DETAIL_CACHE_TTL = convertTimeToSecondsAndMilliseconds('2h').seconds;
    this.LIST_CACHE_TTL = convertTimeToSecondsAndMilliseconds('5m').seconds;
  }

  /**
   * Cache a filtered vendors list with pagination
   * @param cuid - Client identifier
   * @param vendorList - Array of vendor data (FilteredUserTableData format)
   * @param opts - Filter and pagination options used to generate this list
   */
  async saveFilteredVendors(
    cuid: string,
    vendorList: FilteredUserTableData[],
    opts: {
      filters: IVendorFilterOptions;
      pagination: IPaginationQuery;
    }
  ): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !vendorList) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID or vendor list',
        };
      }

      const listKey = this.generateListKeyFromOptions(opts.filters, opts.pagination);
      const key = `${this.KEY_PREFIXES.FILTERED_VENDORS}${cuid}:${listKey}`;

      // Clear any existing data for this key
      await this.deleteItems([key]);

      const multi = this.client.multi();

      // Store each vendor in the list
      for (const vendor of vendorList) {
        multi.RPUSH(key, this.serialize(vendor));
      }

      // Store metadata for pagination
      const metaKey = `${key}:meta`;
      await this.setObject(
        metaKey,
        {
          total: vendorList.length,
          lastUpdated: Date.now(),
          listKey,
          cuid,
          filters: opts.filters,
          pagination: opts.pagination,
        },
        this.LIST_CACHE_TTL
      );

      // Set TTL on the list
      multi.EXPIRE(key, this.LIST_CACHE_TTL);
      await multi.exec();

      this.log.info(`Cached ${vendorList.length} vendors for client ${cuid}`, {
        listKey,
        ttl: this.LIST_CACHE_TTL,
      });

      return {
        data: { count: vendorList.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to cache filtered vendors:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached filtered vendors list
   * @param cuid - Client identifier
   * @param filters - Filter options
   * @param pagination - Pagination options
   */
  async getFilteredVendors(
    cuid: string,
    filters: IVendorFilterOptions,
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

      const listKey = this.generateListKeyFromOptions(filters, pagination);
      const key = `${this.KEY_PREFIXES.FILTERED_VENDORS}${cuid}:${listKey}`;

      const listResult = await this.getListRange<FilteredUserTableData>(key, 0, -1);

      if (!listResult.success || !listResult.data || listResult.data.length === 0) {
        return {
          data: null,
          success: false,
          message: 'No cached vendors found',
        };
      }

      // Get metadata for pagination info
      const metaKey = `${key}:meta`;
      const metaResult = await this.getObject<{
        total: number;
        filters: IVendorFilterOptions;
        pagination: IPaginationQuery;
      }>(metaKey);

      const total =
        metaResult.success && metaResult.data ? metaResult.data.total : listResult.data.length;

      this.log.info(`Retrieved ${listResult.data.length} cached vendors for client ${cuid}`, {
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
      this.log.error('Failed to get filtered vendors from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Cache a vendor detail
   * @param cuid - Client identifier
   * @param vendorId - Vendor identifier
   * @param vendorData - Vendor detail data
   */
  async cacheVendorDetail(
    cuid: string,
    vendorId: string,
    vendorData: any
  ): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !vendorId || !vendorData) {
        return {
          data: null,
          success: false,
          error: 'Invalid client ID, vendor ID, or vendor data',
        };
      }

      const vendorKey = `${this.KEY_PREFIXES.VENDOR_DETAIL}${cuid}:${vendorId}`;
      const result = await this.setItem(
        vendorKey,
        JSON.stringify(vendorData),
        this.VENDOR_DETAIL_CACHE_TTL
      );

      // Add to client's vendor set for easy lookup/invalidation
      const clientKey = `${this.KEY_PREFIXES.CLIENT_VENDORS}${cuid}`;
      await this.client.sAdd(clientKey, vendorId);

      return result;
    } catch (error) {
      this.log.error('Failed to cache vendor detail:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Get cached vendor detail
   * @param cuid - Client identifier
   * @param vendorId - Vendor identifier
   */
  async getVendorDetail(cuid: string, vendorId: string): Promise<ISuccessReturnData<any | null>> {
    try {
      if (!cuid || !vendorId) {
        return {
          success: false,
          data: null,
          error: 'Client ID and vendor ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.VENDOR_DETAIL}${cuid}:${vendorId}`;
      const result = await this.getItem(key);
      return result;
    } catch (error) {
      this.log.error('Failed to get vendor detail from cache:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate filtered vendor lists for a client
   * @param cuid - Client identifier
   */
  async invalidateVendorLists(cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      // Pattern to match all filtered vendor lists for this client
      const pattern = `${this.KEY_PREFIXES.FILTERED_VENDORS}${cuid}:*`;
      const keys = await this.client.keys(pattern);

      if (keys.length > 0) {
        await this.deleteItems(keys);
        this.log.info(`Invalidated ${keys.length} vendor list caches for client ${cuid}`);
      }

      return {
        data: { deletedCount: keys.length },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate vendor lists:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate a specific vendor detail
   * @param cuid - Client identifier
   * @param vendorId - Vendor identifier
   */
  async invalidateVendorDetail(cuid: string, vendorId: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid || !vendorId) {
        return {
          data: null,
          success: false,
          error: 'Client ID and vendor ID are required',
        };
      }

      const key = `${this.KEY_PREFIXES.VENDOR_DETAIL}${cuid}:${vendorId}`;
      await this.deleteItems([key]);

      return { data: null, success: true };
    } catch (error) {
      this.log.error('Failed to invalidate vendor detail:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Invalidate all vendor caches for a client
   * @param cuid - Client identifier
   */
  async invalidateAllVendorCaches(cuid: string): Promise<ISuccessReturnData> {
    try {
      if (!cuid) {
        return {
          data: null,
          success: false,
          error: 'Client ID is required',
        };
      }

      // Get all patterns
      const patterns = [
        `${this.KEY_PREFIXES.FILTERED_VENDORS}${cuid}:*`,
        `${this.KEY_PREFIXES.VENDOR_DETAIL}${cuid}:*`,
        `${this.KEY_PREFIXES.CLIENT_VENDORS}${cuid}`,
      ];

      let totalDeleted = 0;
      for (const pattern of patterns) {
        const keys = await this.client.keys(pattern);
        if (keys.length > 0) {
          await this.deleteItems(keys);
          totalDeleted += keys.length;
        }
      }

      this.log.info(`Invalidated ${totalDeleted} vendor caches for client ${cuid}`);

      return {
        data: { deletedCount: totalDeleted },
        success: true,
      };
    } catch (error) {
      this.log.error('Failed to invalidate all vendor caches:', error);
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
  private generateListKeyFromOptions(
    filters: IVendorFilterOptions,
    pagination: IPaginationQuery
  ): string {
    const combined = {
      ...filters,
      page: pagination.page,
      limit: pagination.limit,
      sortBy: pagination.sortBy,
      sort: pagination.sort,
    };
    const hash = this.hashData(combined);
    return `q:${hash}`;
  }
}
