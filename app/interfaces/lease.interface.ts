import { Document, Types } from 'mongoose';

import { AddressDetails } from './property.interface';
import { IPaymentListItem } from './payments.interface';

export enum LeaseStatus {
  READY_FOR_SIGNATURE = 'ready_for_signature',
  PENDING_SIGNATURE = 'pending_signature',
  DRAFT_RENEWAL = 'draft_renewal',
  TERMINATED = 'terminated',
  COMPLETED = 'completed',
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

export enum SigningMethod {
  ELECTRONIC = 'electronic',
  PENDING = 'pending',
  MANUAL = 'manual',
}

export enum LeaseType {
  MONTH_TO_MONTH = 'month_to_month',
  FIXED_TERM = 'fixed_term',
}

export interface ILease {
  autoSendInfo?: {
    sent: boolean;
    failedAt: Date;
    failureReason: 'not_approved' | 'auto_send_disabled';
  };
  autoScheduleInspection?: { moveIn: boolean; moveOut: boolean };
  pendingChanges?: IPendingLeaseChanges | null;
  generateFirstPaymentOnActivation?: boolean;
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
  renewalRequest?: IRenewalRequest;
  templateType: LeaseTemplateType;
  internalNotes?: IInternalNote[];
  includeManagementFee?: boolean;
  requiresNotarization?: boolean;
  signatures?: ILeaseSignature[];
  metadata?: Record<string, any>; // Store enriched data for lease generation
  vacateRequest?: IVacateRequest;
  eSignature?: ILeaseESignature;
  includeParkingInfo?: boolean;
  terminationReason?: string;
  deletedBy?: Types.ObjectId;
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

export interface ILeaseFinancialSummary {
  acceptedPaymentMethod?: PaymentMethodType;
  proRatedLastMonthDaysInMonth: number;
  proRatedFirstMonthFormatted: string;
  proRatedManagementFeeAmount: number;
  firstPaymentAmountFormatted: string;
  proRatedLastMonthFormatted: string;
  proRatedLastMonthDailyRate: number;
  // First-payment breakdown
  proRatedFirstMonthAmount: number;
  // Last-month breakdown
  proRatedLastMonthAmount: number;
  isFirstMonthFullMonth: boolean;
  proRatedLastMonthDays: number;
  isLastMonthFullMonth: boolean;
  lastPaymentDate: Date | null;
  nextPaymentDate: Date | null;
  proRatedDaysInMonth: number;
  securityDepositRaw: number; // Raw amount in cents
  firstPaymentAmount: number;
  lateFeeType?: LateFeeType;
  firstPaymentMonth: string;
  managementFeeRaw: number;
  securityDeposit: string; // Formatted currency string
  lateFeeAmount?: number;
  // Management fee (sourced from property, billed when lease.includeManagementFee is true)
  managementFee?: string;
  firstPaymentDate: Date;
  rentAmountRaw: number; // Raw amount in cents
  totalExpected: number;
  lateFeeDays?: number;
  proRatedDays: number;
  rentAmount: string; // Formatted currency string
  rentDueDay: number; // 1-31
  totalPaid: number;
  totalOwed: number;
  currency: string;
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
  rentAmount?: number;
  unitNumber?: string;
  signedDate?: string;
  tenantName?: string;
  rentDueDay?: number;
  leaseType?: string;
  currency?: string;
};

export interface ILeaseFormData {
  tenantInfo: {
    id: string | null; // if existing tenant
    email?: string; // required when inviting new tenant
    firstName?: string; // required when inviting new tenant
    lastName?: string; // required when inviting new tenant
  };
  fees: Pick<
    ILeaseFees,
    | 'rentAmount'
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
  internalNotes?: IInternalNote[];
  includeManagementFee?: boolean;
  requiresNotarization?: boolean;
  signingMethod?: SigningMethod;
  includeParkingInfo?: boolean;
  legalTerms?: ILegalTerms;
  coTenants?: ICoTenant[];
  petPolicy?: IPetPolicy;
  leaseNumber: string;
  type: LeaseType;
}

export interface ILeaseDocument extends Document, ILease {
  calculateFees(options?: { daysLate?: number }): {
    monthly: { rent: number; petFee: number; total: number };
    deposits: { security: number; pet: number; total: number };
    late: {
      daysLate: number;
      fee: number;
      type: LateFeeType | 'none';
      percentage: number;
      gracePeriod: number;
    };
    currency: string;
  };
  // Instance methods
  softDelete(userId: Types.ObjectId): Promise<ILeaseDocument>;
  hasOverlap(startDate: Date, endDate: Date): boolean;
  expiryGracePeriodDaysRemaining: number;
  propertyInfo?: ILeasePropertyInfo;
  propertyUnitInfo?: ILeaseUnitInfo;
  // Virtual properties (computed)
  daysUntilExpiry: number | null;
  durationMonths: number | null;
  tenantInfo?: ILeaseTenantInfo;
  expiryGracePeriodDays: number;
  totalMonthlyFees: number;
  isInGracePeriod: boolean;
  isExpiringSoon: boolean;
  _id: Types.ObjectId;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  luid: string;
  id: string;
}

/**
 * Pre-calculated renewal information for active/draft_renewal leases.
 * Only included in lease response when status is 'active' or 'draft_renewal'.
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
  rentAmount: number;
  propertyId: string;
  tenantName: string;
  rentDueDay: number;
  currency: string;
}

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
  unitPuid?: string;
  endDateTo?: Date;
  minRent?: number;
  maxRent?: number;
  search?: string; // For lease number or tenant name search
}

export interface ILeaseProperty {
  specifications?: {
    totalArea?: number; // Square footage
    bedrooms?: number;
    bathrooms?: number;
    parkingSpaces?: number;
    floors?: number;
  };
  managedBy?: Types.ObjectId | string;
  unitId?: Types.ObjectId | string;
  propertyType?: LeasePropertyType;
  address: AddressDetails | string; // Support both detailed address object and simple string
  id: Types.ObjectId | string;
  unitNumber?: string; // Unit/Suite number from property unit
  name?: string; // Property name (e.g., "Sunset Towers", "Oak Street Plaza")
}

export interface ILeaseStats {
  leasesByStatus: {
    draft: number;
    pending_signature: number;
    active: number;
    expired: number;
    terminated: number;
    cancelled: number;
  };
  /** Per-currency breakdown of active lease rent totals. Replaces the old single `totalMonthlyRent` number. */
  monthlyRentByCurrency: Array<{ currency: string; total: number }>;
  averageLeaseDuration: number;
  expiringIn30Days: number;
  expiringIn60Days: number;
  expiringIn90Days: number;
  occupancyRate: number;
  totalLeases: number;
}

export interface ILeaseListItem {
  property: {
    pid: string;
    name: string;
    address: string;
    managedByUid?: string | null;
  };
  tenant: {
    id: string;
    uid: string;
    email: string;
    fullName: string;
  };
  lateFeesGracePeriod: number;
  sentForSignature: boolean;
  tenantActivated: boolean;
  propertyAddress: string;
  petsAllowed: boolean;
  leaseNumber: string;
  status: LeaseStatus;
  unitNumber?: string;
  rentAmount: number;
  startDate: Date;
  endDate: Date;
  luid: string;
}

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

export interface IRentRollItem {
  leaseId: Types.ObjectId | string;
  daysUntilExpiry: number | null;
  propertyAddress: string;
  securityDeposit: number;
  propertyName: string;
  leaseNumber: string;
  tenantEmail: string;
  unitNumber?: string;
  status: LeaseStatus;
  rentAmount: number;
  tenantName: string;
  currency: string;
  startDate: Date;
  endDate: Date;
  luid: string;
}

export interface ILeaseSignature {
  landlordInfo?: {
    name: string;
    email: string;
    phone?: string;
  };
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

export interface IRentRollReport {
  summary: {
    totalLeases: number;
    monthlyRentByCurrency: Array<{ currency: string; total: number }>;
    totalSecurityDeposits: number;
    activeLeases: number;
    expiringLeases: number;
  };
  propertyId?: Types.ObjectId | string;
  items: IRentRollItem[];
  propertyName?: string;
  generatedAt: Date;
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

export interface ILeaseDetailResponse {
  financialSummary: ILeaseFinancialSummary;
  permissions: ILeaseUserPermissions;
  documents?: ILeaseDocumentItem[];
  activity?: ILeaseActivityEvent[];
  payments?: IPaymentListItem[];
  property: ILeasePropertyInfo;
  timeline?: ILeaseTimeline;
  tenant: ILeaseTenantInfo;
  lease: ILeaseDocument;
}

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

export interface ILeaseDocumentItem {
  status: 'active' | 'inactive' | 'failed' | 'deleted';
  documentType?: 'lease_agreement' | 'other';
  uploadedBy: Types.ObjectId | string;
  mimeType?: string;
  uploadedAt?: Date;
  filename: string;
  error?: string;
  size?: number;
  url: string;
  key: string;
}

export interface ILeaseTimeline {
  isInGracePeriod: boolean;
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

export interface ILeaseFees {
  acceptedPaymentMethod?: PaymentMethodType;
  lateFeePercentage?: number;
  lateFeeType?: LateFeeType;
  securityDeposit: number;
  lateFeeAmount?: number;
  lateFeeDays?: number;
  rentAmount: number;
  rentDueDay: number; // 1-31
  currency: string;
}

/**
 * Offboarding Status (derived at query time — not persisted)
 */
export interface IOffboardingStatus {
  depositRefundStatus: 'refunded' | 'pending' | 'not_applicable';
  inspectionStatus: string | null;
  inspectionScheduledDate?: Date;
  paymentsCancelled: boolean;
  leaseTerminated: boolean;
  terminationDate?: Date;
  depositAmount?: number;
}

/** Embedded subdocument on the Lease model -- tenant requests lease renewal */
export interface IRenewalRequest {
  decision?: {
    decidedBy: Types.ObjectId;
    decidedAt: Date;
    rejectionReason?: string;
  };
  status: 'pending' | 'approved' | 'rejected';
  requestedTermMonths?: number;
  submittedAt: Date;
  message?: string;
  holdUntil?: Date;
}

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

/** Embedded subdocument on the Lease model -- tenant requests to vacate early */
export interface IVacateRequest {
  decision?: {
    decidedBy: Types.ObjectId;
    decidedAt: Date;
    adjustedMoveOutDate?: Date;
    rejectionReason?: string;
  };
  status: VacateRequestStatus;
  requestedMoveOutDate: Date;
  submittedAt: Date;
  reason: string;
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

export interface ILeaseApprovalEntry {
  action: 'created' | 'submitted' | 'approved' | 'rejected' | 'updated' | 'overridden';
  actor: Types.ObjectId | string;
  metadata?: Record<string, any>;
  rejectionReason?: string;
  timestamp: Date;
  notes?: string;
}

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

export interface LeaseESignatureFailedPayload {
  jobId: string | number;
  errorDetails?: any;
  leaseId: string;
  actorId: string; // User who attempted to send for signature
  error: string;
  luid: string;
  cuid: string;
}

export interface ILeasePropertyInfo extends ILeaseProperty {
  managedBy?: Types.ObjectId | string;
  propertyType?: LeasePropertyType;
  availableUnits?: number;
  totalUnits?: number;
  name?: string;
  pid?: string;
}

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

export type LeaseTemplateType =
  | 'generic'
  | 'residential-single-family'
  | 'residential-apartment'
  | 'commercial-office'
  | 'commercial-retail'
  | 'short-term-rental';

export interface ILeaseTerminationData {
  terminationDate: Date | string;
  moveOutDate?: Date | string;
  terminationReason: string;
  notes?: string;
}

export interface ILeaseQueryOptions {
  sortOrder?: 'asc' | 'desc';
  populate?: string[];
  sortBy?: string;
  limit?: number;
  page?: number;
}

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

export interface IPendingLeaseChanges {
  updatedBy: Types.ObjectId | string;
  displayName?: string;
  [key: string]: any;
  updatedAt: Date;
}

export interface IInternalNote {
  authorId: Types.ObjectId | string;
  timestamp: Date;
  author: string;
  html?: string;
  note: string;
}

export interface ILeaseDuration {
  terminationDate?: Date;
  moveOutDate?: Date;
  moveInDate?: Date;
  startDate: Date;
  endDate: Date;
}

export interface IPetPolicy {
  monthlyFee?: number;
  allowed: boolean;
  deposit?: number;
  types?: string[];
  maxPets?: number;
}

export interface IVacateRequestDecision {
  adjustedMoveOutDate?: Date | string;
  rejectionReason?: string;
  approved: boolean;
}

export type LeasePropertyType =
  | 'apartment'
  | 'house'
  | 'condominium'
  | 'townhouse'
  | 'commercial'
  | 'industrial';

export interface ILeaseActivationData {
  signedDate?: Date | string;
  moveInDate?: Date | string;
  notes?: string;
}

export interface ICoTenant {
  occupation?: string;
  email: string;
  phone: string;
  name: string;
}

export interface ILegalTerms {
  text?: string;
  html?: string;
  url?: string;
}

export type SignerRole = 'tenant' | 'co_tenant' | 'landlord' | 'property_manager';

export type LeaseApprovalStatus = 'approved' | 'rejected' | 'pending' | 'draft';

export type PaymentMethodType = 'auto-debit' | 'cash' | 'e-transfer' | 'check';

export type VacateRequestStatus = 'pending' | 'approved' | 'rejected';

export type LateFeeType = 'fixed' | 'percentage';
