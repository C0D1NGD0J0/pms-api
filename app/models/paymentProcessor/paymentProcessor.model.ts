import { Schema, model } from 'mongoose';
import { generateShortUID, createLogger } from '@utils/index';
import {
  PaymentProcessorAccountType,
  IPaymentProcessorDocument,
} from '@interfaces/paymentProcessor.interface';

const logger = createLogger('PaymentProcessorModel');

const PaymentProcessorSchema = new Schema<IPaymentProcessorDocument>(
  {
    ppuid: {
      type: String,
      required: true,
      unique: true,
      index: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    cuid: {
      type: String,
      required: [true, 'Client ID is required'],
      immutable: true,
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: 'Client',
      required: [true, 'Client reference is required'],
      index: true,
      immutable: true,
    },
    accountId: {
      type: String,
      required: [true, 'Account ID is required'],
    },
    accountType: {
      type: String,
      enum: Object.values(PaymentProcessorAccountType),
      required: [true, 'Account type is required'],
      default: PaymentProcessorAccountType.EXPRESS,
    },
    chargesEnabled: {
      type: Boolean,
      required: true,
      default: false,
    },
    payoutsEnabled: {
      type: Boolean,
      required: true,
      default: false,
    },
    detailsSubmitted: {
      type: Boolean,
      required: true,
      default: false,
    },
    payoutsBlocked: {
      type: Boolean,
      default: false,
    },
    payoutsBlockedReason: {
      type: String,
    },
    payoutsBlockedAt: {
      type: Date,
    },
    payoutsBlockedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    payoutsPaused: {
      type: Boolean,
      default: false,
    },
    payoutsPausedReason: {
      type: String,
    },
    payoutsPausedAt: {
      type: Date,
    },
    disputeStats: {
      total: { type: Number, default: 0 },
      open: { type: Number, default: 0 },
      lastDisputeAt: { type: Date },
    },
    onboardedAt: {
      type: Date,
    },
    deletedAt: {
      type: Date,
    },
    vendor: {
      type: Schema.Types.ObjectId,
      ref: 'Vendor',
      index: true,
    },
    vuid: {
      type: String,
      index: true,
    },
    ownerType: {
      type: String,
      enum: ['client', 'vendor'],
      default: 'client',
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PaymentProcessorSchema.index({ cuid: 1 });
PaymentProcessorSchema.index({ accountId: 1 }, { unique: true });
PaymentProcessorSchema.index({ vuid: 1, cuid: 1 });

PaymentProcessorSchema.pre('save', function () {
  logger.info({ ppuid: this.ppuid, cuid: this.cuid }, 'Saving payment processor');
});

export const PaymentProcessor = model<IPaymentProcessorDocument>(
  'PaymentProcessor',
  PaymentProcessorSchema
);
