import { NextFunction, Response } from 'express';
import { AppRequest } from '@interfaces/utils.interface';
import { ISubscriptionStatus } from '@interfaces/subscription.interface';

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

import { requireActiveSubscription, subscriptionEntitlements } from '@shared/middlewares';

const CUID = 'client-abc-123';

function makeReq(overrides: Partial<AppRequest> = {}): Partial<AppRequest> {
  return {
    method: 'GET',
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

function makeGetEntitlements(result: any) {
  return jest.fn().mockReturnValue(Promise.resolve(result));
}

const entitlementsPayload = {
  plan: { status: ISubscriptionStatus.ACTIVE },
  entitlements: { someFeature: true },
};

describe('subscriptionEntitlements middleware', () => {
  const next = jest.fn() as unknown as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('loads entitlements onto req.context and calls next when a subscription is found', async () => {
    const getSubscriptionEntitlements = makeGetEntitlements({
      success: true,
      data: entitlementsPayload,
    });
    const req = makeReq({
      container: { cradle: { subscriptionService: { getSubscriptionEntitlements } } } as any,
      context: {
        currentuser: { sub: 'user1', client: { cuid: CUID, role: 'admin' } },
      } as any,
    });

    await subscriptionEntitlements(req as any, makeRes() as any, next);

    expect(getSubscriptionEntitlements).toHaveBeenCalledWith(CUID, 'admin');
    expect((req.context as any).entitlements).toEqual(entitlementsPayload);
    expect(next).toHaveBeenCalledWith();
  });

  it('skips reloading and calls next when entitlements are already on the request context', async () => {
    const getSubscriptionEntitlements = makeGetEntitlements({
      success: true,
      data: entitlementsPayload,
    });
    const req = makeReq({
      container: { cradle: { subscriptionService: { getSubscriptionEntitlements } } } as any,
      context: {
        currentuser: { sub: 'user1', client: { cuid: CUID, role: 'admin' } },
        entitlements: entitlementsPayload,
      } as any,
    });

    await subscriptionEntitlements(req as any, makeRes() as any, next);

    expect(getSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('calls next without error when there is no current user', async () => {
    const req = makeReq({ context: { currentuser: null } as any });

    await subscriptionEntitlements(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith();
    expect((req.context as any).entitlements).toBeUndefined();
  });

  it('calls next without error when subscriptionService is unavailable in the container', async () => {
    const req = makeReq({
      container: { cradle: {} } as any,
      context: {
        currentuser: { sub: 'user1', client: { cuid: CUID, role: 'admin' } },
      } as any,
    });

    await subscriptionEntitlements(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith();
    expect((req.context as any).entitlements).toBeUndefined();
  });

  it('passes a ServiceUnavailableError to next when the entitlements lookup throws', async () => {
    const getSubscriptionEntitlements = jest
      .fn()
      .mockReturnValue(Promise.reject(new Error('db down')));
    const req = makeReq({
      container: { cradle: { subscriptionService: { getSubscriptionEntitlements } } } as any,
      context: {
        currentuser: { sub: 'user1', client: { cuid: CUID, role: 'admin' } },
      } as any,
    });

    await subscriptionEntitlements(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503 }));
  });
});

describe('requireActiveSubscription middleware', () => {
  const next = jest.fn() as unknown as NextFunction;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it.each(['tenant', 'vendor'])(
    'bypasses entitlement loading entirely for %s role',
    async (role) => {
      const getSubscriptionEntitlements = makeGetEntitlements({
        success: true,
        data: entitlementsPayload,
      });
      const req = makeReq({
        container: { cradle: { subscriptionService: { getSubscriptionEntitlements } } } as any,
        context: { currentuser: { sub: 'u1', client: { cuid: CUID, role } } } as any,
      });

      await requireActiveSubscription(req as any, makeRes() as any, next);

      expect(getSubscriptionEntitlements).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledWith();
    }
  );

  it('reuses entitlements already set on req.context instead of reloading them', async () => {
    const getSubscriptionEntitlements = makeGetEntitlements({
      success: true,
      data: entitlementsPayload,
    });
    const req = makeReq({
      container: { cradle: { subscriptionService: { getSubscriptionEntitlements } } } as any,
      context: {
        currentuser: { sub: 'u1', client: { cuid: CUID, role: 'admin' } },
        entitlements: entitlementsPayload,
      } as any,
    });

    await requireActiveSubscription(req as any, makeRes() as any, next);

    expect(getSubscriptionEntitlements).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith();
  });

  it('loads entitlements on demand when subscriptionEntitlements did not run first', async () => {
    const getSubscriptionEntitlements = makeGetEntitlements({
      success: true,
      data: entitlementsPayload,
    });
    const req = makeReq({
      container: { cradle: { subscriptionService: { getSubscriptionEntitlements } } } as any,
      context: { currentuser: { sub: 'u1', client: { cuid: CUID, role: 'admin' } } } as any,
    });

    await requireActiveSubscription(req as any, makeRes() as any, next);

    expect(getSubscriptionEntitlements).toHaveBeenCalledWith(CUID, 'admin');
    expect(next).toHaveBeenCalledWith();
  });

  it('fails open with a ServiceUnavailableError when entitlements could not be loaded', async () => {
    const getSubscriptionEntitlements = makeGetEntitlements({ success: false, data: null });
    const req = makeReq({
      container: { cradle: { subscriptionService: { getSubscriptionEntitlements } } } as any,
      context: { currentuser: { sub: 'u1', client: { cuid: CUID, role: 'admin' } } } as any,
    });

    await requireActiveSubscription(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 503 }));
  });

  it('blocks with ForbiddenError when subscription status is pending_payment', async () => {
    const req = makeReq({
      context: {
        currentuser: { sub: 'u1', client: { cuid: CUID, role: 'admin' } },
        entitlements: { plan: { status: ISubscriptionStatus.PENDING_PAYMENT } },
      } as any,
    });

    await requireActiveSubscription(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('blocks with ForbiddenError when subscription status is inactive', async () => {
    const req = makeReq({
      context: {
        currentuser: { sub: 'u1', client: { cuid: CUID, role: 'admin' } },
        entitlements: { plan: { status: ISubscriptionStatus.INACTIVE } },
      } as any,
    });

    await requireActiveSubscription(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 403 }));
  });

  it('allows past_due through so the grace-period banner can be shown instead of hard-blocking', async () => {
    const req = makeReq({
      context: {
        currentuser: { sub: 'u1', client: { cuid: CUID, role: 'admin' } },
        entitlements: { plan: { status: ISubscriptionStatus.PAST_DUE } },
      } as any,
    });

    await requireActiveSubscription(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith();
  });

  it('allows active subscriptions through', async () => {
    const req = makeReq({
      context: {
        currentuser: { sub: 'u1', client: { cuid: CUID, role: 'admin' } },
        entitlements: { plan: { status: ISubscriptionStatus.ACTIVE } },
      } as any,
    });

    await requireActiveSubscription(req as any, makeRes() as any, next);

    expect(next).toHaveBeenCalledWith();
  });
});
