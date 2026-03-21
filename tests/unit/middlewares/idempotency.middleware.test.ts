import { NextFunction, Response } from 'express';
import { idempotency } from '@shared/middlewares';
import { AppRequest } from '@interfaces/utils.interface';

// Silence the bunyan logger created inside the middleware module
jest.mock('@utils/helpers', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn(),
  })),
}));

/** Build a minimal AppRequest-shaped object */
function buildMockRequest(overrides: Partial<AppRequest> = {}): Partial<AppRequest> {
  return {
    headers: {},
    method: 'POST',
    params: { cuid: 'cuid-test-123' },
    context: {
      currentuser: { sub: 'user-id-abc' } as any,
    } as any,
    container: {
      cradle: {
        idempotencyCache: buildMockIdempotencyCache(),
      },
    } as any,
    ...overrides,
  };
}

/** Build a minimal Response-shaped object with a writable statusCode */
function buildMockResponse(): { statusCode: number } & Partial<Response> {
  const res: any = {
    statusCode: 200,
  };
  res.status = jest.fn((code: number) => {
    res.statusCode = code;
    return res;
  });
  res.json = jest.fn(() => res);
  res.setHeader = jest.fn();
  return res;
}

/** Build a minimal mock IdempotencyCache */
function buildMockIdempotencyCache() {
  return {
    getCachedRouteResponse: jest.fn(),
    cacheRouteResponse: jest.fn(),
  };
}

describe('idempotency middleware', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
  });

  // ── Missing Idempotency-Key header ───────────────────────────────────────

  describe('when Idempotency-Key header is missing', () => {
    it('should respond with 400 and not call next()', async () => {
      // Arrange
      const req = buildMockRequest({ headers: {} });
      const res = buildMockResponse();

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Assert
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Idempotency-Key header is required',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Cache hit (duplicate request) ────────────────────────────────────────

  describe('when a cached response exists (duplicate request)', () => {
    it('should replay the cached statusCode and body without calling next()', async () => {
      // Arrange
      const cachedResponse = { statusCode: 201, body: { success: true, data: { id: 'xyz' } } };
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-key-001' },
      });
      (req.container!.cradle.idempotencyCache as any).getCachedRouteResponse.mockReturnValue(
        Promise.resolve(cachedResponse)
      );
      const res = buildMockResponse();

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Assert
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(cachedResponse.body);
      expect(next).not.toHaveBeenCalled();
    });

    it('should pass method, userId, cuid and key to getCachedRouteResponse', async () => {
      // Arrange
      const cachedResponse = { statusCode: 200, body: {} };
      const req = buildMockRequest({
        method: 'PUT',
        headers: { 'idempotency-key': 'idem-key-put' },
        params: { cuid: 'cuid-xyz' },
        context: { currentuser: { sub: 'user-999' } } as any,
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(cachedResponse));
      const res = buildMockResponse();

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Assert
      expect(cache.getCachedRouteResponse).toHaveBeenCalledWith(
        'PUT',
        'user-999',
        'cuid-xyz',
        'idem-key-put'
      );
    });
  });

  // ── Cache miss — 2xx response ─────────────────────────────────────────────

  describe('when there is no cached response (first request)', () => {
    it('should call next() on a cache miss', async () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-key-new' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(null));
      cache.cacheRouteResponse.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should intercept res.json and cache the response when statusCode is 2xx', async () => {
      // Arrange
      const req = buildMockRequest({
        method: 'POST',
        headers: { 'idempotency-key': 'idem-cache-2xx' },
        params: { cuid: 'cuid-abc' },
        context: { currentuser: { sub: 'user-abc' } } as any,
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(null));
      cache.cacheRouteResponse.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 201;

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Simulate the actual route handler sending a JSON response
      const responseBody = { success: true, data: { id: 'new-resource' } };
      (res as any).json(responseBody);

      // Allow the fire-and-forget .catch chain to settle
      await Promise.resolve();

      // Assert
      expect(cache.cacheRouteResponse).toHaveBeenCalledWith(
        'POST',
        'user-abc',
        'cuid-abc',
        'idem-cache-2xx',
        201,
        responseBody
      );
    });

    it('should still call the original res.json after intercepting', async () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-passthrough' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(null));
      cache.cacheRouteResponse.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 200;
      const originalJson = res.json as jest.Mock;

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);
      const responseBody = { success: true };
      (res as any).json(responseBody);

      // Assert — original json was called
      expect(originalJson).toHaveBeenCalledWith(responseBody);
    });
  });

  // ── Cache miss — non-2xx response ─────────────────────────────────────────

  describe('when the route returns a non-2xx status code', () => {
    it('should NOT cache the response body for 4xx responses', async () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-4xx' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(null));
      cache.cacheRouteResponse.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 422;

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);
      (res as any).json({ success: false, message: 'Validation error' });

      await Promise.resolve();

      // Assert
      expect(cache.cacheRouteResponse).not.toHaveBeenCalled();
    });

    it('should NOT cache 5xx responses', async () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-5xx' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(null));
      cache.cacheRouteResponse.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 500;

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);
      (res as any).json({ success: false, message: 'Internal error' });

      await Promise.resolve();

      // Assert
      expect(cache.cacheRouteResponse).not.toHaveBeenCalled();
    });
  });

  // ── Redis error — fail open ───────────────────────────────────────────────

  describe('when Redis throws during the cache lookup', () => {
    it('should call next() and not return an error response (fail open)', async () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-redis-err' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(
        Promise.reject(new Error('Redis connection lost'))
      );
      const res = buildMockResponse();

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Assert — middleware fails open: next() called, no 500 returned
      expect(next).toHaveBeenCalledTimes(1);
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  // ── userId / cuid fallbacks ───────────────────────────────────────────────

  describe('userId and cuid defaults', () => {
    it('should default userId to "anonymous" when no authenticated user is present', async () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-anon' },
        context: {} as any, // no currentuser
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(null));
      cache.cacheRouteResponse.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Assert
      expect(cache.getCachedRouteResponse).toHaveBeenCalledWith(
        expect.any(String),
        'anonymous',
        expect.any(String),
        'idem-anon'
      );
    });

    it('should default cuid to "global" when req.params.cuid is absent', async () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-global' },
        params: {},
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.getCachedRouteResponse.mockReturnValue(Promise.resolve(null));
      cache.cacheRouteResponse.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();

      // Act
      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // Assert
      expect(cache.getCachedRouteResponse).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'global',
        'idem-global'
      );
    });
  });
});
