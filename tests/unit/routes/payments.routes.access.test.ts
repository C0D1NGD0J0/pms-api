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
    requireNotSuspended: next,
    requirePayoutAccess: next,
    diskUpload: () => next,
    scanFile: next,
  };
});

// cuid/pytuid params are validated against the database; only access control is under test here.
jest.mock('@shared/validations', () => {
  const actual = jest.requireActual('@shared/validations');
  const { z } = jest.requireActual('zod');
  return {
    ...actual,
    UtilsValidations: {
      ...actual.UtilsValidations,
      cuid: z.object({ cuid: z.string() }),
      pytuid: z.object({ pytuid: z.string() }),
    },
  };
});

import paymentRoutes from '@routes/payments.routes';
import { blockUnverifiedInvoiceWebhookInProduction } from '@routes/webhook.routes';

const CUID = 'client-abc-123';
const PYTUID = 'PYT-123';
const MRUID = 'MR-123';

const controllerMethods = [
  'chargeForMaintenance',
  'ensureSelfMaintenanceCharge',
  'createPayment',
  'payVendor',
  'scanReceipt',
  'recordManualPayment',
  'cancelPayment',
  'refundPayment',
  'releaseDepositRefund',
  'reviewPayment',
  'createCardPaymentSession',
  'payPendingCharge',
  'listPayments',
  'getPayment',
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
    const user: ITestUser = { role, department };
    (req as any).container = {
      cradle: { permissionService, emitterService: { emit: jest.fn() } },
      resolve: () => mockController,
    };
    (req as any).context = {
      currentuser: {
        sub: `${user.role}-sub`,
        uid: `${user.role}-uid`,
        client: { cuid: CUID, role: user.role },
        clients: [{ cuid: CUID, isConnected: true }],
        employeeInfo: user.department ? { department: user.department } : undefined,
        tenantInfo: { activeLease: {} },
      },
    };
    next();
  });
  app.use('/api/v1/payments', paymentRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();
const base = `/api/v1/payments/${CUID}`;

const send = (method: 'post' | 'patch', url: string, as: ITestUser, body: object = {}) => {
  const req = request(app)[method](url).set('x-test-role', as.role);
  if (as.department) req.set('x-test-department', as.department);
  return req.send(body);
};

const managerOnlyRoutes: Array<{
  label: string;
  method: 'post' | 'patch';
  url: string;
  body?: object;
}> = [
  { label: 'review staff manual entry', method: 'patch', url: `${base}/${PYTUID}/review` },
  { label: 'release deposit refund', method: 'post', url: `${base}/${PYTUID}/release-deposit` },
];

const internalOnlyRoutes: Array<{
  label: string;
  method: 'post' | 'patch';
  url: string;
  body?: object;
}> = [
  {
    label: 'PM maintenance charge',
    method: 'post',
    url: `${base}/maintenance-charge`,
    body: { mruid: MRUID, tenantId: 'tenant-sub', amount: 1 },
  },
  {
    label: 'manual entry',
    method: 'post',
    url: `${base}/manual_entry`,
    body: {
      paymentType: 'rent',
      paymentMethod: 'cash',
      baseAmount: 100,
      paidAt: '2026-01-01',
      tenantId: 'tenant-sub',
      leaseId: 'lease-1',
    },
  },
  { label: 'vendor payout', method: 'post', url: `${base}/vendor-payout/${MRUID}` },
  {
    label: 'create rent charge',
    method: 'post',
    url: base,
    body: {
      paymentType: 'rent',
      leaseId: 'lease-1',
      tenantId: 'tenant-sub',
      dueDate: '2026-01-01',
    },
  },
  { label: 'scan receipt', method: 'post', url: `${base}/scan-receipt` },
  { label: 'cancel payment', method: 'patch', url: `${base}/${PYTUID}/cancel` },
  { label: 'refund payment', method: 'post', url: `${base}/${PYTUID}/refund` },
  ...managerOnlyRoutes,
];

describe('payments routes — access control', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([ROLES.TENANT, ROLES.VENDOR])('%s', (role) => {
    it.each(internalOnlyRoutes)('is forbidden from $label', async ({ method, url, body }) => {
      const res = await send(method, url, { role }, body);

      expect(res.status).toBe(403);
      Object.values(mockController).forEach((handler) => expect(handler).not.toHaveBeenCalled());
    });
  });

  describe('review and release-deposit (manager and above)', () => {
    it.each([ROLES.MANAGER, ROLES.ADMIN, ROLES.SUPER_ADMIN, ROLES.ROOT_ADMIN])(
      'allows %s',
      async (role) => {
        for (const { method, url } of managerOnlyRoutes) {
          const res = await send(method, url, { role });
          expect(res.status).toBe(200);
        }
        expect(mockController.reviewPayment).toHaveBeenCalledTimes(1);
        expect(mockController.releaseDepositRefund).toHaveBeenCalledTimes(1);
      }
    );

    it.each(['accounting', 'management', 'operations'])(
      'denies staff in the %s department',
      async (department) => {
        for (const { method, url } of managerOnlyRoutes) {
          const res = await send(method, url, { role: ROLES.STAFF, department });
          expect(res.status).toBe(403);
        }
      }
    );
  });

  describe('PM write routes for internal roles', () => {
    it('lets a manager create a maintenance charge and record a manual entry', async () => {
      const [charge, manual] = internalOnlyRoutes;

      expect(
        (await send(charge.method, charge.url, { role: ROLES.MANAGER }, charge.body)).status
      ).toBe(200);
      expect(
        (await send(manual.method, manual.url, { role: ROLES.MANAGER }, manual.body)).status
      ).toBe(200);
    });

    it('lets an admin refund and cancel (admin now holds payment:update)', async () => {
      expect((await send('post', `${base}/${PYTUID}/refund`, { role: ROLES.ADMIN })).status).toBe(
        200
      );
      expect((await send('patch', `${base}/${PYTUID}/cancel`, { role: ROLES.ADMIN })).status).toBe(
        200
      );
    });

    it('lets a manager refund and cancel (managers and above hold payment:update)', async () => {
      expect((await send('post', `${base}/${PYTUID}/refund`, { role: ROLES.MANAGER })).status).toBe(
        200
      );
      expect(
        (await send('patch', `${base}/${PYTUID}/cancel`, { role: ROLES.MANAGER })).status
      ).toBe(200);
    });

    it('still lets accounting staff record a manual entry', async () => {
      const manual = internalOnlyRoutes[1];
      const res = await send(
        manual.method,
        manual.url,
        { role: ROLES.STAFF, department: 'accounting' },
        manual.body
      );
      expect(res.status).toBe(200);
    });

    it('still denies operations staff a manual entry (department has no payment:create)', async () => {
      const manual = internalOnlyRoutes[1];
      const res = await send(
        manual.method,
        manual.url,
        { role: ROLES.STAFF, department: 'operations' },
        manual.body
      );
      expect(res.status).toBe(403);
    });
  });

  describe('tenant self-serve routes keep working', () => {
    const tenant = { role: ROLES.TENANT };

    it('pays an own pending charge', async () => {
      expect((await send('post', `${base}/${PYTUID}/pay`, tenant)).status).toBe(200);
      expect(mockController.payPendingCharge).toHaveBeenCalled();
    });

    it('starts a card checkout', async () => {
      expect((await send('post', `${base}/${PYTUID}/card-checkout`, tenant)).status).toBe(200);
      expect(mockController.createCardPaymentSession).toHaveBeenCalled();
    });

    it('lists and reads own payments', async () => {
      expect((await request(app).get(base).set('x-test-role', ROLES.TENANT)).status).toBe(200);
      expect(
        (await request(app).get(`${base}/${PYTUID}`).set('x-test-role', ROLES.TENANT)).status
      ).toBe(200);
    });

    it('ensures an own maintenance charge, stripping any client-supplied amount', async () => {
      const res = await send('post', `${base}/maintenance-charge/ensure`, tenant, {
        mruid: MRUID,
        amountInCents: 1,
        amount: 1,
      });

      expect(res.status).toBe(200);
      expect(res.body.body).toEqual({ mruid: MRUID });
    });

    it('rejects an ensure request without an mruid', async () => {
      const res = await send('post', `${base}/maintenance-charge/ensure`, tenant, {});
      expect(res.status).toBe(422);
      expect(mockController.ensureSelfMaintenanceCharge).not.toHaveBeenCalled();
    });
  });
});

describe('invoice webhook production guard', () => {
  const originalEnv = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
  });

  const webhookApp = () => {
    const app = express();
    app.post('/invoices/:source', blockUnverifiedInvoiceWebhookInProduction, (_req, res) => {
      res.status(200).json({ received: true });
    });
    return app;
  };

  it('refuses invoice webhooks in production while signatures are unverified', async () => {
    process.env.NODE_ENV = 'production';
    const res = await request(webhookApp()).post('/invoices/quickbooks').send({});
    expect(res.status).toBe(501);
  });

  it('keeps accepting invoice webhooks outside production', async () => {
    process.env.NODE_ENV = 'development';
    const res = await request(webhookApp()).post('/invoices/quickbooks').send({});
    expect(res.status).toBe(200);
  });

  it('is wired into the invoice webhook route', () => {
    const webhookRoutes = jest.requireActual('@routes/webhook.routes').default;
    const invoiceLayer = webhookRoutes.stack.find(
      (layer: any) => layer.route?.path === '/invoices/:source'
    );
    const handlers = invoiceLayer.route.stack.map((routeLayer: any) => routeLayer.handle);
    expect(handlers[0]).toBe(blockUnverifiedInvoiceWebhookInProduction);
  });
});
