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

export enum PaymentRecordType {
  MAINTENANCE = 'maintenance',
  LATE_FEE = 'late_fee',
  RENT = 'rent',
}

export interface IPaymentDocument extends Document {
  notes?: {
    text: string;
    createdAt: Date;
    author: string;
  }[];
  paymentType: PaymentRecordType;
  status: PaymentRecordStatus;
  gatewayPaymentId?: string;
  period?: IPaymentPeriod;
  lease?: Types.ObjectId;
  tenant: Types.ObjectId; // References Profile
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
