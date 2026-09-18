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

/** Build a minimal mock IdempotencyCache with atomic claim methods */
function buildMockIdempotencyCache() {
  return {
    claimRouteRequest: jest.fn(),
    finalizeRouteRequest: jest.fn(),
    releaseRouteClaim: jest.fn(),
    // Legacy methods kept for backward compat
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
      const req = buildMockRequest({ headers: {} });
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Idempotency-Key header is required',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Completed cached response (duplicate request) ───────────────────────

  describe('when a cached response exists (duplicate request)', () => {
    it('should replay the cached statusCode and body without calling next()', async () => {
      const cachedResponse = { statusCode: 201, body: { success: true, data: { id: 'xyz' } } };
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-key-001' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve(cachedResponse));
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith(cachedResponse.body);
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Concurrent request in progress ──────────────────────────────────────

  describe('when another request with the same key is still processing', () => {
    it('should respond with 409 Conflict and not call next()', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-key-concurrent' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('processing'));
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'A request with this idempotency key is already being processed',
      });
      expect(next).not.toHaveBeenCalled();
    });
  });

  // ── Claim won — 2xx response ────────────────────────────────────────────

  describe('when the claim is won (first request)', () => {
    it('should call next() on a successful claim', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-key-new' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      cache.finalizeRouteRequest.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should intercept res.json and finalize the response when statusCode is 2xx', async () => {
      const req = buildMockRequest({
        method: 'POST',
        headers: { 'idempotency-key': 'idem-cache-2xx' },
        params: { cuid: 'cuid-abc' },
        context: { currentuser: { sub: 'user-abc' } } as any,
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      cache.finalizeRouteRequest.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 201;

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      const responseBody = { success: true, data: { id: 'new-resource' } };
      (res as any).json(responseBody);

      await Promise.resolve();

      expect(cache.finalizeRouteRequest).toHaveBeenCalledWith(
        'POST',
        undefined,
        'user-abc',
        'cuid-abc',
        'idem-cache-2xx',
        201,
        responseBody
      );
    });

    it('should still call the original res.json after intercepting', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-passthrough' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      cache.finalizeRouteRequest.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 200;
      const originalJson = res.json as jest.Mock;

      await idempotency(req as AppRequest, res as Response, next as NextFunction);
      const responseBody = { success: true };
      (res as any).json(responseBody);

      expect(originalJson).toHaveBeenCalledWith(responseBody);
    });
  });

  // ── Claim won — non-2xx response releases claim ─────────────────────────

  describe('when the route returns a non-2xx status code', () => {
    it('should release the claim for 4xx responses', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-4xx' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      cache.releaseRouteClaim.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 422;

      await idempotency(req as AppRequest, res as Response, next as NextFunction);
      (res as any).json({ success: false, message: 'Validation error' });

      await Promise.resolve();

      expect(cache.finalizeRouteRequest).not.toHaveBeenCalled();
      expect(cache.releaseRouteClaim).toHaveBeenCalled();
    });

    it('should release the claim for 5xx responses', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-5xx' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      cache.releaseRouteClaim.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();
      res.statusCode = 500;

      await idempotency(req as AppRequest, res as Response, next as NextFunction);
      (res as any).json({ success: false, message: 'Internal error' });

      await Promise.resolve();

      expect(cache.finalizeRouteRequest).not.toHaveBeenCalled();
      expect(cache.releaseRouteClaim).toHaveBeenCalled();
    });
  });

  // ── Redis error — fail closed ───────────────────────────────────────────

  describe('when Redis throws during the claim', () => {
    it('should respond with 503 and not call next() (fail closed)', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-redis-err' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.reject(new Error('Redis connection lost')));
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      expect(next).not.toHaveBeenCalled();
      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Service temporarily unavailable',
      });
    });
  });

  // ── Handler crash leaves claim to expire via TTL ────────────────────────

  describe('when the route handler throws (never calls res.json)', () => {
    it('should have called next() — the claim expires naturally via TTL', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-crash' },
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      // The middleware called next() — if the handler throws without calling
      // res.json, the intercepted json wrapper never runs. The processing
      // claim stays in Redis and expires after ROUTE_PROCESSING_LOCK_TTL (30s).
      expect(next).toHaveBeenCalledTimes(1);
      expect(cache.finalizeRouteRequest).not.toHaveBeenCalled();
      expect(cache.releaseRouteClaim).not.toHaveBeenCalled();
    });
  });

  // ── userId / cuid fallbacks ───────────────────────────────────────────────

  describe('userId and cuid defaults', () => {
    it('should default userId to "anonymous" when no authenticated user is present', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-anon' },
        context: {} as any,
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      cache.finalizeRouteRequest.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      expect(cache.claimRouteRequest).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        'anonymous',
        expect.any(String),
        'idem-anon'
      );
    });

    it('should default cuid to "global" when req.params.cuid is absent', async () => {
      const req = buildMockRequest({
        headers: { 'idempotency-key': 'idem-global' },
        params: {},
      });
      const cache = req.container!.cradle.idempotencyCache as any;
      cache.claimRouteRequest.mockReturnValue(Promise.resolve('claimed'));
      cache.finalizeRouteRequest.mockReturnValue(Promise.resolve(undefined));
      const res = buildMockResponse();

      await idempotency(req as AppRequest, res as Response, next as NextFunction);

      expect(cache.claimRouteRequest).toHaveBeenCalledWith(
        expect.any(String),
        undefined,
        expect.any(String),
        'global',
        'idem-global'
      );
    });
  });
});
