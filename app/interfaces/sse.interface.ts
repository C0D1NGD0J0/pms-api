import { Session } from 'better-sse';
import { Response, Request } from 'express';

/**
 * SSE event names become the browser's EventSource event name. EventSource silently
 * drops names it has no listener for, so this list must match the listeners in
 * pms-ui `src/store/sseNotification.store.ts`.
 *
 * "Something changed, refetch" signals do NOT get their own name — they go through
 * `resource-event` with a `resource` from SSE_RESOURCES.
 */
export const SSE_EVENT_NAMES = [
  'my-notifications',
  'announcements',
  'job-notification',
  'metrics:update',
  'resource-event',
] as const;
export type SSEEventName = (typeof SSE_EVENT_NAMES)[number];

/** Mirrored in pms-ui `src/services/events/sseContract.ts` — keep both in sync. */
export const SSE_RESOURCES = [
  'maintenance',
  'inspection',
  'lease',
  'invoice',
  'payment',
  'subscription',
  'identity',
  'payout',
  'clientSettings',
  'report',
  'guestPass',
  'invitation',
] as const;
/**
 * Delivery is fire-and-forget over Redis pub/sub: a resolved promise means the
 * message was published, not that any session received it.
 */
export interface ISSEService {
  broadcastToClient(
    cuid: string,
    data: unknown,
    eventType: Exclude<SSEEventName, 'resource-event'>,
    eventId?: string,
    targetRoles?: string[],
    targetDepartments?: string[],
    delivery?: ISSEBroadcastDelivery
  ): Promise<void>;

  connect(
    req: Request,
    res: Response,
    userId: string,
    cuid: string,
    channelType: SSEChannelType,
    userRole?: string,
    userDepartment?: string,
    preferences?: ISSEAnnouncementPreferences
  ): Promise<Session>;

  broadcastToClient(
    cuid: string,
    data: IResourceEvent,
    eventType: 'resource-event',
    eventId?: string,
    targetRoles?: string[],
    targetDepartments?: string[],
    delivery?: ISSEBroadcastDelivery
  ): Promise<void>;
  sendToUser(
    userId: string,
    cuid: string,
    data: unknown,
    eventType: Exclude<SSEEventName, 'resource-event'>,
    eventId?: string
  ): Promise<void>;

  sendToUser(
    userId: string,
    cuid: string,
    data: IResourceEvent,
    eventType: 'resource-event',
    eventId?: string
  ): Promise<void>;
  getActiveSessionCount(userId: string, cuid: string, channelType: SSEChannelType): number;

  getTotalActiveConnections(): number;

  cleanup(): Promise<void>;
}

/** Viewer preferences captured when an announcement stream connects. */
export interface ISSEAnnouncementPreferences {
  disabledCategories?: string[];
  seesAllDepartments?: boolean;
  inAppDisabled?: boolean;
}

export interface IResourceEvent {
  [key: string]: unknown;
  resource: SSEResource;
  resourceUId?: string;
  action: string;
}

/** Lets the fan-out honour preferences without looking anything up. */
export interface ISSEBroadcastDelivery {
  category?: string | null;
  required?: boolean;
}

export type SSEChannelType = 'individual' | 'announcement';

export type SSEResource = (typeof SSE_RESOURCES)[number];
