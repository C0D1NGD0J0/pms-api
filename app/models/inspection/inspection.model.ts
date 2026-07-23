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
      default: '',
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
    notes: { type: String, trim: true, maxlength: 1000 },
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
    propertyUnitId: { type: Schema.Types.ObjectId, ref: 'PropertyUnit' },
    inspectorId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    tenantId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    scheduledDate: { type: Date, required: true },
    completedDate: { type: Date },
    submittedAt: { type: Date },
    approvedAt: { type: Date },
    tenantAcknowledgedAt: { type: Date },
    disputeNotes: { type: String, trim: true, maxlength: 2000 },
    overallCondition: { type: String, enum: Object.values(ConditionRating) },
    overallNotes: { type: String, trim: true, maxlength: 2000 },
    rooms: [inspectionRoomSchema],
    media: [mediaSubSchema],
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    deletedAt: { type: Date, index: true },
  },
  { timestamps: true }
);

inspectionSchema.index({ cuid: 1, propertyId: 1, status: 1 });
inspectionSchema.index({ cuid: 1, leaseId: 1 });
inspectionSchema.index({ cuid: 1, tenantId: 1 });

const InspectionModel = model<IInspectionDocument>('Inspection', inspectionSchema);
export default InspectionModel;
