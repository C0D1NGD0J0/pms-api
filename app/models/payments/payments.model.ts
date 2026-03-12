import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  PaymentMethod,
} from '@interfaces/index';

const PaymentSchema = new Schema<IPaymentDocument>(
  {
    pytuid: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      default: () => generateShortUID(),
    },
    invoiceNumber: {
      type: String,
      required: true,
      unique: true,
    },
    cuid: {
      type: String,
      required: [true, 'Client ID is required'],
      immutable: true,
    },
    paymentType: {
      type: String,
      enum: Object.values(PaymentRecordType),
      required: [true, 'Payment type is required'],
    },
    paymentMethod: {
      type: String,
      enum: Object.values(PaymentMethod),
      default: PaymentMethod.ONLINE,
      required: [true, 'Payment method is required'],
    },
    lease: {
      type: Schema.Types.ObjectId,
      ref: 'Lease',
    },
    tenant: {
      type: Schema.Types.ObjectId,
      ref: 'Profile',
      required: [true, 'Tenant is required'],
    },
    baseAmount: {
      type: Number,
      required: [true, 'Base amount is required'],
      min: [0, 'Base amount cannot be negative'],
    },
    processingFee: {
      type: Number,
      default: 0,
      min: [0, 'Processing fee cannot be negative'],
    },
    gatewayPaymentId: {
      type: String,
    },
    gatewayChargeId: {
      type: String,
    },
    refund: {
      refundedAt: { type: Date },
      amount: {
        type: Number,
        min: [0, 'Refund amount cannot be negative'],
      },
      reason: { type: String, trim: true },
    },
    dispute: {
      disputeId: { type: String },
      amount: {
        type: Number,
        min: [0, 'Dispute amount cannot be negative'],
      },
      reason: { type: String, trim: true },
      disputedAt: { type: Date },
    },
    status: {
      type: String,
      enum: Object.values(PaymentRecordStatus),
      default: PaymentRecordStatus.PENDING,
      required: true,
    },
    dueDate: {
      type: Date,
      required: [true, 'Due date is required'],
    },
    paidAt: Date,
    period: {
      month: {
        type: Number,
        min: 1,
        max: 12,
      },
      year: {
        type: Number,
        min: 2020,
      },
    },
    description: String,
    receipt: {
      url: {
        type: String,
        validate: {
          validator: function (v: string) {
            return !v || /^https?:\/\/.+/.test(v);
          },
          message: (props: any) => `${props.value} is not a valid URL!`,
        },
      },
      filename: { type: String },
      key: { type: String },
      uploadedAt: { type: Date },
      uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    },
    recordedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    isManualEntry: {
      type: Boolean,
      default: false,
      required: true,
    },
    notes: [
      {
        note: {
          type: String,
          required: true,
          trim: true,
        },
        author: {
          type: String,
          required: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
    deletedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PaymentSchema.index({ cuid: 1, status: 1, dueDate: -1 });
PaymentSchema.index({ tenant: 1, dueDate: -1 });
PaymentSchema.index(
  { lease: 1, paymentType: 1, 'period.month': 1, 'period.year': 1 },
  {
    unique: true,
    partialFilterExpression: {
      paymentType: PaymentRecordType.RENT,
      deletedAt: null,
    },
  }
);

PaymentSchema.index({ gatewayPaymentId: 1 }, { unique: true, sparse: true });
PaymentSchema.index({ gatewayChargeId: 1 }, { sparse: true });

PaymentSchema.virtual('isOverdue').get(function (this: IPaymentDocument) {
  return (
    this.status !== PaymentRecordStatus.PAID &&
    this.status !== PaymentRecordStatus.CANCELLED &&
    new Date() > this.dueDate
  );
});

PaymentSchema.virtual('daysOverdue').get(function (this: IPaymentDocument) {
  const isOverdue =
    this.status !== PaymentRecordStatus.PAID &&
    this.status !== PaymentRecordStatus.CANCELLED &&
    new Date() > this.dueDate;

  if (!isOverdue) return 0;
  return Math.floor((Date.now() - this.dueDate.getTime()) / (1000 * 60 * 60 * 24));
});

PaymentSchema.pre('save', function (next) {
  if (!this.invoiceNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = Math.random().toString(36).substring(2, 8).toUpperCase();
    this.invoiceNumber = `INV-${year}${month}-${random}`;
  }
  next();
});

const PaymentModel = model<IPaymentDocument>('Payment', PaymentSchema);
PaymentModel.syncIndexes();

export default PaymentModel;
