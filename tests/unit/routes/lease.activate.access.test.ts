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
    idempotency: next,
    requireVerifiedClient: next,
    requireActiveSubscription: next,
    diskUpload: () => next,
    scanFile: next,
  };
});

// cuid/luid params are validated against the database; only access + body validation is under test
jest.mock('@shared/validations', () => {
  const actual = jest.requireActual('@shared/validations');
  const { z } = jest.requireActual('zod');
  return {
    ...actual,
    UtilsValidations: {
      ...actual.UtilsValidations,
      cuid: z.object({ cuid: z.string() }),
      luid: z.object({ luid: z.string() }),
    },
  };
});

import leaseRoutes from '@routes/lease.routes';

const CUID = 'client-abc-123';
const LUID = 'LEASE-123';
const url = `/api/v1/leases/${CUID}/${LUID}/activate`;

const activateLease = jest.fn((req: Request, res: Response) =>
  res.status(200).json({ handledBy: 'activateLease', body: req.body })
);
const permissionService = new PermissionService();

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = (req.headers['x-test-role'] as string) || ROLES.TENANT;
    const department = req.headers['x-test-department'] as string | undefined;
    (req as any).container = {
      cradle: { permissionService, emitterService: { emit: jest.fn() } },
      resolve: () => ({ activateLease }),
    };
    (req as any).context = {
      currentuser: {
        sub: `${role}-sub`,
        uid: `${role}-uid`,
        client: { cuid: CUID, role },
        clients: [{ cuid: CUID, isConnected: true }],
        employeeInfo: department ? { department } : undefined,
      },
    };
    next();
  });
  app.use('/api/v1/leases', leaseRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();
const today = () => new Date().toISOString().split('T')[0];
const daysFromToday = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

const activate = (role: string, body: object, department?: string) => {
  const req = request(app).post(url).set('x-test-role', role);
  if (department) req.set('x-test-department', department);
  return req.send(body);
};

describe('POST /leases/:cuid/:luid/activate — access and validation', () => {
  beforeEach(() => activateLease.mockClear());

  it.each([ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN])('lets a %s activate', async (role) => {
    const res = await activate(role, { signedDate: today() });

    expect(res.status).toBe(200);
    expect(activateLease).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['staff (operations)', ROLES.STAFF, 'operations'],
    ['staff (management)', ROLES.STAFF, 'management'],
    ['tenant', ROLES.TENANT, undefined],
    ['vendor', ROLES.VENDOR, undefined],
  ])('rejects %s with 403', async (_label, role, department) => {
    const res = await activate(role, { signedDate: today() }, department);

    expect(res.status).toBe(403);
    expect(activateLease).not.toHaveBeenCalled();
  });

  it('rejects a missing signedDate', async () => {
    const res = await activate(ROLES.MANAGER, { notes: 'Signed at the office' });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'signedDate' })])
    );
    expect(activateLease).not.toHaveBeenCalled();
  });

  it('rejects a future signedDate', async () => {
    const res = await activate(ROLES.MANAGER, { signedDate: daysFromToday(3) });

    expect(res.status).toBe(422);
    expect(res.body.errors).toEqual([
      { path: 'signedDate', message: 'Signed date cannot be in the future' },
    ]);
  });

  it('parses signedBy sent as a JSON string (multipart field)', async () => {
    const signedBy = [{ name: 'Tia Tenant', email: 'tia@test.com', role: 'tenant' }];

    const res = await activate(ROLES.MANAGER, {
      signedDate: today(),
      signedBy: JSON.stringify(signedBy),
    });

    expect(res.status).toBe(200);
    expect(res.body.body.signedBy).toEqual(signedBy);
  });
});
