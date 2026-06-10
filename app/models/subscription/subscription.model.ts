import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import { ISubscriptionDocument, ISubscriptionStatus } from '@interfaces/index';

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
    cuid: { type: String, required: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    planName: {
      type: String,
      enum: ['essential', 'growth', 'portfolio'] as const,
      required: true,
      default: 'essential',
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(ISubscriptionStatus),
      required: true,
      default: ISubscriptionStatus.ACTIVE,
      index: true,
    },
    startDate: { type: Date, required: true },
    endDate: {
      type: Date,
      required: false,
      validate: {
        validator: function (this: unknown, value: Date | undefined) {
          // In Mongoose 9, `this` can be a Query (update context) or a Document
          if (!this || typeof this !== 'object' || !('planName' in this)) return true;

          const doc = this as ISubscriptionDocument;
          if (doc.planName === 'essential') return true;

          // paid plans with active status must have endDate
          if (doc.status === 'active') {
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
    entitlements: {
      eSignature: { type: Boolean, required: true, default: false },
      MaintenanceRequestService: { type: Boolean, required: true, default: false },
      VisitorPassService: { type: Boolean, required: true, default: false },
      reportingAnalytics: { type: Boolean, required: true, default: false },
      leaseTemplates: { type: Boolean, required: true, default: false },
      vendorManagement: { type: Boolean, required: true, default: false },
      prioritySupport: { type: Boolean, default: false },
      aiTriage: { type: Boolean, required: true, default: false },
      aiInvoiceScanning: { type: Boolean, required: true, default: false },
    },
    billing: {
      customerId: {
        type: String,
        validate: {
          validator: function (this: any, value: string | undefined) {
            const parent = this && typeof this.parent === 'function' ? this.parent() : null;
            if (!parent || parent.planName === 'essential') {
              return true;
            }
            return value !== undefined && value !== null && value !== '';
          },
          message: 'Customer ID is required for paid subscriptions',
        },
      },
      subscriberId: {
        type: String,
        validate: {
          validator: function (this: any, value: string | undefined) {
            const parent = this && typeof this.parent === 'function' ? this.parent() : null;
            if (!parent || parent.planName === 'essential') {
              return true;
            }
            return value !== undefined && value !== null && value !== '';
          },
          message: 'Subscriber ID is required for paid subscriptions',
        },
      },
      provider: {
        type: String,
        enum: ['stripe', 'paypal', 'none', 'paystack'],
        required: true,
        default: 'none',
      },
      planId: { type: String, required: true },
      planLookUpKey: { type: String },
      seatItemId: { type: String },
      cardLast4: { type: String },
      cardBrand: { type: String },
    },
    customPriceInCents: { type: Number },
    additionalSeatsCount: { type: Number, default: 0 },
    additionalSeatsCost: { type: Number, default: 0 },
    totalMonthlyPrice: { type: Number, required: true },
    currentSeats: { type: Number, default: 1 },
    currentProperties: { type: Number, default: 0 },
    pendingDowngradeAt: { type: Date, index: true },
    currentUnits: { type: Number, default: 0 },
    manualRecords: {
      countThisPeriod: { type: Number, default: 0 },
      periodStart: { type: Date, default: Date.now },
    },
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
