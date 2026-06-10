import type { QueryFilter } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  IMaintenanceRequestDocument,
  IMaintenanceStats,
  IVendorStats,
} from '@interfaces/maintenanceRequest.interface';

export interface IMaintenanceRequestDAO {
  /**
   * List requests with propertyId, vendorId, and tenantId populated
   * Use this for all list responses sent to the frontend
   */
  listWithDetails(
    filter: QueryFilter<IMaintenanceRequestDocument>,
    pagination?: IPaginationQuery
  ): ListResultWithPagination<IMaintenanceRequestDocument[]>;

  /**
   * Aggregated stats for a client, optionally scoped to property, tenant, or vendor
   */
  getStats(
    cuid: string,
    opts?: { propertyId?: string; tenantUserId?: string; vendorUserId?: string }
  ): Promise<IMaintenanceStats>;

  /**
   * Get a single request by mruid scoped to a client (primary lookup)
   */
  getByMruid(mruid: string, cuid: string): Promise<IMaintenanceRequestDocument | null>;

  getVendorStatsBatch(vendorIds: string[]): Promise<Map<string, IVendorStats>>;

  getVendorAvgRatingBatch(vendorIds: string[]): Promise<Map<string, number>>;

  /**
   * Get a vendor's active job queue (ASSIGNED + IN_PROGRESS) across all clients
   * Cross-cuid: vendors can work for multiple property managers
   */
  getVendorQueue(vendorId: string): Promise<IMaintenanceRequestDocument[]>;
  /**
   * Get a single request by mruid without cuid scoping
   * Used by webhook handlers where cuid is not available from the external source
   */
  findByMruid(mruid: string): Promise<IMaintenanceRequestDocument | null>;
  /**
   * Get performance stats for a vendor across all clients
   * Cross-cuid: vendors can work for multiple property managers
   */
  getVendorStats(vendorId: string): Promise<IVendorStats>;
  getVendorAvgRating(vendorId: string): Promise<number>;
}
