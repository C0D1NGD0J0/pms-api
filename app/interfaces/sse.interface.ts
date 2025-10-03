import { Session } from 'better-sse';
import { Response, Request } from 'express';

/**
 * Main SSE Service Interface
 */
export interface ISSEService {
  connect(
    req: Request,
    res: Response,
    userId: string,
    cuid: string,
    channelType: 'personal' | 'announcement'
  ): Promise<Session>;

  getActiveSessionCount(
    userId: string,
    cuid: string,
    channelType: 'personal' | 'announcement'
  ): number;

  sendToUser(userId: string, cuid: string, data: any, eventType?: string): Promise<boolean>;

  broadcastToClient(cuid: string, data: any, eventType?: string): Promise<number>;

  getTotalActiveConnections(): number;

  cleanup(): Promise<void>;
}
