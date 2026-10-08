import { Document, Types } from 'mongoose';

import { IPropertyDocument } from './property.interface';
import { IPropertyUnitDocument } from './propertyUnit.interface';
import { ILeaseDocument, ILeaseProperty } from './lease.interface';
import { IProfileDocument, IProfileWithUser } from './profile.interface';

export enum PaymentRecordStatus {
  PENDING_REFUND = 'pending_refund', // deposit approved for refund, awaiting PM/admin release (when requireDepositRefundApproval is enabled)
  PROCESSING = 'processing', // charge submitted to bank, awaiting settlement (ACSS/bank transfer)
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  PENDING = 'pending',
  OVERDUE = 'overdue',
  FAILED = 'failed',
  PAID = 'paid',
}

/**
 * Machine-readable codes sent as the error response's `code` on payment errors the UI reacts to,
 * so the frontend doesn't depend on message wording.
 */
export enum PaymentErrorCode {
  VENDOR_PAYOUT_REVERSAL_REQUIRED = 'VENDOR_PAYOUT_REVERSAL_REQUIRED',
  CHARGE_SELECTION_REQUIRED = 'CHARGE_SELECTION_REQUIRED',
  CHARGE_ALREADY_SETTLED = 'CHARGE_ALREADY_SETTLED',
  DEBIT_IN_PROGRESS = 'DEBIT_IN_PROGRESS',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
}

export enum PaymentRecordType {
  SECURITY_DEPOSIT = 'security_deposit',
  DEPOSIT_REFUND = 'deposit_refund',
  MAINTENANCE = 'maintenance',
  LATE_FEE = 'late_fee',
  RENT = 'rent',
}

export enum PaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  ONLINE = 'online',
  CHECK = 'check',
  OTHER = 'other',
  CASH = 'cash',
}

export interface IPaymentDocument extends Document {
  refund?: {
    vendorTransferReversalId?: string; // maintenance refund that pulled the vendor payout back
    refundedAt?: Date;
    refundedBy?: string;
    amount?: number; // CUMULATIVE refunded cents; status stays PAID until fully refunded
    reason?: string;
    gatewayRefundId?: string;
    failureReason?: string; // last gateway refund failure — cleared when a refund succeeds
    failedAt?: Date;
  };
  splitInvoices?: {
    invoiceId: string;
    amount: number;
    category: 'rent' | 'fees';
    status: 'pending' | 'paid' | 'failed';
    applicationFee?: number; // application fee charged on this split's invoice (cents)
    chargeId?: string;
    paidAt?: Date;
  }[];
  dispute?: {
    status?: 'open' | 'won' | 'lost' | 'needs_response' | 'under_review' | 'closed';
    resolvedAt?: Date;
    disputeId?: string;
    amount?: number;
    reason?: string;
    disputedAt?: Date;
  };
  managerReview?: {
    reviewedBy?: Types.ObjectId; // User who reviewed/confirmed the payment
    reviewedAt?: Date;
    notes?: string;
  };
  receipt?: {
    url?: string;
    filename?: string;
    key?: string;
    uploadedAt?: Date;
    uploadedBy?: Types.ObjectId;
  };
  failure?: {
    retryCount: number;
    reason?: string;
    lastFailedAt?: Date;
    pmNotifiedAt?: Date;
  };
  invoiceDocument?: {
    url: string;
    key: string;
    generatedAt: Date;
  };
  notes?: {
    note: string;
    author: string;
    createdAt: Date;
  }[];
  lineItems?: {
    description: string;
    amountInCents: number;
  }[];
  stripePaymentMethodType?: string; // e.g. 'card', 'acss_debit', 'us_bank_account'
  managerReviewRequired?: boolean; // true for staff-initiated manual entries — PM must confirm
  paymentType: PaymentRecordType;
  maintenanceRequestUid?: string; // mruid — links maintenance expense/charge back to its request
  cardCheckoutSessionId?: string; // latest card checkout session — expired before a new one is opened
  paymentSource?: PaymentSource;
  paymentMethod: PaymentMethod;
  status: PaymentRecordStatus;
  recordedBy?: Types.ObjectId; // User who recorded manual payment
  propertyId?: Types.ObjectId; // Direct property ref — used for entries without a lease
  vendorId?: Types.ObjectId; // Set for maintenance expense records (vendor who submitted the invoice)
  gatewayPaymentId?: string;
  gatewayChargeId?: string;
  period?: IPaymentPeriod;
  platformRevenue: number; // Platform's net revenue after Stripe gateway fee (applicationFee − processingFee)
  unitId?: Types.ObjectId; // Direct unit ref — used for entries without a lease
  lease?: Types.ObjectId;
  tenant: Types.ObjectId; // References Profile
  isManualEntry: boolean;
  applicationFee: number; // Platform's application fee in cents (kept by platform; distinct from processingFee which is the Stripe gateway fee)
  padNoticeSentAt?: Date; // when the PAD (ACSS) pre-debit notice for this record was sent
  invoiceNumber: string;
  processingFee: number;
  description?: string;
  _id: Types.ObjectId;
  cancelledAt?: Date;
  baseAmount: number;
  overdueAt?: Date;
  currency: string; // ISO 4217 uppercase, e.g. 'USD', 'CAD', 'GBP'
  deletedAt?: Date;
  chargedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  pytuid: string;
  dueDate: Date;
  paidAt?: Date;
  cuid: string;
}

/**
 * Shape of each item returned by getPayments (list view).
 */
export interface IPaymentListItem {
  failure?: { retryCount: number; reason?: string; lastFailedAt?: Date; pmNotifiedAt?: Date };
  tenant: { firstName: string; lastName: string; fullName: string } | null;
  lineItems: { description: string; amountInCents: number }[];
  receipt?: { url?: string; filename?: string; key?: string };
  stripePaymentMethodType?: string;
  paymentType: PaymentRecordType;
  paymentMethod: PaymentMethod;
  status: PaymentRecordStatus;
  platformRevenue?: number; // Platform's net revenue — only returned for ROOT_ADMIN
  period?: IPaymentPeriod;
  applicationFee: number; // Platform's application fee in cents
  processingFee?: number; // Stripe gateway fee — only returned for ROOT_ADMIN
  baseAmount: number;
  property: string;
  currency: string;
  pytuid: string;
  amount: number;
  dueDate: Date;
  paidAt?: Date;
}

export interface IManualPaymentFormData {
  receipt?: {
    url?: string;
    filename?: string;
    key?: string;
  };
  paymentType: PaymentRecordType;
  paymentMethod: PaymentMethod;
  status?: PaymentRecordStatus;
  period?: IPaymentPeriod;
  processingFee?: number; // In cents
  description?: string;
  propertyId?: string; // Property ID (pid) — used when no lease
  baseAmount: number; // In cents
  leaseId?: string;
  tenantId: string;
  unitId?: string; // Unit ID (puid) — used when no lease
  pytuid?: string; // Open charge to settle; when omitted the service auto-matches one
  mruid?: string; // Maintenance request the payment is for
  paidAt: Date;
}

export interface IVendorEarningsResponse {
  stats: {
    totalPaidInCents: number;
    pendingPayoutInCents: number;
    completedJobs: number;
    expectedEarningsInCents: number;
  };
  pagination: { total: number; page: number; limit: number; pages: number };
  items: IVendorEarningItem[];
}

export interface IRefundPaymentData {
  reverseVendorTransfer?: boolean; // Maintenance refunds after the vendor was paid: pull the payout back
  isManualRelease?: boolean; // When true, skip Stripe and record refund as processed outside the app
  amount?: number;
  reason?: string;
}

export interface IPaymentFormData {
  paymentType: PaymentRecordType;
  period?: IPaymentPeriod;
  notifyByEmail?: boolean;
  description?: string;
  daysLate?: number; // For late fee calculations
  leaseId?: string;
  tenantId: string;
  dueDate: Date;
}

export interface IVendorEarningItem {
  status: PaymentRecordStatus;
  pytuid?: string | null;
  amountInCents: number;
  createdAt: Date;
  invuid: string;
  mruid: string;
  title: string;
  paidAt?: Date;
}

/**
 * Fully populated payment: tenant includes the populated User doc,
 * lease includes the populated Property and PropertyUnit docs.
 * Used for single-payment detail queries (getPaymentByUid).
 */
export interface IPaymentFullyPopulated extends Omit<IPaymentDocument, 'tenant' | 'lease'> {
  lease?: ILeaseDocumentPopulated;
  tenant: IProfileWithUser;
}

/**
 * ILeaseProperty with populated `id` (Property doc) and optional `unitId` (PropertyUnit doc).
 * Used when the lease populate chain includes `property.id` and `property.unitId`.
 */
export interface ILeasePropertyPopulated extends Omit<ILeaseProperty, 'id' | 'unitId'> {
  unitId?: IPropertyUnitDocument;
  id: IPropertyDocument;
}

export interface IPaymentPopulated extends Omit<IPaymentDocument, 'tenant' | 'lease'> {
  tenant: IProfileDocument;
  lease?: ILeaseDocument;
}

/**
 * ILeaseDocument with its embedded property sub-document fully populated.
 */
export interface ILeaseDocumentPopulated extends Omit<ILeaseDocument, 'property'> {
  property: ILeasePropertyPopulated;
}

export type PaymentSource = 'cron' | 'pm_initiated' | 'staff_initiated';

export interface IPaymentPeriod {
  month: number;
  year: number;
}
