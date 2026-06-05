import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import {
  TenantPaymentStatus,
  IInvoiceDocument,
  InvoiceStatus,
} from '@interfaces/invoice.interface';

const InvoiceLineItemSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPriceInCents: { type: Number, required: true, min: 0 },
    amountInCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

const InvoiceSchema = new Schema<IInvoiceDocument>(
  {
    invuid: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      index: true,
      default: () => generateShortUID(),
    },
    cuid: {
      type: String,
      required: [true, 'Client ID is required'],
      immutable: true,
      index: true,
    },
    maintenanceRequestId: {
      type: Schema.Types.ObjectId,
      ref: 'MaintenanceRequest',
      required: true,
      index: true,
    },
    mruid: {
      type: String,
      required: true,
    },
    submittedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    submittedAt: {
      type: Date,
      required: true,
    },
    amountInCents: {
      type: Number,
      required: [true, 'Amount is required'],
      min: 0,
    },
    currency: {
      type: String,
      default: 'USD',
      uppercase: true,
      minlength: 3,
      maxlength: 3,
    },
    description: {
      type: String,
      required: [true, 'Description is required'],
      maxlength: 500,
    },
    lineItems: {
      type: [InvoiceLineItemSchema],
      default: undefined,
    },
    status: {
      type: String,
      enum: Object.values(InvoiceStatus),
      default: InvoiceStatus.PENDING,
      required: true,
      index: true,
    },
    review: {
      reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      reviewedAt: { type: Date },
      rejectionReason: { type: String },
      _id: false,
    },
    source: {
      type: {
        type: String,
        enum: ['manual', 'quickbooks', 'freshbooks', 'jobber'],
        default: 'manual',
      },
      externalId: { type: String },
      externalUrl: { type: String },
      _id: false,
    },
    attachment: {
      url: { type: String },
      key: { type: String },
      _id: false,
    },
    isDeleted: {
      type: Boolean,
      default: false,
    },
    vendorPayoutStatus: {
      type: String,
      enum: ['pending', 'paid'],
      default: 'pending',
    },
    tenantPaymentStatus: {
      type: String,
      enum: Object.values(TenantPaymentStatus),
      default: TenantPaymentStatus.UNPAID,
    },
    fundsAvailable: {
      type: Boolean,
      default: false,
    },
    fundsAvailableAt: {
      type: Date,
      default: null,
    },
    stripeChargeId: {
      type: String,
      default: null,
      sparse: true,
    },
    stripeReceiptUrl: {
      type: String,
      default: null,
    },
    vendorPaidAt: { type: Date },
    vendorPayoutTransferId: { type: String, sparse: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Compound indexes
InvoiceSchema.index({ cuid: 1, status: 1 });
InvoiceSchema.index({ cuid: 1, maintenanceRequestId: 1 });
InvoiceSchema.index({ vendorPayoutStatus: 1, tenantPaymentStatus: 1, fundsAvailable: 1 });

const InvoiceModel = model<IInvoiceDocument>('Invoice', InvoiceSchema);

export default InvoiceModel;
