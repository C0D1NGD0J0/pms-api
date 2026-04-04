import { FilterQuery } from 'mongoose';
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
    filter: FilterQuery<IMaintenanceRequestDocument>,
    pagination?: IPaginationQuery
  ): ListResultWithPagination<IMaintenanceRequestDocument[]>;

  /**
   * Get a single request by mruid scoped to a client (primary lookup)
   */
  getByMruid(mruid: string, cuid: string): Promise<IMaintenanceRequestDocument | null>;

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
   * Get PM dashboard stats for a client, optionally scoped to a property
   */
  getStats(cuid: string, propertyId?: string): Promise<IMaintenanceStats>;

  /**
   * Get performance stats for a vendor across all clients
   * Cross-cuid: vendors can work for multiple property managers
   */
  getVendorStats(vendorId: string): Promise<IVendorStats>;
}
