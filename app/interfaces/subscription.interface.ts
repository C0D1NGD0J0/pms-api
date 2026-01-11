import { Document, Types } from 'mongoose';

export enum IPaymentGateway {
  PAYSTACK = 'paystack',
  STRIPE = 'stripe',
  PAYPAL = 'paypal',
  NONE = 'none',
}

export enum ISubscriptionStatus {
  INACTIVE = 'inactive',
  ACTIVE = 'active',
}

export interface ISubscriptionPlansConfig {
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
  priceInCents: number;
  description: string;
  isFeatured: boolean;
  planName: PlanName;
  trialDays: number;
  priceId?: string;
  ctaText: string;
  name: string;
}

export interface ISubscription {
  paymentGateway: IPaymentGateway;
  additionalSeatsCount: number;
  status: ISubscriptionStatus;
  customPriceInCents?: number;
  additionalSeatsCost: number;
  paymentGatewayId?: string;
  totalMonthlyPrice: number;
  currentProperties: number;
  client: Types.ObjectId;
  currentSeats: number;
  currentUnits: number;
  planName: PlanName;
  canceledAt?: Date;
  startDate: Date;
  planId: string;
  endDate: Date;
  cuid: string;

  suid: string;
}

export type ISubscriptionPlanResponse = {
  pricing: {
    lookUpKey: string | null;
    id: string | null;
    monthly: {
      priceInCents: number;
      displayPrice: string;
    };
    annual: {
      priceInCents: number;
      displayPrice: string;
      savings: number;
    };
  };
} & Omit<ISubscriptionPlansConfig, 'priceInCents' | 'priceId' | 'features'>;

export interface ISubscriptionDocument extends ISubscription, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

export type PlanName = 'personal' | 'starter' | 'professional';
