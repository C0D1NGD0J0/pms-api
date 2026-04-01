import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import uniqueValidator from 'mongoose-unique-validator';
import {
  IMaintenanceRequestDocument,
  MaintenanceRequestPriority,
  MaintenanceRequestStatus,
  MaintenanceCategory,
  AvailabilityWindow,
} from '@interfaces/maintenanceRequest.interface';

import { InvoiceSchema } from './invoice.schema';

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
    completedAt: { type: Date },
    completionNotes: { type: [CompletionNoteSchema], default: undefined },
    actualCost: { type: Number, min: 0 },
    invoice: { type: InvoiceSchema, default: undefined },
    aiAnalysis: {
      confidence: { type: Number, min: 0, max: 1 },
      reasoning: { type: String },
      suggestedVendorId: { type: Schema.Types.ObjectId, ref: 'User' },
      processedAt: { type: Date },
      modelUsed: { type: String },
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
            validator: function (v: string) {
              // Basic URL validation
              return /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})[/\w.- ]*\/?$/.test(v);
            },
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
        externalUrl: {
          type: String,
          validate: {
            validator: function (v: string) {
              // Basic URL validation
              return /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})[/\w.- ]*\/?$/.test(v);
            },
            message: (props: any) => `${props.value} is not a valid URL!`,
          },
        },
        uploadedAt: { type: Date, default: Date.now },
        uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
        description: { type: String, trim: true, maxlength: 150 },
        filename: { type: String, trim: true, maxlength: 100 },
      },
    ],
    isBillable: { type: Boolean, default: false },
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
MaintenanceRequestSchema.index({ 'invoice.status': 1, cuid: 1 });

const MaintenanceRequestModel = model<IMaintenanceRequestDocument>(
  'MaintenanceRequest',
  MaintenanceRequestSchema
);

MaintenanceRequestModel.syncIndexes();

export default MaintenanceRequestModel;
