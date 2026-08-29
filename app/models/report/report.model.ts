import { Schema, model } from 'mongoose';
import {
  MAX_REPORT_EMAIL_RECIPIENTS,
  IReportScheduleDocument,
  ScheduleFrequency,
  IReportDocument,
  REPORT_SECTIONS,
  ReportPeriod,
  ReportStatus,
} from '@interfaces/report.interface';

// ─── Report (generated report artifact) ─────────────────────────────
const reportSchema = new Schema<IReportDocument>(
  {
    cuid: {
      type: String,
      required: [true, 'Client ID is required'],
      immutable: true,
    },
    requestedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    period: {
      type: String,
      enum: Object.values(ReportPeriod),
      required: true,
    },
    status: {
      type: String,
      enum: Object.values(ReportStatus),
      default: ReportStatus.PENDING,
      index: true,
    },
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },
    propertyId: { type: String },
    sections: {
      type: [String],
      enum: REPORT_SECTIONS,
      default: [...REPORT_SECTIONS],
      validate: {
        validator: (v: string[]) => v.length >= 1,
        message: 'At least one section is required',
      },
    },
    emailRecipients: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= MAX_REPORT_EMAIL_RECIPIENTS,
        message: `Cannot exceed ${MAX_REPORT_EMAIL_RECIPIENTS} email recipients`,
      },
    },
    file: {
      url: { type: String },
      key: { type: String },
      filename: { type: String },
      size: { type: Number },
      mimeType: { type: String, default: 'application/pdf' },
      uploadedAt: { type: Date },
    },
    failedReason: { type: String },
    completedAt: { type: Date },
    scheduledBy: { type: Schema.Types.ObjectId, ref: 'ReportSchedule' },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

reportSchema.index({ cuid: 1, status: 1 });
reportSchema.index({ cuid: 1, createdAt: -1 });

// ─── ReportSchedule (recurring report config — one per client) ──────
const reportScheduleSchema = new Schema<IReportScheduleDocument>(
  {
    cuid: {
      type: String,
      required: [true, 'Client ID is required'],
      immutable: true,
      unique: true,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    frequency: {
      type: String,
      enum: Object.values(ScheduleFrequency),
      required: true,
    },
    sections: {
      type: [String],
      enum: REPORT_SECTIONS,
      default: [...REPORT_SECTIONS],
      validate: {
        validator: (v: string[]) => v.length >= 1,
        message: 'At least one section is required',
      },
    },
    emailRecipients: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= MAX_REPORT_EMAIL_RECIPIENTS,
        message: `Cannot exceed ${MAX_REPORT_EMAIL_RECIPIENTS} email recipients`,
      },
    },
    propertyId: { type: String },
    nextRunAt: { type: Date, required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, toJSON: { virtuals: true }, toObject: { virtuals: true } }
);

const Report = model<IReportDocument>('Report', reportSchema);
const ReportSchedule = model<IReportScheduleDocument>('ReportSchedule', reportScheduleSchema);

Report.syncIndexes();
ReportSchedule.syncIndexes();

export { ReportSchedule };
export default Report;
