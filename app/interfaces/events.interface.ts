import { Job } from 'bull';

import { UploadResult } from './utils.interface';

export enum EventTypes {
  PROPERTY_DOCUMENTS_UPDATE = 'update:property:documents',
  DELETE_ASSET_COMPLETED = 'delete:asset:completed',
  PROPERTY_UPDATE_FAILED = 'update:property:failed',
  DELETE_REMOTE_ASSET = 'delete:remote:asset',
  DELETE_ASSET_FAILED = 'delete:asset:failed',
  DELETE_LOCAL_ASSET = 'delete:local:asset',

  PROPERTY_CREATED = 'property:created',
  PROPERTY_DELETED = 'property:deleted',
  UPLOAD_COMPLETED = 'upload:completed',
  UPLOAD_FAILED = 'upload:failed',
  UPLOAD_ASSET = 'upload:asset',
  SYSTEM_ERROR = 'system:error',
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
};

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
