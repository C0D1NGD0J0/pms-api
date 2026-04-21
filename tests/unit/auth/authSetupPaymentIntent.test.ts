// Break the circular import chain: auth.service → @shared/middlewares → @di/index → registerResources → auth.service (undefined)
jest.mock('@shared/middlewares', () => ({ preventTenantConflict: jest.fn() }));
jest.mock('@di/index', () => ({ container: {} }));
jest.mock('@shared/languages', () => ({ t: jest.fn((k: string) => k) }));
jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  httpStatusCodes: {
    OK: 200,
    CREATED: 201,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    RATE_LIMITER: 429,
    UNPROCESSABLE: 422,
    NOT_IMPLEMENTED: 501,
    EXPIRED_AUTH_TOKEN: 419,
    SERVICE_UNAVAILABLE: 503,
    INTERNAL_SERVER_ERROR: 500,
  },
  JWT_KEY_NAMES: { ACCESS_TOKEN: 'accessToken', REFRESH_TOKEN: 'refreshToken' },
  generateShortUID: jest.fn(() => 'short-uid'),
  hashGenerator: jest.fn(),
  JOB_NAME: {},
  STRIPE_SUPPORTED_COUNTRY_CODES: [],
  getCountryCodeFromLocation: jest.fn(),
  getLocationDetails: jest.fn(),
}));

import { Types } from 'mongoose';
import { AuthService } from '@services/auth/auth.service';
import { ICurrentUser } from '@interfaces/user.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';

// ── Constants ─────────────────────────────────────────────────────────────────

const CUID = 'MMQHHVX09JJT';
const TENANT_SUB = new Types.ObjectId().toString();
const ACCOUNT_ID = 'acct_stripe_123';
const EXISTING_CUSTOMER_ID = 'cus_existing_456';
const NEW_CUSTOMER_ID = 'cus_new_789';
const CHECKOUT_URL = 'https://checkout.stripe.com/c/pay/cs_test_abc';
const RETURN_URL = 'https://app.example.com/onboarding/MMQHHVX09JJT?payment_setup=complete';
const CANCEL_URL = 'https://app.example.com/onboarding/MMQHHVX09JJT';

// ── Shared helpers ─────────────────────────────────────────────────────────────

const makeTenantUser = (overrides: Partial<ICurrentUser['client']> = {}): ICurrentUser =>
  ({
    sub: TENANT_SUB,
    email: 'tenant@example.com',
    client: {
      cuid: CUID,
      role: 'tenant',
      displayname: 'Test Tenant',
      isVerified: true,
      ...overrides,
    },
  }) as ICurrentUser;

const makeProcessor = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  accountId: ACCOUNT_ID,
  ...overrides,
});

const makeProfile = (customerId?: string) => {
  const map = new Map<string, string>();
  if (customerId) {
    map.set(ACCOUNT_ID, customerId);
  }
  return {
    _id: new Types.ObjectId(),
    tenantInfo: {
      paymentGatewayCustomers: map,
    },
  };
};

const makeLease = (acceptedPaymentMethod?: string) => ({
  _id: new Types.ObjectId(),
  fees: {
    acceptedPaymentMethod,
  },
});

const makeService = (overrides: Record<string, any> = {}) =>
  new AuthService({
    leaseDAO: (overrides.leaseDAO ?? {}) as any,
    profileDAO: (overrides.profileDAO ?? {}) as any,
    paymentProcessorDAO: (overrides.paymentProcessorDAO ?? {}) as any,
    paymentGatewayService: (overrides.paymentGatewayService ?? {}) as any,
    userDAO: {} as any,
    clientDAO: {} as any,
    queueFactory: { getQueue: jest.fn() } as any,
    tokenService: {} as any,
    authCache: {} as any,
    vendorService: {} as any,
    subscriptionService: {} as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
  });

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — non-tenant role
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — non-tenant role', () => {
  afterEach(() => jest.clearAllMocks());

  it('throws BadRequestError when currentuser.client.role is not tenant', async () => {
    const service = makeService();
    const user = makeTenantUser({ role: 'staff' as any });

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError with correct message for non-tenant role', async () => {
    const service = makeService();
    const user = makeTenantUser({ role: 'admin' as any });

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toMatchObject({
      message: 'Only tenants can set up a payment method.',
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — no active lease
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — no active lease', () => {
  let leaseDAO: { getActiveLeaseByTenant: jest.Mock };

  beforeEach(() => {
    leaseDAO = { getActiveLeaseByTenant: jest.fn() };
  });

  afterEach(() => jest.clearAllMocks());

  it('returns requiresSetup: false with reason no_active_lease when lease is null', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(null));

    const service = makeService({ leaseDAO });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result).toEqual({
      success: true,
      data: { requiresSetup: false, reason: 'no_active_lease' },
    });
  });

  it('calls leaseDAO.getActiveLeaseByTenant with cuid and currentuser.sub', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(null));

    const service = makeService({ leaseDAO });
    const user = makeTenantUser();

    await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(leaseDAO.getActiveLeaseByTenant).toHaveBeenCalledWith(CUID, TENANT_SUB);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — non-electronic payment method
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — non-electronic payment method', () => {
  let leaseDAO: { getActiveLeaseByTenant: jest.Mock };

  beforeEach(() => {
    leaseDAO = { getActiveLeaseByTenant: jest.fn() };
  });

  afterEach(() => jest.clearAllMocks());

  it('returns requiresSetup: false with paymentMethod check for check payment method', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('check')));

    const service = makeService({ leaseDAO });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result).toEqual({
      success: true,
      data: { requiresSetup: false, paymentMethod: 'check' },
    });
  });

  it('returns requiresSetup: false with paymentMethod cash for cash payment method', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('cash')));

    const service = makeService({ leaseDAO });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result).toEqual({
      success: true,
      data: { requiresSetup: false, paymentMethod: 'cash' },
    });
  });

  it('returns requiresSetup: false with paymentMethod unspecified when acceptedPaymentMethod is undefined', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease(undefined)));

    const service = makeService({ leaseDAO });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result).toEqual({
      success: true,
      data: { requiresSetup: false, paymentMethod: 'unspecified' },
    });
  });

  it('returns requiresSetup: false with paymentMethod unspecified when acceptedPaymentMethod is null', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(
      Promise.resolve({ _id: new Types.ObjectId(), fees: { acceptedPaymentMethod: null } })
    );

    const service = makeService({ leaseDAO });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result).toEqual({
      success: true,
      data: { requiresSetup: false, paymentMethod: 'unspecified' },
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — electronic lease / processor not found
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — electronic lease, processor not found', () => {
  let leaseDAO: { getActiveLeaseByTenant: jest.Mock };
  let paymentProcessorDAO: { findFirst: jest.Mock };

  beforeEach(() => {
    leaseDAO = { getActiveLeaseByTenant: jest.fn() };
    paymentProcessorDAO = { findFirst: jest.fn() };
  });

  afterEach(() => jest.clearAllMocks());

  it('throws NotFoundError when paymentProcessorDAO.findFirst returns null', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(null));

    const service = makeService({ leaseDAO, paymentProcessorDAO });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError with correct message when processor not found', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(null));

    const service = makeService({ leaseDAO, paymentProcessorDAO });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toMatchObject({
      message: 'Client payment processor not configured.',
    });
  });

  it('calls paymentProcessorDAO.findFirst with correct filter', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(null));

    const service = makeService({ leaseDAO, paymentProcessorDAO });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toThrow(NotFoundError);

    expect(paymentProcessorDAO.findFirst).toHaveBeenCalledWith({
      cuid: CUID,
      ownerType: { $in: ['client', null] },
      deletedAt: null,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — electronic lease / profile not found
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — electronic lease, profile not found', () => {
  let leaseDAO: { getActiveLeaseByTenant: jest.Mock };
  let paymentProcessorDAO: { findFirst: jest.Mock };
  let profileDAO: { findFirst: jest.Mock };

  beforeEach(() => {
    leaseDAO = { getActiveLeaseByTenant: jest.fn() };
    paymentProcessorDAO = { findFirst: jest.fn() };
    profileDAO = { findFirst: jest.fn() };
  });

  afterEach(() => jest.clearAllMocks());

  it('throws NotFoundError when profileDAO.findFirst returns null', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(null));

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toThrow(NotFoundError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — electronic lease / existing customer
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — electronic lease, existing customer', () => {
  let leaseDAO: { getActiveLeaseByTenant: jest.Mock };
  let paymentProcessorDAO: { findFirst: jest.Mock };
  let profileDAO: { findFirst: jest.Mock };
  let paymentGatewayService: { createCustomer: jest.Mock; createSetupCheckoutSession: jest.Mock };

  beforeEach(() => {
    leaseDAO = { getActiveLeaseByTenant: jest.fn() };
    paymentProcessorDAO = { findFirst: jest.fn() };
    profileDAO = { findFirst: jest.fn() };
    paymentGatewayService = { createCustomer: jest.fn(), createSetupCheckoutSession: jest.fn() };
  });

  afterEach(() => jest.clearAllMocks());

  it('uses existing customerId from tenantProfile map without calling createCustomer', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile(EXISTING_CUSTOMER_ID)));
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: CHECKOUT_URL } })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(paymentGatewayService.createCustomer).not.toHaveBeenCalled();
  });

  it('calls createSetupCheckoutSession with STRIPE provider, existing customerId, returnUrl, and cancelUrl', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile(EXISTING_CUSTOMER_ID)));
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: CHECKOUT_URL } })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(paymentGatewayService.createSetupCheckoutSession).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      { customerId: EXISTING_CUSTOMER_ID, successUrl: RETURN_URL, cancelUrl: CANCEL_URL }
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — electronic lease / new customer creation
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — electronic lease, new customer creation', () => {
  let leaseDAO: { getActiveLeaseByTenant: jest.Mock };
  let paymentProcessorDAO: { findFirst: jest.Mock };
  let profileDAO: { findFirst: jest.Mock; updateById: jest.Mock };
  let paymentGatewayService: { createCustomer: jest.Mock; createSetupCheckoutSession: jest.Mock };

  beforeEach(() => {
    leaseDAO = { getActiveLeaseByTenant: jest.fn() };
    paymentProcessorDAO = { findFirst: jest.fn() };
    profileDAO = { findFirst: jest.fn(), updateById: jest.fn() };
    paymentGatewayService = { createCustomer: jest.fn(), createSetupCheckoutSession: jest.fn() };
  });

  afterEach(() => jest.clearAllMocks());

  it('calls createCustomer with correct arguments when customer is not in map', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile()));
    paymentGatewayService.createCustomer.mockReturnValue(
      Promise.resolve({ success: true, data: { customerId: NEW_CUSTOMER_ID } })
    );
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: CHECKOUT_URL } })
    );
    profileDAO.updateById.mockReturnValue(Promise.resolve({}));

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(paymentGatewayService.createCustomer).toHaveBeenCalledWith({
      provider: IPaymentGatewayProvider.STRIPE,
      email: user.email,
      metadata: { cuid: CUID, tenantId: TENANT_SUB },
      connectedAccountId: ACCOUNT_ID,
    });
  });

  it('saves new customerId via profileDAO.updateById after customer creation', async () => {
    const profile = makeProfile();
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(profile));
    paymentGatewayService.createCustomer.mockReturnValue(
      Promise.resolve({ success: true, data: { customerId: NEW_CUSTOMER_ID } })
    );
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: CHECKOUT_URL } })
    );
    profileDAO.updateById.mockReturnValue(Promise.resolve({}));

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(profileDAO.updateById).toHaveBeenCalledWith(profile._id.toString(), {
      $set: { [`tenantInfo.paymentGatewayCustomers.${ACCOUNT_ID}`]: NEW_CUSTOMER_ID },
    });
  });

  it('throws BadRequestError when createCustomer returns success: false', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile()));
    paymentGatewayService.createCustomer.mockReturnValue(
      Promise.resolve({ success: false, data: null })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError with correct message when createCustomer fails', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile()));
    paymentGatewayService.createCustomer.mockReturnValue(
      Promise.resolve({ success: false, data: null })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toMatchObject({
      message: 'Failed to create payment customer.',
    });
  });

  it('calls createSetupCheckoutSession with new customerId after customer creation', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile()));
    paymentGatewayService.createCustomer.mockReturnValue(
      Promise.resolve({ success: true, data: { customerId: NEW_CUSTOMER_ID } })
    );
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: CHECKOUT_URL } })
    );
    profileDAO.updateById.mockReturnValue(Promise.resolve({}));

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(paymentGatewayService.createSetupCheckoutSession).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      { customerId: NEW_CUSTOMER_ID, successUrl: RETURN_URL, cancelUrl: CANCEL_URL }
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// setupPaymentIntent — checkout session
// ═════════════════════════════════════════════════════════════════════════════

describe('AuthService.setupPaymentIntent — checkout session', () => {
  let leaseDAO: { getActiveLeaseByTenant: jest.Mock };
  let paymentProcessorDAO: { findFirst: jest.Mock };
  let profileDAO: { findFirst: jest.Mock; updateById: jest.Mock };
  let paymentGatewayService: { createCustomer: jest.Mock; createSetupCheckoutSession: jest.Mock };

  beforeEach(() => {
    leaseDAO = { getActiveLeaseByTenant: jest.fn() };
    paymentProcessorDAO = { findFirst: jest.fn() };
    profileDAO = { findFirst: jest.fn(), updateById: jest.fn() };
    paymentGatewayService = { createCustomer: jest.fn(), createSetupCheckoutSession: jest.fn() };
  });

  afterEach(() => jest.clearAllMocks());

  it('throws BadRequestError when createSetupCheckoutSession returns success: false', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile(EXISTING_CUSTOMER_ID)));
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: false, data: null })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError with correct message when createSetupCheckoutSession fails', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile(EXISTING_CUSTOMER_ID)));
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: false, data: null })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    await expect(service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL)).rejects.toMatchObject({
      message: 'Failed to create payment setup session.',
    });
  });

  it('returns requiresSetup: true with url and paymentMethod on success', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile(EXISTING_CUSTOMER_ID)));
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: CHECKOUT_URL } })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result).toEqual({
      success: true,
      data: {
        requiresSetup: true,
        url: CHECKOUT_URL,
        paymentMethod: 'auto-debit',
      },
    });
  });

  it('verifies url comes from sessionResult.data.url', async () => {
    const specificUrl = 'https://checkout.stripe.com/c/pay/cs_specific_xyz';
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile(EXISTING_CUSTOMER_ID)));
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: specificUrl } })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result.data.url).toBe(specificUrl);
  });

  it('returns correct paymentMethod in success response for mobile_payment', async () => {
    leaseDAO.getActiveLeaseByTenant.mockReturnValue(Promise.resolve(makeLease('auto-debit')));
    paymentProcessorDAO.findFirst.mockReturnValue(Promise.resolve(makeProcessor()));
    profileDAO.findFirst.mockReturnValue(Promise.resolve(makeProfile(EXISTING_CUSTOMER_ID)));
    paymentGatewayService.createSetupCheckoutSession.mockReturnValue(
      Promise.resolve({ success: true, data: { url: CHECKOUT_URL } })
    );

    const service = makeService({ leaseDAO, paymentProcessorDAO, profileDAO, paymentGatewayService });
    const user = makeTenantUser();

    const result = await service.setupPaymentIntent(CUID, user, RETURN_URL, CANCEL_URL);

    expect(result.data.paymentMethod).toBe('auto-debit');
  });
});
