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
import { requireRolePermission, requirePermission } from '@shared/middlewares';

const CUID = 'client-abc-123';
const MANAGER_ID = 'manager-sub-1';

const permissionService = new PermissionService();

function makeReq(
  role: string,
  sub = MANAGER_ID,
  extra: { department?: string; cuid?: string } = {}
): Partial<AppRequest> {
  return {
    method: 'POST',
    params: { cuid: extra.cuid ?? CUID },
    container: { cradle: { permissionService } } as any,
    context: {
      currentuser: {
        sub,
        uid: `uid-${sub}`,
        client: { cuid: CUID, role },
        clients: [{ cuid: CUID, isConnected: true }],
        employeeInfo: extra.department ? { department: extra.department } : undefined,
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

describe('requireRolePermission — role grants only (client settings)', () => {
  beforeEach(() => jest.clearAllMocks());

  const roleOnly = requireRolePermission(PermissionResource.CLIENT, PermissionAction.SETTINGS);
  const withDepartments = requirePermission(PermissionResource.CLIENT, PermissionAction.SETTINGS);

  it('allows admins and super-admins, who hold client:settings through their role', async () => {
    allowed(await run(roleOnly, makeReq(ROLES.ADMIN, 'admin-sub')));
    allowed(await run(roleOnly, makeReq(ROLES.SUPER_ADMIN, 'super-sub')));
  });

  it('ignores the management department grant that requirePermission honours', async () => {
    const managementStaff = () => makeReq(ROLES.STAFF, 'staff-sub', { department: 'management' });

    allowed(await run(withDepartments, managementStaff()));
    denied(await run(roleOnly, managementStaff()));
  });

  it('denies managers, staff without a department, tenants and vendors', async () => {
    for (const role of [ROLES.MANAGER, ROLES.STAFF, ROLES.TENANT, ROLES.VENDOR]) {
      denied(await run(roleOnly, makeReq(role, `${role}-sub`)));
    }
  });

  it('denies a caller acting on another client', async () => {
    denied(await run(roleOnly, makeReq(ROLES.ADMIN, 'admin-sub', { cuid: 'other-client' })));
  });

  it('leaves the request user untouched, so later handlers still see the department', async () => {
    const req = makeReq(ROLES.STAFF, 'staff-sub', { department: 'management' });

    await run(roleOnly, req);

    expect((req.context as any).currentuser.employeeInfo).toEqual({ department: 'management' });
  });
});
