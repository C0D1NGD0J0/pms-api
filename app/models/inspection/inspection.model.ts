import { z } from 'zod';
import { Schema, model } from 'mongoose';
import { generateShortUID } from '@utils/index';
import {
  IInspectionDocument,
  InspectionStatus,
  ConditionRating,
  InspectionType,
} from '@interfaces/inspection.interface';

const urlSchema = z.string().url();
const validateUrl = (v: string): boolean => {
  try {
    urlSchema.parse(v);
    return true;
  } catch {
    return false;
  }
};

const mediaSubSchema = new Schema(
  {
    url: {
      type: String,
      validate: {
        validator: validateUrl,
        message: (props: any) => `${props.value} is not a valid URL!`,
      },
      required: true,
    },
    key: { type: String },
    status: {
      type: String,
      enum: ['pending', 'processing', 'active', 'inactive', 'deleted'],
      default: 'active',
    },
    uploadedAt: { type: Date, default: Date.now },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    description: { type: String, trim: true, maxlength: 150 },
    filename: { type: String, trim: true, maxlength: 100 },
  },
  { _id: false }
);

const inspectionItemSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    condition: {
      type: String,
      enum: Object.values(ConditionRating),
      default: ConditionRating.NA,
    },
    notes: { type: String, trim: true, maxlength: 500 },
  },
  { _id: false }
);

const inspectionRoomSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    condition: {
      type: String,
      enum: Object.values(ConditionRating),
      default: ConditionRating.NA,
    },
    notes: {
      text: { type: String, trim: true, maxlength: 1000 },
      html: { type: String, trim: true },
    },
    items: [inspectionItemSchema],
    media: [mediaSubSchema],
  },
  { _id: false }
);

export const DEFAULT_INSPECTION_ROOMS = [
  {
    name: 'Living Room',
    condition: ConditionRating.NA,
    items: [
      { name: 'Walls', condition: ConditionRating.NA },
      { name: 'Floors', condition: ConditionRating.NA },
      { name: 'Ceiling', condition: ConditionRating.NA },
      { name: 'Windows', condition: ConditionRating.NA },
      { name: 'Electrical Outlets', condition: ConditionRating.NA },
    ],
    media: [],
  },
  {
    name: 'Kitchen',
    condition: ConditionRating.NA,
    items: [
      { name: 'Appliances', condition: ConditionRating.NA },
      { name: 'Countertops', condition: ConditionRating.NA },
      { name: 'Cabinets', condition: ConditionRating.NA },
      { name: 'Sink / Plumbing', condition: ConditionRating.NA },
    ],
    media: [],
  },
  {
    name: 'Bathroom',
    condition: ConditionRating.NA,
    items: [
      { name: 'Fixtures', condition: ConditionRating.NA },
      { name: 'Tiles', condition: ConditionRating.NA },
      { name: 'Plumbing', condition: ConditionRating.NA },
      { name: 'Ventilation', condition: ConditionRating.NA },
    ],
    media: [],
  },
  {
    name: 'Bedroom',
    condition: ConditionRating.NA,
    items: [
      { name: 'Walls', condition: ConditionRating.NA },
      { name: 'Floors', condition: ConditionRating.NA },
      { name: 'Ceiling', condition: ConditionRating.NA },
      { name: 'Closet', condition: ConditionRating.NA },
      { name: 'Windows', condition: ConditionRating.NA },
    ],
    media: [],
  },
];

const inspectionSchema = new Schema<IInspectionDocument>(
  {
    iuid: {
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
    type: {
      type: String,
      enum: Object.values(InspectionType),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(InspectionStatus),
      default: InspectionStatus.SCHEDULED,
      index: true,
    },
    leaseId: { type: Schema.Types.ObjectId, ref: 'Lease', required: true, index: true },
    propertyId: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    inspectorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scheduledDate: { type: Date, required: true },
    completedDate: { type: Date },
    submittedAt: { type: Date },
    approvedAt: { type: Date },
    tenantAcknowledgedAt: { type: Date },
    disputeNotes: {
      text: { type: String, trim: true, maxlength: 2000 },
      html: { type: String, trim: true },
    },
    rejectionReason: {
      text: { type: String, trim: true, maxlength: 2000 },
      html: { type: String, trim: true },
    },
    refundInfo: {
      type: new Schema(
        {
          amount: { type: Number, min: 0, required: true },
          isRefunded: { type: Boolean, default: false },
        },
        { _id: false }
      ),
      default: undefined,
    },
    overallCondition: { type: String, enum: Object.values(ConditionRating) },
    conditionScore: { type: Number, min: 0, max: 100 },
    overallNotes: {
      text: { type: String, trim: true, maxlength: 2000 },
      html: { type: String, trim: true },
    },
    notes: [
      {
        note: { type: String, required: true, maxlength: 2000 },
        html: { type: String, maxlength: 2000 },
        author: { type: String, required: true },
        authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
        timestamp: { type: Date, default: Date.now, required: true },
        _id: false,
      },
    ],
    rooms: [inspectionRoomSchema],
    media: [mediaSubSchema],
    aiAnalysis: {
      type: Schema.Types.Mixed,
      default: undefined,
    },
    reportDocument: {
      url: { type: String },
      key: { type: String },
      filename: { type: String },
      size: { type: Number, min: 0 },
      status: {
        type: String,
        enum: ['pending', 'active', 'inactive', 'failed'],
        default: 'pending',
      },
      generatedAt: { type: Date },
      error: { type: String, default: null },
    },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

inspectionSchema.index({ cuid: 1, propertyId: 1, status: 1 });
inspectionSchema.index({ cuid: 1, deletedAt: 1 });
inspectionSchema.index({ cuid: 1, leaseId: 1 });
inspectionSchema.index({ cuid: 1, tenantId: 1 });

const InspectionModel = model<IInspectionDocument>('Inspection', inspectionSchema);
export default InspectionModel;
