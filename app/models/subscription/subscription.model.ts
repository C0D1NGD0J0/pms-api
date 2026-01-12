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
      id: { type: String, required: true, index: true },
      provider: {
        type: String,
        enum: ['stripe', 'paypal', 'none', 'paystack'],
        required: true,
        default: 'none',
      },
      planId: { type: String, required: true },
      planLookUpKey: { type: String },
    },
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

// Composite index for filtering subscriptions by status and plan
SubscriptionSchema.index({ status: 1, planName: 1 });

const SubscriptionModel = model<ISubscriptionDocument>('Subscription', SubscriptionSchema);
SubscriptionModel.cleanIndexes();
SubscriptionModel.syncIndexes();

export default SubscriptionModel;
