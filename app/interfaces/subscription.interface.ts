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

export interface IPaymentGateway {
  provider: IPaymentGatewayProvider;
  planLookUpKey?: string; // Lookup key for the plan
  subscriberId?: string; // Payment gateway subscription ID (e.g., Stripe sub_xxx) set after payment
  customerId: string; // Payment gateway customer ID (e.g., Stripe customer ID)
  cardLast4?: string; // Last 4 digits for UI display (PCI-compliant)
  cardBrand?: string; // Card brand for UI display (visa, mastercard, etc.)
  planId: string; // Payment gateway price/plan ID (e.g., Stripe price ID)
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
}

export interface ISubscriptionPlanUsage {
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

export interface ISubscriptionEntitlements {
  paymentFlow: {
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
  features: Record<string, boolean>;
}

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

export interface ISubscriptionDocument extends ISubscription, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
  suid: string;
}

export type PlanName = 'essential' | 'growth' | 'portfolio';
