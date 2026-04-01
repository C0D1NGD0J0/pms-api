import { Schema } from 'mongoose';
import { InvoiceStatus } from '@interfaces/maintenanceRequest.interface';

export const InvoiceLineItemSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPriceInCents: { type: Number, required: true, min: 0 },
    amountInCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

export const InvoiceSchema = new Schema(
  {
    submittedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    submittedAt: { type: Date, required: true },
    amountInCents: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'usd', minlength: 3, maxlength: 3 },
    description: { type: String, required: true, maxlength: 500 },
    lineItems: { type: [InvoiceLineItemSchema], default: undefined },
    attachmentUrl: { type: String },
    attachmentKey: { type: String },
    status: {
      type: String,
      enum: Object.values(InvoiceStatus),
      default: InvoiceStatus.PENDING,
      required: true,
    },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    rejectionReason: { type: String },
    source: {
      type: String,
      enum: ['manual', 'quickbooks', 'freshbooks', 'jobber'],
      default: 'manual',
    },
    externalInvoiceId: { type: String },
    externalInvoiceUrl: { type: String },
  },
  { _id: false }
);
