import { NextFunction, Response, Request } from 'express';
import { RequestSource } from '@interfaces/utils.interface';
import { contextBuilder } from '@shared/middlewares/middleware';

// ── Module-level mocks ──────────────────────────────────────────────────────

// Provide a deterministic value for generateShortUID so we can assert on it
const MOCK_GENERATED_ID = 'GENERATEDUID1';

jest.mock('@utils/index', () => ({
  generateShortUID: jest.fn(() => MOCK_GENERATED_ID),
  JWT_KEY_NAMES: { ACCESS_TOKEN: 'accessToken', REFRESH_TOKEN: 'refreshToken' },
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
    trace: jest.fn(),
  })),
  extractMulterFiles: jest.fn(),
}));

// ua-parser-js is a real parser; mock it so results are stable
jest.mock('ua-parser-js', () => ({
  UAParser: jest.fn(() => ({
    getResult: () => ({
      browser: { name: 'Chrome', version: '120' },
      os: { name: 'macOS' },
    }),
  })),
}));

// Avoid loading the DI container
jest.mock('@di/index', () => ({ container: { createScope: jest.fn() } }));

// Avoid loading shared language module
jest.mock('@shared/languages', () => ({ t: jest.fn((k: string) => k) }));

// ── Helpers ─────────────────────────────────────────────────────────────────

function buildMockRequest(
  overrides: { headers?: Record<string, string> } & Partial<Request> = {}
): Partial<Request> {
  return {
    headers: {},
    header: jest.fn((name: string) => (overrides.headers ?? {})[name]),
    method: 'GET',
    path: '/test',
    originalUrl: '/test',
    params: {},
    query: {},
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' } as any,
    context: undefined as any,
    ...overrides,
  };
}

function buildMockResponse(): { headers: Record<string, string> } & Partial<Response> {
  const headers: Record<string, string> = {};
  return {
    headers,
    setHeader: jest.fn((name: string, value: string) => {
      headers[name] = value;
    }) as any,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('contextBuilder middleware', () => {
  let next: jest.Mock;

  beforeEach(() => {
    next = jest.fn();
  });

  // ── X-Request-ID header provided ─────────────────────────────────────────

  describe('when an X-Request-ID header is provided by the caller', () => {
    it('should echo the incoming X-Request-ID back via the response header', () => {
      // Arrange
      const incomingId = 'client-provided-request-id-abc';
      const req = buildMockRequest({
        headers: { 'x-request-id': incomingId },
      });
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', incomingId);
    });

    it('should set req.context.requestId to the incoming X-Request-ID value', () => {
      // Arrange
      const incomingId = 'my-deterministic-id-xyz';
      const req = buildMockRequest({
        headers: { 'x-request-id': incomingId },
      });
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      expect((req as any).context.requestId).toBe(incomingId);
    });
  });

  // ── No X-Request-ID header ───────────────────────────────────────────────

  describe('when no X-Request-ID header is present', () => {
    it('should generate a new requestId and echo it back via the response header', () => {
      // Arrange
      const req = buildMockRequest(); // no x-request-id header
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert — the header must be present (whatever value was generated)
      expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', expect.any(String));
      const echoedId = (res.setHeader as jest.Mock).mock.calls[0][1] as string;
      expect(echoedId.length).toBeGreaterThan(0);
    });

    it('should set req.context.requestId to the generated uid', () => {
      // Arrange
      const req = buildMockRequest();
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert — mock returns MOCK_GENERATED_ID
      expect((req as any).context.requestId).toBe(MOCK_GENERATED_ID);
    });

    it('should echo the same generated id that is set on req.context', () => {
      // Arrange
      const req = buildMockRequest();
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert — echoed header and context value must match
      const contextId = (req as any).context.requestId;
      const headerValue = (res.setHeader as jest.Mock).mock.calls[0][1];
      expect(headerValue).toBe(contextId);
    });
  });

  // ── next() is always called ──────────────────────────────────────────────

  describe('control flow', () => {
    it('should always call next() on success', () => {
      // Arrange
      const req = buildMockRequest();
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      expect(next).toHaveBeenCalledTimes(1);
      expect(next).toHaveBeenCalledWith(); // no error argument
    });
  });

  // ── Context shape ────────────────────────────────────────────────────────

  describe('request context shape', () => {
    it('should set a timestamp on the context', () => {
      // Arrange
      const req = buildMockRequest();
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      expect((req as any).context.timestamp).toBeInstanceOf(Date);
    });

    it('should include request path, method, params, and query on the context', () => {
      // Arrange
      const req = buildMockRequest({
        method: 'POST',
        path: '/api/v1/resource',
        originalUrl: '/api/v1/resource?foo=bar',
        params: { cuid: 'client-123' },
        query: { foo: 'bar' } as any,
      });
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      const { request } = (req as any).context;
      expect(request.method).toBe('POST');
      expect(request.path).toBe('/api/v1/resource');
      expect(request.params).toEqual({ cuid: 'client-123' });
      expect(request.query).toEqual({ foo: 'bar' });
    });

    it('should default source to RequestSource.UNKNOWN when X-Request-Source header is absent', () => {
      // Arrange
      const req = buildMockRequest();
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      expect((req as any).context.source).toBe(RequestSource.UNKNOWN);
    });

    it('should accept a valid RequestSource value from the X-Request-Source header', () => {
      // Arrange
      const req = buildMockRequest({
        headers: { 'x-request-source': RequestSource.WEB },
      });
      // Override the header() mock to return the header value
      (req as any).header = jest.fn((name: string) => {
        if (name === 'X-Request-Source') return RequestSource.WEB;
        return undefined;
      });
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      expect((req as any).context.source).toBe(RequestSource.WEB);
    });

    it('should preserve an existing currentuser on the context if one was set before contextBuilder runs', () => {
      // Arrange
      const existingUser = { sub: 'existing-user-sub' };
      const req = buildMockRequest();
      (req as any).context = { currentuser: existingUser };
      const res = buildMockResponse();

      // Act
      contextBuilder(req as Request, res as Response, next as NextFunction);

      // Assert
      expect((req as any).context.currentuser).toEqual(existingUser);
    });
  });
});
