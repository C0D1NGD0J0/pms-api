import { Document, Types } from 'mongoose';

/**
 * ============================================================================
 * BASE TYPE DEFINITIONS (Single Source of Truth)
 * ============================================================================
 */

/**
 * Lease Status Enum
 * Represents the current state of a lease agreement
 */
export enum LeaseStatus {
  READY_FOR_SIGNATURE = 'ready_for_signature',
  PENDING_SIGNATURE = 'pending_signature',
  DRAFT_RENEWAL = 'draft_renewal',
  TERMINATED = 'terminated',
  CANCELLED = 'cancelled',
  RENEWED = 'renewed',
  EXPIRED = 'expired',
  ACTIVE = 'active',
  DRAFT = 'draft',
}

export enum ILeaseESignatureStatusEnum {
  COMPLETED = 'completed',
  DECLINED = 'declined',
  SIGNED = 'signed',
  VOIDED = 'voided',
  DRAFT = 'draft',
  SENT = 'sent',
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
 * Legacy interface - keeping for backward compatibility
 * Use ILeasePreviewRequest instead (will deprecate later)
 */
export type LeasePreviewData = {
  petPolicy?: IPetPolicy;
  renewalOptions?: Omit<IRenewalOptions, 'requireApproval' | 'autoApproveRenewal'>;
  coTenants?: ICoTenant[];
  legalTerms?: ILegalTerms;
  managementCompanyAddress?: string | null;
  managementCompanyEmail?: string | null;
  managementCompanyPhone?: string | null;
  utilitiesIncluded?: UtilityType | UtilityType[];
  managementCompanyName?: string | null;
  requiresNotarization?: boolean;
  landlordSignatureUrl?: string;
  tenantSignatureUrl?: string;
  startDate?: string | Date;
  isExternalOwner: boolean;
  landlordAddress?: string;
  propertyAddress?: string;
  securityDeposit?: number;
  endDate?: string | Date;
  landlordEmail?: string;
  landlordPhone?: string;
  signingMethod?: string;
  hasUnitOwner: boolean;
  ownershipType: string;
  propertyName?: string;
  propertyType?: string;
  jurisdiction?: string;
  landlordName?: string;
  isMultiUnit: boolean;
  leaseNumber?: string;
  currentDate?: string;
  tenantEmail?: string;
  tenantPhone?: string;
  monthlyRent?: number;
  unitNumber?: string;
  signedDate?: string;
  tenantName?: string;
  rentDueDay?: number;
  leaseType?: string;
  currency?: string;
};

/**
 * Main Lease Interface
 * Core lease data structure
 */
export interface ILease {
  autoSendInfo?: {
    sent: boolean;
    failedAt: Date;
    failureReason: 'not_approved' | 'auto_send_disabled';
  };
  pendingChanges?: IPendingLeaseChanges | null;
  previousLeaseId?: Types.ObjectId | string;
  approvalDetails?: ILeaseApprovalEntry[];
  signingMethod: SigningMethod | string;
  leaseDocuments?: ILeaseDocumentItem[];
  approvalStatus?: LeaseApprovalStatus;
  useInvitationIdAsTenantId?: boolean;
  createdBy: Types.ObjectId | string;
  lastModifiedBy?: ILastModifiedBy[];
  utilitiesIncluded?: UtilityType[];
  tenantId: Types.ObjectId | string;
  renewalOptions?: IRenewalOptions;
  templateType: LeaseTemplateType;
  internalNotes?: IInternalNote[];
  requiresNotarization?: boolean;
  signatures?: ILeaseSignature[];
  metadata?: Record<string, any>; // Store enriched data for lease generation
  eSignature?: ILeaseESignature;
  terminationReason?: string;
  property: ILeaseProperty;
  duration: ILeaseDuration;
  legalTerms?: ILegalTerms;
  coTenants?: ICoTenant[];
  petPolicy?: IPetPolicy;
  leaseNumber: string;
  status: LeaseStatus;
  signedDate?: Date;
  fees: ILeaseFees;
  deletedAt?: Date;
  type: LeaseType;
  cuid: string;
}

/**
 * ============================================================================
 * ENUMS
 * ============================================================================
 */

/**
 * Lease Form Data Interface
 * Used for creating/updating leases via API
 */
export interface ILeaseFormData {
  tenantInfo: {
    id: string | null; // if existing tenant
    email?: string; // required when inviting new tenant
    firstName?: string; // required when inviting new tenant
    lastName?: string; // required when inviting new tenant
  };
  fees: Pick<
    ILeaseFees,
    | 'monthlyRent'
    | 'securityDeposit'
    | 'rentDueDay'
    | 'currency'
    | 'lateFeeAmount'
    | 'lateFeeDays'
    | 'lateFeeType'
    | 'lateFeePercentage'
    | 'acceptedPaymentMethod'
  >;
  property: Pick<ILeaseProperty, 'id' | 'address'> & {
    unitId?: string;
  };
  duration: Pick<ILeaseDuration, 'startDate' | 'endDate' | 'moveInDate'>;
  leaseDocument?: ILeaseDocumentItem[];
  utilitiesIncluded?: UtilityType[];
  renewalOptions?: IRenewalOptions;
  templateType?: LeaseTemplateType;
  requiresNotarization?: boolean;
  signingMethod?: SigningMethod;
  legalTerms?: ILegalTerms;
  coTenants?: ICoTenant[];
  petPolicy?: IPetPolicy;
  internalNotes?: string;
  leaseNumber: string;
  type: LeaseType;
}

/**
 * Renewal Metadata Interface
 * Pre-calculated renewal information for active/draft_renewal leases
 * Only included in lease response when status is 'active' or 'draft_renewal'
 */
export interface IRenewalMetadata {
  renewalFormData?: {
    property: Pick<ILeaseProperty, 'id' | 'address'> & { unitId?: string };
    tenantInfo: Pick<ILeaseFormData['tenantInfo'], 'id'>;
    duration: Record<keyof Pick<ILeaseDuration, 'startDate' | 'endDate' | 'moveInDate'>, string>;
    fees: ILeaseFormData['fees'];
    type: LeaseType;
    signingMethod: SigningMethod | string;
    renewalOptions: IRenewalOptions;
    petPolicy: IPetPolicy;
    utilitiesIncluded: UtilityType[];
    legalTerms: ILegalTerms | string;
    coTenants: ICoTenant[];
    leaseNumber: string;
  };
  renewalDates: Record<keyof Pick<ILeaseDuration, 'startDate' | 'endDate' | 'moveInDate'>, string>;
  ineligibilityReason: string | null;
  renewalWindowDays: number;
  daysUntilExpiry: number;
  isEligible: boolean;
  canRenew: boolean;
}

/**
 * Lease preview request data from frontend
 * Used to generate lease document preview before actual lease creation
 */
export interface ILeasePreviewRequest {
  renewalOptions?: Omit<IRenewalOptions, 'requireApproval' | 'autoApproveRenewal'>;
  signingMethod: SigningMethod | string;
  utilitiesIncluded?: UtilityType[];
  templateType: LeaseTemplateType;
  requiresNotarization: boolean;
  legalTerms?: ILegalTerms;
  startDate: Date | string;
  coTenants?: ICoTenant[];
  propertyAddress: string;
  securityDeposit: number;
  petPolicy?: IPetPolicy;
  endDate: Date | string;
  leaseType: LeaseType;
  leaseNumber?: string;
  unitNumber?: string;
  tenantEmail: string;
  tenantPhone: string;
  monthlyRent: number;
  propertyId: string;
  tenantName: string;
  rentDueDay: number;
  currency: string;
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
 * Lease Document Interface with Mongoose Document
 * Extends ILease with MongoDB document properties and methods
 */
export interface ILeaseDocument extends Document, ILease {
  // Instance methods
  softDelete(userId: Types.ObjectId): Promise<ILeaseDocument>;
  hasOverlap(startDate: Date, endDate: Date): boolean;
  propertyInfo?: ILeasePropertyInfo;
  propertyUnitInfo?: ILeaseUnitInfo;
  // Virtual properties (computed)
  daysUntilExpiry: number | null;
  durationMonths: number | null;
  tenantInfo?: ILeaseTenantInfo;
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
 * ============================================================================
 * CORE INTERFACES (Single Source of Truth)
 * ============================================================================
 */

/**
 * Lease Financial Summary Interface
 * Financial information and payment tracking
 */
export interface ILeaseFinancialSummary {
  acceptedPaymentMethod?: PaymentMethodType;
  lastPaymentDate: Date | null;
  securityDepositRaw: number; // Raw amount in cents
  lateFeeType?: LateFeeType;
  securityDeposit: string; // Formatted currency string
  monthlyRentRaw: number; // Raw amount in cents
  lateFeeAmount?: number;
  totalExpected: number;
  nextPaymentDate: Date;
  lateFeeDays?: number;
  monthlyRent: string; // Formatted currency string
  rentDueDay: number; // 1-31
  totalPaid: number;
  totalOwed: number;
  currency: string;
}

/**
 * Lease Activity Event Interface
 * Individual activity/audit event in lease history
 */
export interface ILeaseActivityEvent {
  type:
    | 'created'
    | 'updated'
    | 'activated'
    | 'terminated'
    | 'cancelled'
    | 'renewed'
    | 'submitted'
    | 'approved'
    | 'rejected'
    | 'overridden'
    | 'signed';
  signatureMethod?: 'manual' | 'electronic';
  user?: Types.ObjectId | string;
  metadata?: Record<string, any>;
  rejectionReason?: string;
  description: string;
  role?: SignerRole;
  userName?: string;
  timestamp: Date;
  notes?: string;
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
  unitId?: Types.ObjectId | string;
  propertyType?: LeasePropertyType;
  id: Types.ObjectId | string;
  unitNumber?: string; // Unit/Suite number from property unit
  address: string;
  name?: string; // Property name (e.g., "Sunset Towers", "Oak Street Plaza")
}

/**
 * Renewal Options Interface
 * Automatic renewal settings
 */
export interface IRenewalOptions {
  daysBeforeExpiryToAutoSendSignature?: number;
  daysBeforeExpiryToGenerateRenewal?: number;
  enableAutoSendForSignature?: boolean;
  autoApproveRenewal?: boolean; // Skip admin review, go straight to ready_for_signature
  renewalTermMonths?: number;
  requireApproval?: boolean; // Require admin review before sending for signature
  noticePeriodDays?: number;
  autoRenew: boolean;
}

/**
 * Enriched lease preview data with landlord/management info
 * Returned from backend after processing preview request
 */
export interface ILeasePreviewResponse extends ILeasePreviewRequest {
  managementCompanyAddress?: string;
  managementCompanyEmail?: string;
  managementCompanyPhone?: string;
  managementCompanyName?: string;
  isExternalOwner: boolean;
  landlordAddress: string;
  landlordEmail: string;
  landlordPhone: string;
  propertyName?: string;
  propertyType?: string;
  jurisdiction?: string;
  landlordName: string;
}

export interface ILeaseDetailResponse {
  financialSummary: ILeaseFinancialSummary;
  permissions: ILeaseUserPermissions;
  documents?: ILeaseDocumentItem[];
  activity?: ILeaseActivityEvent[];
  property: ILeasePropertyInfo;
  timeline?: ILeaseTimeline;
  tenant: ILeaseTenantInfo;
  lease: ILeaseDocument;
  payments?: any[]; // TODO: Define payment interface when payments service is ready
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

export interface LeaseESignatureCompletedPayload {
  signers: Array<{
    name: string;
    email: string;
    role: string;
    signedAt?: Date;
  }>;
  propertyManagerId: string;
  propertyUnitId?: string;
  propertyId: string;
  documentId: string;
  completedAt: Date;
  tenantId: string;
  leaseId: string;
  luid: string;
  cuid: string;
}

/**
 * Lease User Permissions Interface
 * User-specific permissions for lease operations
 */
export interface ILeaseUserPermissions {
  canManageSignatures: boolean;
  canUploadDocuments: boolean;
  canViewFinancials: boolean;
  canViewDocuments: boolean;
  canViewActivity: boolean;
  canGeneratePDF: boolean;
  canTerminate: boolean;
  canActivate: boolean;
  canDownload: boolean;
  canDelete: boolean;
  canEdit: boolean;
}

export interface LeaseESignatureSentPayload {
  signers: Array<{
    name: string;
    email: string;
    role: string;
  }>;
  jobId: string | number;
  envelopeId: string; // BoldSign document ID
  leaseId: string;
  actorId: string; // User who sent for signature
  luid: string;
  cuid: string;
  sentAt: Date;
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
 * Signature Interface
 * Individual signature tracking
 */
export interface ILeaseSignature {
  coTenantInfo?: {
    name: string;
    email: string;
    phone: string;
  };
  signatureMethod: 'manual' | 'electronic';
  userId?: Types.ObjectId | string;
  providerSignatureId?: string;
  ipAddress?: string;
  role: SignerRole;
  signedAt?: Date;
}

/**
 * Fees Interface
 * All financial terms of the lease
 */
export interface ILeaseFees {
  acceptedPaymentMethod?: PaymentMethodType;
  lateFeePercentage?: number;
  lateFeeType?: LateFeeType;
  securityDeposit: number;
  lateFeeAmount?: number;
  lateFeeDays?: number;
  monthlyRent: number;
  rentDueDay: number; // 1-31
  currency: string;
}

/**
 * ============================================================================
 * MAIN LEASE INTERFACE
 * ============================================================================
 */

/**
 * Lease List Item Interface
 * Simplified lease data for list views
 */
export interface ILeaseListItem {
  sentForSignature: boolean;
  tenantActivated: boolean;
  propertyAddress: string;
  leaseNumber: string;
  monthlyRent: number;
  status: LeaseStatus;
  unitNumber?: string;
  tenantName: string;
  startDate: Date;
  endDate: Date;
  luid: string;
}

/**
 * ============================================================================
 * FORM DATA INTERFACES
 * ============================================================================
 */

/**
 * E-Signature Interface
 * Tracks electronic signature provider details
 */
export interface ILeaseESignature {
  status?: ILeaseESignatureStatusEnum;
  provider: 'hellosign' | 'boldsign';
  declinedReason?: string;
  errorMessage?: string;
  envelopeId?: string;
  signingUrl?: string;
  completedAt?: Date;
  failedAt?: Date;
  sentAt?: Date;
}

/**
 * Lease Document Item Interface
 * Tracks uploaded lease documents
 */
export interface ILeaseDocumentItem {
  documentType?: 'lease_agreement' | 'other';
  uploadedBy: Types.ObjectId | string;
  status: 'active' | 'inactive';
  mimeType?: string;
  uploadedAt?: Date;
  filename: string;
  size?: number;
  url: string;
  key: string;
}

export interface LeaseTerminatedPayload {
  terminationReason: string;
  propertyUnitId?: string;
  terminationDate: Date;
  terminatedBy: string;
  propertyId: string;
  moveOutDate?: Date;
  tenantId: string;
  leaseId: string;
  luid: string;
  cuid: string;
}

/**
 * Lease Timeline Interface
 * Key milestone dates and progress tracking
 */
export interface ILeaseTimeline {
  isExpiringSoon: boolean;
  daysRemaining: number;
  daysElapsed: number;
  moveInDate?: Date;
  isActive: boolean;
  progress: number; // 0-100 percentage
  startDate: Date;
  created: Date;
  signed?: Date;
  endDate: Date;
}

/**
 * ============================================================================
 * RENEWAL METADATA INTERFACE
 * ============================================================================
 */

/**
 * Lease Approval Entry Interface
 * Tracks individual approval actions
 */
export interface ILeaseApprovalEntry {
  action: 'created' | 'submitted' | 'approved' | 'rejected' | 'updated' | 'overridden';
  actor: Types.ObjectId | string;
  metadata?: Record<string, any>;
  rejectionReason?: string;
  timestamp: Date;
  notes?: string;
}

/**
 * ============================================================================
 * DOCUMENT INTERFACES (Mongoose Extensions)
 * ============================================================================
 */

/**
 * E-Signature Request Data Interface
 * Used when sending lease for signature
 */
export interface IESignatureRequestData {
  signers: {
    email: string;
    name: string;
    role: Exclude<SignerRole, 'property_manager'>;
    order?: number;
  }[];
  provider: 'boldsign' | 'pandadoc';
  testMode?: boolean;
  message?: string;
}

/**
 * ============================================================================
 * POPULATED/ENRICHED INTERFACES
 * ============================================================================
 */

export interface LeaseESignatureFailedPayload {
  jobId: string | number;
  errorDetails?: any;
  leaseId: string;
  actorId: string; // User who attempted to send for signature
  error: string;
  luid: string;
  cuid: string;
}

/**
 * Populated Property Info Interface
 * Property details returned in lease response
 */
export interface ILeasePropertyInfo extends ILeaseProperty {
  managedBy?: Types.ObjectId | string;
  propertyType?: LeasePropertyType;
  availableUnits?: number;
  totalUnits?: number;
  name?: string;
  pid?: string;
}

/**
 * Populated Unit Info Interface
 * Unit details returned in lease response (secure field selection)
 */
export interface ILeaseUnitInfo {
  _id: Types.ObjectId | string;
  specifications?: any;
  amenities?: string[];
  unitNumber: string;
  status?: string;
  floor?: number;
  puid: string;
  fees?: any;
  id: string;
}

/**
 * Populated Tenant Info Interface
 * Tenant details returned in lease response
 */
export interface ILeaseTenantInfo {
  _id: Types.ObjectId | string;
  phoneNumber?: string;
  firstName?: string;
  lastName?: string;
  fullname?: string;
  avatar?: string;
  email: string;
  uid?: string;
}

/**
 * Pending Changes Preview Interface
 * Preview of pending changes awaiting approval
 */
export interface ILeasePendingChangesPreview {
  updatedBy: Types.ObjectId | string;
  changes: Record<string, any>;
  updatedFields: string[];
  displayName?: string;
  updatedAt: Date;
  summary: string;
}

export interface LeaseESignatureDeclinedPayload {
  declineReason?: string;
  documentId: string;
  declinedBy: string;
  declinedAt: Date;
  leaseId: string;
  luid: string;
  cuid: string;
}

/**
 * ============================================================================
 * RESPONSE INTERFACES
 * ============================================================================
 */

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

export interface LeaseESignatureRequestedPayload {
  jobId: string | number;
  leaseId: string;
  actorId: string; // User who requested signature
  luid: string;
  cuid: string;
}

/**
 * ============================================================================
 * ACTIVITY & EVENT INTERFACES
 * ============================================================================
 */

/**
 * Lease Template Types
 */
export type LeaseTemplateType =
  | 'residential-single-family'
  | 'residential-apartment'
  | 'commercial-office'
  | 'commercial-retail'
  | 'short-term-rental';

/**
 * ============================================================================
 * E-SIGNATURE PAYLOAD INTERFACES
 * ============================================================================
 */

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
 * Utility Types
 */
export type UtilityType =
  | 'water'
  | 'gas'
  | 'electricity'
  | 'internet'
  | 'cable'
  | 'trash'
  | 'sewer'
  | 'heating'
  | 'cooling';

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
 * Payment Method Types
 */
export type PaymentMethodType =
  | 'bank_transfer'
  | 'check'
  | 'cash'
  | 'credit_card'
  | 'debit_card'
  | 'mobile_payment';

/**
 * ============================================================================
 * ACTION DATA INTERFACES
 * ============================================================================
 */

/**
 * Property Types (for lease context)
 */
export type LeasePropertyType =
  | 'apartment'
  | 'house'
  | 'condominium'
  | 'townhouse'
  | 'commercial'
  | 'industrial';

/**
 * Internal Note Interface
 * Audit trail for internal notes on a lease
 */
export interface IInternalNote {
  authorId: Types.ObjectId | string;
  timestamp: Date;
  author: string;
  note: string;
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
 * ============================================================================
 * QUERY & FILTER INTERFACES
 * ============================================================================
 */

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
 * ============================================================================
 * REPORTING INTERFACES
 * ============================================================================
 */

/**
 * Signer/Participant Role Types
 */
export type SignerRole = 'tenant' | 'co_tenant' | 'landlord' | 'property_manager';

/**
 * Lease Approval Status Type
 * Tracks the approval state of a lease
 */
export type LeaseApprovalStatus = 'approved' | 'rejected' | 'pending' | 'draft';

/**
 * Late Fee Types
 */
export type LateFeeType = 'fixed' | 'percentage';
