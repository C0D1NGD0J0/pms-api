import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import { ISubscriptionDocument } from '@interfaces/index';

const SubscriptionSchema = new Schema<ISubscriptionDocument>(
  {
    suid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
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
      enum: ['active', 'inactive', 'pending_payment'],
      required: true,
      default: 'active',
      index: true,
    },
    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: false,
      validate: {
        validator: function (this: ISubscriptionDocument, value: Date | undefined) {
          if (this.planName === 'starter') return true;

          // paid plans with active status must have endDate
          if (this.status === 'active') {
            return value !== undefined && value !== null;
          }

          // pending_payment: endDate can be undefined set later by Stripe webhook
          return true;
        },
        message: 'End date is required for active paid subscriptions',
      },
    },
    billingInterval: {
      type: String,
      enum: ['monthly', 'annual'],
      required: true,
      default: 'monthly',
      index: true,
    },
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
    pendingDowngradeAt: { type: Date, index: true },
    currentUnits: { type: Number, default: 0 },
    canceledAt: { type: Date },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

SubscriptionSchema.index({ status: 1, planName: 1 });
SubscriptionSchema.index({ pendingDowngradeAt: 1, status: 1 });

const SubscriptionModel = model<ISubscriptionDocument>('Subscription', SubscriptionSchema);
SubscriptionModel.cleanIndexes();
SubscriptionModel.syncIndexes();

export default SubscriptionModel;
