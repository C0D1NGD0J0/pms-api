import { Types } from 'mongoose';

// Break the circular import chain: vendor.service → @shared/middlewares → @di/index → registerResources → vendor.service (undefined)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.fn(),
}));
jest.mock('@di/index', () => ({ container: {} }));

import { VendorCache } from '@caching/vendor.cache';
import { PermissionService } from '@services/permission';
import { VendorService } from '@services/vendor/vendor.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IPaymentGatewayProvider } from '@interfaces/subscription.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { PaymentProcessorDAO, ProfileDAO, VendorDAO, ClientDAO, UserDAO } from '@dao/index';

// ── Shared constants ──────────────────────────────────────────────────────────

const CUID = 'CLIENT001';
const VUID = 'VND001';
const ACCOUNT_ID = 'acct_1AbCdEfGhIjKlMn';
const RETURN_URL = 'https://app.example.com/vendor/onboarding/return';
const REFRESH_URL = 'https://app.example.com/vendor/onboarding/refresh';

// ── Shared helpers ────────────────────────────────────────────────────────────

const makeClient = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  cuid: CUID,
  settings: { vendorPayoutMode: 'express' },
  ...overrides,
});

const _makeVendor = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  vuid: VUID,
  cuid: CUID,
  contactPerson: { email: 'vendor@example.com' },
  deletedAt: null,
  ...overrides,
});

const makeProcessor = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  accountId: ACCOUNT_ID,
  vuid: VUID,
  cuid: CUID,
  ownerType: 'vendor',
  payoutsEnabled: false,
  chargesEnabled: false,
  detailsSubmitted: false,
  ...overrides,
});

const _makeConnectAccountResult = (overrides: Record<string, any> = {}) => ({
  success: true,
  data: {
    accountId: ACCOUNT_ID,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    ...overrides,
  },
});

const makeService = (
  overrides: Partial<{
    vendorDAO: jest.Mocked<VendorDAO>;
    clientDAO: jest.Mocked<ClientDAO>;
    paymentGatewayService: jest.Mocked<PaymentGatewayService>;
    paymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
    payoutAccountService: any;
  }> = {}
) =>
  new VendorService({
    vendorDAO: (overrides.vendorDAO ?? {
      updateClientPayoutAccount: jest.fn(),
      findFirst: jest.fn(),
    }) as jest.Mocked<VendorDAO>,
    clientDAO: (overrides.clientDAO ?? {}) as jest.Mocked<ClientDAO>,
    userDAO: {} as jest.Mocked<UserDAO>,
    profileDAO: {} as jest.Mocked<ProfileDAO>,
    vendorCache: {} as jest.Mocked<VendorCache>,
    permissionService: {} as jest.Mocked<PermissionService>,
    paymentGatewayService: (overrides.paymentGatewayService ??
      {}) as jest.Mocked<PaymentGatewayService>,
    payoutAccountService: (overrides.payoutAccountService ?? {}) as any,
    paymentProcessorDAO: (overrides.paymentProcessorDAO ?? {}) as jest.Mocked<PaymentProcessorDAO>,
    maintenanceRequestDAO: {} as any,
    geoCoderService: {} as any,
    userCache: {} as any,
  });

// ═════════════════════════════════════════════════════════════════════════════
// initiatePayoutOnboarding
// ═════════════════════════════════════════════════════════════════════════════

describe('VendorService - initiatePayoutOnboarding', () => {
  let vendorService: VendorService;
  let mockClientDAO: { getClientByCuid: jest.Mock };
  let mockVendorDAO: { findFirst: jest.Mock; updateClientPayoutAccount: jest.Mock };
  let mockPaymentProcessorDAO: { findByVuid: jest.Mock };
  let mockPayoutAccountService: { initiateVendorAccount: jest.Mock };

  beforeEach(() => {
    mockClientDAO = { getClientByCuid: jest.fn() };
    mockVendorDAO = { findFirst: jest.fn(), updateClientPayoutAccount: jest.fn() };
    mockPaymentProcessorDAO = { findByVuid: jest.fn() };
    mockPayoutAccountService = { initiateVendorAccount: jest.fn() };

    vendorService = makeService({
      clientDAO: mockClientDAO as any,
      vendorDAO: mockVendorDAO as any,
      paymentProcessorDAO: mockPaymentProcessorDAO as any,
      payoutAccountService: mockPayoutAccountService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should throw NotFoundError when client is not found', async () => {
    // Arrange
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(null));

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(NotFoundError);
    expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith(CUID);
    expect(mockPaymentProcessorDAO.findByVuid).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when client vendorPayoutMode is not "express"', async () => {
    // Arrange
    const client = makeClient({ settings: { vendorPayoutMode: 'manual' } });
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(
      BadRequestError
    );
    expect(mockPaymentProcessorDAO.findByVuid).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when client has no vendorPayoutMode setting', async () => {
    // Arrange
    const client = makeClient({ settings: {} });
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(
      BadRequestError
    );
  });

  it('should return existing accountId and sync connectedClients when a processor record already exists (idempotent)', async () => {
    // Arrange
    const client = makeClient();
    const processor = makeProcessor({
      detailsSubmitted: true,
      payoutsEnabled: true,
      chargesEnabled: true,
    });
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockVendorDAO.updateClientPayoutAccount.mockReturnValue(Promise.resolve({}));

    // Act
    const result = await vendorService.initiatePayoutOnboarding(CUID, VUID);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data.accountId).toBe(ACCOUNT_ID);
    expect(mockVendorDAO.updateClientPayoutAccount).toHaveBeenCalledWith(VUID, CUID, {
      isSetup: true,
      payoutsEnabled: true,
      chargesEnabled: true,
    });
    expect(mockPayoutAccountService.initiateVendorAccount).not.toHaveBeenCalled();
  });

  it('should delegate to payoutAccountService.initiateVendorAccount when no processor exists', async () => {
    // Arrange
    const client = makeClient();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPayoutAccountService.initiateVendorAccount.mockReturnValue(
      Promise.resolve({ success: true, data: { accountId: ACCOUNT_ID } })
    );

    // Act
    const result = await vendorService.initiatePayoutOnboarding(CUID, VUID);

    // Assert
    expect(mockPayoutAccountService.initiateVendorAccount).toHaveBeenCalledWith(CUID, VUID);
    expect(result.success).toBe(true);
    expect(result.data.accountId).toBe(ACCOUNT_ID);
  });

  it('should propagate errors thrown by payoutAccountService.initiateVendorAccount', async () => {
    // Arrange
    const client = makeClient();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPayoutAccountService.initiateVendorAccount.mockReturnValue(
      Promise.reject(
        new BadRequestError({ message: 'Failed to create payout account with provider.' })
      )
    );

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(
      BadRequestError
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPayoutOnboardingLink
// ═════════════════════════════════════════════════════════════════════════════

describe('VendorService - getPayoutOnboardingLink', () => {
  let vendorService: VendorService;
  let mockPayoutAccountService: { getVendorKycOnboardingLink: jest.Mock };

  beforeEach(() => {
    mockPayoutAccountService = { getVendorKycOnboardingLink: jest.fn() };

    vendorService = makeService({
      payoutAccountService: mockPayoutAccountService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should delegate to payoutAccountService.getVendorKycOnboardingLink with correct args', async () => {
    // Arrange
    const onboardingUrl = 'https://connect.stripe.com/onboarding/abc';
    mockPayoutAccountService.getVendorKycOnboardingLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: onboardingUrl } })
    );

    // Act
    const result = await vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL);

    // Assert
    expect(mockPayoutAccountService.getVendorKycOnboardingLink).toHaveBeenCalledWith(
      CUID,
      VUID,
      RETURN_URL,
      REFRESH_URL
    );
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ url: onboardingUrl });
  });

  it('should propagate errors from payoutAccountService.getVendorKycOnboardingLink', async () => {
    // Arrange
    mockPayoutAccountService.getVendorKycOnboardingLink.mockReturnValue(
      Promise.reject(new NotFoundError({ message: 'Payout account not found.' }))
    );

    // Act & Assert
    await expect(
      vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL)
    ).rejects.toThrow(NotFoundError);
  });

  it('should return { success: true, data: { url } } on success', async () => {
    // Arrange
    const _processor = makeProcessor();
    const onboardingUrl = 'https://connect.stripe.com/onboarding/abc123';
    mockPayoutAccountService.getVendorKycOnboardingLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: onboardingUrl } })
    );

    // Act
    const result = await vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ url: onboardingUrl });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// syncPayoutAccountStatus
// ═════════════════════════════════════════════════════════════════════════════

describe('VendorService - syncPayoutAccountStatus', () => {
  let vendorService: VendorService;
  let mockPaymentGatewayService: { getConnectAccount: jest.Mock };
  let mockPaymentProcessorDAO: { findByVuid: jest.Mock; upsertForVendor: jest.Mock };

  beforeEach(() => {
    mockPaymentGatewayService = { getConnectAccount: jest.fn() };
    mockPaymentProcessorDAO = { findByVuid: jest.fn(), upsertForVendor: jest.fn() };

    vendorService = makeService({
      paymentGatewayService: mockPaymentGatewayService as any,
      paymentProcessorDAO: mockPaymentProcessorDAO as any,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should throw NotFoundError when no processor record is found', async () => {
    // Arrange
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));

    // Act & Assert
    await expect(vendorService.syncPayoutAccountStatus(CUID, VUID)).rejects.toThrow(NotFoundError);
    expect(mockPaymentProcessorDAO.findByVuid).toHaveBeenCalledWith(VUID);
    expect(mockPaymentGatewayService.getConnectAccount).not.toHaveBeenCalled();
  });

  it('should call getConnectAccount with the processor accountId', async () => {
    // Arrange
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({
        success: true,
        data: { charges_enabled: false, payouts_enabled: false, details_submitted: false },
      })
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.syncPayoutAccountStatus(CUID, VUID);

    // Assert
    expect(mockPaymentGatewayService.getConnectAccount).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      ACCOUNT_ID
    );
  });

  it('should throw BadRequestError when getConnectAccount returns success: false', async () => {
    // Arrange
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({ success: false, data: null, message: 'Account not found' })
    );

    // Act & Assert
    await expect(vendorService.syncPayoutAccountStatus(CUID, VUID)).rejects.toThrow(
      BadRequestError
    );
    expect(mockPaymentProcessorDAO.upsertForVendor).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when getConnectAccount returns success: true but data is null', async () => {
    // Arrange
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({ success: true, data: null })
    );

    // Act & Assert
    await expect(vendorService.syncPayoutAccountStatus(CUID, VUID)).rejects.toThrow(
      BadRequestError
    );
  });

  it('should call upsertForVendor with updated status fields from provider', async () => {
    // Arrange
    const processor = makeProcessor({ payoutsEnabled: false });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({
        success: true,
        data: { charges_enabled: true, payouts_enabled: false, details_submitted: true },
      })
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.syncPayoutAccountStatus(CUID, VUID);

    // Assert
    expect(mockPaymentProcessorDAO.upsertForVendor).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: ACCOUNT_ID,
        chargesEnabled: true,
        payoutsEnabled: false,
        detailsSubmitted: true,
        ownerType: 'vendor',
        vuid: VUID,
        cuid: CUID,
      })
    );
  });

  it('should set onboardedAt when payoutsEnabled transitions from false to true (justVerified)', async () => {
    // Arrange — processor currently has payoutsEnabled: false
    const processor = makeProcessor({ payoutsEnabled: false });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    // Provider now reports payouts_enabled: true
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({
        success: true,
        data: { charges_enabled: true, payouts_enabled: true, details_submitted: true },
      })
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.syncPayoutAccountStatus(CUID, VUID);

    // Assert
    const upsertArgs = mockPaymentProcessorDAO.upsertForVendor.mock.calls[0][0];
    expect(upsertArgs.onboardedAt).toBeInstanceOf(Date);
  });

  it('should NOT set onboardedAt when payoutsEnabled was already true before sync', async () => {
    // Arrange — processor already has payoutsEnabled: true
    const processor = makeProcessor({ payoutsEnabled: true });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    // Provider also reports payouts_enabled: true (no transition)
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({
        success: true,
        data: { charges_enabled: true, payouts_enabled: true, details_submitted: true },
      })
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.syncPayoutAccountStatus(CUID, VUID);

    // Assert
    const upsertArgs = mockPaymentProcessorDAO.upsertForVendor.mock.calls[0][0];
    expect(upsertArgs.onboardedAt).toBeUndefined();
  });

  it('should NOT set onboardedAt when payoutsEnabled remains false after sync', async () => {
    // Arrange — processor has payoutsEnabled: false
    const processor = makeProcessor({ payoutsEnabled: false });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    // Provider also reports payouts_enabled: false (no transition)
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({
        success: true,
        data: { charges_enabled: false, payouts_enabled: false, details_submitted: false },
      })
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.syncPayoutAccountStatus(CUID, VUID);

    // Assert
    const upsertArgs = mockPaymentProcessorDAO.upsertForVendor.mock.calls[0][0];
    expect(upsertArgs.onboardedAt).toBeUndefined();
  });

  it('should return { isSetup, payoutsEnabled, chargesEnabled } on success', async () => {
    // Arrange
    const processor = makeProcessor({ payoutsEnabled: false });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({
        success: true,
        data: { charges_enabled: true, payouts_enabled: true, details_submitted: true },
      })
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    const result = await vendorService.syncPayoutAccountStatus(CUID, VUID);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toEqual({
      isSetup: true,
      payoutsEnabled: true,
      chargesEnabled: true,
    });
  });

  it('should default missing boolean fields to false in the return value', async () => {
    // Arrange
    const processor = makeProcessor({ payoutsEnabled: false });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    // Provider returns undefined for boolean fields (edge case)
    mockPaymentGatewayService.getConnectAccount.mockReturnValue(
      Promise.resolve({
        success: true,
        data: {
          charges_enabled: undefined,
          payouts_enabled: undefined,
          details_submitted: undefined,
        },
      })
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    const result = await vendorService.syncPayoutAccountStatus(CUID, VUID);

    // Assert
    expect(result.data.isSetup).toBe(false);
    expect(result.data.payoutsEnabled).toBe(false);
    expect(result.data.chargesEnabled).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPayoutDashboardLink
// ═════════════════════════════════════════════════════════════════════════════

describe('VendorService - getPayoutDashboardLink', () => {
  let vendorService: VendorService;
  let mockPayoutAccountService: { getVendorDashboardLink: jest.Mock };

  beforeEach(() => {
    mockPayoutAccountService = { getVendorDashboardLink: jest.fn() };

    vendorService = makeService({
      payoutAccountService: mockPayoutAccountService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should delegate to payoutAccountService.getVendorDashboardLink with correct args', async () => {
    // Arrange
    const dashboardUrl = 'https://dashboard.stripe.com/express/acct_1AbCdEfGhIjKlMn';
    mockPayoutAccountService.getVendorDashboardLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: dashboardUrl } })
    );

    // Act
    const result = await vendorService.getPayoutDashboardLink(CUID, VUID);

    // Assert
    expect(mockPayoutAccountService.getVendorDashboardLink).toHaveBeenCalledWith(CUID, VUID);
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ url: dashboardUrl });
  });

  it('should propagate errors from payoutAccountService.getVendorDashboardLink', async () => {
    // Arrange
    mockPayoutAccountService.getVendorDashboardLink.mockReturnValue(
      Promise.reject(new NotFoundError({ message: 'Payout account not found.' }))
    );

    // Act & Assert
    await expect(vendorService.getPayoutDashboardLink(CUID, VUID)).rejects.toThrow(NotFoundError);
  });
});
