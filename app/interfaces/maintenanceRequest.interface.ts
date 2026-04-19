import { Document, Types } from 'mongoose';

import { MediaDocumentStatus } from './property.interface';

export enum MaintenanceCategory {
  PEST_CONTROL = 'pest_control',
  LANDSCAPING = 'landscaping',
  ELECTRICAL = 'electrical',
  STRUCTURAL = 'structural',
  APPLIANCE = 'appliance',
  PLUMBING = 'plumbing',
  COSMETIC = 'cosmetic',
  GENERAL = 'general',
  OTHER = 'other',
  HVAC = 'hvac',
}

export enum AvailabilityWindow {
  WEEKDAYS_ONLY = 'weekdays_only',
  WEEKENDS_ONLY = 'weekends_only',
  AFTERNOON = 'afternoon',
  MORNING = 'morning',
  EVENING = 'evening',
  ALL_DAY = 'all_day',
}

export enum MaintenanceRequestStatus {
  IN_PROGRESS = 'in_progress',
  CANCELLED = 'cancelled',
  COMPLETED = 'completed',
  ASSIGNED = 'assigned',
  PENDING = 'pending',
  OPEN = 'open',
}

export enum WorkOrderStatus {
  PENDING_REVIEW = 'pending_review',
  APPROVED = 'approved',
  REJECTED = 'rejected',
}

export enum MaintenanceRequestPriority {
  MEDIUM = 'medium',
  URGENT = 'urgent',
  HIGH = 'high',
  LOW = 'low',
}

export enum InvoiceStatus {
  APPROVED = 'approved',
  REJECTED = 'rejected',
  PENDING = 'pending',
}

export interface IMaintenanceRequest {
  availabilityInfo?: {
    preferredDate?: Date; // specific dates tenant prefers
    options: AvailabilityWindow[]; // when tenant is available
  };
  completionNotes?: { author: Types.ObjectId | string; note: string; createdAt: Date }[];
  description: {
    text: string;
    html?: string;
  };
  propertyUnitId?: Types.ObjectId | string;
  priority: MaintenanceRequestPriority;
  assignedBy?: Types.ObjectId | string; // User who assigned the request
  managedBy?: Types.ObjectId | string;
  propertyId: Types.ObjectId | string;
  tenantId?: Types.ObjectId | string; // User with role=tenant
  vendorId?: Types.ObjectId | string; // User with role=vendor
  status: MaintenanceRequestStatus;
  media: MaintenanceRequestMedia[];
  assignedTechnician?: ITechnician;
  workOrderHistory?: IWorkOrder[];
  category: MaintenanceCategory;
  invoice?: IMaintenanceInvoice;
  locationDescription?: string;
  permissionToEnter: boolean;
  aiAnalysis?: IAIAnalysis;
  estimatedCost?: number;
  workOrder?: IWorkOrder;
  scheduledDate?: Date;
  actualCost?: number;
  isBillable: boolean; // billing seam for expense integration
  completedAt?: Date;
  assignedAt?: Date;
  hasPet?: boolean;
  mruid: string;
  title: string;
  cuid: string;
}

export interface ICreateMaintenanceRequest {
  availabilityInfo?: {
    preferredDate?: Date; // specific dates tenant prefers
    options: AvailabilityWindow[]; // when tenant is available
  };
  description: {
    text: string;
    html?: string;
  };
  priority?: MaintenanceRequestPriority;
  media: MaintenanceRequestMedia[];
  category: MaintenanceCategory;
  locationDescription?: string;
  permissionToEnter: boolean;
  hasPet?: boolean;
  puid?: string; // property unit resource UID
  title: string;
  pid: string; // property resource UID
}

export interface ITenantMaintenanceRequestView {
  media: Array<{ url: string; filename?: string }>;
  priority: MaintenanceRequestPriority;
  timeline: IMaintenanceTimelineStep[];
  status: MaintenanceRequestStatus;
  category: MaintenanceCategory;
  propertyAddress: string;
  completionNote?: string;
  scheduledDate?: Date;
  description: string;
  unitNumber?: string;
  completedAt?: Date;
  submittedAt: Date;
  mruid: string;
  title: string;
}

export interface IMaintenanceInvoice {
  lineItems?: IInvoiceLineItem[];
  submittedBy: Types.ObjectId;
  reviewedBy?: Types.ObjectId;
  externalInvoiceUrl?: string;
  externalInvoiceId?: string;
  rejectionReason?: string;
  attachmentUrl?: string;
  attachmentKey?: string;
  status: InvoiceStatus;
  amountInCents: number;
  source: InvoiceSource;
  description: string;
  submittedAt: Date;
  reviewedAt?: Date;
  currency: string; // 'usd'
}

export interface IMaintenanceFilters {
  status?: MaintenanceRequestStatus | MaintenanceRequestStatus[];
  priority?: MaintenanceRequestPriority;
  category?: MaintenanceCategory;
  isBillable?: boolean;
  vendorUid?: string; // user resource UID of vendor
  tenantUid?: string; // user resource UID of tenant
  dateFrom?: string;
  dateTo?: string;
  puid?: string; // property unit resource UID
  pid?: string; // property resource UID
}

export interface IUpdateMaintenancePayload {
  availabilityInfo?: { preferredDate?: string; options?: AvailabilityWindow[] };
  description?: { text: string; html?: string };
  priority?: MaintenanceRequestPriority;
  category?: MaintenanceCategory;
  locationDescription?: string;
  permissionToEnter?: boolean;
  hasPet?: boolean;
  title?: string;
}

export interface IMaintenanceStats {
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  avgResolutionDays: number;
  pendingInvoices: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  assigned: number;
  pending: number;
  total: number;
  open: number;
}

export interface IWorkOrder {
  lineItems?: IWorkOrderLineItem[];
  estimatedCostInCents: number;
  submittedBy: Types.ObjectId;
  reviewedBy?: Types.ObjectId;
  rejectionReason?: string;
  status: WorkOrderStatus;
  submittedAt: Date;
  reviewedAt?: Date;
  notes?: string;
  scope: string;
}

export interface IInvoiceWebhookPayload {
  rawPayload: Record<string, unknown>;
  lineItems?: IInvoiceLineItem[];
  externalInvoiceUrl?: string;
  externalInvoiceId: string;
  source: InvoiceSource;
  description: string;
  currency: string;
  amount: number;
  mruid: string;
}

export interface MaintenanceRequestMedia {
  status: MediaDocumentStatus;
  uploadedBy: Types.ObjectId;
  _id?: Types.ObjectId;
  description?: string;
  filename?: string;
  uploadedAt: Date;
  key?: string;
  url: string;
}

export interface ISubmitInvoicePayload {
  lineItems?: IInvoiceLineItem[];
  externalInvoiceUrl?: string;
  externalInvoiceId?: string;
  source?: InvoiceSource;
  description: string;
  currency?: string;
  amount: number;
}

export interface IRespondToAssignmentPayload {
  technician?: { name: string; phone?: string; email?: string }; // optional on accept
  action: 'accept' | 'decline';
  reason?: string; // required when action === 'decline'
}

export interface IMaintenanceRequestDocument extends IMaintenanceRequest, Document {
  _id: Types.ObjectId;
  deletedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
  id: string;
}

export interface IAIAnalysis {
  suggestedVendorId?: Types.ObjectId | string;
  confidence?: number;
  reasoning?: string;
  processedAt?: Date;
  modelUsed?: string;
}

export interface IVendorStats {
  avgCompletionDays?: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  assigned: number;
  total: number;
}

export interface IMaintenanceTimelineStep {
  status: MaintenanceRequestStatus;
  reached: boolean;
  timestamp?: Date;
  label: string;
  note?: string;
}

export interface ISubmitWorkOrderPayload {
  lineItems?: IWorkOrderLineItem[];
  estimatedCostInCents: number;
  notes?: string;
  scope: string;
}

export interface IReviewInvoicePayload {
  action: 'approve' | 'reject';
  rejectionReason?: string; // required when action === 'reject'
}

export interface IWorkOrderLineItem {
  unitPriceInCents: number;
  amountInCents: number;
  description: string;
  quantity: number;
}

export interface IInvoiceLineItem {
  unitPriceInCents: number;
  amountInCents: number;
  description: string;
  quantity: number;
}

export interface IAssignVendorPayload {
  scheduledDate?: string;
  estimatedCost?: number;
  vuid: string; // vendor resource UID
}

export interface ITechnician {
  userId?: Types.ObjectId | string;
  phone?: string;
  email?: string;
  name: string;
}

export interface IReviewWorkOrderPayload {
  action: 'approve' | 'reject';
  rejectionReason?: string;
}

export interface ICompleteMaintenancePayload {
  completionNotes?: string;
  actualCost?: number;
}

export type InvoiceSource = 'manual' | 'quickbooks' | 'freshbooks' | 'jobber';

export interface IUpdateStatusPayload {
  status: MaintenanceRequestStatus;
}

export interface IRejectInvoicePayload {
  rejectionReason: string;
}

export interface ICancelMaintenancePayload {
  reason?: string;
}

export interface IDeclineAssignmentPayload {
  reason?: string;
}
