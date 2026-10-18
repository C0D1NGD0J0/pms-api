import { NextFunction, Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { PermissionResource, PermissionAction } from '@interfaces/utils.interface';

const mockLogger = {
  error: jest.fn(),
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  trace: jest.fn(),
};
jest.mock('@utils/helpers', () => ({
  createLogger: jest.fn(() => mockLogger),
  generateShortUID: jest.fn(() => 'test-uid'),
  JWT_KEY_NAMES: {},
  extractMulterFiles: jest.fn(() => []),
}));
jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => mockLogger),
  generateShortUID: jest.fn(() => 'test-uid'),
  JWT_KEY_NAMES: {},
  extractMulterFiles: jest.fn(() => []),
  httpStatusCodes: {
    OK: 200,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    SERVICE_UNAVAILABLE: 503,
    INTERNAL_SERVER_ERROR: 500,
  },
}));
jest.mock('@di/index', () => ({ container: { createScope: jest.fn() } }));
jest.mock('@shared/languages', () => ({
  t: (key: string) => key,
  LanguageService: jest.fn(),
}));
jest.mock('@shared/languages/language.service', () => ({
  LanguageService: jest.fn(),
}));

import { PermissionService } from '@services/permission/permission.service';
import { requirePermissionWithContext, requirePermission } from '@shared/middlewares';

const CUID = 'client-abc-123';
const STAFF_ID = 'staff-sub-1';

const permissionService = new PermissionService();

function makeReq(department?: string): Partial<AppRequest> {
  return {
    method: 'GET',
    params: { cuid: CUID },
    container: { cradle: { permissionService } } as any,
    context: {
      currentuser: {
        sub: STAFF_ID,
        uid: `uid-${STAFF_ID}`,
        client: { cuid: CUID, role: ROLES.STAFF },
        clients: [{ cuid: CUID, isConnected: true }],
        employeeInfo: department ? { department } : undefined,
      },
    } as any,
  };
}

const run = async (
  middleware: ReturnType<typeof requirePermission>,
  req: Partial<AppRequest>
): Promise<jest.Mock> => {
  const next = jest.fn();
  await middleware(req as any, {} as Response, next as unknown as NextFunction);
  return next;
};

const allowed = (next: jest.Mock) => expect(next).toHaveBeenCalledWith();
const denied = (next: jest.Mock) =>
  expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));

describe('staff scope fallback — requirePermission', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lets maintenance staff reach list routes they hold only list:assigned for', async () => {
    allowed(
      await run(
        requirePermission(PermissionResource.MAINTENANCE, PermissionAction.LIST),
        makeReq('maintenance')
      )
    );
    allowed(
      await run(
        requirePermission(PermissionResource.PROPERTY, PermissionAction.LIST),
        makeReq('maintenance')
      )
    );
  });

  it('returns 403 to maintenance staff on any-only routes', async () => {
    denied(
      await run(
        requirePermission(PermissionResource.MAINTENANCE, PermissionAction.CREATE),
        makeReq('maintenance')
      )
    );
    denied(
      await run(
        requirePermission(PermissionResource.MAINTENANCE, PermissionAction.STATS),
        makeReq('maintenance')
      )
    );
    denied(
      await run(
        requirePermission(PermissionResource.PAYMENT, PermissionAction.LIST),
        makeReq('maintenance')
      )
    );
  });

  it('returns 403 to security staff on lease, payment and expense routes', async () => {
    for (const resource of [
      PermissionResource.LEASE,
      PermissionResource.PAYMENT,
      PermissionResource.EXPENSE,
    ]) {
      denied(await run(requirePermission(resource, PermissionAction.READ), makeReq('security')));
      denied(await run(requirePermission(resource, PermissionAction.LIST), makeReq('security')));
    }
  });
});

describe('staff scope fallback — requirePermissionWithContext', () => {
  beforeEach(() => jest.clearAllMocks());

  it('falls back to :assigned for reads when the context has no owner', async () => {
    const middleware = requirePermissionWithContext(
      PermissionResource.MAINTENANCE,
      PermissionAction.READ,
      () => ({})
    );
    allowed(await run(middleware, makeReq('maintenance')));
  });

  it('falls back to :assigned for writes only when the record assignees are known', async () => {
    const assignedToMe = requirePermissionWithContext(
      PermissionResource.PROPERTY,
      PermissionAction.UPDATE,
      () => ({ resourceId: 'pid-1', assignedUsers: [STAFF_ID] })
    );
    const assignedToSomeoneElse = requirePermissionWithContext(
      PermissionResource.PROPERTY,
      PermissionAction.UPDATE,
      () => ({ resourceId: 'pid-1', assignedUsers: ['other-staff'] })
    );
    const noAssignees = requirePermissionWithContext(
      PermissionResource.PROPERTY,
      PermissionAction.UPDATE,
      () => ({ resourceId: 'pid-1', assignedUsers: [] })
    );

    allowed(await run(assignedToMe, makeReq('operations')));
    denied(await run(assignedToSomeoneElse, makeReq('operations')));
    denied(await run(noAssignees, makeReq('operations')));
  });

  it('keeps the :any check for staff without a department', async () => {
    const middleware = requirePermissionWithContext(
      PermissionResource.LEASE,
      PermissionAction.READ,
      () => ({})
    );
    allowed(await run(middleware, makeReq()));
    denied(await run(middleware, makeReq('security')));
  });
});
