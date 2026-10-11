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
    requireActiveTenant: () => next,
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
    UtilsValidations: {
      ...actual.UtilsValidations,
      cuid: z.object({ cuid: z.string() }),
    },
  };
});

import { router as guestPassRoutes } from '@routes/guestpass.routes';

const CUID = 'client-abc-123';

const mockController = {
  createPass: jest.fn((req: Request, res: Response) => res.status(200).json({ body: req.body })),
  validateCode: jest.fn((req: Request, res: Response) => res.status(200).json({ body: req.body })),
  getPass: jest.fn((req: Request, res: Response) => res.status(200).json({ params: req.params })),
  getStats: jest.fn((req: Request, res: Response) => res.status(200).json({ query: req.query })),
  revokePass: jest.fn((req: Request, res: Response) => res.status(200).json({ body: req.body })),
  acknowledgePass: jest.fn((req: Request, res: Response) =>
    res.status(200).json({ params: req.params })
  ),
  bulkAcknowledge: jest.fn((req: Request, res: Response) =>
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
        tenantInfo: { activeLease: {} },
      },
    };
    next();
  });
  app.use('/api/v1/guest-passes', guestPassRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();
const createBody = {
  propertyId: 'PID123ABCDEF',
  unitId: 'PUID12345678',
  visitorName: 'Visitor',
  visitorPhone: '+15555550100',
  sendViaSms: true,
  sendViaEmail: false,
  purpose: 'Delivery',
  hostNotes: 'Leave packages at the front desk',
};

const createPass = (as: ITestUser, body: object = createBody) => {
  const req = request(app).post(`/api/v1/guest-passes/${CUID}`).set('x-test-role', as.role);
  if (as.department) req.set('x-test-department', as.department);
  return req.send(body);
};

describe('guest pass routes — POST /:cuid (create pass) access control', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.TENANT])(
    'allows %s to create a pass',
    async (role) => {
      const res = await createPass({ role });

      expect(res.status).toBe(200);
      expect(mockController.createPass).toHaveBeenCalledTimes(1);
    }
  );

  it('forbids vendors', async () => {
    const res = await createPass({ role: ROLES.VENDOR });

    expect(res.status).toBe(403);
    expect(mockController.createPass).not.toHaveBeenCalled();
  });

  // Staff (including the security department) can read/validate passes but never issue them
  it.each(['security', 'maintenance', 'operations', 'accounting', 'management'])(
    'forbids staff in the %s department',
    async (department) => {
      const res = await createPass({ role: ROLES.STAFF, department });

      expect(res.status).toBe(403);
      expect(mockController.createPass).not.toHaveBeenCalled();
    }
  );

  it('passes purpose and hostNotes through to the controller and strips undeclared fields', async () => {
    const res = await createPass(
      { role: ROLES.TENANT },
      { ...createBody, entryNotes: 'guard-only field', status: 'used' }
    );

    expect(res.status).toBe(200);
    expect(res.body.body).toMatchObject({
      purpose: 'Delivery',
      hostNotes: 'Leave packages at the front desk',
    });
    expect(res.body.body).not.toHaveProperty('entryNotes');
    expect(res.body.body).not.toHaveProperty('status');
  });
});

describe('guest pass routes — POST /:cuid/validate (gate check-in) access control', () => {
  beforeEach(() => jest.clearAllMocks());

  const validateCode = (as: ITestUser) => {
    const req = request(app)
      .post(`/api/v1/guest-passes/${CUID}/validate`)
      .set('x-test-role', as.role);
    if (as.department) req.set('x-test-department', as.department);
    return req.send({ code: '123456', propertyId: '64b7f0c2a1b2c3d4e5f60718' });
  };

  it('accepts the property pid the UI sends', async () => {
    const res = await request(app)
      .post(`/api/v1/guest-passes/${CUID}/validate`)
      .set('x-test-role', ROLES.STAFF)
      .set('x-test-department', 'security')
      .send({ code: '123456', propertyId: 'PID123ABCDEF' });

    expect(res.status).toBe(200);
    expect(res.body.body.propertyId).toBe('PID123ABCDEF');
  });

  it('allows security staff to validate a code', async () => {
    const res = await validateCode({ role: ROLES.STAFF, department: 'security' });

    expect(res.status).toBe(200);
    expect(mockController.validateCode).toHaveBeenCalledTimes(1);
  });

  it.each([ROLES.TENANT, ROLES.VENDOR])('forbids %s from validating a code', async (role) => {
    const res = await validateCode({ role });

    expect(res.status).toBe(403);
    expect(mockController.validateCode).not.toHaveBeenCalled();
  });
});

const VPUID = 'VP12345678AB';
const asRole = (req: request.Test, as: ITestUser) => {
  req.set('x-test-role', as.role);
  if (as.department) req.set('x-test-department', as.department);
  return req;
};

describe('guest pass routes — GET /:cuid/:vpuid (pass detail) access control', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    { role: ROLES.ADMIN },
    { role: ROLES.MANAGER },
    { role: ROLES.TENANT },
    { role: ROLES.STAFF, department: 'security' },
  ])('allows $role ($department) to read a pass', async (as) => {
    const res = await asRole(request(app).get(`/api/v1/guest-passes/${CUID}/${VPUID}`), as);

    expect(res.status).toBe(200);
    expect(res.body.params.vpuid).toBe(VPUID);
  });

  it('forbids vendors', async () => {
    const res = await asRole(request(app).get(`/api/v1/guest-passes/${CUID}/${VPUID}`), {
      role: ROLES.VENDOR,
    });

    expect(res.status).toBe(403);
    expect(mockController.getPass).not.toHaveBeenCalled();
  });

  it('still routes /:cuid/stats to the stats handler with the propertyId query', async () => {
    const res = await asRole(
      request(app).get(`/api/v1/guest-passes/${CUID}/stats?propertyId=PID123ABCDEF`),
      { role: ROLES.MANAGER }
    );

    expect(res.status).toBe(200);
    expect(mockController.getStats).toHaveBeenCalledTimes(1);
    expect(mockController.getPass).not.toHaveBeenCalled();
    expect(res.body.query).toEqual({ propertyId: 'PID123ABCDEF' });
  });
});

describe('guest pass routes — acknowledge by vpuid', () => {
  beforeEach(() => jest.clearAllMocks());
  const security = { role: ROLES.STAFF, department: 'security' };

  it('acknowledges a single pass by vpuid', async () => {
    const res = await asRole(
      request(app).patch(`/api/v1/guest-passes/${CUID}/${VPUID}/acknowledge`),
      security
    );

    expect(res.status).toBe(200);
    expect(res.body.params.vpuid).toBe(VPUID);
  });

  it('accepts vpuids for bulk acknowledge', async () => {
    const res = await asRole(
      request(app).post(`/api/v1/guest-passes/${CUID}/bulk-acknowledge`),
      security
    ).send({ passIds: [VPUID, 'VP87654321CD'] });

    expect(res.status).toBe(200);
    expect(res.body.body.passIds).toEqual([VPUID, 'VP87654321CD']);
  });

  it('rejects malformed pass ids', async () => {
    const res = await asRole(
      request(app).post(`/api/v1/guest-passes/${CUID}/bulk-acknowledge`),
      security
    ).send({ passIds: ['short'] });

    expect(res.status).toBe(422);
    expect(mockController.bulkAcknowledge).not.toHaveBeenCalled();
  });
});

describe('guest pass routes — DELETE /:cuid/:vpuid (revoke) reason', () => {
  beforeEach(() => jest.clearAllMocks());

  it('passes the revoke reason through to the controller', async () => {
    const res = await asRole(request(app).delete(`/api/v1/guest-passes/${CUID}/${VPUID}`), {
      role: ROLES.TENANT,
    }).send({ reason: 'Visitor cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ reason: 'Visitor cancelled' });
  });

  it('allows revoking without a body', async () => {
    const res = await asRole(request(app).delete(`/api/v1/guest-passes/${CUID}/${VPUID}`), {
      role: ROLES.MANAGER,
    });

    expect(res.status).toBe(200);
    expect(mockController.revokePass).toHaveBeenCalledTimes(1);
  });

  it('rejects a reason over 500 characters', async () => {
    const res = await asRole(request(app).delete(`/api/v1/guest-passes/${CUID}/${VPUID}`), {
      role: ROLES.MANAGER,
    }).send({ reason: 'A'.repeat(501) });

    expect(res.status).toBe(422);
  });
});
