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
import {
  PaymentProcessorDAO,
  ProfileDAO,
  VendorDAO,
  ClientDAO,
  UserDAO,
} from '@dao/index';

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

const makeVendor = (overrides: Record<string, any> = {}) => ({
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

const makeConnectAccountResult = (overrides: Record<string, any> = {}) => ({
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
  }> = {}
) =>
  new VendorService({
    vendorDAO: (overrides.vendorDAO ?? {}) as jest.Mocked<VendorDAO>,
    clientDAO: (overrides.clientDAO ?? {}) as jest.Mocked<ClientDAO>,
    userDAO: {} as jest.Mocked<UserDAO>,
    profileDAO: {} as jest.Mocked<ProfileDAO>,
    vendorCache: {} as jest.Mocked<VendorCache>,
    permissionService: {} as jest.Mocked<PermissionService>,
    paymentGatewayService: (overrides.paymentGatewayService ?? {}) as jest.Mocked<PaymentGatewayService>,
    paymentProcessorDAO: (overrides.paymentProcessorDAO ?? {}) as jest.Mocked<PaymentProcessorDAO>,
    maintenanceRequestDAO: {} as any,
  });

// ═════════════════════════════════════════════════════════════════════════════
// initiatePayoutOnboarding
// ═════════════════════════════════════════════════════════════════════════════

describe('VendorService - initiatePayoutOnboarding', () => {
  let vendorService: VendorService;
  let mockClientDAO: { getClientByCuid: jest.Mock };
  let mockVendorDAO: { findFirst: jest.Mock };
  let mockPaymentGatewayService: { createConnectAccount: jest.Mock };
  let mockPaymentProcessorDAO: { findByVuid: jest.Mock; upsertForVendor: jest.Mock };

  beforeEach(() => {
    mockClientDAO = { getClientByCuid: jest.fn() };
    mockVendorDAO = { findFirst: jest.fn() };
    mockPaymentGatewayService = { createConnectAccount: jest.fn() };
    mockPaymentProcessorDAO = { findByVuid: jest.fn(), upsertForVendor: jest.fn() };

    vendorService = makeService({
      clientDAO: mockClientDAO as any,
      vendorDAO: mockVendorDAO as any,
      paymentGatewayService: mockPaymentGatewayService as any,
      paymentProcessorDAO: mockPaymentProcessorDAO as any,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should throw NotFoundError when client is not found', async () => {
    // Arrange
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(null));

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(NotFoundError);
    expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith(CUID);
    expect(mockVendorDAO.findFirst).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when client vendorPayoutMode is not "express"', async () => {
    // Arrange
    const client = makeClient({ settings: { vendorPayoutMode: 'manual' } });
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(BadRequestError);
    expect(mockVendorDAO.findFirst).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when client has no vendorPayoutMode setting', async () => {
    // Arrange
    const client = makeClient({ settings: {} });
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(BadRequestError);
  });

  it('should throw NotFoundError when vendor is not found', async () => {
    // Arrange
    const client = makeClient();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(null));

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(NotFoundError);
    expect(mockVendorDAO.findFirst).toHaveBeenCalledWith({ vuid: VUID, cuid: CUID, deletedAt: null });
    expect(mockPaymentProcessorDAO.findByVuid).not.toHaveBeenCalled();
  });

  it('should return existing accountId when a processor record already exists (idempotent)', async () => {
    // Arrange
    const client = makeClient();
    const vendor = makeVendor();
    const processor = makeProcessor();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(vendor));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));

    // Act
    const result = await vendorService.initiatePayoutOnboarding(CUID, VUID);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data.accountId).toBe(ACCOUNT_ID);
    expect(mockPaymentGatewayService.createConnectAccount).not.toHaveBeenCalled();
    expect(mockPaymentProcessorDAO.upsertForVendor).not.toHaveBeenCalled();
  });

  it('should call createConnectAccount with the correct arguments when no processor exists', async () => {
    // Arrange
    const client = makeClient();
    const vendor = makeVendor();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(vendor));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPaymentGatewayService.createConnectAccount.mockReturnValue(
      Promise.resolve(makeConnectAccountResult())
    );
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.initiatePayoutOnboarding(CUID, VUID);

    // Assert
    expect(mockPaymentGatewayService.createConnectAccount).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      {
        email: 'vendor@example.com',
        country: 'CA',
        businessType: 'individual',
        metadata: { vuid: VUID, cuid: CUID },
        cuid: CUID,
      }
    );
  });

  it('should call upsertForVendor with account data after successful createConnectAccount', async () => {
    // Arrange
    const client = makeClient();
    const vendor = makeVendor();
    const connectResult = makeConnectAccountResult({
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: false,
    });
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(vendor));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPaymentGatewayService.createConnectAccount.mockReturnValue(Promise.resolve(connectResult));
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.initiatePayoutOnboarding(CUID, VUID);

    // Assert
    expect(mockPaymentProcessorDAO.upsertForVendor).toHaveBeenCalledWith({
      accountId: ACCOUNT_ID,
      chargesEnabled: true,
      payoutsEnabled: false,
      detailsSubmitted: false,
      ownerType: 'vendor',
      client: client._id,
      vuid: VUID,
      cuid: CUID,
    });
  });

  it('should throw BadRequestError when createConnectAccount returns success: false', async () => {
    // Arrange
    const client = makeClient();
    const vendor = makeVendor();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(vendor));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPaymentGatewayService.createConnectAccount.mockReturnValue(
      Promise.resolve({ success: false, data: null, message: 'Stripe error' })
    );

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(BadRequestError);
    expect(mockPaymentProcessorDAO.upsertForVendor).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when createConnectAccount returns success: true but data is null', async () => {
    // Arrange
    const client = makeClient();
    const vendor = makeVendor();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(vendor));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPaymentGatewayService.createConnectAccount.mockReturnValue(
      Promise.resolve({ success: true, data: null })
    );

    // Act & Assert
    await expect(vendorService.initiatePayoutOnboarding(CUID, VUID)).rejects.toThrow(BadRequestError);
  });

  it('should return { success: true, data: { accountId } } on successful account creation', async () => {
    // Arrange
    const client = makeClient();
    const vendor = makeVendor();
    const connectResult = makeConnectAccountResult();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(vendor));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPaymentGatewayService.createConnectAccount.mockReturnValue(Promise.resolve(connectResult));
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    const result = await vendorService.initiatePayoutOnboarding(CUID, VUID);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ accountId: ACCOUNT_ID });
  });

  it('should use empty string for email when vendor has no contactPerson email', async () => {
    // Arrange
    const client = makeClient();
    const vendor = makeVendor({ contactPerson: {} });
    const connectResult = makeConnectAccountResult();
    mockClientDAO.getClientByCuid.mockReturnValue(Promise.resolve(client));
    mockVendorDAO.findFirst.mockReturnValue(Promise.resolve(vendor));
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(null));
    mockPaymentGatewayService.createConnectAccount.mockReturnValue(Promise.resolve(connectResult));
    mockPaymentProcessorDAO.upsertForVendor.mockReturnValue(Promise.resolve({}));

    // Act
    await vendorService.initiatePayoutOnboarding(CUID, VUID);

    // Assert
    expect(mockPaymentGatewayService.createConnectAccount).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      expect.objectContaining({ email: '' })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPayoutOnboardingLink
// ═════════════════════════════════════════════════════════════════════════════

describe('VendorService - getPayoutOnboardingLink', () => {
  let vendorService: VendorService;
  let mockPaymentGatewayService: { createKycOnboardingLink: jest.Mock };
  let mockPaymentProcessorDAO: { findByVuid: jest.Mock };

  beforeEach(() => {
    mockPaymentGatewayService = { createKycOnboardingLink: jest.fn() };
    mockPaymentProcessorDAO = { findByVuid: jest.fn() };

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
    await expect(
      vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL)
    ).rejects.toThrow(NotFoundError);
    expect(mockPaymentProcessorDAO.findByVuid).toHaveBeenCalledWith(VUID, CUID);
    expect(mockPaymentGatewayService.createKycOnboardingLink).not.toHaveBeenCalled();
  });

  it('should call createKycOnboardingLink with the correct arguments', async () => {
    // Arrange
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createKycOnboardingLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: 'https://connect.stripe.com/onboarding/abc' } })
    );

    // Act
    await vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL);

    // Assert
    expect(mockPaymentGatewayService.createKycOnboardingLink).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      { accountId: ACCOUNT_ID, returnUrl: RETURN_URL, refreshUrl: REFRESH_URL }
    );
  });

  it('should throw BadRequestError when createKycOnboardingLink returns success: false', async () => {
    // Arrange
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createKycOnboardingLink.mockReturnValue(
      Promise.resolve({ success: false, data: null, message: 'Link generation failed' })
    );

    // Act & Assert
    await expect(
      vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL)
    ).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when createKycOnboardingLink returns success: true but data is null', async () => {
    // Arrange
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createKycOnboardingLink.mockReturnValue(
      Promise.resolve({ success: true, data: null })
    );

    // Act & Assert
    await expect(
      vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL)
    ).rejects.toThrow(BadRequestError);
  });

  it('should return { success: true, data: { url } } on success', async () => {
    // Arrange
    const processor = makeProcessor();
    const onboardingUrl = 'https://connect.stripe.com/onboarding/abc123';
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createKycOnboardingLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: onboardingUrl } })
    );

    // Act
    const result = await vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ url: onboardingUrl });
  });

  it('should use the processor accountId when calling createKycOnboardingLink', async () => {
    // Arrange
    const customAccountId = 'acct_differentAccount';
    const processor = makeProcessor({ accountId: customAccountId });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createKycOnboardingLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: 'https://stripe.com/link' } })
    );

    // Act
    await vendorService.getPayoutOnboardingLink(CUID, VUID, RETURN_URL, REFRESH_URL);

    // Assert
    expect(mockPaymentGatewayService.createKycOnboardingLink).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      expect.objectContaining({ accountId: customAccountId })
    );
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
    expect(mockPaymentProcessorDAO.findByVuid).toHaveBeenCalledWith(VUID, CUID);
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
    await expect(vendorService.syncPayoutAccountStatus(CUID, VUID)).rejects.toThrow(BadRequestError);
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
    await expect(vendorService.syncPayoutAccountStatus(CUID, VUID)).rejects.toThrow(BadRequestError);
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
        data: { charges_enabled: undefined, payouts_enabled: undefined, details_submitted: undefined },
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
  let mockPaymentGatewayService: { createDashboardLoginLink: jest.Mock };
  let mockPaymentProcessorDAO: { findByVuid: jest.Mock };

  beforeEach(() => {
    mockPaymentGatewayService = { createDashboardLoginLink: jest.fn() };
    mockPaymentProcessorDAO = { findByVuid: jest.fn() };

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
    await expect(vendorService.getPayoutDashboardLink(CUID, VUID)).rejects.toThrow(NotFoundError);
    expect(mockPaymentProcessorDAO.findByVuid).toHaveBeenCalledWith(VUID, CUID);
    expect(mockPaymentGatewayService.createDashboardLoginLink).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when detailsSubmitted is false', async () => {
    // Arrange
    const processor = makeProcessor({ detailsSubmitted: false });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));

    // Act & Assert
    await expect(vendorService.getPayoutDashboardLink(CUID, VUID)).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.createDashboardLoginLink).not.toHaveBeenCalled();
  });

  it('should call createDashboardLoginLink with correct provider and accountId', async () => {
    // Arrange
    const processor = makeProcessor({ detailsSubmitted: true });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createDashboardLoginLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: 'https://dashboard.stripe.com/login' } })
    );

    // Act
    await vendorService.getPayoutDashboardLink(CUID, VUID);

    // Assert
    expect(mockPaymentGatewayService.createDashboardLoginLink).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      ACCOUNT_ID
    );
  });

  it('should throw BadRequestError when createDashboardLoginLink returns success: false', async () => {
    // Arrange
    const processor = makeProcessor({ detailsSubmitted: true });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createDashboardLoginLink.mockReturnValue(
      Promise.resolve({ success: false, data: null, message: 'Login link generation failed' })
    );

    // Act & Assert
    await expect(vendorService.getPayoutDashboardLink(CUID, VUID)).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when createDashboardLoginLink returns success: true but data is null', async () => {
    // Arrange
    const processor = makeProcessor({ detailsSubmitted: true });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createDashboardLoginLink.mockReturnValue(
      Promise.resolve({ success: true, data: null })
    );

    // Act & Assert
    await expect(vendorService.getPayoutDashboardLink(CUID, VUID)).rejects.toThrow(BadRequestError);
  });

  it('should return { success: true, data: { url } } on success', async () => {
    // Arrange
    const dashboardUrl = 'https://dashboard.stripe.com/express/acct_1AbCdEfGhIjKlMn';
    const processor = makeProcessor({ detailsSubmitted: true });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createDashboardLoginLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: dashboardUrl } })
    );

    // Act
    const result = await vendorService.getPayoutDashboardLink(CUID, VUID);

    // Assert
    expect(result.success).toBe(true);
    expect(result.data).toEqual({ url: dashboardUrl });
  });

  it('should use the processor accountId from the specific processor record', async () => {
    // Arrange
    const customAccountId = 'acct_customDashboard';
    const processor = makeProcessor({ accountId: customAccountId, detailsSubmitted: true });
    mockPaymentProcessorDAO.findByVuid.mockReturnValue(Promise.resolve(processor));
    mockPaymentGatewayService.createDashboardLoginLink.mockReturnValue(
      Promise.resolve({ success: true, data: { url: 'https://stripe.com/dash' } })
    );

    // Act
    await vendorService.getPayoutDashboardLink(CUID, VUID);

    // Assert
    expect(mockPaymentGatewayService.createDashboardLoginLink).toHaveBeenCalledWith(
      IPaymentGatewayProvider.STRIPE,
      customAccountId
    );
  });
});
