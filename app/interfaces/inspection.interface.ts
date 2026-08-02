import { Document, Types } from 'mongoose';

import { AIInspectionAnalysis } from './inspectionAI.interface';
import { IPromiseReturnedData, IPaginationQuery, IPaginateResult } from './utils.interface';

export enum InspectionStatus {
  IN_PROGRESS = 'in_progress',
  SCHEDULED = 'scheduled',
  SUBMITTED = 'submitted',
  CANCELLED = 'cancelled',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  DISPUTED = 'disputed',
}

export enum ConditionRating {
  EXCELLENT = 'excellent',
  GOOD = 'good',
  FAIR = 'fair',
  POOR = 'poor',
  NA = 'na',
}

export enum InspectionType {
  MOVE_OUT = 'move_out',
  MOVE_IN = 'move_in',
  ROUTINE = 'routine',
}

export const ALLOWED_INSPECTION_TRANSITIONS: Record<InspectionStatus, InspectionStatus[]> = {
  [InspectionStatus.SCHEDULED]: [InspectionStatus.IN_PROGRESS, InspectionStatus.CANCELLED],
  [InspectionStatus.IN_PROGRESS]: [InspectionStatus.SUBMITTED, InspectionStatus.CANCELLED],
  [InspectionStatus.SUBMITTED]: [
    InspectionStatus.APPROVED,
    InspectionStatus.REJECTED,
    InspectionStatus.DISPUTED,
  ],
  [InspectionStatus.REJECTED]: [InspectionStatus.IN_PROGRESS],
  [InspectionStatus.DISPUTED]: [InspectionStatus.APPROVED],
  [InspectionStatus.APPROVED]: [],
  [InspectionStatus.CANCELLED]: [],
};

export interface IInspection {
  refundInfo?: { amount: number; isRefunded: boolean };
  rejectionReason?: { text: string; html?: string };
  disputeNotes?: { text: string; html?: string };
  overallNotes?: { text: string; html?: string };
  reportDocument?: IInspectionReportDocument;
  overallCondition?: ConditionRating;
  aiAnalysis?: AIInspectionAnalysis;
  inspectorId: Types.ObjectId;
  tenantAcknowledgedAt?: Date;
  propertyId: Types.ObjectId;
  notes?: IInspectionNote[];
  media: IInspectionMedia[];
  createdBy: Types.ObjectId;
  status: InspectionStatus;
  tenantId: Types.ObjectId;
  rooms: IInspectionRoom[];
  conditionScore?: number;
  leaseId: Types.ObjectId;
  type: InspectionType;
  completedDate?: Date;
  scheduledDate: Date;
  submittedAt?: Date;
  approvedAt?: Date;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  iuid: string;
  cuid: string;
}

export interface IInspectionStats {
  byType: Record<string, number>;
  avgCompletionDays: number;
  inProgress: number;
  scheduled: number;
  submitted: number;
  cancelled: number;
  approved: number;
  rejected: number;
  disputed: number;
  total: number;
}

export interface ICreateInspection {
  overallNotes?: { text: string; html?: string };
  rooms?: Partial<IInspectionRoom>[];
  scheduledDate: string | Date;
  refundDeposit?: boolean;
  type: InspectionType;
  inspectorId?: string;
  leaseId: string;
}

export interface IInspectionMedia {
  status: 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';
  uploadedBy?: Types.ObjectId;
  description?: string;
  filename?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface IInspectionReportDocument {
  status: 'pending' | 'active' | 'inactive' | 'failed';
  generatedAt: Date;
  filename: string;
  error?: string;
  size?: number;
  url: string;
  key: string;
}

export interface IInspectionRoom {
  notes?: { text: string; html?: string };
  condition: ConditionRating;
  media: IInspectionMedia[];
  items: IInspectionItem[];
  name: string;
}

export interface IUpdateInspection {
  overallNotes?: { text: string; html?: string };
  overallCondition?: ConditionRating;
  rooms?: IInspectionRoom[];
}

export interface IListInspectionsQuery extends IPaginationQuery {
  status?: InspectionStatus;
  type?: InspectionType;
  propertyId?: string;
}

export interface IInspectionNote {
  authorId: Types.ObjectId | string;
  timestamp: Date;
  author: string;
  html?: string;
  note: string;
}

export type IInspectionListReturnData = IPromiseReturnedData<{
  inspections: IInspection[];
  pagination: IPaginateResult;
}>;

export interface IInspectionItem {
  condition: ConditionRating;
  notes?: string;
  name: string;
}

export interface IDisputeInspection {
  disputeNotes: { text: string; html?: string };
}

export interface IInspectionDocument extends IInspection, Document {}
export type IInspectionReturnData = IPromiseReturnedData<IInspection>;
