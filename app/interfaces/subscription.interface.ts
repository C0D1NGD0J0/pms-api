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
  seatPricing: {
    includedSeats: number;
    additionalSeatPriceCents: number;
    maxAdditionalSeats: number;
    lookUpKey: string;
    lookUpKeys?: {
      monthly: string;
      annual: string;
    };
    stripePrices?: {
      monthly: {
        priceId: string;
        amountInCents: number;
        displayPrice: string;
        lookUpKey: string;
      } | null;
      annual: {
        priceId: string;
        amountInCents: number;
        displayPrice: string;
        lookUpKey: string;
      } | null;
    };
  };
  features: {
    eSignature: boolean;
    RepairRequestService: boolean;
    VisitorPassService: boolean;
    reportingAnalytics: boolean;
    leaseTemplates: boolean;
    prioritySupport?: boolean;
  };
  pricing: {
    monthly: {
      priceId: string;
      priceInCents: number;
    };
    annual: {
      priceId: string;
      priceInCents: number;
      savingsPercent: number;
    };
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

export interface ISubscriptionPlanUsage {
  seatInfo: {
    includedSeats: number;
    additionalSeats: number;
    totalAllowed: number;
    maxAdditionalSeats: number;
    additionalSeatPriceCents: number;
    availableForPurchase: number;
  };
  verification: {
    isVerified: boolean;
    requiresVerification: boolean;
    gracePeriodExpired: boolean;
    daysRemaining: number | null;
    accountCreatedAt: Date;
  };
  plan: {
    name: PlanName;
    status: ISubscriptionStatus;
    billingInterval: 'monthly' | 'annual';
    startDate: Date;
    endDate: Date | null;
  };
  isLimitReached: {
    properties: boolean;
    units: boolean;
    seats: boolean;
  };
  limits: {
    properties: number;
    units: number;
    seats: number;
  };
  usage: {
    properties: number;
    units: number;
    seats: number;
  };
}

export interface ISubscription {
  entitlements: {
    eSignature: boolean;
    RepairRequestService: boolean;
    VisitorPassService: boolean;
    reportingAnalytics: boolean;
    leaseTemplates: boolean;
    prioritySupport?: boolean;
  };
  billingInterval: 'monthly' | 'annual';
  billing: ISubscriptionBilling;
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
}

export interface ISubscriptionEntitlements {
  entitlements: {
    eSignature: boolean;
    RepairRequestService: boolean;
    VisitorPassService: boolean;
    reportingAnalytics: boolean;
    leaseTemplates: boolean;
    prioritySupport?: boolean;
  };
  paymentFlow?: {
    requiresPayment: boolean;
    reason: 'pending_signup' | 'expired' | 'grace_period' | null;
    gracePeriodEndsAt: Date | null;
    daysUntilDowngrade: number | null;
  };
  plan: {
    name: PlanName;
    status: ISubscriptionStatus;
    billingInterval: 'monthly' | 'annual';
  };
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

export interface ISubscriptionSummary {
  billingInterval: 'monthly' | 'annual';
  status: ISubscriptionStatus;
  currentProperties: number;
  subscriptionId: string;
  nextBillingDate?: Date;
  currentSeats: number;
  currentUnits: number;
  planName: PlanName;
  amount: number;
  suid: string;
  cuid: string;
}

export interface ISubscriptionBilling {
  provider: IPaymentGatewayProvider;
  planLookUpKey?: string;
  subscriberId?: string;
  seatItemId?: string;
  customerId: string;
  cardLast4?: string;
  cardBrand?: string;
  planId: string;
}

export interface ISubscriptionDocument extends ISubscription, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  suid: string;
}

export interface IPaymentGateway extends ISubscriptionBilling {
  connectedAccountId?: string;
}

export type PlanName = 'essential' | 'growth' | 'portfolio';
