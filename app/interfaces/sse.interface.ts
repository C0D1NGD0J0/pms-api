import { Session } from 'better-sse';
import { Response, Request } from 'express';

import { INotificationDocument } from './notification.interface';

/**
 * Main SSE Service
 */
export interface ISSEService {
  initializeConnection(req: Request, res: Response, sessionData: ISSESession): Promise<Session>;
  sendToUser(userId: string, cuid: string, message: ISSEMessage): Promise<boolean>;
  createAnnouncementSession(userId: string, cuid: string): Promise<ISSESession>;
  createPersonalSession(userId: string, cuid: string): Promise<ISSESession>;
  sendToChannel(channel: string, message: ISSEMessage): Promise<void>;
  cleanup(sessionId: string): Promise<void>;
}

/**
 * Redis Channel Service
 */
export interface ISSEChannelService {
  subscribeToChannels(
    channels: string[],
    callback: (channel: string, message: string) => void
  ): Promise<void>;
  getAnnouncementChannels(userId: string, cuid: string): Promise<string[]>;
  publishToChannel(channel: string, message: ISSEMessage): Promise<void>;
  getPersonalChannels(userId: string, cuid: string): string[];
}

/**
 * Simple SSE Session tracking
 */
export interface ISSESession {
  channels: string[];
  connectedAt: Date;
  session: Session;
  userId: string;
  cuid: string;
  id: string;
}

/**
 * SSE Message format
 */
export interface ISSEMessage {
  data: INotificationDocument;
  timestamp: Date;
  event: string;
  id: string;
}
