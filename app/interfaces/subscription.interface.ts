import { Document, Types } from 'mongoose';

export enum ISubscriptionTier {
  PROFESSIONAL = 'professional',
  ENTERPRISE = 'enterprise',
  STARTER = 'starter',
  FREE = 'free',
}

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
  seatPricing: {
    includedSeats: number; // Seats included in base price
    additionalSeatPriceCents: number; // Price per extra seat (0 = can't buy more)
    maxAdditionalSeats: number; // Max extra seats allowed (-1 = unlimited, 0 = none)
  };
  limits: {
    maxProperties: number; // Property documents (-1 = unlimited)
    maxUnits: number; // PropertyUnit documents (-1 = unlimited)
    maxVendors: number; // Always -1 (unlimited)
  };
  features: {
    eSignature: boolean;
    RepairRequestService: boolean;
    VisitorPassService: boolean;
    apiAccess?: boolean;
    webhooks?: boolean;
    prioritySupport?: boolean;
  };
  transactionFeePercent: number;
  isCustomPricing: boolean; // true for Enterprise (contact sales)
  priceInCents: number; // Base price (includes base seats)
  name: string;
}

export interface ISubscription {
  paymentGateway: IPaymentGateway;
  additionalSeatsCount: number;
  status: ISubscriptionStatus;
  customPriceInCents?: number; // For Enterprise custom negotiated price
  additionalSeatsCost: number; // Total cost for extra seats in cents
  paymentGatewayId?: string;
  totalMonthlyPrice: number; // basePrice + additionalSeatsCost + customPrice
  currentProperties: number;
  tier: ISubscriptionTier;
  client: Types.ObjectId;
  currentSeats: number; // Total seats in use (included + additional)
  currentUnits: number;
  canceledAt?: Date;
  planName: string;
  startDate: Date;
  endDate: Date;
  cuid: string;

  suid: string;
}

export interface ISubscriptionDocument extends ISubscription, Document {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

// i noticed in the login signup you had social login but not in the logi page. also if you look at the login/signup design in the github repo there are multiple step in the signup dependnign on user account type. we need to have a subscription tire page as the would determing the type of signup page wether enterpise or personla etc
