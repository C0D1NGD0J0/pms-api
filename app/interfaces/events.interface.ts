import { Job } from 'bull';

import { UploadResult } from './utils.interface';
import { ResourceInfo, MailType } from './utils.interface';
import {
  LeaseESignatureRequestedPayload,
  LeaseESignatureCompletedPayload,
  LeaseESignatureDeclinedPayload,
  LeaseESignatureFailedPayload,
  LeaseESignatureSentPayload,
  LeaseTerminatedPayload,
} from './lease.interface';

export enum EventTypes {
  LEASE_ESIGNATURE_REQUESTED = 'lease:esignature:requested',
  LEASE_ESIGNATURE_COMPLETED = 'lease:esignature:completed',
  PAYMENT_PROCESSOR_VERIFIED = 'payment:processor:verified',
  LEASE_ESIGNATURE_DECLINED = 'lease:esignature:declined',
  PROPERTY_DOCUMENTS_UPDATE = 'update:property:documents',
  PAYMENT_DISPUTE_CREATED = 'payment:dispute:created',
  PDF_GENERATION_REQUESTED = 'pdf:generation:requested',
  LEASE_ESIGNATURE_FAILED = 'lease:esignature:failed',
  LEASE_RENEWAL_REQUESTED = 'lease:renewal:requested',
  PAYMENT_DISPUTE_WON = 'payment:dispute:won',
  PROPERTY_UPDATE_FAILED = 'update:property:failed',
  DELETE_ASSET_COMPLETED = 'delete:asset:completed',
  PAYMENT_SUCCEEDED = 'payment:succeeded',
  USER_SIGNUP_INITIATED = 'user:signup:initiated',
  LEASE_ESIGNATURE_SENT = 'lease:esignature:sent',
  PDF_GENERATION_FAILED = 'pdf:generation:failed',
  PAYMENT_REFUNDED = 'payment:refunded',
  PAYMENT_FAILED = 'payment:failed',
  INVITATION_ACCEPTED = 'invitation:accepted',
  DELETE_ASSET_FAILED = 'delete:asset:failed',
  DELETE_REMOTE_ASSET = 'delete:remote:asset',
  UNIT_STATUS_CHANGED = 'unit:status:changed',
  INVITATION_EXPIRED = 'invitation:expired',
  INVITATION_REVOKED = 'invitation:revoked',
  DELETE_LOCAL_ASSET = 'delete:local:asset',
  UNIT_BATCH_CREATED = 'unit:batch:created',
  LEASE_TERMINATED = 'lease:terminated',
  PROPERTY_CREATED = 'property:created',
  PROPERTY_DELETED = 'property:deleted',
  UPLOAD_COMPLETED = 'upload:completed',
  INVITATION_SENT = 'invitation:sent',
  USER_UNARCHIVED = 'user:unarchived',
  UNIT_UNARCHIVED = 'unit:unarchived',
  USER_ARCHIVED = 'user:archived',
  PDF_GENERATED = 'pdf:generated',
  LEASE_RENEWED = 'lease:renewed',
  UNIT_ARCHIVED = 'unit:archived',
  UPLOAD_FAILED = 'upload:failed',
  JOB_COMPLETED = 'job:completed',
  EMAIL_FAILED = 'email:failed',
  SYSTEM_ERROR = 'system:error',
  UNIT_CREATED = 'unit:created',
  UNIT_UPDATED = 'unit:updated',
  UPLOAD_ASSET = 'upload:asset',
  JOB_STARTED = 'job:started',
  EMAIL_SENT = 'email:sent',
  JOB_FAILED = 'job:failed',
}

export type EventPayloadMap = {
  [EventTypes.LEASE_ESIGNATURE_REQUESTED]: LeaseESignatureRequestedPayload;
  [EventTypes.LEASE_ESIGNATURE_SENT]: LeaseESignatureSentPayload;
  [EventTypes.LEASE_ESIGNATURE_FAILED]: LeaseESignatureFailedPayload;
  [EventTypes.LEASE_ESIGNATURE_COMPLETED]: LeaseESignatureCompletedPayload;
  [EventTypes.LEASE_ESIGNATURE_DECLINED]: LeaseESignatureDeclinedPayload;
  [EventTypes.LEASE_TERMINATED]: LeaseTerminatedPayload;
  [EventTypes.DELETE_ASSET_COMPLETED]: DeleteAssetCompletedPayload;
  [EventTypes.DELETE_ASSET_FAILED]: DeleteAssetFailedPayload;
  [EventTypes.DELETE_LOCAL_ASSET]: DeleteLocalAssetPayload;
  [EventTypes.DELETE_REMOTE_ASSET]: DeleteRemoteAssetPayload;
  [EventTypes.EMAIL_FAILED]: EmailFailedPayload;
  [EventTypes.EMAIL_SENT]: EmailSentPayload;
  [EventTypes.JOB_COMPLETED]: JobNotificationPayload;
  [EventTypes.JOB_FAILED]: JobNotificationPayload;
  [EventTypes.JOB_STARTED]: JobNotificationPayload;
  [EventTypes.PDF_GENERATED]: PdfGeneratedPayload;
  [EventTypes.PDF_GENERATION_FAILED]: PdfGenerationFailedPayload;
  [EventTypes.PDF_GENERATION_REQUESTED]: PdfGenerationRequestedPayload;
  [EventTypes.PROPERTY_CREATED]: any;
  [EventTypes.PROPERTY_DELETED]: any;
  [EventTypes.PROPERTY_DOCUMENTS_UPDATE]: PropertyUpdatedPayload;
  [EventTypes.PROPERTY_UPDATE_FAILED]: any;
  [EventTypes.SYSTEM_ERROR]: SystemErrorPayload;
  [EventTypes.UNIT_ARCHIVED]: UnitChangedPayload;
  [EventTypes.UNIT_BATCH_CREATED]: UnitBatchChangedPayload;
  [EventTypes.UNIT_CREATED]: UnitChangedPayload;
  [EventTypes.UNIT_STATUS_CHANGED]: UnitChangedPayload;
  [EventTypes.UNIT_UNARCHIVED]: UnitChangedPayload;
  [EventTypes.UNIT_UPDATED]: UnitChangedPayload;
  [EventTypes.UPLOAD_ASSET]: any;
  [EventTypes.UPLOAD_COMPLETED]: UploadCompletedPayload;
  [EventTypes.UPLOAD_FAILED]: UploadFailedPayload;
  [EventTypes.LEASE_RENEWED]: LeaseRenewedPayload;
  [EventTypes.USER_SIGNUP_INITIATED]: UserSignupInitiatedPayload;
  [EventTypes.INVITATION_SENT]: InvitationEventPayload;
  [EventTypes.INVITATION_ACCEPTED]: InvitationEventPayload;
  [EventTypes.INVITATION_EXPIRED]: InvitationEventPayload;
  [EventTypes.INVITATION_REVOKED]: InvitationEventPayload;
  [EventTypes.USER_ARCHIVED]: UserArchivePayload;
  [EventTypes.USER_UNARCHIVED]: UserArchivePayload;
  [EventTypes.LEASE_RENEWAL_REQUESTED]: LeaseRenewalRequestedPayload;
  [EventTypes.PAYMENT_PROCESSOR_VERIFIED]: PaymentProcessorVerifiedPayload;
  [EventTypes.PAYMENT_DISPUTE_CREATED]: PaymentDisputeCreatedPayload;
  [EventTypes.PAYMENT_DISPUTE_WON]: PaymentDisputeWonPayload;
  [EventTypes.PAYMENT_SUCCEEDED]: PaymentSucceededPayload;
  [EventTypes.PAYMENT_FAILED]: PaymentFailedPayload;
  [EventTypes.PAYMENT_REFUNDED]: PaymentRefundedPayload;
};

export interface UserSignupInitiatedPayload {
  billingInterval: 'monthly' | 'annual'; // Billing frequency
  subscriptionId: string; // MongoDB ObjectId of created subscription
  planLookUpKey: string; // Optional Stripe plan lookup key
  planName: string; // 'personal' | 'starter' | 'professional'
  clientId: string; // MongoDB ObjectId of client/organization
  planId: string; // Stripe price ID (required for paid plans)
  userId: string; // MongoDB ObjectId of user
  email: string; // User email (required for Stripe customer creation)
}

export interface UnitChangedPayload {
  changeType: 'created' | 'updated' | 'archived' | 'unarchived' | 'status_changed';
  previousStatus?: string; // For status changes
  propertyPid: string; // Frontend-friendly property ID
  propertyId: string; // MongoDB ObjectId as string
  newStatus?: string; // For status changes
  unitId?: string; // Unit ID (for updates/status changes)
  userId: string; // User who made the change
  cuid: string; // Client ID
}

export interface JobNotificationPayload {
  metadata?: {
    totalItems?: number;
    processedItems?: number;
    successCount?: number;
    failedCount?: number;
    errors?: Array<{ item: string; error: string }>;
    message?: string;
    [key: string]: any; // Allow job-specific fields
  };
  jobType: JobType;
  progress: number; // 0-100
  stage: JobStage;
  userId: string;
  jobId: string;
  cuid: string;
}

export interface IEventBus {
  publishEvent<T extends keyof EventPayloadMap>(
    eventType: T,
    payload: EventPayloadMap[T],
    options?: {
      delay?: number;
      priority?: number;
      userId?: string;
      source?: string;
    }
  ): Promise<Job<any>>;

  subscribeToEvent<T extends keyof EventPayloadMap>(
    eventType: T,
    handler: (data: any) => Promise<void>
  ): void;
}

export interface UnitBatchChangedPayload {
  unitsCreated: number; // Number of units created
  propertyPid: string; // Frontend-friendly property ID
  unitsFailed: number; // Number of units that failed to create
  propertyId: string; // MongoDB ObjectId as string
  userId: string; // User who made the change
  cuid: string; // Client ID
}

export interface LeaseRenewedPayload {
  originalLeaseId: string;
  propertyUnitId?: string;
  renewalLeaseId: string;
  approvalStatus: string;
  monthlyRent: number;
  propertyId: string;
  tenantId: string;
  startDate: Date;
  status: string;
  endDate: Date;
  cuid: string;
}

export interface InvitationEventPayload {
  invitationId: string; // MongoDB ObjectId of invitation
  inviteeEmail: string; // Email of person invited
  clientId: string; // MongoDB ObjectId of client
  role: string; // Role being invited to
  cuid: string; // Client unique ID
}

export interface UploadCompletedPayload {
  senderInfo?: {
    email: string;
    name: string;
  };
  results: UploadResult[];
  resourceName: string;
  resourceType: string;
  resourceId: string;
  fieldName: string;
  actorId: string;
}

export interface PdfGeneratedPayload {
  senderInfo?: {
    email: string;
    name: string;
  };
  generationTime?: number;
  jobId: string | number;
  fileSize?: number;
  leaseId: string;
  pdfUrl: string;
  s3Key: string;
}

export interface LeaseRenewalRequestedPayload {
  renewalTermMonths?: number;
  propertyUnitId?: string;
  requestedBy: string;
  propertyId: string;
  tenantId: string;
  leaseId: string;
  luid: string;
  cuid: string;
}

export interface SystemErrorPayload {
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  originalEvent?: EventTypes;
  resourceType?: string;
  resourceId?: string;
  context?: any;
}

export interface PaymentDisputeCreatedPayload {
  invoiceNumber: string;
  disputeId: string;
  chargeId: string;
  currency: string;
  pytuid: string;
  amount: number;
  reason: string;
  cuid: string;
}

export interface PdfGenerationRequestedPayload {
  senderInfo?: {
    email: string;
    name: string;
  };
  jobId: string | number;
  resource: ResourceInfo;
  templateType?: string;
  cuid: string;
}

// Generic background job notification payload
export type JobType =
  | 'csv_invitation'
  | 'csv_bulk_user'
  | 'file_upload'
  | 'video_processing'
  | 'image_processing'
  | 'document_processing'
  | 'report_generation'
  | 'bulk_operation';

export interface EmailFailedPayload {
  error: {
    message: string;
    code?: string;
  };
  jobData: Record<string, any>;
  emailType: MailType;
  subject: string;
  to: string;
}

export interface PaymentDisputeWonPayload {
  invoiceNumber: string;
  disputeId: string;
  chargeId: string;
  currency: string;
  pytuid: string;
  amount: number;
  cuid: string;
}

export interface UploadFailedPayload {
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  resourceType: string;
  resourceId: string;
}
export interface PropertyUpdatedPayload {
  updateType: 'documents' | 'details' | 'status';
  propertyId: string;
  status: 'success';
}

export interface UserArchivePayload {
  archivedBy: string;
  createdAt: Date;
  roles: string[];
  userId: string;
  cuid: string;
}

export interface PaymentSucceededPayload {
  invoiceId: string;
  pytuid: string;
  amount: number;
  cuid: string;
  paidAt: Date;
}

export interface PaymentRefundedPayload {
  refundAmount: number;
  chargeId: string;
  pytuid: string;
  cuid: string;
}

export interface EventMetadata {
  requestId?: string;
  timestamp: number;
  source?: string;
  userId?: string;
}

export interface EventPayload<T = unknown> {
  metadata: EventMetadata;
  eventType: EventTypes;
  payload: T;
}

export interface PdfGenerationFailedPayload {
  jobId: string | number;
  resourceId: string;
  error: string;
}

export interface PaymentProcessorVerifiedPayload {
  accountId: string;
  verifiedAt: Date;
  cuid: string;
}

// Generic email event payloads
export interface EmailSentPayload {
  jobData: Record<string, any>;
  emailType: MailType;
  sentAt: Date;
}

export interface DeleteAssetFailedPayload {
  failedKeys: string[];
  userId?: string;
  reason: string;
}

// ── Payment domain events ────────────────────────────────────────────────────

export interface DeleteAssetCompletedPayload {
  deletedKeys: string[];
  failedKeys?: string[];
}

export interface PaymentFailedPayload {
  invoiceId: string;
  pytuid: string;
  cuid: string;
}

export type DeleteRemoteAssetPayload = AssetIdentifiersPayload;

export type DeleteLocalAssetPayload = AssetIdentifiersPayload;

export type JobStage = 'started' | 'completed' | 'failed';

type AssetIdentifiersPayload = string[];
