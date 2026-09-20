import jwt from 'jsonwebtoken';
import { App } from '@root/app';
import { container } from '@di/index';
import cookieParser from 'cookie-parser';
import { envVariables } from '@shared/config';
import { asyncWrapper } from '@utils/helpers';
import { DatabaseService, RedisService } from '@database/index';
import express, { Application, Response, Request } from 'express';
import { mockRequestContext } from '@tests/helpers/mockRequestContext';
import { errorHandlerMiddleware } from '@shared/middlewares/error-handler';

/**
 * Creates a test Express application for integration testing
 * This sets up the full Express app with all middleware and routes
 * but without starting the HTTP server
 */
export const createTestApp = (): Application => {
  const expApp = express();

  // Get database and redis services from container
  const dbService = container.resolve<DatabaseService>('dbService');
  const redisService = container.resolve<RedisService>('redisService');

  // Initialize the app with all middleware and routes
  const app = new App(expApp, dbService, redisService);
  app.initConfig();

  return expApp;
};

// ── Lightweight controller-test app ──────────────────────────────────────────

interface RouteDefinition {
  handler: (req: any, res: Response) => Promise<any> | any;
  /** Return the user whose context should be injected for this request. */
  contextUser: () => any;
  method: RouteMethod;
  path: string;
}

interface ControllerTestAppOptions {
  routes: RouteDefinition[];
}

type RouteMethod = 'get' | 'post' | 'put' | 'patch' | 'delete';

/**
 * Creates a lightweight Express app for controller integration tests.
 *
 * Includes:
 * - JSON body parsing + cookie parsing
 * - Stub `req.container` (empty — controller tests instantiate services manually)
 * - Each route wrapped in `asyncWrapper` (matches production routing)
 * - `errorHandlerMiddleware` registered after all routes (matches production)
 *
 * Usage:
 * ```ts
 * const { app, setContextUser } = createControllerTestApp({
 *   routes: [
 *     {
 *       method: 'get',
 *       path: '/api/v1/vendors/:cuid/vendors/stats',
 *       contextUser: () => adminUser,
 *       handler: (req, res) => vendorController.getVendorStats(req, res),
 *     },
 *   ],
 * });
 *
 * // Override context user for a specific route in one test:
 * setContextUser('/api/v1/vendors/:cuid/vendors/stats', otherUser);
 * ```
 */
export function createControllerTestApp(opts: ControllerTestAppOptions) {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    req.container = {} as any;
    next();
  });

  // Per-route user overrides — keyed by `METHOD:path`
  const overrides: Record<string, any> = {};

  for (const route of opts.routes) {
    const key = `${route.method.toUpperCase()}:${route.path}`;
    app[route.method](
      route.path,
      asyncWrapper((req: Request, res: Response) => {
        const user = key in overrides ? overrides[key] : route.contextUser();
        req.context = mockRequestContext(user, req.params.cuid) as any;
        return route.handler(req as any, res);
      })
    );
  }

  // Must be registered after all routes
  app.use(errorHandlerMiddleware);

  return {
    app,
    /**
     * Override the context user for a specific route in the current test.
     * Call with `null` (or rely on `resetContextOverrides`) to revert.
     */
    setContextUser(path: string, user: any, method: RouteMethod = 'get') {
      overrides[`${method.toUpperCase()}:${path}`] = user;
    },
    /** Clear all per-test overrides — call in `beforeEach`. */
    resetContextOverrides() {
      for (const k of Object.keys(overrides)) delete overrides[k];
    },
  };
}

/**
 * Helper to create an auth token for testing
 * Generates a properly signed JWT token for authenticated requests
 * that matches what the authentication middleware expects
 */
export const createAuthToken = (user: any): string => {
  const activeCuid = user.activecuid;
  const clientInfo = user.cuids.find((c: any) => c.cuid === activeCuid);

  // Must match the shape AuthTokenService.generateToken produces:
  // jwt.sign({ data: payload }, secret, options)
  // verifyJwtToken reads decoded.data.sub and decoded.data.cuid
  const data = {
    uid: user.uid,
    sub: user._id.toString(),
    email: user.email,
    cuid: activeCuid,
    rememberMe: false,
    client: {
      cuid: activeCuid,
      role: clientInfo?.roles[0] || 'staff',
    },
  };

  const secret = envVariables.JWT.SECRET || 'WeAreUnited4Life';
  return jwt.sign({ data }, secret, { expiresIn: '1h' });
};

/**
 * Returns a supertest-compatible cookie header string for the given token.
 * The auth middleware reads from req.cookies['accessToken'] only —
 * Authorization headers are not supported.
 */
export const authCookie = (token: string): string => `accessToken=${token}`;
