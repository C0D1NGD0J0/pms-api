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
  category: MaintenanceCategory;
  invoice?: IMaintenanceInvoice;
  locationDescription?: string;
  permissionToEnter: boolean;
  aiAnalysis?: IAIAnalysis;
  estimatedCost?: number;
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
  category: MaintenanceCategory;
  locationDescription?: string;
  permissionToEnter: boolean;
  preferredDate?: string; // ISO date string — advisory, must be in the future
  propertyId: string;
  hasPet?: boolean;
  unitId?: string;
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
  propertyId?: string;
  vendorId?: string;
  tenantId?: string;
  dateFrom?: string;
  unitId?: string;
  dateTo?: string;
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

export interface IMaintenanceStats {
  byCategory: Record<string, number>;
  byPriority: Record<string, number>;
  pendingInvoices: number;
  inProgress: number;
  completed: number;
  cancelled: number;
  pending: number;
  total: number;
  open: number;
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

export interface IInvoiceLineItem {
  unitPriceInCents: number;
  amountInCents: number;
  description: string;
  quantity: number;
}

export interface IAssignVendorPayload {
  scheduledDate?: string;
  estimatedCost?: number;
  vendorId: string;
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

export interface IDeclineAssignmentPayload {
  reason?: string;
}

export interface ICancelMaintenancePayload {
  reason?: string;
}
