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

// Schema refinements look the property/unit up through the DI container; only access control
// and body stripping are under test here.
jest.mock('@di/setup', () => ({
  container: {
    cradle: {
      propertyDAO: { findFirst: () => Promise.resolve({ id: 'property-id' }) },
      propertyUnitDAO: {
        // the unit in the URL exists; no other unit shares the submitted unit number
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

const controllerMethods = [
  'addUnit',
  'updateUnit',
  'updateUnitStatus',
  'setupInpection',
  'getPropertyUnits',
  'archiveUnit',
] as const;

const mockController = Object.fromEntries(
  controllerMethods.map((method) => [
    method,
    jest.fn((req: Request, res: Response) =>
      res.status(200).json({ handledBy: method, body: req.body })
    ),
  ])
) as Record<(typeof controllerMethods)[number], jest.Mock>;

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
    // The stored property's manager decides MINE vs ANY scope; default: someone else manages it
    const propertyManager = (req.headers['x-test-property-manager'] as string) || OTHER_MANAGER_ID;
    (req as any).container = {
      cradle: {
        permissionService,
        emitterService: { emit: jest.fn() },
        propertyDAO: {
          findFirst: jest.fn(() =>
            Promise.resolve({ managedBy: propertyManager, assignedStaff: [] })
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
const base = `/api/v1/properties/${CUID}/${PID}/units`;
// Unit managers are sent as user uids
const managerId = 'MANAGER00001';

const send = (
  method: 'post' | 'patch' | 'get' | 'delete',
  url: string,
  as: { managesProperty?: boolean } & ITestUser,
  body: object = {}
) => {
  const req = request(app)[method](url).set('x-test-role', as.role);
  if (as.department) req.set('x-test-department', as.department);
  if (as.managesProperty) req.set('x-test-property-manager', `${as.role}-sub`);
  return req.send(body);
};

const unitBody = {
  unitNumber: 'B1-01',
  unitType: 'residential',
  floor: -1,
  managedBy: managerId,
  specifications: { totalArea: 450, bedrooms: 1, bathrooms: 1 },
  fees: { rentAmount: 900, currency: 'USD' },
};

const routes = {
  create: {
    method: 'post' as const,
    url: base,
    body: { units: [unitBody], cuid: CUID, pid: PID },
    handler: 'addUnit' as const,
  },
  update: {
    method: 'patch' as const,
    url: `${base}/${PUID}`,
    body: {
      unitType: 'commercial',
      isActive: false,
      managedBy: managerId,
      fees: { currency: 'CAD' },
      specifications: { maxOccupants: 3 },
      floor: -2,
    },
    handler: 'updateUnit' as const,
  },
  status: {
    method: 'patch' as const,
    url: `${base}/${PUID}/status`,
    body: { status: 'maintenance' },
    handler: 'updateUnitStatus' as const,
  },
  inspection: {
    method: 'post' as const,
    url: `${base}/${PUID}/inspection`,
    body: {
      inspectionDate: '2026-11-01',
      inspector: { name: 'Jane Inspector', contact: '416-555-0100' },
      status: 'scheduled',
    },
    handler: 'setupInpection' as const,
  },
};
const writeRoutes = Object.entries(routes).map(([label, route]) => ({ label, ...route }));
const unitEditRoutes = writeRoutes.filter(({ label }) => label !== 'create');

describe('property unit routes — access control', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([
    { role: ROLES.TENANT },
    { role: ROLES.VENDOR },
    { role: ROLES.STAFF, department: 'security' }, // read-only for properties
    { role: ROLES.STAFF, department: 'maintenance' },
  ])('$role $department', (user) => {
    it.each(writeRoutes)('is forbidden from $label', async ({ method, url, body }) => {
      const res = await send(method, url, user, body);

      expect(res.status).toBe(403);
      Object.values(mockController).forEach((handler) => expect(handler).not.toHaveBeenCalled());
    });
  });

  describe.each([ROLES.ADMIN, ROLES.SUPER_ADMIN])('%s', (role) => {
    it.each(writeRoutes)('is allowed to $label', async ({ method, url, body, handler }) => {
      const res = await send(method, url, { role }, body);

      expect(res.status).toBe(200);
      expect(mockController[handler]).toHaveBeenCalledTimes(1);
    });
  });

  describe('manager (non-admin, update:any on properties)', () => {
    it.each(unitEditRoutes)('is allowed to $label', async ({ method, url, body, handler }) => {
      const res = await send(method, url, { role: ROLES.MANAGER }, body);

      expect(res.status).toBe(200);
      expect(mockController[handler]).toHaveBeenCalledTimes(1);
    });
  });

  describe('request bodies reaching the service', () => {
    it('keeps the newly editable fields and managedBy on update', async () => {
      const res = await send(
        'patch',
        routes.update.url,
        { role: ROLES.MANAGER },
        {
          ...routes.update.body,
          currentLease: new Types.ObjectId().toString(),
          cuid: 'OTHER-CUID',
        }
      );

      // managedBy reaches the service for every allowed role, which checks it is an employee of
      // this client (see propertyUnitService integration tests)
      expect(res.body.body).toEqual(routes.update.body);
    });

    it('keeps managedBy and a basement floor on create', async () => {
      const res = await send('post', routes.create.url, { role: ROLES.ADMIN }, routes.create.body);

      expect(res.body.body.units[0]).toMatchObject({ managedBy: managerId, floor: -1 });
    });

    it('rejects a floor below the lowest basement level', async () => {
      const res = await send('patch', routes.update.url, { role: ROLES.ADMIN }, { floor: -5 });

      expect(res.status).toBe(422);
      expect(mockController.updateUnit).not.toHaveBeenCalled();
    });
  });

  describe('ownership comes from the stored property, never the request body', () => {
    it('lets a manager add units to a property they manage (create:mine)', async () => {
      const res = await send(
        'post',
        routes.create.url,
        { role: ROLES.MANAGER, managesProperty: true },
        routes.create.body
      );

      expect(res.status).toBe(200);
      expect(mockController.addUnit).toHaveBeenCalledTimes(1);
    });

    it('blocks a manager from adding units to a property someone else manages', async () => {
      const res = await send(
        'post',
        routes.create.url,
        { role: ROLES.MANAGER },
        routes.create.body
      );

      expect(res.status).toBe(403);
      expect(mockController.addUnit).not.toHaveBeenCalled();
    });

    it('ignores an ownerId in the body that claims the property', async () => {
      const res = await send(
        'post',
        routes.create.url,
        { role: ROLES.MANAGER },
        { ...routes.create.body, ownerId: `${ROLES.MANAGER}-sub` }
      );

      expect(res.status).toBe(403);
      expect(mockController.addUnit).not.toHaveBeenCalled();
    });

    it('blocks a manager from archiving units on a property someone else manages', async () => {
      const res = await send(
        'delete',
        `${base}/${PUID}`,
        { role: ROLES.MANAGER },
        {
          ownerId: `${ROLES.MANAGER}-sub`,
        }
      );

      expect(res.status).toBe(403);
      expect(mockController.archiveUnit).not.toHaveBeenCalled();
    });

    it('does not let a tenant read units by claiming ownership in the body', async () => {
      const res = await send(
        'get',
        base,
        { role: ROLES.TENANT },
        { ownerId: `${ROLES.TENANT}-sub` }
      );

      expect(res.status).toBe(403);
      expect(mockController.getPropertyUnits).not.toHaveBeenCalled();
    });

    it('does not let a vendor read units by listing itself in assignedUsers', async () => {
      const res = await send(
        'get',
        base,
        { role: ROLES.VENDOR },
        {
          assignedUsers: [`${ROLES.VENDOR}-sub`],
        }
      );

      expect(res.status).toBe(403);
      expect(mockController.getPropertyUnits).not.toHaveBeenCalled();
    });
  });

  describe('staff department permissions are applied', () => {
    it('lets management staff update units', async () => {
      const res = await send(
        'patch',
        routes.status.url,
        { role: ROLES.STAFF, department: 'management' },
        routes.status.body
      );

      expect(res.status).toBe(200);
      expect(mockController.updateUnitStatus).toHaveBeenCalledTimes(1);
    });

    it('still blocks security staff, who are read-only for properties', async () => {
      const res = await send(
        'patch',
        routes.status.url,
        { role: ROLES.STAFF, department: 'security' },
        routes.status.body
      );

      expect(res.status).toBe(403);
    });
  });
});
