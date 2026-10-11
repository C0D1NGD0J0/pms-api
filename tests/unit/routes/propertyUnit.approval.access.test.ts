import request from 'supertest';
import { Types } from 'mongoose';
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
    requireActiveSubscription: next,
    diskUpload: () => next,
    scanFile: next,
  };
});

// The puid param is checked against the DI container; the unit in the URL exists
jest.mock('@di/setup', () => ({
  container: {
    cradle: {
      propertyDAO: { findFirst: () => Promise.resolve({ id: 'property-id' }) },
      propertyUnitDAO: {
        findFirst: (query: { puid?: string }) =>
          Promise.resolve(query.puid ? { puid: query.puid } : null),
      },
    },
  },
}));

import propertyUnitRoutes from '@routes/propertyUnit.routes';

const CUID = 'client-abc-123';
const PID = 'PID-123';
const PUID = 'PUID-123';
const OTHER_MANAGER_ID = new Types.ObjectId().toString();

const mockController = {
  approveUnitChanges: jest.fn((req: Request, res: Response) =>
    res.status(200).json({ handledBy: 'approveUnitChanges', body: req.body })
  ),
  rejectUnitChanges: jest.fn((req: Request, res: Response) =>
    res.status(200).json({ handledBy: 'rejectUnitChanges', body: req.body })
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
    const role = (req.headers['x-test-role'] as string) || ROLES.TENANT;
    const department = req.headers['x-test-department'] as string | undefined;
    (req as any).container = {
      cradle: {
        permissionService,
        emitterService: { emit: jest.fn() },
        propertyDAO: {
          findFirst: jest.fn(() =>
            Promise.resolve({ managedBy: OTHER_MANAGER_ID, assignedStaff: [] })
          ),
        },
      },
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
  app.use('/api/v1/properties/:cuid/:pid/units', propertyUnitRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();
const base = `/api/v1/properties/${CUID}/${PID}/units/${PUID}`;

const send = (url: string, as: ITestUser, body: object) => {
  const req = request(app).post(url).set('x-test-role', as.role);
  if (as.department) req.set('x-test-department', as.department);
  return req.send(body);
};

const reviewRoutes = [
  {
    label: 'approve',
    url: `${base}/approve`,
    body: { notes: 'Looks right' },
    handler: 'approveUnitChanges' as const,
  },
  {
    label: 'reject',
    url: `${base}/reject`,
    body: { reason: 'Rent is above market' },
    handler: 'rejectUnitChanges' as const,
  },
];

describe('property unit approval routes — access control', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([
    { role: ROLES.TENANT },
    { role: ROLES.VENDOR },
    // management staff may edit units (their high-impact edits wait for approval) but not review
    { role: ROLES.STAFF, department: 'management' },
    { role: ROLES.STAFF, department: 'operations' },
    { role: ROLES.STAFF, department: 'security' },
  ])('$role $department', (user) => {
    it.each(reviewRoutes)('is forbidden from $label', async ({ url, body }) => {
      const res = await send(url, user, body);

      expect(res.status).toBe(403);
      expect(mockController.approveUnitChanges).not.toHaveBeenCalled();
      expect(mockController.rejectUnitChanges).not.toHaveBeenCalled();
    });
  });

  describe.each([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER])('%s', (role) => {
    it.each(reviewRoutes)('is allowed to $label', async ({ url, body, handler }) => {
      const res = await send(url, { role }, body);

      expect(res.status).toBe(200);
      expect(mockController[handler]).toHaveBeenCalledTimes(1);
      expect(res.body.body).toEqual(body);
    });
  });

  describe('request bodies', () => {
    it('requires a rejection reason', async () => {
      const res = await send(`${base}/reject`, { role: ROLES.ADMIN }, { reason: '   ' });

      expect(res.status).toBe(422);
      expect(mockController.rejectUnitChanges).not.toHaveBeenCalled();
    });

    it('accepts an approval without notes and strips unknown fields', async () => {
      const res = await send(
        `${base}/approve`,
        { role: ROLES.ADMIN },
        { pendingChanges: { unitType: 'storage' } }
      );

      expect(res.status).toBe(200);
      expect(res.body.body).toEqual({});
    });
  });
});
