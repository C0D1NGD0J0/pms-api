import { Document, Types } from 'mongoose';

// ── Enums & Types ────────────────────────────────────────────────────────────

export enum InvoiceStatus {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PENDING = 'pending',
}

export interface IInvoice {
  vendorPayoutStatus?: 'pending' | 'paid';
  maintenanceRequestId: Types.ObjectId;
  vendorPayoutTransferId?: string;
  attachment?: IInvoiceAttachment;
  lineItems?: IInvoiceLineItem[];
  submittedBy: Types.ObjectId;
  source: IInvoiceSourceInfo;
  review?: IInvoiceReview;
  amountInCents: number;
  status: InvoiceStatus;
  description: string;
  vendorPaidAt?: Date;
  isDeleted: boolean;
  submittedAt: Date;
  currency: string;
  invuid: string;
  mruid: string;
  cuid: string;
}

// ── Sub-shapes ───────────────────────────────────────────────────────────────

export interface IInvoiceWebhookPayload {
  rawPayload: Record<string, unknown>;
  lineItems?: IInvoiceLineItem[];
  externalInvoiceUrl?: string;
  externalInvoiceId: string;
  source: InvoiceSource;
  description: string;
  currency: string;
  amount: number;
  mruid: string;
}

export interface ISubmitInvoicePayload {
  lineItems?: IInvoiceLineItem[];
  externalInvoiceUrl?: string;
  externalInvoiceId?: string;
  source?: InvoiceSource;
  description: string;
  currency?: string;
  amount: number;
}

export interface IInvoiceLineItem {
  unitPriceInCents: number;
  amountInCents: number;
  description: string;
  quantity: number;
}

export interface IInvoiceReview {
  reviewedBy: Types.ObjectId;
  rejectionReason?: string;
  reviewedAt: Date;
}

// ── Core interface ───────────────────────────────────────────────────────────

export interface IInvoiceSourceInfo {
  externalUrl?: string;
  type: InvoiceSource;
  externalId?: string;
}

export type InvoiceSource = 'manual' | 'quickbooks' | 'freshbooks' | 'jobber';

// ── Payloads ─────────────────────────────────────────────────────────────────

export interface IInvoiceAttachment {
  url: string;
  key: string;
}

export interface IInvoiceDocument extends IInvoice, Document {}
