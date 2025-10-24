import { Document, Types } from 'mongoose';

/**
 * Lease Status Enum
 * Represents the current state of a lease agreement
 */
export enum LeaseStatus {
  PENDING_SIGNATURE = 'pending_signature',
  TERMINATED = 'terminated',
  CANCELLED = 'cancelled',
  EXPIRED = 'expired',
  ACTIVE = 'active',
  DRAFT = 'draft',
}

/**
 * Signing Method Enum
 */
export enum SigningMethod {
  ELECTRONIC = 'electronic',
  PENDING = 'pending',
  MANUAL = 'manual',
}

/**
 * Lease Type Enum
 * Defines the term structure of the lease
 */
export enum LeaseType {
  MONTH_TO_MONTH = 'month_to_month',
  FIXED_TERM = 'fixed_term',
}

/**
 * Main Lease Interface
 * Core lease data structure
 */
export interface ILease {
  utilitiesIncluded?: (
    | 'water'
    | 'gas'
    | 'electricity'
    | 'internet'
    | 'cable'
    | 'trash'
    | 'sewer'
    | 'heating'
    | 'cooling'
  )[];
  signingMethod: SigningMethod | string;
  leaseDocument?: ILeaseDocumentItem[];
  createdBy: Types.ObjectId | string;
  lastModifiedBy?: ILastModifiedBy[];
  tenantId: Types.ObjectId | string;
  renewalOptions?: IRenewalOptions;
  signatures?: ILeaseSignature[];
  eSignature?: ILeaseESignature;
  terminationReason?: string;
  property: ILeaseProperty;
  duration: ILeaseDuration;
  legalTerms?: ILegalTerms;
  coTenants?: ICoTenant[];
  petPolicy?: IPetPolicy;
  internalNotes?: string;
  leaseNumber: string;
  status: LeaseStatus;
  signedDate?: Date;
  fees: ILeaseFees;
  deletedAt?: Date;
  type: LeaseType;
  cuid: string;
}

/**
 * Lease Form Data Interface
 * Used for creating/updating leases via API
 */
export interface ILeaseFormData {
  lateFeeType?: 'fixed' | 'percentage';
  acceptedPaymentMethods?: string[];
  renewalOptions?: IRenewalOptions;
  utilitiesIncluded?: string[];
  moveInDate?: Date | string;
  lateFeePercentage?: number;
  startDate: Date | string;
  legalTerms?: ILegalTerms;
  propertyAddress: string;
  securityDeposit: number;
  coTenants?: ICoTenant[];
  endDate: Date | string;
  lateFeeAmount?: number;
  petPolicy?: IPetPolicy;
  internalNotes?: string;
  lateFeeDays?: number;
  leaseNumber: string;
  monthlyRent: number;
  propertyId: string;
  rentDueDay: number;
  currency?: string;
  tenantId: string;
  type: LeaseType;
  unitId?: string;
}

/**
 * Lease Filter Options Interface
 * Used for querying leases
 */
export interface ILeaseFilterOptions {
  signingMethod?: SigningMethod | string;
  status?: LeaseStatus | LeaseStatus[];
  propertyId?: Types.ObjectId | string;
  tenantId?: Types.ObjectId | string;
  unitId?: Types.ObjectId | string;
  type?: LeaseType | LeaseType[];
  isExpiringSoon?: boolean;
  startDateFrom?: Date;
  createdBefore?: Date;
  createdAfter?: Date;
  startDateTo?: Date;
  endDateFrom?: Date;
  endDateTo?: Date;
  minRent?: number;
  maxRent?: number;
  search?: string; // For lease number or tenant name search
}

/**
 * Lease Document Interface with Mongoose Document
 * Extends ILease with MongoDB document properties and methods
 */
export interface ILeaseDocument extends Document, ILease {
  // Instance methods
  softDelete(userId: Types.ObjectId): Promise<ILeaseDocument>;
  hasOverlap(startDate: Date, endDate: Date): boolean;
  // Virtual properties
  daysUntilExpiry: number | null;
  durationMonths: number | null;
  totalMonthlyFees: number;

  isExpiringSoon: boolean;
  _id: Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;

  luid: string;
  id: string;
}

/**
 * Fees Interface
 * All financial terms of the lease
 */
export interface ILeaseFees {
  acceptedPaymentMethods?: (
    | 'bank_transfer'
    | 'check'
    | 'cash'
    | 'credit_card'
    | 'debit_card'
    | 'mobile_payment'
  )[];
  lateFeeType?: 'fixed' | 'percentage';
  lateFeePercentage?: number;
  securityDeposit: number;
  lateFeeAmount?: number;
  lateFeeDays?: number;
  monthlyRent: number;
  rentDueDay: number; // 1-31
  currency: string;
}

/**
 * Lease Stats Interface
 * Statistics for reporting
 */
export interface ILeaseStats {
  leasesByStatus: {
    draft: number;
    pending_signature: number;
    active: number;
    expired: number;
    terminated: number;
    cancelled: number;
  };
  averageLeaseDuration: number;
  totalMonthlyRent: number;
  expiringIn30Days: number;
  expiringIn60Days: number;
  expiringIn90Days: number;
  occupancyRate: number;
  totalLeases: number;
}

/**
 * Rent Roll Item Interface
 * Individual entry in rent roll report
 */
export interface IRentRollItem {
  leaseId: Types.ObjectId | string;
  daysUntilExpiry: number | null;
  propertyAddress: string;
  securityDeposit: number;
  propertyName: string;
  leaseNumber: string;
  tenantEmail: string;
  unitNumber?: string;
  monthlyRent: number;
  status: LeaseStatus;
  tenantName: string;
  startDate: Date;
  endDate: Date;
  luid: string;
}

/**
 * Rent Roll Report Interface
 * Complete rent roll with summary
 */
export interface IRentRollReport {
  summary: {
    totalLeases: number;
    totalMonthlyRent: number;
    totalSecurityDeposits: number;
    activeLeases: number;
    expiringLeases: number;
  };
  propertyId?: Types.ObjectId | string;
  items: IRentRollItem[];
  propertyName?: string;
  generatedAt: Date;
}

/**
 * Lease Document Item Interface
 * Tracks uploaded lease documents
 */
export interface ILeaseDocumentItem {
  documentType?: 'lease_agreement' | 'addendum' | 'amendment' | 'renewal' | 'termination' | 'other';
  uploadedBy: Types.ObjectId | string;
  mimeType?: string;
  uploadedAt?: Date;
  filename: string;
  size?: number;
  url: string;
  key: string;
}

/**
 * E-Signature Request Data Interface
 * Used when sending lease for signature
 */
export interface IESignatureRequestData {
  signers: {
    email: string;
    name: string;
    role: 'tenant' | 'co_tenant' | 'landlord';
    order?: number;
  }[];
  provider: 'hellosign' | 'docusign' | 'pandadoc';
  testMode?: boolean;
  message?: string;
}

/**
 * Signature Interface
 * Individual signature tracking
 */
export interface ILeaseSignature {
  role: 'tenant' | 'co_tenant' | 'landlord' | 'property_manager';
  signatureMethod: 'manual' | 'electronic';
  userId: Types.ObjectId | string;
  providerSignatureId?: string;
  ipAddress?: string;
  signedAt: Date;
}

/**
 * E-Signature Interface
 * Tracks electronic signature provider details
 */
export interface ILeaseESignature {
  status?: 'draft' | 'sent' | 'signed' | 'declined' | 'voided';
  provider: 'hellosign' | 'boldsign';
  declinedReason?: string;
  envelopeId?: string;
  signingUrl?: string;
  completedAt?: Date;
  sentAt?: Date;
}

/**
 * Last Modified By Interface
 * Audit trail entry
 */
export interface ILastModifiedBy {
  action: 'created' | 'updated' | 'activated' | 'terminated' | 'cancelled' | 'renewed';
  userId: Types.ObjectId | string;
  name: string;
  date: Date;
}

/**
 * Lease Termination Data Interface
 * Used when terminating a lease
 */
export interface ILeaseTerminationData {
  terminationDate: Date | string;
  moveOutDate?: Date | string;
  terminationReason: string;
  notes?: string;
}

/**
 * Lease Query Options Interface
 * Pagination and sorting options
 */
export interface ILeaseQueryOptions {
  sortOrder?: 'asc' | 'desc';
  populate?: string[];
  sortBy?: string;
  limit?: number;
  page?: number;
}

/**
 * Duration Interface
 * All date-related information
 */
export interface ILeaseDuration {
  terminationDate?: Date;
  moveOutDate?: Date;
  moveInDate?: Date;
  startDate: Date;
  endDate: Date;
}

/**
 * Pet Policy Interface
 * Defines pet rules and associated fees
 */
export interface IPetPolicy {
  monthlyFee?: number;
  allowed: boolean;
  deposit?: number;
  types?: string[];
  maxPets?: number;
}

/**
 * Property Reference Interface
 * Links lease to property and unit
 */
export interface ILeaseProperty {
  unitId?: Types.ObjectId | string;
  id: Types.ObjectId | string;
  address: string;
}

/**
 * Lease Activation Data Interface
 * Used when activating a lease
 */
export interface ILeaseActivationData {
  signedDate?: Date | string;
  moveInDate?: Date | string;
  notes?: string;
}

/**
 * Renewal Options Interface
 * Automatic renewal settings
 */
export interface IRenewalOptions {
  renewalTermMonths?: number;
  noticePeriodDays?: number;
  autoRenew: boolean;
}

/**
 * Co-Tenant Interface
 * Additional tenants on the lease
 */
export interface ICoTenant {
  occupation?: string;
  email: string;
  phone: string;
  name: string;
}

/**
 * Legal Terms Interface
 * Stores lease agreement terms
 */
export interface ILegalTerms {
  text?: string;
  html?: string;
  url?: string;
}
