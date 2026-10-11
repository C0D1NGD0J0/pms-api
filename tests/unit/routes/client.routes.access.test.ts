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

import clientRoutes from '@routes/client.routes';

const CUID = 'client-abc-123';

const mockController = {
  updateClientProfile: jest.fn((req: Request, res: Response) =>
    res.status(200).json({ body: req.body })
  ),
};

const permissionService = new PermissionService();

interface ITestUser {
  department?: string;
  role: string;
}

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = req.headers['x-test-role'] as string;
    const department = req.headers['x-test-department'] as string | undefined;
    (req as any).container = {
      cradle: { permissionService, emitterService: { emit: jest.fn() } },
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
  app.use('/api/v1/clients', clientRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();
const fullFormSave = {
  displayName: 'Acme Renamed',
  companyProfile: { tradingName: 'New Trading' },
  settings: { lang: 'fr' },
};

const patchClient = (as: ITestUser, body: object = fullFormSave) => {
  const req = request(app).patch(`/api/v1/clients/${CUID}`).set('x-test-role', as.role);
  if (as.department) req.set('x-test-department', as.department);
  return req.send(body);
};

describe('client routes — PATCH /:cuid (update client details) access control', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([ROLES.TENANT, ROLES.VENDOR])('forbids external role %s', async (role) => {
    const res = await patchClient({ role });

    expect(res.status).toBe(403);
    expect(mockController.updateClientProfile).not.toHaveBeenCalled();
  });

  it.each([ROLES.ADMIN, ROLES.MANAGER])(
    'forbids %s (client:update is held by super-admin only)',
    async (role) => {
      const res = await patchClient({ role });

      expect(res.status).toBe(403);
      expect(mockController.updateClientProfile).not.toHaveBeenCalled();
    }
  );

  it.each(['maintenance', 'operations', 'accounting', 'security', 'management'])(
    'forbids staff in the %s department',
    async (department) => {
      const res = await patchClient({ role: ROLES.STAFF, department });

      expect(res.status).toBe(403);
      expect(mockController.updateClientProfile).not.toHaveBeenCalled();
    }
  );

  it('allows super-admin to save the account form', async () => {
    const res = await patchClient({ role: ROLES.SUPER_ADMIN });

    expect(res.status).toBe(200);
    expect(mockController.updateClientProfile).toHaveBeenCalledTimes(1);
    expect(res.body.body).toEqual(fullFormSave);
  });

  it('forbids a super-admin of another client (cuid mismatch)', async () => {
    const res = await request(app)
      .patch('/api/v1/clients/other-client-999')
      .set('x-test-role', ROLES.SUPER_ADMIN)
      .send(fullFormSave);

    expect(res.status).toBe(403);
    expect(mockController.updateClientProfile).not.toHaveBeenCalled();
  });
});
