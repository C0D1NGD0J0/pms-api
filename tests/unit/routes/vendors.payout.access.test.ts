import request from 'supertest';
import { ROLES } from '@shared/constants/roles.constants';
import express, { NextFunction, Response, Request } from 'express';

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

// cuid/vuid params are validated against the database; only access control is under test here.
jest.mock('@shared/validations', () => {
  const actual = jest.requireActual('@shared/validations');
  const { z } = jest.requireActual('zod');
  return {
    ...actual,
    ClientValidations: {
      ...actual.ClientValidations,
      clientIdParam: z.object({ cuid: z.string() }),
    },
    UtilsValidations: {
      ...actual.UtilsValidations,
      vuid: z.object({ vuid: z.string() }),
    },
  };
});

import vendorRoutes from '@routes/vendors.routes';

const CUID = 'client-abc-123';
const OTHER_CUID = 'client-xyz-789';
const OWN_VUID = 'VENDOR-A';
const OTHER_VUID = 'VENDOR-B';

const controllerMethods = [
  'initiatePayoutOnboarding',
  'getPayoutOnboardingLink',
  'syncPayoutAccountStatus',
  'getPayoutDashboardLink',
] as const;

const mockController = Object.fromEntries(
  controllerMethods.map((method) => [
    method,
    jest.fn((_req: Request, res: Response) => res.status(200).json({ handledBy: method })),
  ])
) as Record<(typeof controllerMethods)[number], jest.Mock>;

interface ITestUser {
  isPrimaryVendor?: boolean;
  cuid?: string;
  vuid?: string;
  role: string;
}

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const user: ITestUser = JSON.parse((req.headers['x-test-user'] as string) || '{}');
    const cuid = user.cuid || CUID;
    (req as any).container = {
      cradle: { emitterService: { emit: jest.fn() } },
      resolve: () => mockController,
    };
    (req as any).context = {
      currentuser: {
        sub: `${user.role}-sub`,
        uid: `${user.role}-uid`,
        client: { cuid, role: user.role },
        clients: [{ cuid, isConnected: true }],
        vendorInfo:
          user.role === ROLES.VENDOR
            ? { vuid: user.vuid, isPrimaryVendor: user.isPrimaryVendor ?? true }
            : undefined,
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

const payoutRoutes: Array<{ method: 'get' | 'post'; action: string; handler: string }> = [
  { method: 'post', action: 'initiate', handler: 'initiatePayoutOnboarding' },
  { method: 'get', action: 'link', handler: 'getPayoutOnboardingLink' },
  { method: 'post', action: 'sync', handler: 'syncPayoutAccountStatus' },
  { method: 'get', action: 'dashboard', handler: 'getPayoutDashboardLink' },
];

const callAs = (
  route: (typeof payoutRoutes)[number],
  as: ITestUser,
  { cuid = CUID, vuid = OWN_VUID }: { cuid?: string; vuid?: string } = {}
) =>
  request(app)
    [route.method](`/api/v1/vendors/${cuid}/vendor/${vuid}/payout_account/${route.action}`)
    .set('x-test-user', JSON.stringify(as));

const primaryVendorA: ITestUser = { role: ROLES.VENDOR, vuid: OWN_VUID, isPrimaryVendor: true };

describe('vendor payout account routes — access control', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(payoutRoutes)('$method payout_account/$action', (route) => {
    it("allows the primary vendor to act on their own vendor's payout account", async () => {
      const res = await callAs(route, primaryVendorA);

      expect(res.status).toBe(200);
      expect(res.body.handledBy).toBe(route.handler);
    });

    it("rejects a primary vendor acting on another vendor's payout account in the same client", async () => {
      const res = await callAs(route, primaryVendorA, { vuid: OTHER_VUID });

      expect(res.status).toBe(403);
      expect(mockController[route.handler as keyof typeof mockController]).not.toHaveBeenCalled();
    });

    it("rejects a primary vendor acting on another client's vendor payout account", async () => {
      const res = await callAs(
        route,
        { ...primaryVendorA, cuid: OTHER_CUID },
        { cuid: OTHER_CUID, vuid: OTHER_VUID }
      );

      expect(res.status).toBe(403);
      expect(mockController[route.handler as keyof typeof mockController]).not.toHaveBeenCalled();
    });

    it('rejects a vendor whose own vuid could not be resolved', async () => {
      const res = await callAs(route, { role: ROLES.VENDOR, isPrimaryVendor: true });

      expect(res.status).toBe(403);
    });

    it('rejects vendor team members even for their own vendor', async () => {
      const res = await callAs(route, { ...primaryVendorA, isPrimaryVendor: false });

      expect(res.status).toBe(403);
    });

    it.each([ROLES.SUPER_ADMIN, ROLES.ADMIN, ROLES.MANAGER, ROLES.STAFF, ROLES.TENANT])(
      'rejects %s (payout onboarding is vendor self-service only)',
      async (role) => {
        const res = await callAs(route, { role });

        expect(res.status).toBe(403);
      }
    );
  });
});
