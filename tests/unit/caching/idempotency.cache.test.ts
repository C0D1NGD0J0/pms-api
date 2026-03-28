import crypto from 'crypto';
import { IdempotencyCache } from '@caching/idempotency.cache';

// Mock createLogger so the BaseCache constructor does not blow up
jest.mock('@utils/helpers', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn(),
  })),
}));

const WEBHOOK_LOCK_TTL = 60 * 30; // 30 min processing lock
const WEBHOOK_PROCESSED_TTL = 60 * 60 * 24 * 3; // 72 hours processed status
const ROUTE_TTL = 60 * 60 * 24; // 24 hours

/** Build a minimal mock Redis client */
function buildMockClient() {
  return {
    SET: jest.fn(),
    SETEX: jest.fn(),
    GET: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
    expire: jest.fn(),
    HSET: jest.fn(),
    HGETALL: jest.fn(),
    multi: jest.fn(),
    RPUSH: jest.fn(),
    LRANGE: jest.fn(),
    LLEN: jest.fn(),
  };
}

/** Build a minimal mock RedisService that hands the client to BaseCache */
function buildMockRedisService(client: ReturnType<typeof buildMockClient>) {
  return {
    client,
    log: {
      error: jest.fn(),
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      trace: jest.fn(),
    },
  };
}

describe('IdempotencyCache', () => {
  let mockClient: ReturnType<typeof buildMockClient>;
  let cache: IdempotencyCache;

  beforeEach(() => {
    mockClient = buildMockClient();
    const redisService = buildMockRedisService(mockClient);
    cache = new IdempotencyCache({ redisService: redisService as any });
  });

  // ── claimWebhookEvent ────────────────────────────────────────────────────

  describe('claimWebhookEvent', () => {
    it('should return true when Redis SET NX returns OK (first caller wins the race)', async () => {
      // Arrange
      mockClient.SET.mockReturnValue(Promise.resolve('OK'));

      // Act
      const result = await cache.claimWebhookEvent('evt_abc123');

      // Assert
      expect(result).toBe(true);
      expect(mockClient.SET).toHaveBeenCalledWith('idmp:wh:evt_abc123', 'processing', {
        NX: true,
        EX: WEBHOOK_LOCK_TTL,
      });
    });

    it('should return false when Redis SET NX returns null (duplicate — another process already claimed it)', async () => {
      // Arrange
      mockClient.SET.mockReturnValue(Promise.resolve(null));

      // Act
      const result = await cache.claimWebhookEvent('evt_abc123');

      // Assert
      expect(result).toBe(false);
    });

    it('should use the correct key prefix idmp:wh:{eventId}', async () => {
      // Arrange
      mockClient.SET.mockReturnValue(Promise.resolve('OK'));

      // Act
      await cache.claimWebhookEvent('evt_xyz_789');

      // Assert
      expect(mockClient.SET).toHaveBeenCalledWith(
        'idmp:wh:evt_xyz_789',
        'processing',
        expect.any(Object)
      );
    });
  });

  // ── markWebhookProcessed ─────────────────────────────────────────────────

  describe('markWebhookProcessed', () => {
    it('should call SETEX with the correct key, processed value, and webhook TTL', async () => {
      // Arrange
      mockClient.SETEX.mockReturnValue(Promise.resolve('OK'));

      // Act
      await cache.markWebhookProcessed('evt_done456');

      // Assert
      expect(mockClient.SETEX).toHaveBeenCalledWith(
        'idmp:wh:evt_done456',
        WEBHOOK_PROCESSED_TTL,
        'processed'
      );
    });

    it('should overwrite the processing claim with processed status', async () => {
      // Arrange
      mockClient.SETEX.mockReturnValue(Promise.resolve('OK'));

      // Act — no error thrown means success
      await expect(cache.markWebhookProcessed('evt_overwrite')).resolves.toBeUndefined();
    });
  });

  // ── releaseWebhookClaim ──────────────────────────────────────────────────

  describe('releaseWebhookClaim', () => {
    it('should call del with the correct webhook key so retries can reclaim it', async () => {
      // Arrange
      mockClient.del.mockReturnValue(Promise.resolve(1));

      // Act
      await cache.releaseWebhookClaim('evt_release789');

      // Assert
      expect(mockClient.del).toHaveBeenCalledWith(['idmp:wh:evt_release789']);
    });

    it('should pass the key as an array (BaseCache.deleteItems signature)', async () => {
      // Arrange
      mockClient.del.mockReturnValue(Promise.resolve(1));

      // Act
      await cache.releaseWebhookClaim('evt_any');

      // Assert
      const callArg = mockClient.del.mock.calls[0][0];
      expect(Array.isArray(callArg)).toBe(true);
    });
  });

  // ── getCachedRouteResponse ───────────────────────────────────────────────

  describe('getCachedRouteResponse', () => {
    it('should return null on a cache miss (GET returns null)', async () => {
      // Arrange
      mockClient.GET.mockReturnValue(Promise.resolve(null));

      // Act
      const result = await cache.getCachedRouteResponse('POST', '/api/v1/test', 'user1', 'cuid1', 'key1');

      // Assert
      expect(result).toBeNull();
    });

    it('should return the parsed object on a cache hit', async () => {
      // Arrange
      const payload = { statusCode: 201, body: { id: 'abc', success: true } };
      mockClient.GET.mockReturnValue(Promise.resolve(JSON.stringify(payload)));

      // Act
      const result = await cache.getCachedRouteResponse('POST', '/api/v1/test', 'user1', 'cuid1', 'key1');

      // Assert
      expect(result).toEqual(payload);
      expect(result!.statusCode).toBe(201);
      expect(result!.body).toEqual({ id: 'abc', success: true });
    });

    it('should derive the Redis key from an MD5 hash of method:routePath:userId:cuid:idempotencyKey', async () => {
      // Arrange
      mockClient.GET.mockReturnValue(Promise.resolve(null));
      const method = 'PUT';
      const routePath = '/api/v1/resource';
      const userId = 'user42';
      const cuid = 'cuid99';
      const idempotencyKey = 'idem-key-xyz';

      const expectedHash = crypto
        .createHash('md5')
        .update(`${method}:${routePath}:${userId}:${cuid}:${idempotencyKey}`)
        .digest('hex');
      const expectedKey = `idmp:r:${expectedHash}`;

      // Act
      await cache.getCachedRouteResponse(method, routePath, userId, cuid, idempotencyKey);

      // Assert
      expect(mockClient.GET).toHaveBeenCalledWith(expectedKey);
    });

    it('should return null when the cached value is not valid JSON', async () => {
      // Arrange
      mockClient.GET.mockReturnValue(Promise.resolve('not-json'));

      // Act
      const result = await cache.getCachedRouteResponse('GET', '/path', 'u', 'c', 'k');

      // Assert — BaseCache.deserialize returns null for invalid JSON
      expect(result).toBeNull();
    });
  });

  // ── cacheRouteResponse ───────────────────────────────────────────────────

  describe('cacheRouteResponse', () => {
    it('should call SETEX with an MD5-hashed route key and the 24 h TTL', async () => {
      // Arrange
      mockClient.SETEX.mockReturnValue(Promise.resolve('OK'));

      const method = 'POST';
      const routePath = '/api/v1/resource';
      const userId = 'userA';
      const cuid = 'cuidB';
      const idempotencyKey = 'idem-abc';
      const statusCode = 200;
      const body = { success: true, data: { result: 42 } };

      const expectedHash = crypto
        .createHash('md5')
        .update(`${method}:${routePath}:${userId}:${cuid}:${idempotencyKey}`)
        .digest('hex');
      const expectedKey = `idmp:r:${expectedHash}`;

      // Act
      await cache.cacheRouteResponse(method, routePath, userId, cuid, idempotencyKey, statusCode, body);

      // Assert
      expect(mockClient.SETEX).toHaveBeenCalledWith(
        expectedKey,
        ROUTE_TTL,
        JSON.stringify({ statusCode, body })
      );
    });

    it('should serialize the statusCode and body together as one JSON value', async () => {
      // Arrange
      mockClient.SETEX.mockReturnValue(Promise.resolve('OK'));

      // Act
      await cache.cacheRouteResponse('DELETE', '/path', 'u', 'c', 'k', 204, null);

      // Assert
      const storedValue = mockClient.SETEX.mock.calls[0][2] as string;
      const parsed = JSON.parse(storedValue);
      expect(parsed).toEqual({ statusCode: 204, body: null });
    });

    it('should produce the same key for the same inputs (deterministic hash)', async () => {
      // Arrange
      mockClient.SETEX.mockReturnValue(Promise.resolve('OK'));

      await cache.cacheRouteResponse('POST', '/route', 'u1', 'c1', 'k1', 200, {});
      await cache.cacheRouteResponse('POST', '/route', 'u1', 'c1', 'k1', 200, {});

      // Assert — both calls should use the same key
      const key1 = mockClient.SETEX.mock.calls[0][0];
      const key2 = mockClient.SETEX.mock.calls[1][0];
      expect(key1).toBe(key2);
    });

    it('should produce different keys for different inputs', async () => {
      // Arrange
      mockClient.SETEX.mockReturnValue(Promise.resolve('OK'));

      await cache.cacheRouteResponse('POST', '/route', 'userA', 'cuid1', 'key1', 200, {});
      await cache.cacheRouteResponse('POST', '/route', 'userB', 'cuid1', 'key1', 200, {});

      // Assert
      const key1 = mockClient.SETEX.mock.calls[0][0];
      const key2 = mockClient.SETEX.mock.calls[1][0];
      expect(key1).not.toBe(key2);
    });
  });
});
