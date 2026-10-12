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
    diskUpload: () => next,
    scanFile: next,
  };
});

// cuid/uid params are validated against the database; only routing + access control is under test.
jest.mock('@shared/validations', () => {
  const actual = jest.requireActual('@shared/validations');
  const { z } = jest.requireActual('zod');
  const cuidOnly = z.object({ cuid: z.string() });
  return {
    ...actual,
    UtilsValidations: { ...actual.UtilsValidations, cuid: cuidOnly },
    ClientValidations: { ...actual.ClientValidations, clientIdParam: cuidOnly },
    UserValidations: {
      ...actual.UserValidations,
      userUidParam: z.object({ cuid: z.string(), uid: z.string() }),
    },
  };
});

import usersRoutes from '@routes/users.routes';

const CUID = 'client-abc-123';
const TENANT_UID = 'tenant-uid-0001';
const permissionService = new PermissionService();

const respondWith = (name: string) =>
  jest.fn((req: Request, res: Response) =>
    res.status(200).json({ handler: name, params: req.params })
  );

const userController = {
  getTenantUserInfo: respondWith('getTenantUserInfo'),
  updateTenantProfile: respondWith('updateTenantProfile'),
  deactivateTenant: respondWith('deactivateTenant'),
  getClientUserInfo: respondWith('getClientUserInfo'),
};

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = (req.headers['x-test-role'] as string) || ROLES.MANAGER;
    (req as any).container = {
      cradle: { permissionService, emitterService: { emit: jest.fn() } },
      resolve: () => userController,
    };
    (req as any).context = {
      currentuser: {
        sub: `${role}-sub`,
        uid: `${role}-uid`,
        client: { cuid: CUID, role },
        clients: [{ cuid: CUID, isConnected: true }],
      },
      request: { params: { cuid: CUID }, url: req.url },
      requestId: 'req-tenant-routes',
    };
    next();
  });
  app.use('/api/v1/users', usersRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();
const tenantUrl = `/api/v1/users/${CUID}/tenants/${TENANT_UID}`;

// pms-ui edits and deactivates tenants through these routes (src/services/users/index.ts);
// they were once dropped by accident when the email-change routes were added.
describe('tenant routes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('reads a tenant', async () => {
    const res = await request(app).get(tenantUrl);
    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('getTenantUserInfo');
  });

  it('updates a tenant profile', async () => {
    const res = await request(app).patch(tenantUrl).send({});
    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('updateTenantProfile');
    expect(res.body.params.uid).toBe(TENANT_UID);
  });

  // Deactivation needs user:delete:any — admins and above, as before the routes went missing
  it('lets an admin deactivate a tenant', async () => {
    const res = await request(app).delete(tenantUrl).set('x-test-role', ROLES.ADMIN);
    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('deactivateTenant');
  });

  it.each([ROLES.MANAGER, ROLES.TENANT, ROLES.VENDOR])(
    'forbids a %s from deactivating a tenant',
    async (role) => {
      const res = await request(app).delete(tenantUrl).set('x-test-role', role);
      expect(res.status).toBe(403);
      expect(userController.deactivateTenant).not.toHaveBeenCalled();
    }
  );

  it('still serves a single client user at /:cuid/:uid', async () => {
    const res = await request(app).get(`/api/v1/users/${CUID}/some-user-uid`);
    expect(res.status).toBe(200);
    expect(res.body.handler).toBe('getClientUserInfo');
  });
});
