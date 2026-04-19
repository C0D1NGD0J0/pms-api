import { NextFunction, Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { FeatureFlag } from '@interfaces/featureFlag.interface';

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

import { requireActiveTenant, requireFeatureFlag } from '@shared/middlewares';

const CUID = 'client-abc-123';

function makeReq(overrides: Partial<AppRequest> = {}): Partial<AppRequest> {
  return {
    method: 'POST',
    container: { cradle: {} } as any,
    context: {
      currentuser: null,
    } as any,
    ...overrides,
  };
}

function makeRes(): Partial<Response> {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  };
}

describe('requireActiveTenant middleware', () => {
  const next = jest.fn() as unknown as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes through for non-tenant roles', () => {
    const req = makeReq({
      context: {
        currentuser: {
          sub: 'user1',
          client: { cuid: CUID, role: ROLES.ADMIN },
          clients: [{ cuid: CUID, isConnected: true }],
        },
      } as any,
    });

    requireActiveTenant('maintenanceRequests')(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith(); // no error arg
  });

  it('passes through for tenant with all features active', () => {
    const req = makeReq({
      context: {
        currentuser: {
          sub: 'tenant1',
          client: {
            cuid: CUID,
            role: ROLES.TENANT,
            tenantFeatures: {
              tenantPortalActive: true,
              maintenanceRequests: true,
              onlinePayments: true,
              smsNotifications: true,
              visitorPass: true,
            },
          },
          clients: [{ cuid: CUID, isConnected: true }],
        },
      } as any,
    });

    requireActiveTenant('maintenanceRequests')(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 403 when specific tenant feature is disabled', () => {
    const req = makeReq({
      context: {
        currentuser: {
          sub: 'tenant1',
          client: {
            cuid: CUID,
            role: ROLES.TENANT,
            tenantFeatures: {
              tenantPortalActive: true,
              maintenanceRequests: false,
            },
          },
          clients: [{ cuid: CUID, isConnected: true }],
        },
      } as any,
    });

    requireActiveTenant('maintenanceRequests')(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({ statusCode: 403 })
    );
  });

  it('blocks disconnected former tenants', () => {
    const req = makeReq({
      context: {
        currentuser: {
          sub: 'tenant2',
          client: { cuid: CUID, role: ROLES.TENANT },
          clients: [{ cuid: CUID, isConnected: false }],
        },
      } as any,
    });

    requireActiveTenant()(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('fails open (allows request) when tenantFeatures is absent', () => {
    const req = makeReq({
      context: {
        currentuser: {
          sub: 'tenant3',
          client: {
            cuid: CUID,
            role: ROLES.TENANT,
            // tenantFeatures intentionally absent
          },
          clients: [{ cuid: CUID, isConnected: true }],
        },
      } as any,
    });

    requireActiveTenant('onlinePayments')(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith(); // no error — fails open
  });

  it('returns 401 when no currentuser', () => {
    const req = makeReq({ context: { currentuser: null } as any });
    requireActiveTenant()(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 401 }));
  });

  it('passes through with no feature flag arg (former-tenant check only)', () => {
    const req = makeReq({
      context: {
        currentuser: {
          sub: 'tenant4',
          client: { cuid: CUID, role: ROLES.TENANT, tenantFeatures: { tenantPortalActive: false } },
          clients: [{ cuid: CUID, isConnected: true }],
        },
      } as any,
    });

    requireActiveTenant()(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith(); // no feature key → no feature check
  });
});

describe('requireFeatureFlag middleware', () => {
  const next = jest.fn() as unknown as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('passes through when feature is enabled', () => {
    const req = makeReq({
      container: {
        cradle: {
          featureFlagService: { isEnabled: jest.fn().mockReturnValue(true) },
        },
      } as any,
    });

    requireFeatureFlag(FeatureFlag.ESIGNATURE)(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('returns 403 when feature is disabled', () => {
    const req = makeReq({
      container: {
        cradle: {
          featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) },
        },
      } as any,
    });

    requireFeatureFlag(FeatureFlag.ESIGNATURE)(req as any, makeRes() as any, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });
});
