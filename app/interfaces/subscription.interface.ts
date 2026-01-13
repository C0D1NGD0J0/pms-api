import { Document, Types } from 'mongoose';

export enum IPaymentGatewayProvider {
  PAYSTACK = 'paystack',
  STRIPE = 'stripe',
  PAYPAL = 'paypal',
  NONE = 'none',
}

export enum ISubscriptionStatus {
  PENDING_PAYMENT = 'pending_payment',
  INACTIVE = 'inactive',
  ACTIVE = 'active',
}

export interface ISubscriptionPlansConfig {
  pricing: {
    monthly: {
      priceId: string; // Stripe price ID for monthly billing
      priceInCents: number;
    };
    annual: {
      priceId: string; // Stripe price ID for annual billing
      priceInCents: number;
      savingsPercent: number;
    };
  };
  features: {
    eSignature: boolean;
    RepairRequestService: boolean;
    VisitorPassService: boolean;
    reportingAnalytics: boolean;
    prioritySupport?: boolean;
  };
  seatPricing: {
    includedSeats: number;
    additionalSeatPriceCents: number;
    maxAdditionalSeats: number;
  };
  limits: {
    maxProperties: number;
    maxUnits: number;
    maxVendors: number;
  };
  transactionFeePercent: number;
  disabledFeatures?: string[];
  isCustomPricing: boolean;
  featuredBadge?: string;
  featureList: string[];
  displayOrder: number;
  description: string;
  isFeatured: boolean;
  planName: PlanName;
  trialDays: number;
  ctaText: string;
  name: string;
}

export interface ISubscription {
  billingInterval: 'monthly' | 'annual';
  paymentGateway: IPaymentGateway;
  additionalSeatsCount: number;
  status: ISubscriptionStatus;
  customPriceInCents?: number;
  additionalSeatsCost: number;
  totalMonthlyPrice: number;
  currentProperties: number;
  pendingDowngradeAt?: Date;
  client: Types.ObjectId;
  currentSeats: number;
  currentUnits: number;
  planName: PlanName;
  canceledAt?: Date;
  startDate: Date;
  endDate: Date;
  cuid: string;
  suid: string;
}

export type ISubscriptionPlanResponse = {
  pricing: {
    monthly: {
      priceId: string;
      priceInCents: number;
      displayPrice: string;
      lookUpKey: string | null;
    };
    annual: {
      priceId: string;
      priceInCents: number;
      displayPrice: string;
      savingsPercent: number;
      savingsDisplay: string;
      lookUpKey: string | null;
    };
  };
} & Omit<ISubscriptionPlansConfig, 'pricing' | 'features'>;

export interface IPaymentGateway {
  provider: IPaymentGatewayProvider;
  planLookUpKey?: string; // Lookup key for the plan
  planId: string; // Stripe price ID or plan ID
  id: string; // Stripe customer ID or payment gateway customer ID
}

export interface ISubscriptionDocument extends ISubscription, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type PlanName = 'personal' | 'starter' | 'professional';
