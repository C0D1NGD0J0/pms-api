import Logger from 'bunyan';
import { Response, Request } from 'express';
import { createLogger } from '@utils/index';
import { createSession, Session } from 'better-sse';

interface IConstructor {}

export class SSEService {
  private readonly log: Logger;
  private readonly activeSessions: Map<string, Session[]> = new Map();

  constructor(_deps: IConstructor = {}) {
    this.log = createLogger('SSEService');
  }

  async connect(
    req: Request,
    res: Response,
    userId: string,
    cuid: string,
    channelType: 'personal' | 'announcement'
  ): Promise<Session> {
    try {
      const session = await createSession(req, res);
      session.state = {
        userId,
        cuid,
        channelType,
        connectedAt: new Date(),
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
    eventType: string = 'notification'
  ): Promise<boolean> {
    try {
      const plainData = data?.toObject ? data.toObject() : data;

      const sessionKey = this.getSessionKey(userId, cuid, 'personal');
      const sessions = this.activeSessions.get(sessionKey);

      if (!sessions || sessions.length === 0) {
        this.log.debug('No active sessions for user', { userId, cuid });
        return false;
      }

      this.log.debug('Sending message to user', { userId, cuid, sessionCount: sessions.length });

      let sentCount = 0;
      for (const session of sessions) {
        if (session.isConnected) {
          try {
            session.push(plainData, eventType);
            sentCount++;
          } catch (error) {
            this.log.error('Failed to push message to session', {
              error,
              userId,
              cuid,
              eventType,
            });
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

      return sentCount > 0;
    } catch (error) {
      this.log.error('Failed to send message to user', { error, userId, cuid });
      return false;
    }
  }

  async broadcastToClient(
    cuid: string,
    data: any,
    eventType: string = 'announcement'
  ): Promise<number> {
    try {
      const plainData = data?.toObject ? data.toObject() : data;

      let sentCount = 0;
      for (const [key, sessions] of this.activeSessions.entries()) {
        if (key.includes(cuid) && key.includes('announcement')) {
          for (const session of sessions) {
            if (session.isConnected) {
              session.push(plainData, eventType);
              sentCount++;
            }
          }
        }
      }

      this.log.debug('Broadcast message to client', { cuid, sentCount });
      return sentCount;
    } catch (error) {
      this.log.error('Failed to broadcast to client', { error, cuid });
      return 0;
    }
  }

  getActiveSessionCount(
    userId: string,
    cuid: string,
    channelType: 'personal' | 'announcement'
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
      this.log.info('SSE cleanup completed');
    } catch (error) {
      this.log.error('Error during SSE cleanup', { error });
    }
  }
}
