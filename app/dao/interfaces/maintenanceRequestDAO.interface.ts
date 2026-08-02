import type { QueryFilter } from 'mongoose';
import { ListResultWithPagination, IPaginationQuery } from '@interfaces/utils.interface';
import {
  IMaintenanceRequestDocument,
  IMaintenanceStats,
  IVendorStats,
} from '@interfaces/maintenanceRequest.interface';

export interface IMaintenanceRequestDAO {
  listWithDetails(
    filter: QueryFilter<IMaintenanceRequestDocument>,
    pagination?: IPaginationQuery
  ): ListResultWithPagination<IMaintenanceRequestDocument[]>;

  getStats(
    cuid: string,
    opts?: { propertyId?: string; tenantUserId?: string; vendorUserId?: string }
  ): Promise<IMaintenanceStats>;

  getByMruid(mruid: string, cuid: string): Promise<IMaintenanceRequestDocument | null>;

  getVendorStatsBatch(vendorIds: string[]): Promise<Map<string, IVendorStats>>;

  getVendorAvgRatingBatch(vendorIds: string[]): Promise<Map<string, number>>;

  /** Cross-cuid: vendors can work for multiple property managers. */
  getVendorQueue(vendorId: string): Promise<IMaintenanceRequestDocument[]>;
  /** Without cuid scoping — used by webhook handlers where cuid is not available. */
  findByMruid(mruid: string): Promise<IMaintenanceRequestDocument | null>;
  /** Cross-cuid: vendors can work for multiple property managers. */
  getVendorStats(vendorId: string): Promise<IVendorStats>;
  getVendorAvgRating(vendorId: string): Promise<number>;
}
