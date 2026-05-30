import { z } from 'zod';
import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import uniqueValidator from 'mongoose-unique-validator';
import {
  IMaintenanceRequestDocument,
  MaintenanceRequestPriority,
  MaintenanceRequestStatus,
  MaintenanceCategory,
  AvailabilityWindow,
  WorkOrderStatus,
} from '@interfaces/maintenanceRequest.interface';

const WorkOrderLineItemSchema = new Schema(
  {
    description: { type: String, required: true },
    quantity: { type: Number, required: true, min: 0 },
    unitPriceInCents: { type: Number, required: true, min: 0 },
    amountInCents: { type: Number, required: true, min: 0 },
  },
  { _id: false }
);

// Zod URL validator
const urlSchema = z.string().url();

const validateUrl = (v: string): boolean => {
  try {
    urlSchema.parse(v);
    return true;
  } catch {
    return false;
  }
};

const CompletionNoteSchema = new Schema(
  {
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    note: { type: String, required: true, maxlength: 2000 },
    createdAt: { type: Date, required: true, default: () => new Date() },
  },
  { _id: true }
);

const MaintenanceRequestSchema = new Schema<IMaintenanceRequestDocument>(
  {
    mruid: {
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
      index: true,
      immutable: true,
    },
    tenantId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    propertyUnitId: { type: Schema.Types.ObjectId, ref: 'PropertyUnit', index: true },
    managedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    locationDescription: { type: String, maxlength: 500 },
    title: { type: String, required: true, maxlength: 200 },
    description: {
      text: { type: String, required: true, maxlength: 2000 },
      html: { type: String },
    },
    category: {
      type: String,
      enum: Object.values(MaintenanceCategory),
      required: true,
      index: true,
    },
    priority: {
      type: String,
      enum: Object.values(MaintenanceRequestPriority),
      default: MaintenanceRequestPriority.MEDIUM,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(MaintenanceRequestStatus),
      default: MaintenanceRequestStatus.OPEN,
      required: true,
      index: true,
    },
    vendorId: { type: Schema.Types.ObjectId, ref: 'User', index: true },
    assignedAt: { type: Date },
    assignedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    scheduledDate: { type: Date },
    estimatedCost: { type: Number, min: 0 },
    permissionToEnter: { type: Boolean, required: true, default: false },
    hasPet: { type: Boolean, default: false },
    completedAt: { type: Date },
    completionNotes: { type: [CompletionNoteSchema], default: undefined },
    actualCost: { type: Number, min: 0 },
    invoiceId: { type: Schema.Types.ObjectId, ref: 'Invoice', index: true },
    invoiceDeadline: { type: Date },
    tenantFeedback: {
      status: { type: String, enum: ['pending', 'confirmed', 'disputed'], default: 'pending' },
      rating: { type: Number, min: 1, max: 5 },
      comment: { type: String, maxlength: 1000 },
      submittedAt: { type: Date },
      _id: false,
    },
    pendingMaintenanceStatus: {
      propertyId: { type: Schema.Types.ObjectId, ref: 'Property' },
      unitId: { type: Schema.Types.ObjectId, ref: 'PropertyUnit' },
      requestedBy: { type: Schema.Types.ObjectId, ref: 'User' },
      requestedAt: { type: Date },
      displayName: { type: String },
      _id: false,
    },
    aiAnalysis: {
      suggestedCategory: { type: String, enum: Object.values(MaintenanceCategory) },
      suggestedPriority: { type: String, enum: Object.values(MaintenanceRequestPriority) },
      confidence: { type: Number, min: 0, max: 1 },
      reasoning: { type: String },
      suggestedVendorId: { type: Schema.Types.ObjectId, ref: 'User' },
      suggestedVendorName: { type: String },
      suggestedVendorReasoning: { type: String },
      processedAt: { type: Date },
      modelUsed: { type: String },
      accepted: { type: Boolean },
    },
    availabilityInfo: {
      preferredDate: { type: Date },
      options: {
        type: [String],
        enum: Object.values(AvailabilityWindow),
        required: true,
        default: [],
      },
    },
    media: [
      {
        url: {
          type: String,
          validate: {
            validator: validateUrl,
            message: (props: any) => `${props.value} is not a valid URL!`,
          },
          required: true,
          default: '',
        },
        key: { type: String },
        status: {
          type: String,
          enum: ['pending', 'processing', 'active', 'inactive', 'deleted'], // if inactive it would be deleted via cron job ltr
          default: 'active',
        },
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        description: { type: String, trim: true, maxlength: 150 },
        filename: { type: String, trim: true, maxlength: 100 },
      },
    ],
    isBillable: { type: Boolean, default: false },
    assignedTechnician: {
      type: {
        _id: false,
        userId: { type: Schema.Types.ObjectId, ref: 'User' },
        name: { type: String, maxlength: 100 },
        phone: { type: String, maxlength: 20 },
        email: { type: String, maxlength: 200 },
      },
      default: undefined,
    },
    workOrder: {
      type: {
        status: {
          type: String,
          enum: Object.values(WorkOrderStatus),
        },
        scope: {
          text: { type: String, maxlength: 2000 },
          html: { type: String },
        },
        estimatedCostInCents: { type: Number, min: 0 },
        lineItems: { type: [WorkOrderLineItemSchema], default: undefined },
        submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        rejectionReason: { type: String, maxlength: 500 },
        notes: { type: String, maxlength: 500 },
        submittedAt: { type: Date },
        reviewedAt: { type: Date },
      },
      default: undefined,
    },
    workOrderHistory: {
      type: [
        {
          status: { type: String, enum: Object.values(WorkOrderStatus) },
          scope: {
            text: { type: String, maxlength: 2000 },
            html: { type: String },
          },
          estimatedCostInCents: { type: Number, min: 0 },
          lineItems: { type: [WorkOrderLineItemSchema], default: undefined },
          submittedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          reviewedBy: { type: Schema.Types.ObjectId, ref: 'User' },
          rejectionReason: { type: String, maxlength: 500 },
          notes: { type: String, maxlength: 500 },
          submittedAt: { type: Date },
          reviewedAt: { type: Date },
        },
      ],
      default: undefined,
    },
    deletedAt: { type: Date, index: true },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true, getters: true },
    toObject: { virtuals: true, getters: true },
  }
);

MaintenanceRequestSchema.plugin(uniqueValidator, { message: '{PATH} must be unique' });

MaintenanceRequestSchema.index({ cuid: 1, status: 1 });
MaintenanceRequestSchema.index({ cuid: 1, propertyId: 1 });
MaintenanceRequestSchema.index({ vendorId: 1, status: 1 });

const MaintenanceRequestModel = model<IMaintenanceRequestDocument>(
  'MaintenanceRequest',
  MaintenanceRequestSchema
);

MaintenanceRequestModel.syncIndexes();

export default MaintenanceRequestModel;
