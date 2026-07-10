import { Document, Types } from 'mongoose';

import { IPropertyDocument } from './property.interface';
import { IPropertyUnitDocument } from './propertyUnit.interface';
import { ILeaseDocument, ILeaseProperty } from './lease.interface';
import { IProfileDocument, IProfileWithUser } from './profile.interface';

export enum PaymentRecordStatus {
  PROCESSING = 'processing', // charge submitted to bank, awaiting settlement (ACSS/bank transfer)
  CANCELLED = 'cancelled',
  REFUNDED = 'refunded',
  PENDING = 'pending',
  OVERDUE = 'overdue',
  FAILED = 'failed',
  PAID = 'paid',
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
  dispute?: {
    status?: 'open' | 'won' | 'lost';
    resolvedAt?: Date;
    disputeId?: string;
    amount?: number;
    reason?: string;
    disputedAt?: Date;
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
  refund?: {
    refundedAt?: Date;
    amount?: number;
    reason?: string;
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
  paymentType: PaymentRecordType;
  maintenanceRequestUid?: string; // mruid — links maintenance expense/charge back to its request
  paymentSource?: PaymentSource;
  paymentMethod: PaymentMethod;
  status: PaymentRecordStatus;
  recordedBy?: Types.ObjectId; // User who recorded manual payment
  vendorId?: Types.ObjectId; // Set for maintenance expense records (vendor who submitted the invoice)
  gatewayPaymentId?: string;
  gatewayChargeId?: string;
  period?: IPaymentPeriod;
  platformRevenue: number; // Platform's net revenue after Stripe gateway fee (applicationFee − processingFee)
  lease?: Types.ObjectId;
  tenant: Types.ObjectId; // References Profile
  isManualEntry: boolean;
  applicationFee: number; // Platform's application fee in cents (kept by platform; distinct from processingFee which is the Stripe gateway fee)
  invoiceNumber: string;
  processingFee: number;
  description?: string;
  _id: Types.ObjectId;
  baseAmount: number;
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
  period?: IPaymentPeriod;
  platformRevenue: number; // Platform's net revenue after Stripe gateway fee
  applicationFee: number; // Platform's application fee in cents
  processingFee: number;
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
  baseAmount: number; // In cents
  leaseId?: string;
  tenantId: string;
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

export interface IRefundPaymentData {
  amount?: number;
  reason?: string;
}

export type PaymentSource = 'cron' | 'pm_initiated' | 'staff_initiated';

export interface IPaymentPeriod {
  month: number;
  year: number;
}
