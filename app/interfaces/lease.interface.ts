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
 * @deprecated Use ILeasePreviewRequest instead
 * Legacy interface - keeping for backward compatibility
 */
export interface LeasePreviewData {
  // Additional Provisions
  petPolicy?: {
    allowed: boolean;
    maxPets?: number;
    types?: string | string[];
    deposit?: number;
  };
  renewalOptions?: {
    autoRenew: boolean;
    renewalTermMonths?: number;
    noticePeriodDays?: number;
  };
  coTenants?: Array<{
    name: string;
    email: string;
    phone: string;
    occupation?: string;
  }>;
  legalTerms?: {
    html?: string;
    text?: string;
  };

  utilitiesIncluded?: string | string[];
  requiresNotarization?: boolean;
  landlordSignatureUrl?: string;
  tenantSignatureUrl?: string;

  startDate?: string | Date;
  landlordAddress?: string;
  propertyAddress?: string;
  securityDeposit?: number;
  endDate?: string | Date;
  landlordEmail?: string;
  landlordPhone?: string;

  signingMethod?: string;
  propertyName?: string;
  propertyType?: string;
  jurisdiction?: string;
  landlordName?: string;
  leaseNumber?: string;
  currentDate?: string;
  tenantEmail?: string;

  tenantPhone?: string;
  monthlyRent?: number;
  unitNumber?: string;
  signedDate?: string;

  // Tenant Information
  tenantName?: string;
  rentDueDay?: number;
  // Lease Terms
  leaseType?: string;
  currency?: string;
}

/**
 * Lease preview request data from frontend
 * Used to generate lease document preview before actual lease creation
 */
export interface ILeasePreviewRequest {
  // Template
  templateType:
    | 'residential-single-family'
    | 'residential-apartment'
    | 'commercial-office'
    | 'commercial-retail'
    | 'short-term-rental';

  renewalOptions?: {
    autoRenew: boolean;
    renewalTermMonths?: number;
    noticePeriodDays?: number;
  };
  // Optional Provisions
  coTenants?: Array<{
    name: string;
    email: string;
    phone: string;
    occupation?: string;
  }>;
  petPolicy?: {
    allowed: boolean;
    maxPets?: number;
    types?: string[];
    deposit?: number;
  };

  // Signing
  signingMethod: SigningMethod | string;
  // Additional Terms
  utilitiesIncluded?: string[];
  startDate: Date | string;

  propertyAddress: string;
  securityDeposit: number;
  endDate: Date | string;

  // Lease Duration
  leaseType: LeaseType;
  unitNumber?: string;
  tenantEmail: string;
  tenantPhone: string;

  // Financial Terms
  monthlyRent: number;

  // Property Information
  propertyId: string;

  // Tenant Information (placeholders for invited tenants)
  tenantName: string;

  rentDueDay: number;

  currency: string;
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
  pendingChanges?: IPendingLeaseChanges | null;
  approvalDetails?: ILeaseApprovalEntry[];
  signingMethod: SigningMethod | string;
  approvalStatus?: LeaseApprovalStatus;
  leaseDocument?: ILeaseDocumentItem[];
  useInvitationIdAsTenantId?: boolean;
  createdBy: Types.ObjectId | string;
  lastModifiedBy?: ILastModifiedBy[];
  tenantId: Types.ObjectId | string;
  renewalOptions?: IRenewalOptions;
  signatures?: ILeaseSignature[];
  metadata?: Record<string, any>; // Store enriched data for lease generation
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
  fees: {
    monthlyRent: number;
    securityDeposit: number;
    rentDueDay: number;
    currency?: string;
    lateFeeAmount?: number;
    lateFeeDays?: number;
    lateFeeType?: 'fixed' | 'percentage';
    lateFeePercentage?: number;
    acceptedPaymentMethod?: string;
  };
  tenantInfo: {
    id: string | null; // if existing tenant
    email?: string; // required when inviting new tenant
    firstName?: string; // required when inviting new tenant
    lastName?: string; // required when inviting new tenant
  };
  duration: {
    startDate: Date | string;
    endDate: Date | string;
    moveInDate?: Date | string;
  };
  property: {
    id: string;
    unitId?: string;
    address: string;
  };
  leaseDocument?: ILeaseDocumentItem[];
  renewalOptions?: IRenewalOptions;
  signingMethod?: SigningMethod;
  utilitiesIncluded?: string[];
  legalTerms?: ILegalTerms;
  coTenants?: ICoTenant[];
  petPolicy?: IPetPolicy;
  internalNotes?: string;
  templateType?: string;
  leaseNumber: string;
  type: LeaseType;
}

/**
 * Lease Filter Options Interface
 * Used for querying leases
 */
export interface ILeaseFilterOptions {
  approvalStatus?: LeaseApprovalStatus | LeaseApprovalStatus[];
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
 * Property Reference Interface
 * Links lease to property and unit
 * Includes essential property information for lease documents
 */
export interface ILeaseProperty {
  specifications?: {
    totalArea?: number; // Square footage
    bedrooms?: number;
    bathrooms?: number;
    parkingSpaces?: number;
    floors?: number;
  };
  // Property information for lease templates
  propertyType?: 'apartment' | 'house' | 'condominium' | 'townhouse' | 'commercial' | 'industrial';
  unitId?: Types.ObjectId | string;
  id: Types.ObjectId | string;
  unitNumber?: string; // Unit/Suite number from property unit
  address: string;
  name?: string; // Property name (e.g., "Sunset Towers", "Oak Street Plaza")
}

/**
 * Enriched lease preview data with landlord/management info
 * Returned from backend after processing preview request
 */
export interface ILeasePreviewResponse extends ILeasePreviewRequest {
  managementCompanyAddress?: string;
  managementCompanyEmail?: string;
  managementCompanyPhone?: string;
  // Management Company (if applicable)
  managementCompanyName?: string;
  isExternalOwner: boolean;

  landlordAddress: string;
  landlordEmail: string;
  landlordPhone: string;
  // Additional computed fields
  propertyName?: string;

  propertyType?: string;
  jurisdiction?: string;
  // Landlord Information (added by backend based on property ownership)
  landlordName: string;
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
  acceptedPaymentMethod?:
    | 'bank_transfer'
    | 'check'
    | 'cash'
    | 'credit_card'
    | 'debit_card'
    | 'mobile_payment';
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
 * Lease Approval Entry Interface
 * Tracks individual approval actions
 */
export interface ILeaseApprovalEntry {
  action: 'created' | 'submitted' | 'approved' | 'rejected' | 'updated' | 'overridden';
  actor: Types.ObjectId | string;
  timestamp: Date;
  notes?: string;
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
 * Pending Lease Changes Interface
 * Stores lease changes awaiting approval
 */
export interface IPendingLeaseChanges {
  updatedBy: Types.ObjectId | string;
  displayName?: string;
  [key: string]: any;
  updatedAt: Date;
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

/**
 * Lease Approval Status Type
 * Tracks the approval state of a lease
 */
export type LeaseApprovalStatus = 'approved' | 'rejected' | 'pending' | 'draft';
