import { Document, Types } from 'mongoose';

export enum PaymentProcessorAccountType {
  STANDARD = 'standard',
  EXPRESS = 'express',
}

export interface IPaymentProcessor {
  accountType: PaymentProcessorAccountType;
  payoutsBlockedReason?: string;
  detailsSubmitted: boolean;
  payoutsBlocked?: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  payoutsBlockedAt?: Date;
  client: Types.ObjectId;
  onboardedAt?: Date;
  accountId: string;
  deletedAt?: Date;
  ppuid: string;
  cuid: string;
}

export interface IPaymentProcessorFormData {
  accountType: PaymentProcessorAccountType;
  detailsSubmitted?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  client: Types.ObjectId;
  accountId: string;
  cuid: string;
}

export interface IPaymentProcessorDocument extends IPaymentProcessor, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}
