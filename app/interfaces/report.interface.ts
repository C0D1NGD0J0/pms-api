import { Document, Types } from 'mongoose';

import { IPromiseReturnedData, IPaginateResult } from './utils.interface';

export enum ReportStatus {
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  PENDING = 'pending',
  FAILED = 'failed',
}

export enum ReportPeriod {
  LAST_30_DAYS = 'last_30_days',
  LAST_90_DAYS = 'last_90_days',
  CUSTOM = 'custom',
}

export enum ScheduleFrequency {
  QUARTERLY = 'quarterly',
  MONTHLY = 'monthly',
}

export const REPORT_SECTIONS = [
  'executive_summary',
  'financial_overview',
  'payment_analysis',
  'lease_occupancy',
  'maintenance',
  'expenses',
  'tenants',
  'vendors',
  'inspections',
] as const;

// Request-level cap = the highest plan's maxReportEmails (Enterprise). The per-plan limit is
// enforced in ReportService; a test keeps this in sync with platform.config.json.
export const MAX_REPORT_EMAIL_RECIPIENTS = 25;

export interface IReportDocument extends Document {
  file?: {
    filename: string;
    key: string;
    mimeType: string;
    size: number;
    uploadedAt: Date;
    url: string;
  };
  scheduledBy?: Types.ObjectId;
  requestedBy: Types.ObjectId;
  emailRecipients: string[];
  sections: ReportSection[];
  failedReason?: string;
  period: ReportPeriod;
  status: ReportStatus;
  propertyId?: string;
  aiSummary?: string;
  completedAt?: Date;
  createdAt: Date;
  startDate: Date;
  endDate: Date;
  cuid: string;
}

export interface IReportScheduleDocument extends Document {
  consecutiveUnviewedCount: number;
  frequency: ScheduleFrequency;
  createdBy: Types.ObjectId;
  emailRecipients: string[];
  sections: ReportSection[];
  pausedReason?: string;
  propertyId: string;
  isActive: boolean;
  createdAt: Date;
  nextRunAt: Date;
  updatedAt: Date;
  cuid: string;
}

export interface IReportStatusResponse {
  sections: ReportSection[];
  failedReason?: string;
  presignedUrl?: string;
  period: ReportPeriod;
  status: ReportStatus;
  completedAt?: Date;
  filename?: string;
  expiresAt?: Date;
  reportId: string;
  createdAt: Date;
  startDate: Date;
  endDate: Date;
}
export interface IReportJobData {
  emailRecipients: string[];
  sections: ReportSection[];
  period: ReportPeriod;
  prevStartDate: Date;
  propertyId?: string;
  prevEndDate: Date;
  reportId: string;
  startDate: Date;
  userId: string;
  endDate: Date;
  cuid: string;
}
export type IReportListReturnData = IPromiseReturnedData<{
  reports: IReportListItemResponse[];
  pagination: IPaginateResult;
}>;

export type IReportScheduleResponse = WithPublicPropertyRef<IReportScheduleDocument>;

export type IReportListItemResponse = WithPublicPropertyRef<IReportDocument>;

// --- Response types ---

export type IReportReturnData = IPromiseReturnedData<IReportStatusResponse>;

export type ReportSection = (typeof REPORT_SECTIONS)[number];
// Public shapes — the stored propertyId (Mongo _id) is swapped for the property's pid.
type WithPublicPropertyRef<T extends Document> = {
  _id: Types.ObjectId;
  pid?: string;
} & Omit<T, 'propertyId' | keyof Document>;
