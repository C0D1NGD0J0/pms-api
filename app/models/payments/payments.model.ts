import { randomBytes } from 'crypto';
import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  IPaymentDocument,
  PaymentMethod,
  PaymentSource,
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
    applicationFee: {
      type: Number,
      default: 0,
      min: [0, 'Application fee cannot be negative'],
    },
    platformRevenue: {
      type: Number,
      default: 0,
      min: [0, 'Platform revenue cannot be negative'],
    },
    gatewayPaymentId: {
      type: String,
    },
    gatewayChargeId: {
      type: String,
    },
    stripePaymentMethodType: {
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
      status: { type: String, enum: ['open', 'won', 'lost'] },
      resolvedAt: { type: Date },
      disputeId: { type: String },
      amount: {
        type: Number,
        min: [0, 'Dispute amount cannot be negative'],
      },
      reason: { type: String, trim: true },
      disputedAt: { type: Date },
    },
    failure: {
      retryCount: { type: Number, default: 0, min: 0 },
      reason: { type: String, trim: true },
      lastFailedAt: { type: Date },
      pmNotifiedAt: { type: Date },
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
    chargedAt: Date,
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
    currency: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      default: 'USD',
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
    invoiceDocument: {
      url: { type: String },
      key: { type: String },
      generatedAt: { type: Date },
    },
    vendorId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
    },
    maintenanceRequestUid: {
      type: String,
      index: true,
      sparse: true,
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
    paymentSource: {
      type: String,
      enum: ['cron', 'pm_initiated', 'staff_initiated'] satisfies PaymentSource[],
      index: true,
    },
    lineItems: [
      {
        description: { type: String, required: true, trim: true },
        amountInCents: { type: Number, required: true, min: 0 },
        _id: false,
      },
    ],
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

PaymentSchema.virtual('maintenanceRequest', {
  ref: 'MaintenanceRequest',
  localField: 'maintenanceRequestUid',
  foreignField: 'mruid',
  justOne: true,
});

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

// pre('validate') runs before Mongoose's required/unique checks,
// ensuring invoiceNumber is always set before validation fires.
PaymentSchema.pre('validate', function () {
  if (!this.invoiceNumber) {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const random = randomBytes(3).toString('hex').toUpperCase();
    this.invoiceNumber = `INV-${year}${month}-${random}`;
  }
});

const PaymentModel = model<IPaymentDocument>('Payment', PaymentSchema);
PaymentModel.syncIndexes();

export default PaymentModel;
