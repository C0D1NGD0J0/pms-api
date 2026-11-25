import { Document, Types } from 'mongoose';

export enum PaymentProcessorAccountType {
  SUBACCOUNT = 'subaccount', // Paystack: a landlord's subaccount (ACCT_…)
  STANDARD = 'standard',
  EXPRESS = 'express',
}

export interface IPaymentProcessor {
  /** Stripe terms the account was created under; only 'full' accounts can take instant payouts */
  serviceAgreement?: PaymentProcessorServiceAgreement;
  disputeStats?: IPaymentProcessorDisputeStats;
  /** Paystack only — Stripe keeps bank details inside the Connect account */
  bankDetails?: IPaymentProcessorBankDetails;
  accountType: PaymentProcessorAccountType;
  /** Which provider holds the account: Stripe Connect (acct_…) or a Paystack subaccount (ACCT_…). Missing = stripe */
  provider?: PaymentProcessorProvider;
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
  bankDetails?: IPaymentProcessorBankDetails;
  accountType: PaymentProcessorAccountType;
  provider?: PaymentProcessorProvider;
  ownerType?: 'client' | 'vendor';
  detailsSubmitted?: boolean;
  chargesEnabled?: boolean;
  payoutsEnabled?: boolean;
  vendor?: Types.ObjectId;
  client: Types.ObjectId;
  onboardedAt?: Date;
  accountId: string;
  vuid?: string;
  cuid: string;
}

/** What the payment settings page shows; only the last 4 characters of identifiers leave the API. */
export interface IPayoutAccountDetails {
  bank: { accountNumberLast4: string; accountName: string; bankName: string } | null;
  provider: PaymentProcessorProvider;
  onboardedAt: Date | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  accountIdLast4: string;
}

export interface IPaymentProcessorDocument extends IPaymentProcessor, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The bank a Paystack payout account settles to, for display. Paystack holds the full account
 * number; only the last 4 digits are kept here.
 */
export interface IPaymentProcessorBankDetails {
  accountNumberLast4: string;
  accountName: string;
  bankName: string;
  bankCode: string;
}

export interface IPaymentProcessorDisputeStats {
  lastDisputeAt?: Date;
  total: number;
  open: number;
}

export type PaymentProcessorServiceAgreement = 'full' | 'recipient';

export type PaymentProcessorProvider = 'stripe' | 'paystack';
