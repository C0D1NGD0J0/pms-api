import { Schema, model } from 'mongoose';
import { ISubscriptionDocument } from '@interfaces/index';

const SubscriptionSchema = new Schema<ISubscriptionDocument>(
  {
    cuid: { type: String, required: true, unique: true, index: true },
    suid: { type: String, required: true, unique: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    planName: {
      type: String,
      enum: ['personal', 'starter', 'professional'],
      required: true,
      default: 'personal',
      index: true,
    },
    planId: { type: String, required: true }, // stripe-price ID
    status: {
      type: String,
      enum: ['active', 'inactive'],
      required: true,
      default: 'active',
      index: true,
    },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true },
    paymentGateway: {
      type: String,
      enum: ['stripe', 'paypal', 'none', 'paystack'],
      required: true,
      default: 'none',
    },
    paymentGatewayId: { type: String, sparse: true, index: true },
    customPriceInCents: { type: Number }, // For Enterprise custom negotiated price
    additionalSeatsCount: { type: Number, default: 0 }, // Extra seats purchased beyond included
    additionalSeatsCost: { type: Number, default: 0 }, // Total cost for extra seats in cents
    totalMonthlyPrice: { type: Number, required: true }, // basePrice + additionalSeatsCost + customPrice
    currentSeats: { type: Number, default: 1 }, // Total seats in use (included + additional)
    currentProperties: { type: Number, default: 0 },
    currentUnits: { type: Number, default: 0 },
    canceledAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

SubscriptionSchema.index({ cuid: 1 });
SubscriptionSchema.index({ suid: 1 });
SubscriptionSchema.index({ client: 1 });
SubscriptionSchema.index({ paymentGatewayId: 1 });
SubscriptionSchema.index({ status: 1, planName: 1 });

const SubscriptionModel = model<ISubscriptionDocument>('Subscription', SubscriptionSchema);
SubscriptionModel.cleanIndexes();
SubscriptionModel.syncIndexes();

export default SubscriptionModel;
