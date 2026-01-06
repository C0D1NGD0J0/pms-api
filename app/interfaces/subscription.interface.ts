import { Document, Types } from 'mongoose';

export interface ISubscription {
  featuresAddOns: {
    eSignature: boolean;
    RepairRequestService: boolean;
    VisitorPassService: boolean;
  };
  paymentGateway: 'stripe' | 'paypal' | 'none' | 'paystack';
  tier: 'free' | 'business' | 'enterprise' | 'individual';
  status: 'active' | 'inactive';
  paymentGatewayId?: string;
  currentProperties: number;
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
