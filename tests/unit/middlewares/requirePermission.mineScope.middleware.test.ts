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

import { requirePermission } from '@shared/middlewares';
import { PermissionService } from '@services/permission/permission.service';

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

describe('requirePermission — opt-in :mine scope (property)', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('create with the :mine fallback enabled', () => {
    const create = requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE, true);

    it('lets a manager (create:mine) create a property', async () => {
      allowed(await run(create, makeReq(ROLES.MANAGER)));
    });

    it('still lets an admin (create:any) create a property', async () => {
      allowed(await run(create, makeReq(ROLES.ADMIN, 'admin-sub')));
    });

    it('still lets management-department staff (create:any via department) create a property', async () => {
      allowed(await run(create, makeReq(ROLES.STAFF, 'staff-sub', { department: 'management' })));
    });

    it('still denies staff without a property-create department grant', async () => {
      denied(await run(create, makeReq(ROLES.STAFF, 'staff-sub', { department: 'operations' })));
    });

    it('still denies tenants', async () => {
      denied(await run(create, makeReq(ROLES.TENANT, 'tenant-sub')));
    });

    it('still rejects a request for a different client before any scope check', async () => {
      denied(await run(create, makeReq(ROLES.MANAGER, MANAGER_ID, { cuid: 'another-client' })));
    });
  });

  describe('without the opt-in argument (all other routes, including property delete)', () => {
    it('keeps denying a manager on create — behavior unchanged for un-migrated routes', async () => {
      const create = requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE);
      denied(await run(create, makeReq(ROLES.MANAGER)));
    });

    it('keeps denying a manager on delete — archive routes were not part of this fix', async () => {
      const remove = requirePermission(PermissionResource.PROPERTY, PermissionAction.DELETE);
      denied(await run(remove, makeReq(ROLES.MANAGER)));
    });
  });
});
