import { Schema, model } from 'mongoose';
import { ISubscriptionDocument } from '@interfaces/index';

const SubscriptionSchema = new Schema<ISubscriptionDocument>(
  {
    cuid: { type: String, required: true, unique: true, index: true },
    suid: { type: String, required: true, unique: true, index: true },
    client: { type: Schema.Types.ObjectId, ref: 'Client', required: true, index: true },
    tier: {
      type: String,
      enum: ['free', 'business', 'enterprise', 'individual'],
      required: true,
      default: 'free',
      index: true,
    },
    status: {
      type: String,
      enum: ['active', 'inactive'],
      required: true,
      default: 'active',
      index: true,
    },
    planName: { type: String, required: true },
    startDate: { type: Date, required: true, default: Date.now },
    endDate: { type: Date, required: true },
    paymentGateway: {
      type: String,
      enum: ['stripe', 'paypal', 'none', 'paystack'],
      required: true,
      default: 'none',
    },
    paymentGatewayId: { type: String, sparse: true, index: true },
    featuresAddOns: {
      eSignature: { type: Boolean, default: false },
      RepairRequestService: { type: Boolean, default: false },
      VisitorPassService: { type: Boolean, default: false },
    },
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
SubscriptionSchema.index({ status: 1, tier: 1 });

const SubscriptionModel = model<ISubscriptionDocument>('Subscription', SubscriptionSchema);
SubscriptionModel.cleanIndexes();
SubscriptionModel.syncIndexes();

export default SubscriptionModel;
