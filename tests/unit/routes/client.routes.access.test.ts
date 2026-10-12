import request from 'supertest';
import { ROLES } from '@shared/constants/roles.constants';
import { ClientService } from '@services/client/client.service';
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

const permissionService = new PermissionService();

// Real service with stubbed persistence, so the super-admin-only field rule runs behind the route.
const clientDAO = {
  getClientByCuid: jest
    .fn()
    .mockResolvedValue({ _id: 'client-id', cuid: CUID, companyProfile: {} }),
  startSession: jest.fn().mockResolvedValue({}),
  withTransaction: jest.fn((session: unknown, run: (session: unknown) => unknown) => run(session)),
  updateById: jest.fn((_id: string, update: object) => Promise.resolve(update)),
};
const clientService = new ClientService({
  clientDAO,
  paymentProcessorDAO: { findFirst: jest.fn().mockResolvedValue(null) },
  permissionService,
} as any);

const mockController = {
  updateClientProfile: jest.fn(async (req: Request, res: Response) => {
    await clientService.updateClientDetails((req as any).context, req.body);
    return res.status(200).json({ body: req.body });
  }),
};

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
      request: { params: { cuid: CUID }, url: req.url },
      requestId: 'req-route-access',
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

const adminFieldsSave = {
  displayName: 'Acme Renamed',
  companyProfile: {
    tradingName: 'New Trading',
    companyEmail: 'ops@acme.example.com',
    companyPhone: '+1 416 979 1234',
    website: 'https://acme.example.com',
    logo: 'https://cdn.example.com/logo.png',
    contactInfo: { contactPerson: 'Jane Ops' },
  },
  settings: {
    timeZone: 'America/Toronto',
    lang: 'fr',
    notificationPreferences: { email: false },
    tenantFeatures: { guestPass: true },
  },
};

const superAdminOnlyPayloads: Array<[string, object]> = [
  ['companyProfile.legalEntityName', { companyProfile: { legalEntityName: 'Acme Inc' } }],
  ['companyProfile.registrationNumber', { companyProfile: { registrationNumber: 'R-1' } }],
  ['companyProfile.companyAddress', { companyProfile: { companyAddress: '1 Main Street' } }],
  ['settings.defaultCurrency', { settings: { defaultCurrency: 'EUR' } }],
  ['settings.vendorPayoutMode', { settings: { vendorPayoutMode: 'express' } }],
  ['settings.requireDepositRefundApproval', { settings: { requireDepositRefundApproval: true } }],
  ['dataProcessingConsent', { dataProcessingConsent: false }],
];

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

  it('forbids manager (no client:settings)', async () => {
    const res = await patchClient({ role: ROLES.MANAGER });

    expect(res.status).toBe(403);
    expect(mockController.updateClientProfile).not.toHaveBeenCalled();
  });

  // management holds client:settings as a department grant (for /settings/tenant-features);
  // department grants must not open the account-details route.
  it.each(['maintenance', 'operations', 'accounting', 'security', 'management'])(
    'forbids staff in the %s department',
    async (department) => {
      const res = await patchClient({ role: ROLES.STAFF, department });

      expect(res.status).toBe(403);
      expect(mockController.updateClientProfile).not.toHaveBeenCalled();
    }
  );

  it('allows admin to save the admin fields', async () => {
    const res = await patchClient({ role: ROLES.ADMIN }, adminFieldsSave);

    expect(res.status).toBe(200);
    expect(clientDAO.updateById).toHaveBeenCalledTimes(1);
  });

  it.each(superAdminOnlyPayloads)(
    'returns 403 when admin sends super-admin-only %s',
    async (_field, restrictedPayload) => {
      const res = await patchClient(
        { role: ROLES.ADMIN },
        { displayName: 'Acme Renamed', ...restrictedPayload }
      );

      expect(res.status).toBe(403);
      expect(clientDAO.updateById).not.toHaveBeenCalled();
    }
  );

  it.each([ROLES.SUPER_ADMIN, ROLES.ROOT_ADMIN])(
    'allows %s to save admin and super-admin-only fields',
    async (role) => {
      const allFields = {
        ...adminFieldsSave,
        companyProfile: {
          ...adminFieldsSave.companyProfile,
          legalEntityName: 'Acme Holdings Inc',
          registrationNumber: 'REG-1',
          companyAddress: '1 Main Street',
        },
        settings: {
          ...adminFieldsSave.settings,
          defaultCurrency: 'CAD',
          vendorPayoutMode: 'platform_hold',
          requireDepositRefundApproval: true,
        },
        dataProcessingConsent: true,
      };

      const res = await patchClient({ role }, allFields);

      expect(res.status).toBe(200);
      expect(clientDAO.updateById).toHaveBeenCalledTimes(1);
    }
  );

  it('forbids a super-admin of another client (cuid mismatch)', async () => {
    const res = await request(app)
      .patch('/api/v1/clients/other-client-999')
      .set('x-test-role', ROLES.SUPER_ADMIN)
      .send(fullFormSave);

    expect(res.status).toBe(403);
    expect(mockController.updateClientProfile).not.toHaveBeenCalled();
  });
});
