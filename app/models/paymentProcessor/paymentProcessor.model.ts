import { Schema, model } from 'mongoose';
import uniqueValidator from 'mongoose-unique-validator';
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
    onboardedAt: {
      type: Date,
    },
    deletedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PaymentProcessorSchema.plugin(uniqueValidator, {
  message: '{PATH} must be unique.',
});

PaymentProcessorSchema.index({ cuid: 1 });
PaymentProcessorSchema.index({ accountId: 1 }, { unique: true });

PaymentProcessorSchema.pre('save', function (next) {
  logger.info({ ppuid: this.ppuid, cuid: this.cuid }, 'Saving payment processor');
  next();
});

export const PaymentProcessor = model<IPaymentProcessorDocument>(
  'PaymentProcessor',
  PaymentProcessorSchema
);
