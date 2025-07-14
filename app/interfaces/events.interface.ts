import { Job } from 'bull';

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
  // Unit-related events for property occupancy sync
  UNIT_ARCHIVED = 'unit:archived',
  UPLOAD_FAILED = 'upload:failed',
  SYSTEM_ERROR = 'system:error',
  UNIT_CREATED = 'unit:created',
  UNIT_UPDATED = 'unit:updated',
  UPLOAD_ASSET = 'upload:asset',
}

export type EventPayloadMap = {
  [EventTypes.PROPERTY_CREATED]: any;
  [EventTypes.PROPERTY_DELETED]: any;
  [EventTypes.PROPERTY_DOCUMENTS_UPDATE]: PropertyUpdatedPayload;
  [EventTypes.PROPERTY_UPDATE_FAILED]: any;
  [EventTypes.UPLOAD_ASSET]: any;
  [EventTypes.UPLOAD_COMPLETED]: UploadCompletedPayload;
  [EventTypes.UPLOAD_FAILED]: UploadFailedPayload;
  [EventTypes.DELETE_LOCAL_ASSET]: DeleteLocalAssetPayload;
  [EventTypes.DELETE_REMOTE_ASSET]: DeleteRemoteAssetPayload;
  [EventTypes.DELETE_ASSET_COMPLETED]: DeleteAssetCompletedPayload;
  [EventTypes.DELETE_ASSET_FAILED]: DeleteAssetFailedPayload;
  [EventTypes.SYSTEM_ERROR]: SystemErrorPayload;
  [EventTypes.UNIT_ARCHIVED]: UnitChangedPayload;
  [EventTypes.UNIT_BATCH_CREATED]: UnitBatchChangedPayload;
  [EventTypes.UNIT_CREATED]: UnitChangedPayload;
  [EventTypes.UNIT_STATUS_CHANGED]: UnitChangedPayload;
  [EventTypes.UNIT_UNARCHIVED]: UnitChangedPayload;
  [EventTypes.UNIT_UPDATED]: UnitChangedPayload;
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

export interface UploadFailedPayload {
  error: {
    message: string;
    code?: string;
    stack?: string;
  };
  resourceType: string;
  resourceId: string;
}

export interface UploadCompletedPayload {
  results: UploadResult[];
  resourceType: string;
  resourceName: string;
  resourceId: string;
  actorId: string;
}

export interface DeleteAssetCompletedPayload {
  deletedKeys: string[];
  failedKeys?: string[]; // Optional: keys that failed to delete
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

export interface DeleteAssetFailedPayload {
  failedKeys: string[];
  userId?: string;
  reason: string;
}

export type DeleteRemoteAssetPayload = AssetIdentifiersPayload;
export type DeleteLocalAssetPayload = AssetIdentifiersPayload;

type AssetIdentifiersPayload = string[];
