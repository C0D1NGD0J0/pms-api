// Break potential circular import chains
jest.mock('@di/index', () => ({ container: {} }));

// ── ioredis mock ──────────────────────────────────────────────────────────────
// A single shared mock instance is intentional: redisPub and redisSub call
// different methods so there is no risk of cross-contamination.
const mockPublish = jest.fn();
const mockSubscribe = jest.fn();
const mockOn = jest.fn();
const mockQuit = jest.fn();

const mockRedisInstance = {
  publish: mockPublish,
  subscribe: mockSubscribe,
  on: mockOn,
  quit: mockQuit,
};

jest.mock('ioredis', () => jest.fn(() => mockRedisInstance));

jest.mock('@shared/config', () => ({
  envVariables: { REDIS: { URL: 'redis://localhost:6379' } },
}));

jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  })),
}));

jest.mock('better-sse', () => ({
  createSession: jest.fn(),
}));

import { SSEService } from '@services/sse/sse.service';

// ── Helpers ───────────────────────────────────────────────────────────────────

type MessageHandler = (channel: string, raw: string) => void;

function getMessageHandler(): MessageHandler {
  const call = (mockOn.mock.calls as [string, MessageHandler][]).find(
    ([event]) => event === 'message'
  );
  if (!call) throw new Error('message handler was not registered');
  return call[1];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('SSEService', () => {
  let service: SSEService;

  beforeEach(() => {
    jest.clearAllMocks();

    // Ensure subscribe calls its callback synchronously so the service
    // constructor doesn't throw on a missing callback invocation.
    mockSubscribe.mockImplementation((...args: unknown[]) => {
      const cb = args[1] as (err: Error | null) => void;
      cb(null);
    });
    mockPublish.mockReturnValue(Promise.resolve(1));
    mockQuit.mockReturnValue(Promise.resolve('OK'));

    service = new SSEService();
  });

  // ── Construction ─────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('subscribes to the pms:sse:events Redis channel', () => {
      expect(mockSubscribe).toHaveBeenCalledWith('pms:sse:events', expect.any(Function));
    });

    it('registers a message handler on the subscriber connection', () => {
      expect(mockOn).toHaveBeenCalledWith('message', expect.any(Function));
    });
  });

  // ── sendToUser ────────────────────────────────────────────────────────────

  describe('sendToUser', () => {
    it('publishes a user-typed message to the SSE events channel', async () => {
      const data = { id: '123', title: 'Test notification' };
      await service.sendToUser('user-1', 'cuid-1', data, 'notification');

      expect(mockPublish).toHaveBeenCalledWith(
        'pms:sse:events',
        JSON.stringify({ type: 'user', userId: 'user-1', cuid: 'cuid-1', data, eventType: 'notification' })
      );
    });

    it('defaults eventType to "notification"', async () => {
      await service.sendToUser('user-1', 'cuid-1', {});

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).eventType).toBe('notification');
    });

    it('includes eventId in the published payload when provided', async () => {
      const eventId = '2026-01-15T10:30:00.000Z';
      await service.sendToUser('user-1', 'cuid-1', { foo: 1 }, 'my-notifications', eventId);

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).eventId).toBe(eventId);
    });

    it('omits eventId from the published payload when not provided', async () => {
      await service.sendToUser('user-1', 'cuid-1', {}, 'notification');

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).eventId).toBeUndefined();
    });

    it('serialises Mongoose documents via toObject() before publishing', async () => {
      const mongoDoc = { value: 42, toObject: () => ({ value: 42 }) };
      await service.sendToUser('user-1', 'cuid-1', mongoDoc);

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      const parsed = JSON.parse(raw);
      expect(parsed.data).toEqual({ value: 42 });
      expect(parsed.data.toObject).toBeUndefined();
    });

    it('returns true', async () => {
      const result = await service.sendToUser('user-1', 'cuid-1', {});
      expect(result).toBe(true);
    });
  });

  // ── broadcastToClient ─────────────────────────────────────────────────────

  describe('broadcastToClient', () => {
    it('publishes a broadcast-typed message to the SSE events channel', async () => {
      const data = { text: 'Scheduled maintenance tonight' };
      await service.broadcastToClient('cuid-1', data, 'announcement');

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      const parsed = JSON.parse(raw);
      expect(parsed).toMatchObject({ type: 'broadcast', cuid: 'cuid-1', data, eventType: 'announcement' });
    });

    it('includes targetRoles in the published payload when provided', async () => {
      await service.broadcastToClient('cuid-1', { msg: 'admins only' }, 'announcements', undefined, ['admin', 'staff']);

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).targetRoles).toEqual(['admin', 'staff']);
    });

    it('omits targetRoles from the published payload when not provided', async () => {
      await service.broadcastToClient('cuid-1', {});

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).targetRoles).toBeUndefined();
    });

    it('defaults eventType to "announcement"', async () => {
      await service.broadcastToClient('cuid-1', {});

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).eventType).toBe('announcement');
    });

    it('includes eventId in the published payload when provided', async () => {
      const eventId = '2026-01-15T10:30:00.000Z';
      await service.broadcastToClient('cuid-1', { msg: 'hi' }, 'announcements', eventId);

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).eventId).toBe(eventId);
    });

    it('omits eventId from the published payload when not provided', async () => {
      await service.broadcastToClient('cuid-1', {});

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      expect(JSON.parse(raw).eventId).toBeUndefined();
    });

    it('serialises Mongoose documents via toObject() before publishing', async () => {
      const mongoDoc = { msg: 'broadcast', toObject: () => ({ msg: 'broadcast' }) };
      await service.broadcastToClient('cuid-1', mongoDoc);

      const [, raw] = (mockPublish.mock.calls[0] as [string, string]);
      const parsed = JSON.parse(raw);
      expect(parsed.data).toEqual({ msg: 'broadcast' });
    });
  });

  // ── Redis message routing ─────────────────────────────────────────────────

  describe('Redis message routing', () => {
    it('routes type=user messages to _localSendToUser', () => {
      const localSend = jest.spyOn(service as any, '_localSendToUser').mockImplementation(() => undefined);
      const handler = getMessageHandler();

      handler('pms:sse:events', JSON.stringify({
        type: 'user',
        userId: 'user-1',
        cuid: 'cuid-1',
        data: { msg: 'hello' },
        eventType: 'notification',
      }));

      expect(localSend).toHaveBeenCalledWith('user-1', 'cuid-1', { msg: 'hello' }, 'notification', undefined);
    });

    it('routes type=user messages with eventId to _localSendToUser', () => {
      const localSend = jest.spyOn(service as any, '_localSendToUser').mockImplementation(() => undefined);
      const handler = getMessageHandler();
      const eventId = '2026-01-15T10:30:00.000Z';

      handler('pms:sse:events', JSON.stringify({
        type: 'user',
        userId: 'user-1',
        cuid: 'cuid-1',
        data: { msg: 'hello' },
        eventType: 'my-notifications',
        eventId,
      }));

      expect(localSend).toHaveBeenCalledWith('user-1', 'cuid-1', { msg: 'hello' }, 'my-notifications', eventId);
    });

    it('routes type=broadcast messages to _localBroadcastToClient', () => {
      const localBroadcast = jest.spyOn(service as any, '_localBroadcastToClient').mockImplementation(() => undefined);
      const handler = getMessageHandler();

      handler('pms:sse:events', JSON.stringify({
        type: 'broadcast',
        cuid: 'cuid-1',
        data: { text: 'hello everyone' },
        eventType: 'announcement',
      }));

      expect(localBroadcast).toHaveBeenCalledWith('cuid-1', { text: 'hello everyone' }, 'announcement', undefined, undefined);
    });

    it('routes type=broadcast messages with eventId to _localBroadcastToClient', () => {
      const localBroadcast = jest.spyOn(service as any, '_localBroadcastToClient').mockImplementation(() => undefined);
      const handler = getMessageHandler();
      const eventId = '2026-01-15T10:30:00.000Z';

      handler('pms:sse:events', JSON.stringify({
        type: 'broadcast',
        cuid: 'cuid-1',
        data: { text: 'hello everyone' },
        eventType: 'announcements',
        eventId,
      }));

      expect(localBroadcast).toHaveBeenCalledWith('cuid-1', { text: 'hello everyone' }, 'announcements', eventId, undefined);
    });

    it('routes type=broadcast messages with targetRoles to _localBroadcastToClient', () => {
      const localBroadcast = jest.spyOn(service as any, '_localBroadcastToClient').mockImplementation(() => undefined);
      const handler = getMessageHandler();

      handler('pms:sse:events', JSON.stringify({
        type: 'broadcast',
        cuid: 'cuid-1',
        data: { text: 'admins only' },
        eventType: 'announcements',
        targetRoles: ['admin', 'staff'],
      }));

      expect(localBroadcast).toHaveBeenCalledWith('cuid-1', { text: 'admins only' }, 'announcements', undefined, ['admin', 'staff']);
    });

    it('ignores messages with an unknown type without throwing', () => {
      jest.spyOn(service as any, '_localSendToUser').mockImplementation(() => undefined);
      jest.spyOn(service as any, '_localBroadcastToClient').mockImplementation(() => undefined);
      const handler = getMessageHandler();

      expect(() =>
        handler('pms:sse:events', JSON.stringify({ type: 'unknown', data: {} }))
      ).not.toThrow();

      expect((service as any)._localSendToUser).not.toHaveBeenCalled();
      expect((service as any)._localBroadcastToClient).not.toHaveBeenCalled();
    });

    it('does not throw on malformed JSON', () => {
      const handler = getMessageHandler();
      expect(() => handler('pms:sse:events', 'not-valid-json')).not.toThrow();
    });
  });

  // ── _localSendToUser ──────────────────────────────────────────────────────

  describe('_localSendToUser', () => {
    it('pushes the event to all connected sessions for the user', () => {
      const pushFn = jest.fn();
      const sessionKey = 'cuid-1:user-1:individual';

      // Inject a fake session directly into the private activeSessions map
      (service as any).activeSessions.set(sessionKey, [
        { isConnected: true, push: pushFn },
        { isConnected: true, push: pushFn },
      ]);

      (service as any)._localSendToUser('user-1', 'cuid-1', { data: 1 }, 'notification');

      expect(pushFn).toHaveBeenCalledTimes(2);
      expect(pushFn).toHaveBeenCalledWith({ data: 1 }, 'notification');
    });

    it('passes { id: eventId } options to session.push when eventId is provided', () => {
      const pushFn = jest.fn();
      const sessionKey = 'cuid-1:user-1:individual';
      const eventId = '2026-01-15T10:30:00.000Z';

      (service as any).activeSessions.set(sessionKey, [
        { isConnected: true, push: pushFn },
      ]);

      (service as any)._localSendToUser('user-1', 'cuid-1', { data: 1 }, 'my-notifications', eventId);

      expect(pushFn).toHaveBeenCalledWith({ data: 1 }, 'my-notifications', eventId);
    });

    it('does not pass options to session.push when eventId is absent', () => {
      const pushFn = jest.fn();
      const sessionKey = 'cuid-1:user-1:individual';

      (service as any).activeSessions.set(sessionKey, [
        { isConnected: true, push: pushFn },
      ]);

      (service as any)._localSendToUser('user-1', 'cuid-1', { data: 1 }, 'notification');

      expect(pushFn).toHaveBeenCalledWith({ data: 1 }, 'notification');
      expect(pushFn).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), expect.anything());
    });

    it('skips sessions that are no longer connected', () => {
      const pushFn = jest.fn();
      const sessionKey = 'cuid-1:user-1:individual';

      (service as any).activeSessions.set(sessionKey, [
        { isConnected: false, push: pushFn },
        { isConnected: true, push: pushFn },
      ]);

      (service as any)._localSendToUser('user-1', 'cuid-1', {}, 'notification');

      expect(pushFn).toHaveBeenCalledTimes(1);
    });

    it('does nothing when there are no sessions for the user', () => {
      // Should not throw and should not call publish
      expect(() =>
        (service as any)._localSendToUser('unknown-user', 'cuid-1', {}, 'notification')
      ).not.toThrow();
    });
  });

  // ── _localBroadcastToClient ───────────────────────────────────────────────

  describe('_localBroadcastToClient', () => {
    it('pushes the event to all announcement sessions for the client', () => {
      const pushFn = jest.fn();

      (service as any).activeSessions.set('cuid-1:user-1:announcement', [
        { isConnected: true, push: pushFn },
      ]);
      (service as any).activeSessions.set('cuid-1:user-2:announcement', [
        { isConnected: true, push: pushFn },
      ]);
      // Different cuid — should be ignored
      (service as any).activeSessions.set('cuid-2:user-1:announcement', [
        { isConnected: true, push: jest.fn() },
      ]);

      (service as any)._localBroadcastToClient('cuid-1', { msg: 'all' }, 'announcement');

      expect(pushFn).toHaveBeenCalledTimes(2);
    });

    it('does not broadcast to individual-channel sessions', () => {
      const pushFn = jest.fn();

      (service as any).activeSessions.set('cuid-1:user-1:individual', [
        { isConnected: true, push: pushFn },
      ]);

      (service as any)._localBroadcastToClient('cuid-1', {}, 'announcement');

      expect(pushFn).not.toHaveBeenCalled();
    });

    it('broadcasts to all announcement sessions when targetRoles is not set', () => {
      const pushFn = jest.fn();

      (service as any).activeSessions.set('cuid-1:user-1:announcement', [
        { isConnected: true, push: pushFn, state: { userRole: 'admin' } },
      ]);
      (service as any).activeSessions.set('cuid-1:user-2:announcement', [
        { isConnected: true, push: pushFn, state: { userRole: 'vendor' } },
      ]);

      (service as any)._localBroadcastToClient('cuid-1', { msg: 'all' }, 'announcement', undefined, undefined);

      expect(pushFn).toHaveBeenCalledTimes(2);
    });

    it('only delivers to sessions whose role is in targetRoles', () => {
      const adminPush = jest.fn();
      const vendorPush = jest.fn();

      (service as any).activeSessions.set('cuid-1:user-1:announcement', [
        { isConnected: true, push: adminPush, state: { userRole: 'admin' } },
      ]);
      (service as any).activeSessions.set('cuid-1:user-2:announcement', [
        { isConnected: true, push: vendorPush, state: { userRole: 'vendor' } },
      ]);

      (service as any)._localBroadcastToClient('cuid-1', { msg: 'pm only' }, 'announcement', undefined, ['admin', 'staff']);

      expect(adminPush).toHaveBeenCalledTimes(1);
      expect(vendorPush).not.toHaveBeenCalled();
    });

    it('skips sessions with no role when targetRoles is set', () => {
      const pushFn = jest.fn();

      (service as any).activeSessions.set('cuid-1:user-1:announcement', [
        { isConnected: true, push: pushFn }, // no session.state
      ]);

      (service as any)._localBroadcastToClient('cuid-1', {}, 'announcement', undefined, ['admin']);

      expect(pushFn).not.toHaveBeenCalled();
    });

    it('delivers to all matching roles across multiple users', () => {
      const pushFn = jest.fn();

      (service as any).activeSessions.set('cuid-1:admin-1:announcement', [
        { isConnected: true, push: pushFn, state: { userRole: 'admin' } },
      ]);
      (service as any).activeSessions.set('cuid-1:staff-1:announcement', [
        { isConnected: true, push: pushFn, state: { userRole: 'staff' } },
      ]);
      (service as any).activeSessions.set('cuid-1:vendor-1:announcement', [
        { isConnected: true, push: jest.fn(), state: { userRole: 'vendor' } },
      ]);

      (service as any)._localBroadcastToClient('cuid-1', {}, 'announcement', undefined, ['admin', 'staff']);

      expect(pushFn).toHaveBeenCalledTimes(2);
    });
  });

  // ── Session counters ──────────────────────────────────────────────────────

  describe('getActiveSessionCount', () => {
    it('returns the count of connected sessions for the given key', () => {
      (service as any).activeSessions.set('cuid-1:user-1:individual', [
        { isConnected: true },
        { isConnected: false },
        { isConnected: true },
      ]);

      expect(service.getActiveSessionCount('user-1', 'cuid-1', 'individual')).toBe(2);
    });

    it('returns 0 when no sessions are registered', () => {
      expect(service.getActiveSessionCount('nobody', 'cuid-x', 'individual')).toBe(0);
    });
  });

  describe('getTotalActiveConnections', () => {
    it('sums connected sessions across all keys', () => {
      (service as any).activeSessions.set('cuid-1:user-1:individual', [
        { isConnected: true },
        { isConnected: true },
      ]);
      (service as any).activeSessions.set('cuid-1:user-1:announcement', [
        { isConnected: false },
        { isConnected: true },
      ]);

      expect(service.getTotalActiveConnections()).toBe(3);
    });

    it('returns 0 initially', () => {
      expect(service.getTotalActiveConnections()).toBe(0);
    });
  });

  // ── cleanup ───────────────────────────────────────────────────────────────

  describe('cleanup', () => {
    it('quits both Redis connections', async () => {
      await service.cleanup();
      // One for redisPub, one for redisSub — both share mockQuit via the
      // single mock instance, so it should be called twice.
      expect(mockQuit).toHaveBeenCalledTimes(2);
    });

    it('clears all active sessions', async () => {
      (service as any).activeSessions.set('cuid-1:user-1:individual', [
        { isConnected: true },
      ]);

      await service.cleanup();

      expect(service.getTotalActiveConnections()).toBe(0);
    });
  });
});
