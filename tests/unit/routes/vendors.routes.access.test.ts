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
    subscriptionEntitlements: next,
    requireFeature: () => next,
    requireActiveSubscription: next,
  };
});

// The cuid param is validated against the database; only access control is under test here.
jest.mock('@shared/validations', () => {
  const actual = jest.requireActual('@shared/validations');
  const { z } = jest.requireActual('zod');
  return {
    ...actual,
    ClientValidations: {
      ...actual.ClientValidations,
      clientIdParam: z.object({ cuid: z.string() }),
    },
  };
});

import vendorRoutes from '@routes/vendors.routes';

const CUID = 'client-abc-123';

const mockController = {
  getFilteredVendors: jest.fn((_req: Request, res: Response) => res.status(200).json({ ok: true })),
};

const permissionService = new PermissionService();

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = req.headers['x-test-role'] as string;
    const department = req.headers['x-test-department'] as string | undefined;
    (req as any).container = {
      cradle: { permissionService },
      resolve: () => mockController,
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
  app.use('/api/v1/vendors', vendorRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();

const listVendors = (role: string, department?: string) => {
  const req = request(app).get(`/api/v1/vendors/${CUID}`).set('x-test-role', role);
  if (department) req.set('x-test-department', department);
  return req;
};

describe('vendor routes — GET /:cuid (vendor list) checks vendor:list', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER])('allows %s', async (role) => {
    const res = await listVendors(role);

    expect(res.status).toBe(200);
    expect(mockController.getFilteredVendors).toHaveBeenCalledTimes(1);
  });

  it.each(['operations', 'maintenance', 'management', undefined])(
    'allows staff in the %s department',
    async (department) => {
      const res = await listVendors(ROLES.STAFF, department);

      expect(res.status).toBe(200);
    }
  );

  // accounting held user:read:any (the old check) but has no vendor grant
  it.each(['accounting', 'security'])('forbids staff in the %s department', async (department) => {
    const res = await listVendors(ROLES.STAFF, department);

    expect(res.status).toBe(403);
    expect(mockController.getFilteredVendors).not.toHaveBeenCalled();
  });

  it('forbids tenants', async () => {
    const res = await listVendors(ROLES.TENANT);

    expect(res.status).toBe(403);
  });
});
