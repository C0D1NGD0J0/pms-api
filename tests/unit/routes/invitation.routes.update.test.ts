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

import invitationRoutes from '@routes/invitation.routes';

const CUID = 'CLIENT1234567';
const IUID = 'INVITE1234567';

const mockController = {
  updateInvitation: jest.fn((req: Request, res: Response) =>
    res.status(200).json({ params: req.params, body: req.body })
  ),
};

const permissionService = new PermissionService();

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const role = (req.headers['x-test-role'] as string) || ROLES.ADMIN;
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
      },
    };
    next();
  });
  app.use('/api/v1/invites', invitationRoutes);
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    res.status(err.statusCode || 500).json({ message: err.message });
  });
  return app;
};

const app = buildApp();

const invitationEdit = {
  inviteeEmail: 'invitee@example.com',
  role: 'staff',
  personalInfo: { firstName: 'Jane', lastName: 'Doe' },
  status: 'draft',
  employeeInfo: { department: 'operations', jobTitle: 'Leasing Agent' },
};

describe('PATCH /invites/:cuid/:iuid (edit invitation)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps both cuid and iuid in the validated params, so the edit can find the invitation', async () => {
    const res = await request(app).patch(`/api/v1/invites/${CUID}/${IUID}`).send(invitationEdit);

    expect(res.status).toBe(200);
    expect(res.body.params).toEqual({ cuid: CUID, iuid: IUID });
    expect(res.body.body.employeeInfo).toEqual({
      department: 'operations',
      jobTitle: 'Leasing Agent',
    });
  });

  it('rejects a malformed invitation id before reaching the controller', async () => {
    const res = await request(app).patch(`/api/v1/invites/${CUID}/short`).send(invitationEdit);

    expect(res.status).toBe(422);
    expect(mockController.updateInvitation).not.toHaveBeenCalled();
  });

  it('forbids roles without invitation update permission', async () => {
    const res = await request(app)
      .patch(`/api/v1/invites/${CUID}/${IUID}`)
      .set('x-test-role', ROLES.TENANT)
      .send(invitationEdit);

    expect(res.status).toBe(403);
    expect(mockController.updateInvitation).not.toHaveBeenCalled();
  });
});
