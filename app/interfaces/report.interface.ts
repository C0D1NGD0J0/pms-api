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

export const MAX_REPORT_EMAIL_RECIPIENTS = 10;

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
  completedAt?: Date;
  createdAt: Date;
  startDate: Date;
  endDate: Date;
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

export interface IReportScheduleDocument extends Document {
  frequency: ScheduleFrequency;
  createdBy: Types.ObjectId;
  emailRecipients: string[];
  sections: ReportSection[];
  propertyId?: string;
  isActive: boolean;
  createdAt: Date;
  nextRunAt: Date;
  updatedAt: Date;
  cuid: string;
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

// --- Response types ---

export type IReportListReturnData = IPromiseReturnedData<{
  reports: IReportDocument[];
  pagination: IPaginateResult;
}>;

export type IReportReturnData = IPromiseReturnedData<IReportStatusResponse>;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
