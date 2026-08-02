import { type QueryFilter, ClientSession } from 'mongoose';
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
  terminateLease(
    cuid: string,
    leaseId: string,
    terminationData: {
      terminationDate: Date;
      terminationReason: string;
      moveOutDate?: Date;
      notes?: string;
    },
    terminatedBy: {
      userId: string;
      name: string;
    }
  ): Promise<ILeaseDocument | null>;

  checkOverlappingLeases(
    cuid: string,
    propertyId: string,
    unitId: string | undefined,
    startDate: Date,
    endDate: Date,
    excludeLeaseId?: string
  ): Promise<ILeaseDocument[]>;

  getTenantInfo(lease: ILeaseDocument): Promise<{
    type: 'invitation' | 'user';
    email: string;
    name: string;
    isActive: boolean;
    data: any;
  }>;

  updateLeaseDocumentStatus(
    leaseId: string,
    status: 'active' | 'failed' | 'deleted',
    errorMessage?: string
  ): Promise<ILeaseDocument | null>;

  getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    pagination: IPaginationQuery
  ): ListResultWithPagination<ILeaseListItem[]>;

  updateLeaseDocuments(
    leaseId: string,
    uploadResults: UploadResult[],
    userId: string
  ): Promise<ILeaseDocument | null>;

  updateLease(
    cuid: string,
    leaseId: string,
    data: Partial<ILeaseDocument>
  ): Promise<ILeaseDocument | null>;

  createLease(cuid: string, data: ILeaseFormData, session?: ClientSession): Promise<ILeaseDocument>;

  getLeaseById(cuid: string, leaseId: string, opts?: IFindOptions): Promise<ILeaseDocument | null>;

  getLeaseStats(cuid: string, filters?: QueryFilter<ILeaseDocument>): Promise<ILeaseStats>;

  updateLeaseStatus(cuid: string, leaseId: string, status: LeaseStatus): Promise<boolean>;

  getActiveLeaseByTenant(cuid: string, tenantId: string): Promise<ILeaseDocument | null>;

  /** Used for field-locking: true if at least one non-draft lease exists for this property */
  hasNonDraftLeaseForProperty(propertyObjectId: string, cuid: string): Promise<boolean>;

  getActiveLeaseByUnit(cuid: string, unitId: string): Promise<ILeaseDocument | null>;

  getExpiringLeases(cuid: string, daysAhead: number): Promise<ILeaseDocument[]>;

  /** Used for field-locking: true if at least one non-draft lease exists for this unit */
  hasNonDraftLeaseForUnit(unitObjectId: string, cuid: string): Promise<boolean>;

  getRentRollData(cuid: string, propertyId?: string): Promise<IRentRollItem[]>;

  getLeasesPendingTenantAcceptance(cuid: string): Promise<ILeaseDocument[]>;

  deleteLease(cuid: string, leaseId: string): Promise<boolean>;
}
