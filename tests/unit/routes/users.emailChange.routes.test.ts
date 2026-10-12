import request from 'supertest';
import { ROLES } from '@shared/constants/roles.constants';
import express, { NextFunction, Response, Request } from 'express';
import { PermissionService } from '@services/permission/permission.service';

jest.mock('@shared/middlewares', () => {
  const actual = jest.requireActual('@shared/middlewares');
  const next = (_req: unknown, _res: unknown, done: () => void) => done();
  return {
    ...actual,
    isAuthenticated: next,
    basicLimiter: () => next,
  };
});

// The cuid param is validated against the database; only routing + access control is under test.
jest.mock('@shared/validations', () => {
  const actual = jest.requireActual('@shared/validations');
  const { z } = jest.requireActual('zod');
  const cuidOnly = z.object({ cuid: z.string() });
  return {
    ...actual,
    UtilsValidations: { ...actual.UtilsValidations, cuid: cuidOnly },
    ClientValidations: { ...actual.ClientValidations, clientIdParam: cuidOnly },
  };
});

import authRoutes from '@routes/auth.routes';
import usersRoutes from '@routes/users.routes';

const CUID = 'client-abc-123';
const TENANT_UID = 'tenant-uid-0001';
const permissionService = new PermissionService();

const respondWith = (name: string) =>
  jest.fn((req: Request, res: Response) =>
    res.status(200).json({ handler: name, params: req.params, body: req.body, query: req.query })
  );

const userController = {
  requestEmailChange: respondWith('request'),
  cancelEmailChange: respondWith('cancel'),
};
const authController = { confirmEmailChange: respondWith('confirm') };

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = (req.headers['x-test-role'] as string) || ROLES.MANAGER;
    (req as any).container = {
      cradle: { permissionService, emitterService: { emit: jest.fn() } },
      resolve: (name: string) => (name === 'authController' ? authController : userController),
    };
    (req as any).context = {
      currentuser: {
        sub: `${role}-sub`,
        uid: `${role}-uid`,
        client: { cuid: CUID, role },
        clients: [{ cuid: CUID, isConnected: true }],
      },
      request: { params: { cuid: CUID }, url: req.url },
      requestId: 'req-email-change',
    };
    next();
  });
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();
const emailChangeUrl = (uid: string) => `/api/v1/users/${CUID}/users/${uid}/email-change`;
const tenantEmailChangeUrl = emailChangeUrl(TENANT_UID);

describe('email change routes', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('staff acting on a tenant', () => {
    it('lets a manager request (or re-send) and cancel', async () => {
      const requested = await request(app)
        .post(tenantEmailChangeUrl)
        .send({ newEmail: ' New@Example.com ', email: 'stripped@example.com' });
      expect(requested.status).toBe(200);
      expect(requested.body.params.uid).toBe(TENANT_UID);
      expect(requested.body.body).toEqual({ newEmail: 'new@example.com' });

      expect((await request(app).delete(tenantEmailChangeUrl)).body.handler).toBe('cancel');
    });

    it('rejects an invalid address before reaching the controller', async () => {
      const res = await request(app).post(tenantEmailChangeUrl).send({ newEmail: 'not-an-email' });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(userController.requestEmailChange).not.toHaveBeenCalled();
    });

    it.each([ROLES.TENANT, ROLES.VENDOR])(
      "forbids %s from changing another user's email",
      async (role) => {
        const res = await request(app)
          .post(tenantEmailChangeUrl)
          .set('x-test-role', role)
          .send({ newEmail: 'takeover@example.com' });
        expect(res.status).toBe(403);
        expect(userController.requestEmailChange).not.toHaveBeenCalled();
      }
    );
  });

  describe('own email change', () => {
    it.each([ROLES.TENANT, ROLES.VENDOR, ROLES.STAFF])(
      'allows %s to manage their own',
      async (role) => {
        const ownUrl = emailChangeUrl(`${role}-uid`);
        const res = await request(app)
          .post(ownUrl)
          .set('x-test-role', role)
          .send({ newEmail: 'me@example.com' });
        expect(res.status).toBe(200);
        expect(res.body.params.uid).toBe(`${role}-uid`);

        expect((await request(app).delete(ownUrl).set('x-test-role', role)).status).toBe(200);
      }
    );
  });

  describe('PATCH /auth/email_change/confirm', () => {
    it('passes a well-formed token to the controller', async () => {
      const token = 'ab'.repeat(32);
      const res = await request(app).patch(`/api/v1/auth/email_change/confirm?t=${token}`);
      expect(res.status).toBe(200);
      expect(res.body.query).toEqual({ t: token });
    });

    it.each(['', 'short', 'z'.repeat(64)])('rejects malformed token %p', async (token) => {
      const res = await request(app).patch(`/api/v1/auth/email_change/confirm?t=${token}`);
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(authController.confirmEmailChange).not.toHaveBeenCalled();
    });
  });
});
