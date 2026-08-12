import { Document, Types } from 'mongoose';

import { AIInspectionAnalysis } from './inspectionAI.interface';
import { IPromiseReturnedData, IPaginationQuery, IPaginateResult } from './utils.interface';

export enum InspectionStatus {
  PENDING_REVIEW = 'pending_review',
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
    InspectionStatus.PENDING_REVIEW,
    InspectionStatus.REJECTED,
    InspectionStatus.CANCELLED,
  ],
  [InspectionStatus.PENDING_REVIEW]: [InspectionStatus.APPROVED, InspectionStatus.DISPUTED],
  [InspectionStatus.REJECTED]: [InspectionStatus.IN_PROGRESS],
  [InspectionStatus.DISPUTED]: [InspectionStatus.PENDING_REVIEW],
  [InspectionStatus.APPROVED]: [],
  [InspectionStatus.CANCELLED]: [],
};

export interface IInspection {
  refundInfo?: { amount: number; proposedRefund?: number; currency: string; isRefunded: boolean };
  rejectionReason?: { text: string; html?: string };
  disputeNotes?: { text: string; html?: string };
  overallNotes?: { text: string; html?: string };
  reportDocument?: IInspectionReportDocument;
  overallCondition?: ConditionRating;
  previousOperationalStatus?: string;
  aiAnalysis?: AIInspectionAnalysis;
  propertyUnitId?: Types.ObjectId;
  tenantAcknowledgedAt?: Date;
  propertyId: Types.ObjectId;
  notes?: IInspectionNote[];
  media: IInspectionMedia[];
  createdBy: Types.ObjectId;
  tenantId?: Types.ObjectId;
  status: InspectionStatus;
  rooms: IInspectionRoom[];
  leaseId?: Types.ObjectId;
  conditionScore?: number;
  inspectorUid: string;
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

export interface ICreateInspection {
  overallNotes?: { text: string; html?: string };
  rooms?: Partial<IInspectionRoom>[];
  scheduledDate: string | Date;
  refundDeposit?: boolean;
  propertyUnitId?: string;
  inspectorId?: string;
  type: InspectionType;
  propertyId?: string;
  leaseId?: string;
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

export interface IInspectionMedia {
  status: 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';
  uploadedBy?: Types.ObjectId;
  description?: string;
  filename?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface IUpdateInspection {
  mediaToRemove?: { roomIndex: number; mediaIndex: number }[];
  overallNotes?: { text: string; html?: string };
  overallCondition?: ConditionRating;
  rooms?: IInspectionRoom[];
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
