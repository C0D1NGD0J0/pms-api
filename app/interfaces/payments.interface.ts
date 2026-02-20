import { Document, Types } from 'mongoose';

import { ILeaseDocument } from './lease.interface';
import { IProfileDocument } from './profile.interface';

export enum PaymentRecordStatus {
  CANCELLED = 'cancelled',
  PENDING = 'pending',
  OVERDUE = 'overdue',
  FAILED = 'failed',
  PAID = 'paid',
}

export enum PaymentMethod {
  BANK_TRANSFER = 'bank_transfer',
  ONLINE = 'online',
  CHECK = 'check',
  OTHER = 'other',
  CASH = 'cash',
}

export enum PaymentRecordType {
  MAINTENANCE = 'maintenance',
  LATE_FEE = 'late_fee',
  RENT = 'rent',
}

export interface IPaymentDocument extends Document {
  receipt?: {
    url?: string;
    filename?: string;
    key?: string;
    uploadedAt?: Date;
    uploadedBy?: Types.ObjectId;
  };
  notes?: {
    text: string;
    createdAt: Date;
    author: string;
  }[];
  paymentType: PaymentRecordType;
  paymentMethod: PaymentMethod;
  status: PaymentRecordStatus;
  recordedBy?: Types.ObjectId; // User who recorded manual payment
  gatewayPaymentId?: string;
  period?: IPaymentPeriod;
  lease?: Types.ObjectId;
  tenant: Types.ObjectId; // References Profile
  isManualEntry: boolean;
  invoiceNumber: string;
  processingFee: number;
  description?: string;
  baseAmount: number;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  pytuid: string;
  dueDate: Date;
  paidAt?: Date;
  cuid: string;
}

export interface IManualPaymentFormData {
  receipt?: {
    url?: string;
    filename?: string;
    key?: string;
  };
  paymentType: PaymentRecordType;
  paymentMethod: PaymentMethod;
  period?: IPaymentPeriod;
  description?: string;
  leaseId?: string;
  tenantId: string;
  amount: number; // In cents
  paidAt: Date;
}

export interface IPaymentFormData {
  paymentType: PaymentRecordType;
  period?: IPaymentPeriod;
  description?: string;
  daysLate?: number; // For late fee calculations
  leaseId?: string;
  tenantId: string;
  dueDate: Date;
}

export interface IPaymentPopulated extends Omit<IPaymentDocument, 'tenant' | 'lease'> {
  tenant: IProfileDocument;
  lease?: ILeaseDocument;
}

export interface IPaymentPeriod {
  month: number;
  year: number;
}
