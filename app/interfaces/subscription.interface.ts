import { Document, Types } from 'mongoose';

export enum ISubscriptionTier {
  ENTERPRISE = 'enterprise',
  INDIVIDUAL = 'individual',
  BUSINESS = 'business',
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

export interface ISubscription {
  featuresAddOns: IFeaturesAddOns;
  paymentGateway: IPaymentGateway;
  status: ISubscriptionStatus;
  paymentGatewayId?: string;
  currentProperties: number;
  tier: ISubscriptionTier;
  client: Types.ObjectId;
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

export interface IFeaturesAddOns {
  RepairRequestService: boolean;
  VisitorPassService: boolean;
  eSignature: boolean;
}
