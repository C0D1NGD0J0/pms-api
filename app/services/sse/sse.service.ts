import Redis from 'ioredis';
import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
import { envVariables } from '@shared/config';
import { createSession, Session } from 'better-sse';

interface IConstructor {}

export class SSEService {
  private readonly log: Logger;
  private readonly activeSessions: Map<string, Session[]> = new Map();
  private readonly redisPub: Redis;
  private readonly redisSub: Redis;

  constructor(_deps: IConstructor = {}) {
    this.log = createLogger('SSEService');
    const redisUrl = envVariables.REDIS.URL;
    this.redisPub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
    this.redisSub = new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: null });
    this._subscribeToRedis();
  }

  private _subscribeToRedis(): void {
    this.redisSub.subscribe('pms:sse:events', (err) => {
      if (err) this.log.error('SSE Redis subscribe failed', { err });
    });

    this.redisSub.on('message', (_channel: string, raw: string) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'user') {
          this._localSendToUser(msg.userId, msg.cuid, msg.data, msg.eventType, msg.eventId);
        } else if (msg.type === 'broadcast') {
          this._localBroadcastToClient(
            msg.cuid,
            msg.data,
            msg.eventType,
            msg.eventId,
            msg.targetRoles
          );
        }
      } catch (err) {
        this.log.error('SSE Redis message parse error', { err });
      }
    });
  }

  async connect(
    req: Request,
    res: Response,
    userId: string,
    cuid: string,
    channelType: 'individual' | 'announcement',
    userRole?: string
  ): Promise<Session> {
    try {
      const session = await createSession(req, res);
      session.state = {
        userId,
        cuid,
        channelType,
        connectedAt: new Date(),
        userRole,
      };

      const sessionKey = this.getSessionKey(userId, cuid, channelType);
      const existingSessions = this.activeSessions.get(sessionKey) || [];
      existingSessions.push(session);
      this.activeSessions.set(sessionKey, existingSessions);

      session.on('disconnected', () => {
        this.handleDisconnect(session, sessionKey);
      });
      return session;
    } catch (error) {
      this.log.error('Failed to create SSE connection', { error, userId, cuid });
      throw error;
    }
  }

  async sendToUser(
    userId: string,
    cuid: string,
    data: any,
    eventType: string = 'notification',
    eventId?: string
  ): Promise<boolean> {
    const plainData = data?.toObject ? data.toObject() : data;
    await this.redisPub.publish(
      'pms:sse:events',
      JSON.stringify({ type: 'user', userId, cuid, data: plainData, eventType, eventId })
    );
    return true;
  }

  async broadcastToClient(
    cuid: string,
    data: any,
    eventType: string = 'announcement',
    eventId?: string,
    targetRoles?: string[]
  ): Promise<number> {
    const plainData = data?.toObject ? data.toObject() : data;
    await this.redisPub.publish(
      'pms:sse:events',
      JSON.stringify({ type: 'broadcast', cuid, data: plainData, eventType, eventId, targetRoles })
    );
    return 1;
  }

  private _localSendToUser(
    userId: string,
    cuid: string,
    data: any,
    eventType: string,
    eventId?: string
  ): void {
    try {
      const sessionKey = this.getSessionKey(userId, cuid, 'individual');
      const sessions = this.activeSessions.get(sessionKey);

      if (!sessions || sessions.length === 0) {
        this.log.debug('No active sessions for user', { userId, cuid });
        return;
      }

      let sentCount = 0;
      for (const session of sessions) {
        if (session.isConnected) {
          try {
            if (eventId) {
              session.push(data, eventType, eventId);
            } else {
              session.push(data, eventType);
            }
            sentCount++;
          } catch (error) {
            this.log.error('Failed to push message to session', { error, userId, cuid, eventType });
          }
        } else {
          this.log.warn('Session not connected, skipping', { userId, cuid });
        }
      }

      this.log.info('Message sent to user sessions', {
        userId,
        cuid,
        eventType,
        totalSessions: sessions.length,
        sentToSessions: sentCount,
      });
    } catch (error) {
      this.log.error('Failed to send message to user', { error, userId, cuid });
    }
  }

  private _localBroadcastToClient(
    cuid: string,
    data: any,
    eventType: string,
    eventId?: string,
    targetRoles?: string[]
  ): void {
    try {
      let sentCount = 0;
      for (const [key, sessions] of this.activeSessions.entries()) {
        if (key.includes(cuid) && key.includes('announcement')) {
          for (const session of sessions) {
            if (!session.isConnected) continue;
            if (targetRoles?.length) {
              const sessionRole = (session.state as any)?.userRole;
              if (!sessionRole || !targetRoles.includes(sessionRole)) continue;
            }
            if (eventId) {
              session.push(data, eventType, eventId);
            } else {
              session.push(data, eventType);
            }
            sentCount++;
          }
        }
      }
      this.log.debug('Broadcast message to client', { cuid, sentCount, targetRoles });
    } catch (error) {
      this.log.error('Failed to broadcast to client', { error, cuid });
    }
  }

  getActiveSessionCount(
    userId: string,
    cuid: string,
    channelType: 'individual' | 'announcement'
  ): number {
    const sessionKey = this.getSessionKey(userId, cuid, channelType);
    const sessions = this.activeSessions.get(sessionKey) || [];
    return sessions.filter((s) => s.isConnected).length;
  }

  getTotalActiveConnections(): number {
    let total = 0;
    for (const sessions of this.activeSessions.values()) {
      total += sessions.filter((s) => s.isConnected).length;
    }
    return total;
  }

  private getSessionKey(userId: string, cuid: string, channelType: string): string {
    return `${cuid}:${userId}:${channelType}`;
  }

  private handleDisconnect(session: Session, sessionKey: string): void {
    try {
      const sessions = this.activeSessions.get(sessionKey) || [];
      const updatedSessions = sessions.filter((s) => s !== session);

      if (updatedSessions.length === 0) {
        this.activeSessions.delete(sessionKey);
      } else {
        this.activeSessions.set(sessionKey, updatedSessions);
      }

      this.log.debug('Session cleanup completed', {
        sessionKey,
        remainingSessions: updatedSessions.length,
      });
    } catch (error) {
      this.log.error('Error handling disconnect', { error, sessionKey });
    }
  }

  async cleanup(): Promise<void> {
    try {
      this.log.info('Cleaning up all SSE sessions', {
        totalSessions: this.getTotalActiveConnections(),
      });
      this.activeSessions.clear();
      await Promise.all([this.redisPub.quit(), this.redisSub.quit()]);
      this.log.info('SSE cleanup completed');
    } catch (error) {
      this.log.error('Error during SSE cleanup', { error });
    }
  }
}
