import { Document, Types } from 'mongoose';

export enum PaymentProcessorAccountType {
  STANDARD = 'standard',
  EXPRESS = 'express',
}

export interface IPaymentProcessor {
  /** Stripe terms the account was created under; only 'full' accounts can take instant payouts */
  serviceAgreement?: PaymentProcessorServiceAgreement;
  disputeStats?: IPaymentProcessorDisputeStats;
  accountType: PaymentProcessorAccountType;
  payoutsBlockedBy?: Types.ObjectId;
  ownerType?: 'client' | 'vendor';
  payoutsBlockedReason?: string;
  payoutsPausedReason?: string;
  /** Weekday of the weekly payout, kept so a paused schedule resumes on the same day */
  payoutWeeklyAnchor?: string;
  detailsSubmitted: boolean;
  payoutsBlocked?: boolean;
  payoutsPaused?: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  payoutsBlockedAt?: Date;
  /** Set when this processor belongs to a vendor rather than the client/PM */
  vendor?: Types.ObjectId;
  payoutsPausedAt?: Date;
  client: Types.ObjectId;
  onboardedAt?: Date;
  accountId: string;
  deletedAt?: Date;
  ppuid: string;
  vuid?: string;
  cuid: string;
}

export interface IPaymentProcessorFormData {
  serviceAgreement?: PaymentProcessorServiceAgreement;
  accountType: PaymentProcessorAccountType;
  ownerType?: 'client' | 'vendor';
  detailsSubmitted?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  vendor?: Types.ObjectId;
  client: Types.ObjectId;
  accountId: string;
  vuid?: string;
  cuid: string;
}

export interface IPaymentProcessorDocument extends IPaymentProcessor, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export interface IPaymentProcessorDisputeStats {
  lastDisputeAt?: Date;
  total: number;
  open: number;
}

export type PaymentProcessorServiceAgreement = 'full' | 'recipient';
