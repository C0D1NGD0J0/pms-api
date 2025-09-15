import { Job } from 'bull';

import { MailType } from './utils.interface';
import { UploadResult } from './utils.interface';

export enum EventTypes {
  PROPERTY_DOCUMENTS_UPDATE = 'update:property:documents',
  DELETE_ASSET_COMPLETED = 'delete:asset:completed',
  PROPERTY_UPDATE_FAILED = 'update:property:failed',
  DELETE_ASSET_FAILED = 'delete:asset:failed',
  DELETE_REMOTE_ASSET = 'delete:remote:asset',
  UNIT_STATUS_CHANGED = 'unit:status:changed',
  DELETE_LOCAL_ASSET = 'delete:local:asset',
  UNIT_BATCH_CREATED = 'unit:batch:created',
  PROPERTY_CREATED = 'property:created',
  PROPERTY_DELETED = 'property:deleted',
  UPLOAD_COMPLETED = 'upload:completed',
  UNIT_UNARCHIVED = 'unit:unarchived',
  UNIT_ARCHIVED = 'unit:archived',
  UPLOAD_FAILED = 'upload:failed',
  EMAIL_FAILED = 'email:failed',
  SYSTEM_ERROR = 'system:error',
  UNIT_CREATED = 'unit:created',
  UNIT_UPDATED = 'unit:updated',
  UPLOAD_ASSET = 'upload:asset',
  EMAIL_SENT = 'email:sent',
}

export type EventPayloadMap = {
  [EventTypes.DELETE_ASSET_COMPLETED]: DeleteAssetCompletedPayload;
  [EventTypes.DELETE_ASSET_FAILED]: DeleteAssetFailedPayload;
  [EventTypes.DELETE_LOCAL_ASSET]: DeleteLocalAssetPayload;
  [EventTypes.DELETE_REMOTE_ASSET]: DeleteRemoteAssetPayload;
  [EventTypes.EMAIL_FAILED]: EmailFailedPayload;
  [EventTypes.EMAIL_SENT]: EmailSentPayload;
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
};

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

export interface UploadCompletedPayload {
  results: UploadResult[];
  resourceName: string;
  resourceType: string;
  resourceId: string;
  fieldName: string;
  actorId: string;
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

export interface DeleteAssetCompletedPayload {
  deletedKeys: string[];
  failedKeys?: string[];
}

export type DeleteRemoteAssetPayload = AssetIdentifiersPayload;
export type DeleteLocalAssetPayload = AssetIdentifiersPayload;

type AssetIdentifiersPayload = string[];
