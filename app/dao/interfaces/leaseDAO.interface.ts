import { ClientSession, FilterQuery } from 'mongoose';
import {
  ListResultWithPagination,
  IPaginationQuery,
  UploadResult,
} from '@interfaces/utils.interface';
import {
  ILeaseFilterOptions,
  ILeaseDocument,
  ILeaseFormData,
  ILeaseListItem,
  IRentRollItem,
  ILeaseStats,
  LeaseStatus,
} from '@interfaces/lease.interface';

import { IFindOptions } from './baseDAO.interface';

export interface ILeaseDAO {
  /**
   * Terminate a lease with termination data
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @param terminationData - Termination details (date, reason, etc.)
   * @returns Updated lease document or null
   */
  terminateLease(
    cuid: string,
    leaseId: string,
    terminationData: {
      terminationDate: Date;
      terminationReason: string;
      moveOutDate?: Date;
      notes?: string;
    }
  ): Promise<ILeaseDocument | null>;

  /**
   * Check for overlapping leases on the same unit
   * @param cuid - Client ID
   * @param propertyId - Property ID
   * @param unitId - Unit ID
   * @param startDate - Lease start date
   * @param endDate - Lease end date
   * @param excludeLeaseId - Optional lease ID to exclude from check
   * @returns Array of overlapping leases
   */
  checkOverlappingLeases(
    cuid: string,
    propertyId: string,
    unitId: string | undefined,
    startDate: Date,
    endDate: Date,
    excludeLeaseId?: string
  ): Promise<ILeaseDocument[]>;

  /**
   * Get tenant information for a lease (handles both invitation and user)
   * @param lease - Lease document
   * @returns Tenant information object with type, email, name, and data
   */
  getTenantInfo(lease: ILeaseDocument): Promise<{
    type: 'invitation' | 'user';
    email: string;
    name: string;
    isActive: boolean;
    data: any;
  }>;

  /**
   * Update lease document status (active, failed, deleted)
   * @param leaseId - Lease ID (luid)
   * @param status - New status for documents
   * @param errorMessage - Optional error message if status is 'failed'
   * @returns Updated lease document or null
   */
  updateLeaseDocumentStatus(
    leaseId: string,
    status: 'active' | 'failed' | 'deleted',
    errorMessage?: string
  ): Promise<ILeaseDocument | null>;

  /**
   * Get filtered leases with pagination
   * @param cuid - Client ID
   * @param filters - Filter options (status, type, propertyId, etc.)
   * @param pagination - Pagination options
   * @returns Leases with pagination metadata
   */
  getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    pagination: IPaginationQuery
  ): ListResultWithPagination<ILeaseListItem[]>;

  /**
   * Update lease with uploaded document information
   * @param leaseId - Lease ID (luid)
   * @param uploadResults - Array of upload results from S3
   * @param userId - User ID who uploaded the documents
   * @returns Updated lease document or null
   */
  updateLeaseDocuments(
    leaseId: string,
    uploadResults: UploadResult[],
    userId: string
  ): Promise<ILeaseDocument | null>;

  /**
   * Update lease fields
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @param data - Partial lease data to update
   * @returns Updated lease document or null
   */
  updateLease(
    cuid: string,
    leaseId: string,
    data: Partial<ILeaseDocument>
  ): Promise<ILeaseDocument | null>;

  /**
   * Create a new lease
   * @param cuid - Client ID
   * @param data - Lease form data (should include createdBy field)
   * @param session - Optional MongoDB session for transactions
   * @returns Created lease document
   */
  createLease(cuid: string, data: ILeaseFormData, session?: ClientSession): Promise<ILeaseDocument>;

  /**
   * Get lease by ID with client isolation
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @param opts - Additional query options
   * @returns Lease document or null if not found
   */
  getLeaseById(cuid: string, leaseId: string, opts?: IFindOptions): Promise<ILeaseDocument | null>;

  /**
   * Get aggregate statistics for leases
   * @param cuid - Client ID
   * @param filters - Optional filters (propertyId, date range)
   * @returns Statistics object
   */
  getLeaseStats(cuid: string, filters?: FilterQuery<ILeaseDocument>): Promise<ILeaseStats>;

  /**
   * Update lease status only
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @param status - New status
   * @returns True if updated successfully
   */
  updateLeaseStatus(cuid: string, leaseId: string, status: LeaseStatus): Promise<boolean>;

  /**
   * Get active lease for a tenant
   * @param cuid - Client ID
   * @param tenantId - Tenant ID
   * @returns Active lease document or null
   */
  getActiveLeaseByTenant(cuid: string, tenantId: string): Promise<ILeaseDocument | null>;

  /**
   * Get active lease for a unit
   * @param cuid - Client ID
   * @param unitId - Unit ID
   * @returns Active lease document or null
   */
  getActiveLeaseByUnit(cuid: string, unitId: string): Promise<ILeaseDocument | null>;

  /**
   * Get leases expiring within specified days
   * @param cuid - Client ID
   * @param daysAhead - Number of days ahead to check
   * @returns Array of expiring leases
   */
  getExpiringLeases(cuid: string, daysAhead: number): Promise<ILeaseDocument[]>;

  /**
   * Get rent roll data with aggregation
   * @param cuid - Client ID
   * @param propertyId - Optional property ID to filter by
   * @returns Array of rent roll items with joined property/unit/tenant data
   */
  getRentRollData(cuid: string, propertyId?: string): Promise<IRentRollItem[]>;

  /**
   * Get leases pending tenant acceptance (using invitation as temporary tenant)
   * @param cuid - Client ID
   * @returns Array of leases awaiting tenant acceptance
   */
  getLeasesPendingTenantAcceptance(cuid: string): Promise<ILeaseDocument[]>;

  /**
   * Soft delete a lease
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @returns True if deleted successfully
   */
  deleteLease(cuid: string, leaseId: string): Promise<boolean>;
}
