import { Document, Types } from 'mongoose';

import { IPromiseReturnedData, IPaginationQuery, IPaginateResult } from './utils.interface';

export enum InspectionStatus {
  IN_PROGRESS = 'in_progress',
  SCHEDULED = 'scheduled',
  SUBMITTED = 'submitted',
  CANCELLED = 'cancelled',
  APPROVED = 'approved',
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
  [InspectionStatus.SUBMITTED]: [InspectionStatus.APPROVED, InspectionStatus.DISPUTED],
  [InspectionStatus.DISPUTED]: [InspectionStatus.APPROVED],
  [InspectionStatus.APPROVED]: [],
  [InspectionStatus.CANCELLED]: [],
};

export interface IInspection {
  overallCondition?: ConditionRating;
  propertyUnitId?: Types.ObjectId;
  inspectorId: Types.ObjectId;
  tenantAcknowledgedAt?: Date;
  propertyId: Types.ObjectId;
  media: IInspectionMedia[];
  createdBy: Types.ObjectId;
  status: InspectionStatus;
  tenantId: Types.ObjectId;
  rooms: IInspectionRoom[];
  leaseId: Types.ObjectId;
  disputeNotes?: string;
  overallNotes?: string;
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

export interface IInspectionMedia {
  status: 'pending' | 'processing' | 'active' | 'inactive' | 'deleted';
  uploadedBy: Types.ObjectId;
  description?: string;
  filename?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface ICreateInspection {
  rooms?: Partial<IInspectionRoom>[];
  scheduledDate: string | Date;
  propertyUnitId?: string;
  overallNotes?: string;
  type: InspectionType;
  inspectorId?: string;
  leaseId: string;
}

export interface IInspectionRoom {
  condition: ConditionRating;
  media: IInspectionMedia[];
  items: IInspectionItem[];
  notes?: string;
  name: string;
}

export interface IListInspectionsQuery extends IPaginationQuery {
  status?: InspectionStatus;
  type?: InspectionType;
  propertyId?: string;
}

export interface IUpdateInspection {
  overallCondition?: ConditionRating;
  rooms?: IInspectionRoom[];
  overallNotes?: string;
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

export interface IInspectionDocument extends IInspection, Document {}

export type IInspectionReturnData = IPromiseReturnedData<IInspection>;
export interface IDisputeInspection {
  disputeNotes: string;
}
