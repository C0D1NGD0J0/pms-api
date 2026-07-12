import { Types } from 'mongoose';

// Break the circular import chain: payments.service → @shared/middlewares → @di/index → registerResources → payments.service (undefined)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { InvoiceDAO } from '@dao/invoiceDAO';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { PaymentService } from '@services/payments/payments.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { StripeService } from '@services/external/stripe/stripe.service';
import { PaymentCronService } from '@services/payments/paymentCron.service';
import { RentPaymentService } from '@services/payments/rentPayment.service';
import { PayoutAccountService } from '@services/payments/payoutAccount.service';
import { PaymentWebhookService } from '@services/payments/paymentWebhook.service';
import { TenantPaymentStatus, InvoiceStatus } from '@interfaces/invoice.interface';
import { SubscriptionPlanConfig, subscriptionPlanConfig } from '@services/subscription';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
import { MaintenancePaymentService } from '@services/payments/maintenancePayment.service';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';
import {
  PaymentProcessorDAO,
  SubscriptionDAO,
  PaymentDAO,
  ProfileDAO,
  ClientDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';

// ── Shared constants ──────────────────────────────────────────────────────────

const CUID = 'MMQHHVX09JJT';
const PYTUID = 'PYT001';

// ── Shared helpers ────────────────────────────────────────────────────────────

const makePayment = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: PYTUID,
  cuid: CUID,
  status: PaymentRecordStatus.PENDING,
  paymentType: PaymentRecordType.RENT,
  baseAmount: 150000,
  processingFee: 2900,
  dueDate: new Date('2026-03-01'),
  tenant: new Types.ObjectId(),
  notes: [],
  ...overrides,
});

const makeServiceWithMocks = (
  overrides: Partial<{
    paymentDAO: jest.Mocked<PaymentDAO>;
    clientDAO: jest.Mocked<ClientDAO>;
    profileDAO: jest.Mocked<ProfileDAO>;
    leaseDAO: jest.Mocked<LeaseDAO>;
    paymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
    paymentGatewayService: jest.Mocked<PaymentGatewayService>;
    subscriptionDAO: jest.Mocked<SubscriptionDAO>;
    emitterService: { emit: jest.Mock; on: jest.Mock };
    stripeService: { createPaymentCheckoutSession: jest.Mock };
    userDAO: jest.Mocked<UserDAO>;
  }> = {}
) => {
  const paymentDAO = (overrides.paymentDAO ?? {
    list: jest.fn().mockResolvedValue({ items: [], pagination: null }),
    startSession: jest.fn().mockResolvedValue({}),
    withTransaction: jest.fn((_session: unknown, cb: (s: unknown) => unknown) => cb(_session)),
  }) as jest.Mocked<PaymentDAO>;
  const clientDAO = (overrides.clientDAO ?? {}) as jest.Mocked<ClientDAO>;
  const profileDAO = (overrides.profileDAO ?? {
    findFirst: jest.fn().mockResolvedValue(null),
  }) as jest.Mocked<ProfileDAO>;
  const leaseDAO = (overrides.leaseDAO ?? {}) as jest.Mocked<LeaseDAO>;
  const paymentProcessorDAO = (overrides.paymentProcessorDAO ?? {
    findFirst: jest.fn().mockResolvedValue(null),
    findByVuid: jest.fn().mockResolvedValue(null),
  }) as jest.Mocked<PaymentProcessorDAO>;
  const paymentGatewayService = (overrides.paymentGatewayService ??
    {}) as jest.Mocked<PaymentGatewayService>;
  const emitterService = (overrides.emitterService ?? { emit: jest.fn(), on: jest.fn() }) as any;
  const subscriptionDAO = (overrides.subscriptionDAO ?? {}) as jest.Mocked<SubscriptionDAO>;
  const userDAO = (overrides.userDAO ?? {}) as jest.Mocked<UserDAO>;
  const stripeService = (overrides.stripeService ?? {
    createPaymentCheckoutSession: jest.fn(),
    getPaymentIntentReceiptUrl: jest.fn().mockResolvedValue(null),
    getPaymentIntentChargeInfo: jest.fn().mockResolvedValue({ chargeId: null, receiptUrl: null }),
    getInvoicePaymentDetails: jest.fn().mockResolvedValue({ chargeId: null }),
  }) as any;
  const subscriptionPlanConfig = {
    calculatePaymentGatewayFee: jest.fn().mockReturnValue(80),
    calculateAchApplicationFee: jest.fn().mockReturnValue(100),
    getTransactionFeePercent: jest.fn().mockReturnValue(2.5),
  } as unknown as jest.Mocked<SubscriptionPlanConfig>;
  const queueFactory = { getQueue: jest.fn() } as any;
  const invoiceDAO = {} as any;

  const paymentWebhookService = new PaymentWebhookService({
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionDAO,
    emitterService,
    stripeService: stripeService as unknown as StripeService,
    smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
    userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
    profileDAO,
    paymentDAO,
    invoiceDAO,
  });

  const payoutAccountService = new PayoutAccountService({
    paymentGatewayService,
    paymentProcessorDAO,
    profileDAO,
    clientDAO,
    vendorDAO: {} as any,
  });

  const paymentCronService = new PaymentCronService({
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    emitterService,
    subscriptionDAO,
    stripeService: stripeService as unknown as StripeService,
    smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
    invoiceDAO,
    queueFactory,
    profileDAO,
    paymentDAO,
    clientDAO,
    leaseDAO,
  });

  const maintenancePaymentService = new MaintenancePaymentService({
    paymentGatewayService,
    paymentProcessorDAO,
    subscriptionPlanConfig,
    emitterService,
    subscriptionDAO,
    smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
    invoiceDAO,
    profileDAO,
    paymentDAO,
    clientDAO,
    vendorDAO: {} as any,
    leaseDAO,
    userDAO,
  });

  const rentPaymentService = new RentPaymentService({
    subscriptionPlanConfig,
    paymentGatewayService,
    paymentWebhookService,
    paymentProcessorDAO,
    emitterService,
    subscriptionDAO,
    paymentCronService,
    queueFactory,
    paymentDAO,
    profileDAO,
    userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
    clientDAO,
    leaseDAO,
  });

  return new PaymentService({
    maintenancePaymentService,
    paymentWebhookService,
    payoutAccountService,
    paymentCronService,
    rentPaymentService,
    invoiceTemplateRenderer: {
      render: jest.fn().mockReturnValue(Promise.resolve('<html></html>')),
    } as any,
    subscriptionPlanConfig,
    paymentGatewayService,
    pdfGeneratorService: {} as any,
    paymentProcessorDAO,
    emitterService,
    subscriptionDAO,
    stripeService: stripeService as unknown as StripeService,
    invoiceDAO,
    paymentDAO,
    profileDAO,
    clientDAO,
    leaseDAO,
    userDAO,
  });
};

// ═════════════════════════════════════════════════════════════════════════════
// setup payment method webhooks
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - setup payment method webhooks', () => {
  const tenantId = new Types.ObjectId().toString();
  const pmAccountId = 'acct_pm_123';
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn().mockResolvedValue({ accountId: pmAccountId }),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      retrievePaymentMethod: jest.fn().mockResolvedValue({
        success: true,
        data: { type: 'acss_debit' },
      }),
      updateCustomerDefaultPaymentMethod: jest.fn().mockResolvedValue({
        success: true,
      }),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    mockProfileDAO = {
      update: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ProfileDAO>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };

    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
      profileDAO: mockProfileDAO,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('saves payment method and mandate from setup_intent.succeeded', async () => {
    await paymentService.handleSetupIntentSucceeded({
      id: 'seti_123',
      metadata: { tenantId, cuid: CUID },
      customer: 'cus_123',
      payment_method: 'pm_123',
      mandate: 'mandate_123',
    });

    expect(mockProfileDAO.update).toHaveBeenCalledWith(
      { user: new Types.ObjectId(tenantId) },
      {
        $set: {
          [`tenantInfo.paymentMethods.${pmAccountId}`]: 'pm_123',
          [`tenantInfo.paymentMandates.${pmAccountId}`]: 'mandate_123',
        },
      }
    );
    expect(mockPaymentGatewayService.updateCustomerDefaultPaymentMethod).toHaveBeenCalledWith(
      expect.anything(),
      'cus_123',
      'pm_123'
    );
  });

  it('does not save a bank debit payment method when the mandate is missing', async () => {
    await paymentService.handleSetupIntentSucceeded({
      id: 'seti_123',
      metadata: { tenantId, cuid: CUID },
      customer: 'cus_123',
      payment_method: 'pm_123',
      mandate: null,
    });

    expect(mockProfileDAO.update).not.toHaveBeenCalled();
    expect(mockPaymentGatewayService.updateCustomerDefaultPaymentMethod).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// cancelPayment
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - cancelPayment', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  const mockTenantUserId = new Types.ObjectId();
  const mockTenantProfile = { _id: new Types.ObjectId(), user: mockTenantUserId };

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockClientDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = { findById: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockPaymentGatewayService = {
      voidInvoice: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };

    mockProfileDAO.findById.mockResolvedValue(mockTenantProfile as any);
    mockPaymentGatewayService.voidInvoice.mockResolvedValue({ success: true, data: null } as any);

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      paymentGatewayService: mockPaymentGatewayService,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should cancel a pending payment', async () => {
    const payment = makePayment();
    const cancelled = { ...payment, status: PaymentRecordStatus.CANCELLED };

    mockClientDAO.findFirst.mockResolvedValue({ _id: new Types.ObjectId(), cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue(cancelled as any);

    const result = await paymentService.cancelPayment(CUID, PYTUID);

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(PaymentRecordStatus.CANCELLED);
  });

  it('should cancel an overdue payment', async () => {
    const payment = makePayment({ status: PaymentRecordStatus.OVERDUE });
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    const result = await paymentService.cancelPayment(CUID, PYTUID);
    expect(result.success).toBe(true);
  });

  it('should include a cancellation note when reason is provided', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    await paymentService.cancelPayment(CUID, PYTUID, 'Tenant moved out');

    expect(mockPaymentDAO.updateById.mock.calls[0][1]).toMatchObject({
      status: PaymentRecordStatus.CANCELLED,
      $push: { notes: expect.objectContaining({ text: 'Cancelled: Tenant moved out' }) },
    });
  });

  it('should not add notes when no reason is provided', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    expect(mockPaymentDAO.updateById.mock.calls[0][1].$push).toBeUndefined();
  });

  it('should throw BadRequestError when cuid or pytuid is missing', async () => {
    await expect(paymentService.cancelPayment('', PYTUID)).rejects.toThrow(BadRequestError);
    await expect(paymentService.cancelPayment(CUID, '')).rejects.toThrow(BadRequestError);
  });

  it('should throw NotFoundError when client or payment does not exist', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(NotFoundError);

    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(NotFoundError);
  });

  it('should throw BadRequestError when payment is already PAID or CANCELLED', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);

    mockPaymentDAO.findFirst.mockResolvedValue(
      makePayment({ status: PaymentRecordStatus.PAID }) as any
    );
    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(BadRequestError);

    mockPaymentDAO.findFirst.mockResolvedValue(
      makePayment({ status: PaymentRecordStatus.CANCELLED }) as any
    );
    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(BadRequestError);
  });

  it('should call updateById with the correct payment _id', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(
      payment._id.toString(),
      expect.objectContaining({ status: PaymentRecordStatus.CANCELLED })
    );
  });

  // ── Stripe invoice voiding ──────────────────────────────────────────────────

  it('should void the Stripe invoice when gatewayPaymentId exists', async () => {
    const payment = makePayment({ gatewayPaymentId: 'in_test_abc123' });
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    expect(mockPaymentGatewayService.voidInvoice).toHaveBeenCalledWith('stripe', 'in_test_abc123');
  });

  it('should skip Stripe void when no gatewayPaymentId exists', async () => {
    const payment = makePayment({ gatewayPaymentId: undefined });
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    expect(mockPaymentGatewayService.voidInvoice).not.toHaveBeenCalled();
  });

  it('should still cancel locally when Stripe void fails', async () => {
    const payment = makePayment({ gatewayPaymentId: 'in_test_fail' });
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);
    mockPaymentGatewayService.voidInvoice.mockResolvedValue({
      success: false,
      data: null,
      message: 'Stripe error',
    } as any);

    const result = await paymentService.cancelPayment(CUID, PYTUID);

    expect(result.success).toBe(true);
    expect(mockPaymentDAO.updateById).toHaveBeenCalled();
  });

  it('should $unset gatewayPaymentId in the DB update', async () => {
    const payment = makePayment({ gatewayPaymentId: 'in_test_clear' });
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    expect(mockPaymentDAO.updateById.mock.calls[0][1]).toMatchObject({
      $unset: { gatewayPaymentId: 1 },
    });
  });

  // ── SSE notification ────────────────────────────────────────────────────────

  it('should emit PAYMENT_CANCELLED event with tenant user ID', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);

    await paymentService.cancelPayment(CUID, PYTUID, 'Duplicate');

    expect(mockProfileDAO.findById).toHaveBeenCalledWith(payment.tenant.toString());
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:cancelled',
      expect.objectContaining({
        tenantUserId: mockTenantUserId.toString(),
        amountInCents: 150000,
        reason: 'Duplicate',
        pytuid: PYTUID,
        cuid: CUID,
      })
    );
  });

  it('should not emit event when tenant profile has no user', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);
    mockProfileDAO.findById.mockResolvedValue({ _id: new Types.ObjectId(), user: null } as any);

    const result = await paymentService.cancelPayment(CUID, PYTUID);

    expect(result.success).toBe(true);
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });

  it('should still cancel when SSE emit throws', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.CANCELLED,
    } as any);
    mockProfileDAO.findById.mockRejectedValue(new Error('DB down'));

    const result = await paymentService.cancelPayment(CUID, PYTUID);

    expect(result.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPaymentByUid
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPaymentByUid', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

  const mockClient = { _id: new Types.ObjectId(), cuid: CUID };

  const makeMockPayment = (overrides: Record<string, any> = {}) => ({
    pytuid: PYTUID,
    cuid: CUID,
    invoiceNumber: 'INV-2026-0041',
    paymentType: PaymentRecordType.RENT,
    status: PaymentRecordStatus.PAID,
    baseAmount: 185000,
    processingFee: 2775,
    dueDate: new Date('2026-02-01'),
    paidAt: new Date('2026-02-01T10:22:00Z'),
    tenant: {
      puid: 'PUID001',
      personalInfo: { firstName: 'Marcus', lastName: 'Johnson', phoneNumber: '+1234567890' },
      user: { email: 'marcus.j@email.com' },
    },
    lease: {
      luid: 'LEASE001',
      leaseNumber: 'LSE-2025-0014',
      status: 'active',
      duration: { startDate: new Date('2025-03-01'), endDate: new Date('2026-02-28') },
      property: {
        id: {
          _id: new Types.ObjectId(),
          propertyType: 'residential',
          specifications: { bedrooms: 2, bathrooms: 1 },
          status: 'active',
          managedBy: new Types.ObjectId(),
        },
        address: '12 Sunset Blvd, Los Angeles, CA 90028',
        unitNumber: '4A',
        name: 'Sunset Apartments',
      },
    },
    toObject() {
      const { tenant, lease, toObject, ...rest } = this as any;
      return { ...rest };
    },
    ...overrides,
  });

  beforeEach(() => {
    mockClientDAO = { findFirst: jest.fn().mockResolvedValue(mockClient) } as any;
    mockPaymentDAO = { findFirst: jest.fn(), findByCuid: jest.fn(), update: jest.fn() } as any;
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({
        personalInfo: { firstName: 'John', lastName: 'Manager', phoneNumber: '+1987654321' },
        user: { email: 'manager@property.com' },
      }),
    } as any;

    paymentService = makeServiceWithMocks({
      clientDAO: mockClientDAO,
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return payment with full leaseInfo and tenant', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment() as any);

    const result = await paymentService.getPaymentByUid(CUID, PYTUID);

    expect(result.success).toBe(true);
    expect(result.data.tenant).toEqual({
      uid: 'PUID001',
      fullName: 'Marcus Johnson',
      email: 'marcus.j@email.com',
      phoneNumber: '+1234567890',
    });
    expect(result.data.leaseInfo).toMatchObject({
      address: '12 Sunset Blvd, Los Angeles, CA 90028',
      leaseNumber: 'LSE-2025-0014',
      unitNumber: '4A',
      propertyName: 'Sunset Apartments',
      bedrooms: 2,
      bathrooms: 1,
    });
  });

  it('should return leaseInfo as null when payment has no lease', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeMockPayment({ lease: null }) as any);

    const result = await paymentService.getPaymentByUid(CUID, PYTUID);

    expect(result.success).toBe(true);
    expect(result.data.leaseInfo).toBeNull();
  });

  it('should handle property with no manager', async () => {
    const payment = makeMockPayment();
    (payment.lease.property.id as any).managedBy = undefined;
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockProfileDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.getPaymentByUid(CUID, PYTUID);

    expect(result.data.leaseInfo?.propertyManager).toBeNull();
  });

  it('should throw BadRequestError when cuid or pytuid is missing', async () => {
    await expect(paymentService.getPaymentByUid('', PYTUID)).rejects.toThrow(BadRequestError);
    await expect(paymentService.getPaymentByUid(CUID, '')).rejects.toThrow(BadRequestError);
  });

  it('should throw NotFoundError when client or payment does not exist', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.getPaymentByUid(CUID, PYTUID)).rejects.toThrow(NotFoundError);

    mockClientDAO.findFirst.mockResolvedValue(mockClient as any);
    mockPaymentDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.getPaymentByUid(CUID, PYTUID)).rejects.toThrow(NotFoundError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPaymentStats
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPaymentStats', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  const makeStat = (
    status: PaymentRecordStatus,
    baseAmount: number,
    overrides: Record<string, any> = {}
  ) => ({
    pytuid: `PYT-${Math.random()}`,
    cuid: CUID,
    status,
    paymentType: PaymentRecordType.RENT,
    baseAmount,
    processingFee: 0,
    ...overrides,
  });

  beforeEach(() => {
    mockClientDAO = {
      findFirst: jest.fn().mockResolvedValue({ cuid: CUID }),
    } as unknown as jest.Mocked<ClientDAO>;
    mockPaymentDAO = { findByCuid: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    paymentService = makeServiceWithMocks({ clientDAO: mockClientDAO, paymentDAO: mockPaymentDAO });
  });

  afterEach(() => jest.clearAllMocks());

  it('should aggregate mixed statuses: collected, pending, overdue, refunded, expectedRevenue', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [
        makeStat(PaymentRecordStatus.PAID, 200000),
        makeStat(PaymentRecordStatus.PAID, 150000),
        makeStat(PaymentRecordStatus.PENDING, 100000),
        makeStat(PaymentRecordStatus.OVERDUE, 50000),
        makeStat(PaymentRecordStatus.CANCELLED, 80000),
        makeStat(PaymentRecordStatus.REFUNDED, 120000),
      ],
      total: 6,
    } as any);

    const result = await paymentService.getPaymentStats(CUID);

    expect(result.data.collected).toBe(350000);
    expect(result.data.pending).toBe(100000);
    expect(result.data.overdue).toBe(50000);
    expect(result.data.refunded).toBe(120000);
    expect(result.data.expectedRevenue).toBe(500000); // CANCELLED and REFUNDED excluded
  });

  it('should use refund.amount (not baseAmount) for partial refunds', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [makeStat(PaymentRecordStatus.REFUNDED, 100000, { refund: { amount: 40000 } })],
      total: 1,
    } as any);

    const result = await paymentService.getPaymentStats(CUID);

    expect(result.data.refunded).toBe(40000);
  });

  it('should calculate collectionRate as percentage of collected vs expected', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [
        makeStat(PaymentRecordStatus.PAID, 75000),
        makeStat(PaymentRecordStatus.PENDING, 25000),
      ],
      total: 2,
    } as any);

    const result = await paymentService.getPaymentStats(CUID);

    expect(result.data.collectionRate).toBe(75); // 75000 / 100000 = 75%
  });

  it('should return 0 for all stats when there are no payments', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({ items: [], total: 0 } as any);

    const result = await paymentService.getPaymentStats(CUID);

    expect(result.data.collectionRate).toBe(0);
    expect(result.data.expectedRevenue).toBe(0);
    expect(result.data.collected).toBe(0);
  });

  it('should throw NotFoundError when client does not exist', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.getPaymentStats(CUID)).rejects.toThrow(NotFoundError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPaymentStats — tenant auto-scope
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPaymentStats (tenant auto-scope)', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

  const TENANT_USER_ID = new Types.ObjectId().toString();
  const TENANT_PROFILE_ID = new Types.ObjectId().toString();
  const OTHER_TENANT_PROFILE_ID = new Types.ObjectId().toString();

  beforeEach(() => {
    mockClientDAO = {
      findFirst: jest.fn().mockResolvedValue({ cuid: CUID }),
    } as unknown as jest.Mocked<ClientDAO>;
    mockPaymentDAO = {
      findByCuid: jest.fn().mockResolvedValue({ items: [], total: 0 }),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(TENANT_PROFILE_ID) }),
    } as unknown as jest.Mocked<ProfileDAO>;
    paymentService = makeServiceWithMocks({
      clientDAO: mockClientDAO,
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('ignores provided tenantId and auto-scopes to requesting tenant profile when role is tenant', async () => {
    const context = {
      currentuser: {
        sub: TENANT_USER_ID,
        client: { role: 'tenant', cuid: CUID },
      },
    } as any;

    await paymentService.getPaymentStats(CUID, context, OTHER_TENANT_PROFILE_ID);

    // profileDAO.findFirst should be called with the requester's own userId (sub), not the caller-supplied tenantId
    expect(mockProfileDAO.findFirst).toHaveBeenCalledWith({ user: expect.any(Types.ObjectId) });

    // findByCuid should receive the auto-resolved profile id, not OTHER_TENANT_PROFILE_ID
    expect(mockPaymentDAO.findByCuid).toHaveBeenCalledWith(
      CUID,
      expect.objectContaining({ tenantId: TENANT_PROFILE_ID }),
      expect.anything()
    );
  });

  it('uses provided tenantId directly when role is not tenant (PM/admin)', async () => {
    const context = {
      currentuser: {
        sub: 'admin-user-id',
        client: { role: 'admin', cuid: CUID },
      },
    } as any;

    await paymentService.getPaymentStats(CUID, context, OTHER_TENANT_PROFILE_ID);

    // profileDAO.findFirst should NOT be called — PM tenantId is passed through directly
    expect(mockProfileDAO.findFirst).not.toHaveBeenCalled();

    expect(mockPaymentDAO.findByCuid).toHaveBeenCalledWith(
      CUID,
      expect.objectContaining({ tenantId: OTHER_TENANT_PROFILE_ID }),
      expect.anything()
    );
  });

  it('returns client-wide stats (no tenantId filter) when no context and no tenantId provided', async () => {
    await paymentService.getPaymentStats(CUID);

    expect(mockProfileDAO.findFirst).not.toHaveBeenCalled();
    expect(mockPaymentDAO.findByCuid).toHaveBeenCalledWith(
      CUID,
      expect.not.objectContaining({ tenantId: expect.anything() }),
      expect.anything()
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// recordManualPayment
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - recordManualPayment', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;

  const USER_ID = new Types.ObjectId().toString();
  const TENANT_ID = new Types.ObjectId().toString();
  const LEASE_ID = new Types.ObjectId().toString();

  const makeProfile = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    user: TENANT_ID,
    ...overrides,
  });
  const makeLease = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    luid: LEASE_ID,
    cuid: CUID,
    ...overrides,
  });
  const makeClient = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    deletedAt: null,
    ...overrides,
  });

  const makeData = (overrides: Record<string, any> = {}) => ({
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.CASH,
    baseAmount: 150000,
    paidAt: new Date('2026-03-01'),
    tenantId: TENANT_ID,
    leaseId: LEASE_ID,
    period: { month: 3, year: 2026 },
    description: 'March rent - cash payment',
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = { insert: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockClientDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockLeaseDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<LeaseDAO>;
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      leaseDAO: mockLeaseDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should create a manual payment with status PAID, processingFee 0, and isManualEntry true', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findFirst.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({
      pytuid: 'PYT001',
      cuid: CUID,
      status: PaymentRecordStatus.PAID,
      paymentMethod: PaymentMethod.CASH,
      isManualEntry: true,
      baseAmount: 150000,
      processingFee: 0,
    } as any);

    const result = await paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData());

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(PaymentRecordStatus.PAID);
    expect(result.data.isManualEntry).toBe(true);
    expect(result.data.processingFee).toBe(0);
  });

  it('should set dueDate and paidAt to the provided paidAt date', async () => {
    const paidAt = new Date('2026-03-15');
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findFirst.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData({ paidAt }));

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.dueDate).toEqual(paidAt);
    expect(insertCall.paidAt).toEqual(paidAt);
  });

  it('should work without leaseId (optional field)', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    const result = await paymentService.recordManualPayment(
      CUID,
      USER_ID,
      USER_ID,
      makeData({ leaseId: undefined })
    );

    expect(result.success).toBe(true);
    expect(mockLeaseDAO.findFirst).not.toHaveBeenCalled();
  });

  it('should include receipt data when provided', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findFirst.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(
      CUID,
      USER_ID,
      USER_ID,
      makeData({
        receipt: {
          url: 'https://s3.aws.com/receipts/receipt.pdf',
          filename: 'receipt.pdf',
          key: 'receipts/abc123.pdf',
        },
      })
    );

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.receipt?.url).toBe('https://s3.aws.com/receipts/receipt.pdf');
  });

  it('should throw NotFoundError when client, profile, or lease is not found', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);
    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())
    ).rejects.toThrow(NotFoundError);

    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(null);
    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())
    ).rejects.toThrow(NotFoundError);

    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findFirst.mockResolvedValue(null);
    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError when lease belongs to a different client', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    // The DAO query includes cuid as a filter, so a cross-client lease returns null
    mockLeaseDAO.findFirst.mockResolvedValue(null);

    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())
    ).rejects.toThrow(NotFoundError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// refundPayment
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - refundPayment', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

  const ADMIN_ID = new Types.ObjectId().toString();

  const makePaidPayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: PYTUID,
    cuid: CUID,
    status: PaymentRecordStatus.PAID,
    paymentType: PaymentRecordType.RENT,
    baseAmount: 150000,
    processingFee: 0,
    gatewayChargeId: 'ch_test_abc123',
    dueDate: new Date('2026-03-01'),
    paidAt: new Date('2026-02-28'),
    ...overrides,
  });

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    cuid: CUID,
    accountId: 'acct_test_123',
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      createRefund: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<ProfileDAO>;
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
      profileDAO: mockProfileDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should refund a PAID payment and set status to REFUNDED', async () => {
    const payment = makePaidPayment();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({
      success: true,
      data: { refundId: 're_test_123', status: 'succeeded', amount: 150000, currency: 'usd' },
    } as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.REFUNDED,
      refund: { refundedAt: new Date(), amount: 150000 },
    } as any);

    const result = await paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {});

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(PaymentRecordStatus.REFUNDED);
  });

  it('should route refund through paymentGatewayService with correct params', async () => {
    const payment = makePaidPayment();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: {} } as any);
    mockPaymentDAO.updateById.mockResolvedValue({
      ...payment,
      status: PaymentRecordStatus.REFUNDED,
    } as any);

    await paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {
      amount: 50000,
      reason: 'Partial refund',
    });

    expect(mockPaymentGatewayService.createRefund).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({
        chargeId: 'ch_test_abc123',
        amountInCents: 50000,
        reason: 'Partial refund',
      })
    );
  });

  it('should store refundAmount: full baseAmount for full refund, partial amount for partial', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ baseAmount: 200000 }) as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: {} } as any);
    mockPaymentDAO.updateById.mockResolvedValue({} as any);

    await paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {});
    expect(mockPaymentDAO.updateById.mock.calls[0][1]).toMatchObject({
      status: PaymentRecordStatus.REFUNDED,
      'refund.amount': 200000,
    });
    expect(mockPaymentDAO.updateById.mock.calls[0][1]['refund.refundedAt']).toBeInstanceOf(Date);

    jest.clearAllMocks();
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ baseAmount: 200000 }) as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: {} } as any);
    mockPaymentDAO.updateById.mockResolvedValue({} as any);

    await paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, { amount: 75000 });
    expect(mockPaymentDAO.updateById.mock.calls[0][1]['refund.amount']).toBe(75000);
  });

  it('should throw BadRequestError when cuid or pytuid is missing', async () => {
    await expect(paymentService.refundPayment('', PYTUID, ADMIN_ID, {})).rejects.toThrow(
      BadRequestError
    );
    await expect(paymentService.refundPayment(CUID, '', ADMIN_ID, {})).rejects.toThrow(
      BadRequestError
    );
  });

  it('should throw NotFoundError when payment does not exist', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(
      NotFoundError
    );
  });

  it('should throw BadRequestError when payment is not PAID (PENDING or CANCELLED)', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(
      makePaidPayment({ status: PaymentRecordStatus.PENDING }) as any
    );
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(
      BadRequestError
    );

    mockPaymentDAO.findFirst.mockResolvedValue(
      makePaidPayment({ status: PaymentRecordStatus.CANCELLED }) as any
    );
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(
      BadRequestError
    );
  });

  it('should throw BadRequestError when payment has no gatewayChargeId (manual entry)', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ gatewayChargeId: null }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(
      BadRequestError
    );
  });

  it('should throw BadRequestError when partial refund amount exceeds baseAmount', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ baseAmount: 100000 }) as any);
    await expect(
      paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, { amount: 200000 })
    ).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when payment processor is not configured or has no accountId', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(
      BadRequestError
    );

    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor({ accountId: null }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(
      BadRequestError
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleDisputeCreated
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleDisputeCreated', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  const DISPUTE_ID = 'dp_test_123';
  const CHARGE_ID = 'ch_test_abc';
  const TRANSFER_ID = 'tr_test_xyz';

  const makeDisputeData = (overrides: Record<string, any> = {}) => ({
    charge: CHARGE_ID,
    amount: 150000,
    currency: 'usd',
    reason: 'fraudulent',
    ...overrides,
  });

  const makePaymentRecord = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: PYTUID,
    cuid: CUID,
    gatewayChargeId: CHARGE_ID,
    invoiceNumber: 'INV-2026-0001',
    status: PaymentRecordStatus.PAID,
    ...overrides,
  });

  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
      startSession: jest.fn().mockResolvedValue({}),
      withTransaction: jest.fn((_session: unknown, cb: (s: unknown) => unknown) => cb(_session)),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockPaymentProcessorDAO = {
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      getCharge: jest.fn(),
      createTransferReversal: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should reverse transfer, update payment record, and emit event', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentGatewayService.getCharge.mockResolvedValue({
      success: true,
      data: { transfer: TRANSFER_ID },
    } as any);
    mockPaymentGatewayService.createTransferReversal.mockResolvedValue({
      success: true,
      data: { reversalId: 'trr_test', amount: 150000 },
    } as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.update.mockResolvedValue({} as any);

    const result = await paymentService.handleDisputeCreated(DISPUTE_ID, makeDisputeData());

    expect(result.success).toBe(true);
    expect(mockPaymentGatewayService.createTransferReversal).toHaveBeenCalledWith(
      'stripe',
      TRANSFER_ID,
      150000
    );
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      expect.objectContaining({ _id: payment._id }),
      {
        $set: expect.objectContaining({
          'dispute.disputeId': DISPUTE_ID,
          'dispute.amount': 150000,
          'dispute.reason': 'fraudulent',
          'dispute.disputedAt': expect.any(Date),
        }),
      },
      undefined,
      expect.anything()
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:dispute:created',
      expect.objectContaining({ cuid: CUID, disputeId: DISPUTE_ID, amount: 150000 })
    );
  });

  it('should return success:false when payment record is not found', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.handleDisputeCreated(DISPUTE_ID, makeDisputeData());

    expect(result.success).toBe(false);
    expect(result.message).toBe('No charge ID or payment record not found');
    expect(mockPaymentGatewayService.getCharge).not.toHaveBeenCalled();
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });

  it('should skip transfer reversal when charge has no transfer, still update and emit event', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentGatewayService.getCharge.mockResolvedValue({
      success: true,
      data: { transfer: null },
    } as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.update.mockResolvedValue({} as any);

    const result = await paymentService.handleDisputeCreated(DISPUTE_ID, makeDisputeData());

    expect(result.success).toBe(true);
    expect(mockPaymentGatewayService.createTransferReversal).not.toHaveBeenCalled();
    expect(mockPaymentDAO.update).toHaveBeenCalled();
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:dispute:created',
      expect.any(Object)
    );
  });

  it('should correctly extract chargeId when disputeData.charge is an object', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentGatewayService.getCharge.mockResolvedValue({
      success: true,
      data: { transfer: TRANSFER_ID },
    } as any);
    mockPaymentGatewayService.createTransferReversal.mockResolvedValue({
      success: true,
      data: {},
    } as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.update.mockResolvedValue({} as any);

    await paymentService.handleDisputeCreated(
      DISPUTE_ID,
      makeDisputeData({ charge: { id: CHARGE_ID } })
    );

    expect(mockPaymentDAO.findFirst).toHaveBeenCalledWith({
      gatewayChargeId: CHARGE_ID,
      deletedAt: null,
    });
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleDisputeWon
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleDisputeWon', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  const DISPUTE_ID = 'dp_won_123';
  const CHARGE_ID = 'ch_won_abc';
  const ACCOUNT_ID = 'acct_pm_xyz';

  const makeDisputeWonData = (overrides: Record<string, any> = {}) => ({
    charge: CHARGE_ID,
    amount: 150000,
    currency: 'usd',
    ...overrides,
  });

  const makePaymentRecord = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: PYTUID,
    cuid: CUID,
    gatewayChargeId: CHARGE_ID,
    invoiceNumber: 'INV-2026-0001',
    status: PaymentRecordStatus.PAID,
    ...overrides,
  });

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    cuid: CUID,
    accountId: ACCOUNT_ID,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
      startSession: jest.fn().mockResolvedValue({}),
      withTransaction: jest.fn((_session: unknown, cb: (s: unknown) => unknown) => cb(_session)),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      createTransfer: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should re-transfer funds to PM and emit event on dispute won', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentProcessorDAO.update.mockResolvedValue({} as any);
    mockPaymentGatewayService.createTransfer.mockResolvedValue({
      success: true,
      data: { transferId: 'tr_new_123', amount: 150000 },
    } as any);

    const result = await paymentService.handleDisputeWon(DISPUTE_ID, makeDisputeWonData());

    expect(result.success).toBe(true);
    expect(mockPaymentGatewayService.createTransfer).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({
        amountInCents: 150000,
        currency: 'usd',
        destination: ACCOUNT_ID,
        metadata: expect.objectContaining({ disputeId: DISPUTE_ID, reason: 'dispute_won' }),
      })
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:dispute:won',
      expect.objectContaining({ cuid: CUID, disputeId: DISPUTE_ID, amount: 150000 })
    );
  });

  it('should return success:false when payment record is not found', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.handleDisputeWon(DISPUTE_ID, makeDisputeWonData());

    expect(result.success).toBe(false);
    expect(result.message).toBe('No charge ID or payment record not found');
    expect(mockPaymentGatewayService.createTransfer).not.toHaveBeenCalled();
  });

  it('should return success:false when payment processor is not found', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaymentRecord() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.handleDisputeWon(DISPUTE_ID, makeDisputeWonData());

    expect(result.success).toBe(false);
    expect(result.message).toBe('Payment processor not found');
    expect(mockPaymentGatewayService.createTransfer).not.toHaveBeenCalled();
  });

  it('should return success:false when payment processor has no accountId', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaymentRecord() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor({ accountId: null }) as any);

    const result = await paymentService.handleDisputeWon(DISPUTE_ID, makeDisputeWonData());

    expect(result.success).toBe(false);
    expect(mockPaymentGatewayService.createTransfer).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createConnectAccount
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - createConnectAccount', () => {
  let paymentService: PaymentService;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  const makeClient = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    accountAdmin: new Types.ObjectId(),
    accountType: { isEnterpriseAccount: false },
    ...overrides,
  });

  const makeGatewayResult = (overrides: Record<string, any> = {}) => ({
    success: true,
    data: {
      accountId: 'acct_new_123',
      chargesEnabled: false,
      payoutsEnabled: false,
      detailsSubmitted: false,
    },
    ...overrides,
  });

  beforeEach(() => {
    mockClientDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
      insert: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      createConnectAccount: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;

    paymentService = makeServiceWithMocks({
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should create a Connect account and persist a PaymentProcessor record', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue({
      personalInfo: { firstName: 'Jane', lastName: 'Doe', phoneNumber: '+11234567890' },
    } as any);
    mockPaymentGatewayService.createConnectAccount.mockResolvedValue(makeGatewayResult() as any);
    mockPaymentProcessorDAO.insert.mockResolvedValue({} as any);

    const result = await paymentService.createConnectAccount(CUID, {
      email: 'jane@example.com',
      country: 'US',
    });

    expect(result.success).toBe(true);
    expect(result.data.accountId).toBe('acct_new_123');
    expect(mockPaymentProcessorDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({ cuid: CUID, accountId: 'acct_new_123' })
    );
  });

  it('should use businessType "company" for enterprise accounts', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    mockClientDAO.findFirst.mockResolvedValue(
      makeClient({ accountType: { isEnterpriseAccount: true }, companyName: 'Acme Corp' }) as any
    );
    mockProfileDAO.findFirst.mockResolvedValue(null);
    mockPaymentGatewayService.createConnectAccount.mockResolvedValue(makeGatewayResult() as any);
    mockPaymentProcessorDAO.insert.mockResolvedValue({} as any);

    await paymentService.createConnectAccount(CUID, { email: 'corp@example.com', country: 'US' });

    expect(mockPaymentGatewayService.createConnectAccount).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({ businessType: 'company' })
    );
  });

  it('should use businessType "individual" for non-enterprise accounts', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(null);
    mockPaymentGatewayService.createConnectAccount.mockResolvedValue(makeGatewayResult() as any);
    mockPaymentProcessorDAO.insert.mockResolvedValue({} as any);

    await paymentService.createConnectAccount(CUID, { email: 'user@example.com', country: 'US' });

    expect(mockPaymentGatewayService.createConnectAccount).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({ businessType: 'individual' })
    );
  });

  it('should throw BadRequestError when a Connect account already exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: 'acct_existing' } as any);

    await expect(
      paymentService.createConnectAccount(CUID, { email: 'a@b.com', country: 'US' })
    ).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.createConnectAccount).not.toHaveBeenCalled();
  });

  it('should throw NotFoundError when client is not found', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    mockClientDAO.findFirst.mockResolvedValue(null);

    await expect(
      paymentService.createConnectAccount(CUID, { email: 'a@b.com', country: 'US' })
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw BadRequestError when gateway returns failure', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(null);
    mockPaymentGatewayService.createConnectAccount.mockResolvedValue({
      success: false,
      message: 'Gateway error',
      data: null,
    } as any);

    await expect(
      paymentService.createConnectAccount(CUID, { email: 'a@b.com', country: 'US' })
    ).rejects.toThrow(BadRequestError);
    expect(mockPaymentProcessorDAO.insert).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getKycOnboardingLink
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getKycOnboardingLink', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    cuid: CUID,
    accountId: 'acct_pm_123',
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      createKycOnboardingLink: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return an onboarding URL', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createKycOnboardingLink.mockResolvedValue({
      success: true,
      data: { url: 'https://connect.stripe.com/onboard/test' },
    } as any);

    const result = await paymentService.getKycOnboardingLink(CUID);

    expect(result.success).toBe(true);
    expect(result.data.url).toBe('https://connect.stripe.com/onboard/test');
    expect(mockPaymentGatewayService.createKycOnboardingLink).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({ accountId: 'acct_pm_123' })
    );
  });

  it('should use urlOverrides when provided', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createKycOnboardingLink.mockResolvedValue({
      success: true,
      data: { url: 'https://connect.stripe.com/onboard/custom' },
    } as any);

    await paymentService.getKycOnboardingLink(CUID, {
      returnUrl: 'https://custom.example.com/return',
      refreshUrl: 'https://custom.example.com/refresh',
    });

    expect(mockPaymentGatewayService.createKycOnboardingLink).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({
        returnUrl: 'https://custom.example.com/return',
        refreshUrl: 'https://custom.example.com/refresh',
      })
    );
  });

  it('should throw BadRequestError when no Connect account exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.getKycOnboardingLink(CUID)).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.createKycOnboardingLink).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when processor has no accountId', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor({ accountId: null }) as any);

    await expect(paymentService.getKycOnboardingLink(CUID)).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when gateway returns failure', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createKycOnboardingLink.mockResolvedValue({
      success: false,
      message: 'Gateway error',
      data: null,
    } as any);

    await expect(paymentService.getKycOnboardingLink(CUID)).rejects.toThrow(BadRequestError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getAccountUpdateLink
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getAccountUpdateLink', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      createKycOnboardingLink: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return an account update URL using createKycOnboardingLink', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({
      cuid: CUID,
      accountId: 'acct_pm_123',
    } as any);
    mockPaymentGatewayService.createKycOnboardingLink.mockResolvedValue({
      success: true,
      data: { url: 'https://connect.stripe.com/update/test' },
    } as any);

    const result = await paymentService.getAccountUpdateLink(CUID);

    expect(result.success).toBe(true);
    expect(result.data.url).toBe('https://connect.stripe.com/update/test');
    // Express accounts use account_onboarding type — verified by calling createKycOnboardingLink, not createAccountUpdateLink
    expect(mockPaymentGatewayService.createKycOnboardingLink).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({ accountId: 'acct_pm_123' })
    );
  });

  it('should throw BadRequestError when no Connect account exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.getAccountUpdateLink(CUID)).rejects.toThrow(BadRequestError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getExternalDashboardLoginLink
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getExternalDashboardLoginLink', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      createDashboardLoginLink: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return a dashboard login URL', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({
      cuid: CUID,
      accountId: 'acct_pm_123',
    } as any);
    mockPaymentGatewayService.createDashboardLoginLink.mockResolvedValue({
      success: true,
      data: { url: 'https://dashboard.stripe.com/express/test' },
    } as any);

    const result = await paymentService.getExternalDashboardLoginLink(CUID);

    expect(result.success).toBe(true);
    expect(result.data.url).toBe('https://dashboard.stripe.com/express/test');
    expect(mockPaymentGatewayService.createDashboardLoginLink).toHaveBeenCalledWith(
      'stripe',
      'acct_pm_123'
    );
  });

  it('should throw BadRequestError when no Connect account exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.getExternalDashboardLoginLink(CUID)).rejects.toThrow(
      BadRequestError
    );
  });

  it('should throw BadRequestError when gateway returns failure', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({
      cuid: CUID,
      accountId: 'acct_pm_123',
    } as any);
    mockPaymentGatewayService.createDashboardLoginLink.mockResolvedValue({
      success: false,
      message: 'Link creation failed',
      data: null,
    } as any);

    await expect(paymentService.getExternalDashboardLoginLink(CUID)).rejects.toThrow(
      BadRequestError
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleInvoicePaymentSucceeded
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleInvoicePaymentSucceeded', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  const INVOICE_ID = 'in_test_123';
  const _CHARGE_ID = 'ch_test_abc';

  const makePaymentRecord = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: PYTUID,
    cuid: CUID,
    baseAmount: 150000,
    status: PaymentRecordStatus.PENDING,
    gatewayPaymentId: INVOICE_ID,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should mark payment as PAID and emit PAYMENT_SUCCEEDED event with receipt fields', async () => {
    const payment = makePaymentRecord({ paymentType: 'rent', tenant: new Types.ObjectId() });
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    const result = await paymentService.handleInvoicePaymentSucceeded(INVOICE_ID, {
      hosted_invoice_url: 'https://stripe.com/receipt/123',
    });

    expect(result.success).toBe(true);
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id, cuid: payment.cuid },
      {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PAID,
          paidAt: expect.any(Date),
        }),
      }
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:succeeded',
      expect.objectContaining({
        cuid: CUID,
        pytuid: PYTUID,
        invoiceId: INVOICE_ID,
        paymentType: 'rent',
        receiptUrl: 'https://stripe.com/receipt/123',
      })
    );
  });

  it('should return success:false when payment record is not found', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(result.success).toBe(false);
    expect(result.message).toBe('Payment record not found');
    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });

  it('should return early with success:true when payment is already PAID', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(
      makePaymentRecord({ status: PaymentRecordStatus.PAID }) as any
    );

    const result = await paymentService.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(result.success).toBe(true);
    expect(result.message).toBe('Payment already paid');
    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
  });

  it('should still update when invoiceData has no charge id', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    const result = await paymentService.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(result.success).toBe(true);
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id, cuid: payment.cuid },
      expect.objectContaining({
        $set: expect.objectContaining({ status: PaymentRecordStatus.PAID }),
      })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleInvoicePaymentFailed
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleInvoicePaymentFailed', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  const INVOICE_ID = 'in_failed_123';

  const makePaymentRecord = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: PYTUID,
    cuid: CUID,
    gatewayPaymentId: INVOICE_ID,
    status: PaymentRecordStatus.PENDING,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should mark payment as FAILED and emit PAYMENT_FAILED event', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    const result = await paymentService.handleInvoicePaymentFailed(INVOICE_ID, {
      attempt_count: 2,
      next_payment_attempt: undefined,
    });

    expect(result.success).toBe(true);
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id, cuid: payment.cuid },
      {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.FAILED,
          'failure.lastFailedAt': expect.any(Date),
        }),
      }
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:failed',
      expect.objectContaining({ cuid: CUID, pytuid: PYTUID, invoiceId: INVOICE_ID })
    );
  });

  it('should return success:false when payment record is not found', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.handleInvoicePaymentFailed(INVOICE_ID, {});

    expect(result.success).toBe(false);
    expect(result.message).toBe('Payment record not found');
    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleChargeRefunded
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleChargeRefunded', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  const CHARGE_ID = 'ch_refunded_123';

  const makePaymentRecord = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: PYTUID,
    cuid: CUID,
    gatewayChargeId: CHARGE_ID,
    status: PaymentRecordStatus.PAID,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should mark payment as REFUNDED, store refund amount, and emit PAYMENT_REFUNDED event', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    const result = await paymentService.handleChargeRefunded(CHARGE_ID, {
      amount_refunded: 150000,
    });

    expect(result.success).toBe(true);
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id, cuid: payment.cuid },
      {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.REFUNDED,
          'refund.amount': 150000,
          'refund.refundedAt': expect.any(Date),
        }),
      }
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:refunded',
      expect.objectContaining({
        cuid: CUID,
        pytuid: PYTUID,
        chargeId: CHARGE_ID,
        refundAmount: 150000,
      })
    );
  });

  it('should return success:false when payment record is not found', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.handleChargeRefunded(CHARGE_ID, { amount_refunded: 100 });

    expect(result.success).toBe(false);
    expect(result.message).toBe('Payment record not found');
    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });

  it('should default refund amount to 0 when amount_refunded is absent', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    await paymentService.handleChargeRefunded(CHARGE_ID, {});

    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id, cuid: payment.cuid },
      expect.objectContaining({
        $set: expect.objectContaining({ 'refund.amount': 0 }),
      })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleAccountUpdated
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleAccountUpdated', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockEmitterService: { emit: jest.Mock; on: jest.Mock };

  const ACCOUNT_ID = 'acct_updated_123';

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    accountId: ACCOUNT_ID,
    chargesEnabled: false,
    payoutsEnabled: false,
    detailsSubmitted: false,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should update PaymentProcessor fields from webhook data', async () => {
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(processor as any);
    mockPaymentProcessorDAO.update.mockResolvedValue(processor as any);

    const result = await paymentService.handleAccountUpdated(ACCOUNT_ID, {
      charges_enabled: true,
      payouts_enabled: false,
      details_submitted: true,
    });

    expect(result.success).toBe(true);
    expect(mockPaymentProcessorDAO.update).toHaveBeenCalledWith(
      { _id: processor._id },
      {
        $set: expect.objectContaining({
          chargesEnabled: true,
          payoutsEnabled: false,
          detailsSubmitted: true,
        }),
      }
    );
  });

  it('should emit PAYMENT_PROCESSOR_VERIFIED and set onboardedAt when account first enables payouts', async () => {
    const processor = makeProcessor({ payoutsEnabled: false });
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(processor as any);
    mockPaymentProcessorDAO.update.mockResolvedValue(processor as any);

    await paymentService.handleAccountUpdated(ACCOUNT_ID, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });

    expect(mockPaymentProcessorDAO.update).toHaveBeenCalledWith(
      { _id: processor._id },
      {
        $set: expect.objectContaining({
          payoutsEnabled: true,
          onboardedAt: expect.any(Date),
        }),
      }
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:processor:verified',
      expect.objectContaining({ cuid: CUID, accountId: ACCOUNT_ID, verifiedAt: expect.any(Date) })
    );
  });

  it('should NOT emit PAYMENT_PROCESSOR_VERIFIED when payouts were already enabled', async () => {
    const processor = makeProcessor({ payoutsEnabled: true });
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(processor as any);
    mockPaymentProcessorDAO.update.mockResolvedValue(processor as any);

    await paymentService.handleAccountUpdated(ACCOUNT_ID, {
      charges_enabled: true,
      payouts_enabled: true,
      details_submitted: true,
    });

    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });

  it('should include requirements in the update when provided', async () => {
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(processor as any);
    mockPaymentProcessorDAO.update.mockResolvedValue(processor as any);

    await paymentService.handleAccountUpdated(ACCOUNT_ID, {
      charges_enabled: false,
      payouts_enabled: false,
      details_submitted: false,
      requirements: {
        currently_due: ['individual.id_number'],
        eventually_due: [],
        past_due: [],
        disabled_reason: 'requirements.past_due',
      },
    });

    expect(mockPaymentProcessorDAO.update).toHaveBeenCalledWith(
      { _id: processor._id },
      {
        $set: expect.objectContaining({
          requirements: expect.objectContaining({
            currentlyDue: ['individual.id_number'],
            disabledReason: 'requirements.past_due',
          }),
        }),
      }
    );
  });

  it('should return success:false when PaymentProcessor is not found', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    const result = await paymentService.handleAccountUpdated(ACCOUNT_ID, {
      charges_enabled: true,
      payouts_enabled: true,
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('PaymentProcessor record not found');
    expect(mockPaymentProcessorDAO.update).not.toHaveBeenCalled();
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPayoutBalance
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPayoutBalance', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    accountId: 'acct_test_123',
    payoutsEnabled: true,
    chargesEnabled: true,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      getConnectBalance: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return available and pending balances', async () => {
    const processor = makeProcessor();
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(processor as any);
    mockPaymentGatewayService.getConnectBalance.mockResolvedValue({
      success: true,
      data: {
        available: [{ amount: 50000, currency: 'usd' }],
        pending: [{ amount: 12000, currency: 'usd' }],
      },
    } as any);

    const result = await paymentService.getPayoutBalance(CUID);

    expect(result.success).toBe(true);
    expect(result.data.available).toEqual([{ amount: 50000, currency: 'usd' }]);
    expect(result.data.pending).toEqual([{ amount: 12000, currency: 'usd' }]);
    expect(mockPaymentGatewayService.getConnectBalance).toHaveBeenCalledWith(
      'stripe',
      processor.accountId
    );
  });

  it('should throw BadRequestError when no Connect account exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.getPayoutBalance(CUID)).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.getConnectBalance).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when payoutsEnabled is false', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(
      makeProcessor({ payoutsEnabled: false }) as any
    );

    await expect(paymentService.getPayoutBalance(CUID)).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.getConnectBalance).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when gateway returns failure', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.getConnectBalance.mockResolvedValue({
      success: false,
      data: null,
      message: 'Stripe error',
    } as any);

    await expect(paymentService.getPayoutBalance(CUID)).rejects.toThrow(BadRequestError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPayoutHistory
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPayoutHistory', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    accountId: 'acct_test_123',
    payoutsEnabled: true,
    chargesEnabled: true,
    ...overrides,
  });

  const makeStripePayout = (id: string, overrides: Record<string, any> = {}) => ({
    id,
    amount: 30000,
    currency: 'usd',
    status: 'paid',
    arrival_date: Math.floor(new Date('2026-04-01').getTime() / 1000),
    created: Math.floor(new Date('2026-03-28').getTime() / 1000),
    description: null,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      listConnectPayouts: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return formatted payout list with pagination info', async () => {
    const payout = makeStripePayout('po_001');
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.listConnectPayouts.mockResolvedValue({
      success: true,
      data: { data: [payout], has_more: false },
    } as any);

    const result = await paymentService.getPayoutHistory(CUID, { limit: 20 });

    expect(result.success).toBe(true);
    expect(result.data.payouts).toHaveLength(1);
    expect(result.data.payouts[0]).toMatchObject({
      id: 'po_001',
      amount: 30000,
      currency: 'usd',
      status: 'paid',
    });
    expect(result.data.hasMore).toBe(false);
    expect(result.data.nextCursor).toBeUndefined();
  });

  it('should set nextCursor when hasMore is true', async () => {
    const payouts = [makeStripePayout('po_001'), makeStripePayout('po_002')];
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.listConnectPayouts.mockResolvedValue({
      success: true,
      data: { data: payouts, has_more: true },
    } as any);

    const result = await paymentService.getPayoutHistory(CUID, { limit: 2 });

    expect(result.data.hasMore).toBe(true);
    expect(result.data.nextCursor).toBe('po_002');
  });

  it('should pass cursor to gateway as starting_after', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.listConnectPayouts.mockResolvedValue({
      success: true,
      data: { data: [], has_more: false },
    } as any);

    await paymentService.getPayoutHistory(CUID, { limit: 5, cursor: 'po_cursor_abc' });

    expect(mockPaymentGatewayService.listConnectPayouts).toHaveBeenCalledWith(
      'stripe',
      'acct_test_123',
      { limit: 5, starting_after: 'po_cursor_abc' }
    );
  });

  it('should throw BadRequestError when no Connect account exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.getPayoutHistory(CUID, {})).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when payoutsEnabled is false', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(
      makeProcessor({ payoutsEnabled: false }) as any
    );

    await expect(paymentService.getPayoutHistory(CUID, {})).rejects.toThrow(BadRequestError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPayoutSchedule
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPayoutSchedule', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    accountId: 'acct_test_123',
    payoutsEnabled: true,
    chargesEnabled: true,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      getPayoutSchedule: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return the current payout schedule', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.getPayoutSchedule.mockResolvedValue({
      success: true,
      data: { interval: 'weekly', weeklyAnchor: 'monday', delayDays: 2 },
    } as any);

    const result = await paymentService.getPayoutSchedule(CUID);

    expect(result.success).toBe(true);
    expect(result.data.interval).toBe('weekly');
    expect(result.data.weeklyAnchor).toBe('monday');
    expect(result.data.delayDays).toBe(2);
    expect(mockPaymentGatewayService.getPayoutSchedule).toHaveBeenCalledWith(
      'stripe',
      'acct_test_123'
    );
  });

  it('should return daily schedule when interval is daily', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.getPayoutSchedule.mockResolvedValue({
      success: true,
      data: { interval: 'daily', delayDays: 1 },
    } as any);

    const result = await paymentService.getPayoutSchedule(CUID);

    expect(result.data.interval).toBe('daily');
    expect(result.data.weeklyAnchor).toBeUndefined();
  });

  it('should throw BadRequestError when no Connect account exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.getPayoutSchedule(CUID)).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.getPayoutSchedule).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when gateway returns failure', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.getPayoutSchedule.mockResolvedValue({
      success: false,
      data: null,
      message: 'Stripe error',
    } as any);

    await expect(paymentService.getPayoutSchedule(CUID)).rejects.toThrow(BadRequestError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// updatePayoutSchedule
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - updatePayoutSchedule', () => {
  let paymentService: PaymentService;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockPaymentGatewayService: jest.Mocked<PaymentGatewayService>;

  const makeProcessor = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    accountId: 'acct_test_123',
    payoutsEnabled: true,
    chargesEnabled: true,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = {
      updatePayoutSchedule: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    paymentService = makeServiceWithMocks({
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockPaymentGatewayService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should update to weekly with anchor', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.updatePayoutSchedule.mockResolvedValue({
      success: true,
      data: null,
    } as any);

    const result = await paymentService.updatePayoutSchedule(CUID, 'weekly', 'friday');

    expect(result.success).toBe(true);
    expect(mockPaymentGatewayService.updatePayoutSchedule).toHaveBeenCalledWith(
      'stripe',
      'acct_test_123',
      'weekly',
      'friday'
    );
  });

  it('should update to daily without anchor', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.updatePayoutSchedule.mockResolvedValue({
      success: true,
      data: null,
    } as any);

    await paymentService.updatePayoutSchedule(CUID, 'daily');

    expect(mockPaymentGatewayService.updatePayoutSchedule).toHaveBeenCalledWith(
      'stripe',
      'acct_test_123',
      'daily',
      undefined
    );
  });

  it('should throw BadRequestError when no Connect account exists', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.updatePayoutSchedule(CUID, 'weekly')).rejects.toThrow(
      BadRequestError
    );
    expect(mockPaymentGatewayService.updatePayoutSchedule).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when payoutsEnabled is false', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(
      makeProcessor({ payoutsEnabled: false }) as any
    );

    await expect(paymentService.updatePayoutSchedule(CUID, 'weekly')).rejects.toThrow(
      BadRequestError
    );
    expect(mockPaymentGatewayService.updatePayoutSchedule).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when gateway returns failure', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.updatePayoutSchedule.mockResolvedValue({
      success: false,
      data: null,
      message: 'Stripe update failed',
    } as any);

    await expect(paymentService.updatePayoutSchedule(CUID, 'monthly')).rejects.toThrow(
      BadRequestError
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// chargeForMaintenance
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - chargeForMaintenance', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;

  const CURRENT_USER_ID = new Types.ObjectId().toString();
  const TENANT_USER_ID = new Types.ObjectId().toString();
  const MRUID = 'MR-TEST-001';
  const PROFILE_OID = new Types.ObjectId();

  const makeBody = (overrides: Record<string, any> = {}) => ({
    mruid: MRUID,
    tenantId: TENANT_USER_ID,
    amount: 45000,
    description: 'Fix leaking pipe',
    ...overrides,
  });

  beforeEach(() => {
    mockClientDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = { getProfileByUserId: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockPaymentDAO = {
      insert: jest.fn(),
      findFirst: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockSubscriptionDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<SubscriptionDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;

    mockSubscriptionDAO.findFirst.mockResolvedValue({ status: 'active', planName: 'basic' } as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ payoutsBlocked: false } as any);

    const mockLeaseDAO = {
      getActiveLeaseByTenant: jest.fn().mockResolvedValue({ fees: { currency: 'USD' } }),
    } as any;

    paymentService = makeServiceWithMocks({
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      paymentDAO: mockPaymentDAO,
      subscriptionDAO: mockSubscriptionDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      leaseDAO: mockLeaseDAO,
    });

    // Inject subscription plan config with getTransactionFeePercent for MaintenancePaymentService
    (paymentService as any).maintenancePaymentService.subscriptionPlanConfig = {
      getTransactionFeePercent: jest.fn().mockReturnValue(0),
    };
  });

  afterEach(() => jest.clearAllMocks());

  it('should create a PENDING maintenance payment with a 5-day grace period', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockProfileDAO.getProfileByUserId.mockResolvedValue({ _id: PROFILE_OID } as any);
    mockPaymentDAO.insert.mockResolvedValue({
      pytuid: 'PYT-MR-001',
      cuid: CUID,
      status: PaymentRecordStatus.PENDING,
      paymentType: PaymentRecordType.MAINTENANCE,
      maintenanceRequestUid: MRUID,
      baseAmount: 45000,
    } as any);

    const before = new Date();
    const result = await paymentService.chargeForMaintenance(CUID, CURRENT_USER_ID, makeBody());
    const after = new Date();

    expect(result.success).toBe(true);

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.paymentType).toBe(PaymentRecordType.MAINTENANCE);
    expect(insertCall.status).toBe(PaymentRecordStatus.PENDING);
    expect(insertCall.maintenanceRequestUid).toBe(MRUID);
    expect(insertCall.baseAmount).toBe(45000);
    expect(insertCall.isManualEntry).toBe(false);
    expect(insertCall.tenant).toEqual(PROFILE_OID);

    // dueDate should be ~5 days from now
    const dueDateMs = (insertCall.dueDate as Date).getTime();
    const minDue = before.getTime() + 4 * 24 * 60 * 60 * 1000;
    const maxDue = after.getTime() + 6 * 24 * 60 * 60 * 1000;
    expect(dueDateMs).toBeGreaterThanOrEqual(minDue);
    expect(dueDateMs).toBeLessThanOrEqual(maxDue);
  });

  it('should use the provided description on the payment record', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockProfileDAO.getProfileByUserId.mockResolvedValue({ _id: PROFILE_OID } as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.chargeForMaintenance(
      CUID,
      CURRENT_USER_ID,
      makeBody({ description: 'Roof repair charge' })
    );

    expect(mockPaymentDAO.insert.mock.calls[0][0].description).toBe('Roof repair charge');
  });

  it('should fall back to a default description when none is provided', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockProfileDAO.getProfileByUserId.mockResolvedValue({ _id: PROFILE_OID } as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.chargeForMaintenance(
      CUID,
      CURRENT_USER_ID,
      makeBody({ description: undefined })
    );

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.description).toContain(MRUID);
  });

  it('should set recordedBy to the current user ObjectId', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockProfileDAO.getProfileByUserId.mockResolvedValue({ _id: PROFILE_OID } as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.chargeForMaintenance(CUID, CURRENT_USER_ID, makeBody());

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect((insertCall.recordedBy as Types.ObjectId).toString()).toBe(CURRENT_USER_ID);
  });

  it('should throw NotFoundError when the client does not exist', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);

    await expect(
      paymentService.chargeForMaintenance(CUID, CURRENT_USER_ID, makeBody())
    ).rejects.toThrow(NotFoundError);

    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });

  it('should throw NotFoundError when the tenant profile does not exist', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockProfileDAO.getProfileByUserId.mockResolvedValue(null);

    await expect(
      paymentService.chargeForMaintenance(CUID, CURRENT_USER_ID, makeBody())
    ).rejects.toThrow(NotFoundError);

    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// markOverduePayments (private — accessed via any cast)
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - markOverduePayments', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };

  const makeOverduePayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: `PYT-${Math.random()}`,
    cuid: CUID,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.RENT,
    baseAmount: 100000,
    dueDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2 days ago
    isManualEntry: true,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      findOverduePayments: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;

    mockEmitter = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      emitterService: mockEmitter,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should flip PENDING → OVERDUE and emit an event per payment', async () => {
    const p1 = makeOverduePayment();
    const p2 = makeOverduePayment();
    mockPaymentDAO.findOverduePayments.mockResolvedValue({ items: [p1, p2], total: 2 } as any);
    mockPaymentDAO.update.mockResolvedValue(undefined as any);

    await (paymentService as any).paymentCronService.markOverduePayments();

    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      expect.objectContaining({ _id: { $in: expect.arrayContaining([p1._id, p2._id]) } }),
      { $set: { status: PaymentRecordStatus.OVERDUE } }
    );
    expect(mockEmitter.emit).toHaveBeenCalledTimes(2);
  });

  it('should skip auto-debit payments (gatewayPaymentId set and not manual)', async () => {
    const manual = makeOverduePayment({ isManualEntry: true, gatewayPaymentId: 'inv_abc' });
    const autoDebit = makeOverduePayment({ isManualEntry: false, gatewayPaymentId: 'inv_xyz' });
    const noGateway = makeOverduePayment({ isManualEntry: false, gatewayPaymentId: undefined });

    mockPaymentDAO.findOverduePayments.mockResolvedValue({
      items: [manual, autoDebit, noGateway],
      total: 3,
    } as any);
    mockPaymentDAO.update.mockResolvedValue(undefined as any);

    await (paymentService as any).paymentCronService.markOverduePayments();

    const updateCall = mockPaymentDAO.update.mock.calls[0][0] as any;
    // autoDebit should NOT be in the $in list
    expect(updateCall._id.$in.map((id: any) => id.toString())).not.toContain(
      autoDebit._id.toString()
    );
    // manual (has gatewayPaymentId but isManualEntry=true) should be included
    expect(updateCall._id.$in.map((id: any) => id.toString())).toContain(manual._id.toString());
    // noGateway (isManualEntry=false, no gatewayPaymentId) should be included
    expect(updateCall._id.$in.map((id: any) => id.toString())).toContain(noGateway._id.toString());
  });

  it('should do nothing when there are no past-due payments', async () => {
    mockPaymentDAO.findOverduePayments.mockResolvedValue({ items: [], total: 0 } as any);

    await (paymentService as any).paymentCronService.markOverduePayments();

    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
    expect(mockEmitter.emit).not.toHaveBeenCalled();
  });

  it('should do nothing when all past-due payments are already OVERDUE', async () => {
    const alreadyOverdue = makeOverduePayment({ status: PaymentRecordStatus.OVERDUE });
    mockPaymentDAO.findOverduePayments.mockResolvedValue({
      items: [alreadyOverdue],
      total: 1,
    } as any);

    await (paymentService as any).paymentCronService.markOverduePayments();

    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPaymentStats — collection rate is RENT-only
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPaymentStats (RENT-only collection rate)', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  const makeStat = (
    status: PaymentRecordStatus,
    baseAmount: number,
    paymentType: PaymentRecordType = PaymentRecordType.RENT,
    overrides: Record<string, any> = {}
  ) => ({
    pytuid: `PYT-${Math.random()}`,
    cuid: CUID,
    status,
    paymentType,
    baseAmount,
    processingFee: 0,
    ...overrides,
  });

  beforeEach(() => {
    mockClientDAO = {
      findFirst: jest.fn().mockResolvedValue({ cuid: CUID }),
    } as unknown as jest.Mocked<ClientDAO>;
    mockPaymentDAO = { findByCuid: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    paymentService = makeServiceWithMocks({ clientDAO: mockClientDAO, paymentDAO: mockPaymentDAO });
  });

  afterEach(() => jest.clearAllMocks());

  it('should exclude MAINTENANCE payments from the collection rate calculation', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [
        // RENT: 60k collected out of 100k expected → 60%
        makeStat(PaymentRecordStatus.PAID, 60000, PaymentRecordType.RENT),
        makeStat(PaymentRecordStatus.PENDING, 40000, PaymentRecordType.RENT),
        // MAINTENANCE: fully collected, but must NOT inflate the collection rate
        makeStat(PaymentRecordStatus.PAID, 200000, PaymentRecordType.MAINTENANCE),
      ],
      total: 3,
    } as any);

    const result = await paymentService.getPaymentStats(CUID);

    // If MAINTENANCE were included: (60k + 200k) / (100k + 200k) = ~87%
    // Correct (RENT-only): 60k / 100k = 60%
    expect(result.data.collectionRate).toBe(60);
  });

  it('should exclude LATE_FEE payments from the collection rate', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [
        makeStat(PaymentRecordStatus.PAID, 100000, PaymentRecordType.RENT),
        makeStat(PaymentRecordStatus.PAID, 5000, PaymentRecordType.LATE_FEE),
        makeStat(PaymentRecordStatus.OVERDUE, 5000, PaymentRecordType.LATE_FEE),
      ],
      total: 3,
    } as any);

    const result = await paymentService.getPaymentStats(CUID);

    // RENT: 100k paid / 100k expected = 100%
    expect(result.data.collectionRate).toBe(100);
    // But total collected still includes late fees
    expect(result.data.collected).toBe(105000);
  });

  it('should return 0 collection rate when no RENT payments exist', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [
        makeStat(PaymentRecordStatus.PAID, 30000, PaymentRecordType.MAINTENANCE),
        makeStat(PaymentRecordStatus.PAID, 5000, PaymentRecordType.LATE_FEE),
      ],
      total: 2,
    } as any);

    const result = await paymentService.getPaymentStats(CUID);

    expect(result.data.collectionRate).toBe(0);
    expect(result.data.collected).toBe(35000); // overall collected still includes all types
  });

  it('should include SECURITY_DEPOSIT and DEPOSIT_REFUND in totals but not collection rate', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [
        makeStat(PaymentRecordStatus.PAID, 50000, PaymentRecordType.RENT),
        makeStat(PaymentRecordStatus.PAID, 150000, PaymentRecordType.SECURITY_DEPOSIT),
      ],
      total: 2,
    } as any);

    const result = await paymentService.getPaymentStats(CUID);

    expect(result.data.collectionRate).toBe(100); // 50k RENT paid / 50k RENT expected
    expect(result.data.collected).toBe(200000); // overall collected includes deposit
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// autoChargeDueRentPayments (private — accessed via any cast)
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - autoChargeDueRentPayments', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockGateway: jest.Mocked<PaymentGatewayService>;

  const ACCOUNT_ID = 'acct_test_123';

  const makeDueRentPayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: `PYT-${Math.random().toString(36).slice(2)}`,
    cuid: CUID,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.RENT,
    baseAmount: 150000,
    processingFee: 2900,
    dueDate: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
    isManualEntry: false,
    gatewayPaymentId: 'in_stripe_invoice_001',
    ...overrides,
  });

  const makeClient = (onlinePayments = true) => ({
    cuid: CUID,
    settings: { tenantFeatures: { onlinePayments } },
  });

  beforeEach(() => {
    mockPaymentDAO = {
      list: jest.fn(),
      updateById: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<PaymentDAO>;

    mockClientDAO = {
      getClientByCuid: jest.fn(),
    } as unknown as jest.Mocked<ClientDAO>;

    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;

    mockGateway = {
      payInvoice: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockGateway,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('does nothing when there are no due rent payments', async () => {
    mockPaymentDAO.list.mockResolvedValue({ items: [], total: 0 } as any);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    expect(mockGateway.payInvoice).not.toHaveBeenCalled();
  });

  it('queries only PENDING/OVERDUE rent with a gatewayPaymentId and dueDate <= now', async () => {
    mockPaymentDAO.list.mockResolvedValue({ items: [], total: 0 } as any);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    const [query] = mockPaymentDAO.list.mock.calls[0] as [any];
    expect(query.paymentType).toBe(PaymentRecordType.RENT);
    expect(query.status.$in).toEqual(
      expect.arrayContaining([PaymentRecordStatus.PENDING, PaymentRecordStatus.OVERDUE])
    );
    expect(query.isManualEntry).toBe(false);
    expect(query.gatewayPaymentId.$exists).toBe(true);
    expect(query.dueDate.$lte).toBeInstanceOf(Date);
  });

  it('calls payInvoice for each due payment with the connected account id', async () => {
    const p1 = makeDueRentPayment({ gatewayPaymentId: 'in_aaa' });
    const p2 = makeDueRentPayment({ gatewayPaymentId: 'in_bbb' });
    mockPaymentDAO.list.mockResolvedValue({ items: [p1, p2], total: 2 } as any);
    mockClientDAO.getClientByCuid.mockResolvedValue(makeClient() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: ACCOUNT_ID } as any);
    mockGateway.payInvoice.mockResolvedValue({ success: true } as any);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    expect(mockGateway.payInvoice).toHaveBeenCalledTimes(2);
    expect(mockGateway.payInvoice).toHaveBeenCalledWith(expect.anything(), 'in_aaa');
    expect(mockGateway.payInvoice).toHaveBeenCalledWith(expect.anything(), 'in_bbb');
  });

  it('handles OVERDUE payments as well as PENDING', async () => {
    const overdue = makeDueRentPayment({ status: PaymentRecordStatus.OVERDUE });
    mockPaymentDAO.list.mockResolvedValue({ items: [overdue], total: 1 } as any);
    mockClientDAO.getClientByCuid.mockResolvedValue(makeClient() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: ACCOUNT_ID } as any);
    mockGateway.payInvoice.mockResolvedValue({ success: true } as any);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    expect(mockGateway.payInvoice).toHaveBeenCalledTimes(1);
  });

  it('skips payments when online payments are disabled for the client', async () => {
    const p = makeDueRentPayment();
    mockPaymentDAO.list.mockResolvedValue({ items: [p], total: 1 } as any);
    mockClientDAO.getClientByCuid.mockResolvedValue(makeClient(false) as any);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    expect(mockGateway.payInvoice).not.toHaveBeenCalled();
    expect(mockPaymentProcessorDAO.findFirst).not.toHaveBeenCalled();
  });

  it('caches the online-payments flag and processor per cuid to avoid redundant DB lookups', async () => {
    const payments = [makeDueRentPayment(), makeDueRentPayment(), makeDueRentPayment()];
    mockPaymentDAO.list.mockResolvedValue({ items: payments, total: 3 } as any);
    mockClientDAO.getClientByCuid.mockResolvedValue(makeClient() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: ACCOUNT_ID } as any);
    mockGateway.payInvoice.mockResolvedValue({ success: true } as any);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    expect(mockClientDAO.getClientByCuid).toHaveBeenCalledTimes(1);
    expect(mockPaymentProcessorDAO.findFirst).toHaveBeenCalledTimes(1);
  });

  it('skips and increments failed when no payment processor is configured', async () => {
    const p = makeDueRentPayment();
    mockPaymentDAO.list.mockResolvedValue({ items: [p], total: 1 } as any);
    mockClientDAO.getClientByCuid.mockResolvedValue(makeClient() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    expect(mockGateway.payInvoice).not.toHaveBeenCalled();
  });

  it('continues processing remaining payments after one Stripe charge fails', async () => {
    const p1 = makeDueRentPayment({ gatewayPaymentId: 'in_fail' });
    const p2 = makeDueRentPayment({ gatewayPaymentId: 'in_ok' });
    mockPaymentDAO.list.mockResolvedValue({ items: [p1, p2], total: 2 } as any);
    mockClientDAO.getClientByCuid.mockResolvedValue(makeClient() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: ACCOUNT_ID } as any);
    mockGateway.payInvoice
      .mockRejectedValueOnce(new Error('card_declined'))
      .mockResolvedValueOnce({ success: true } as any);

    await (paymentService as any).paymentCronService.autoChargeDueRentPayments();

    expect(mockGateway.payInvoice).toHaveBeenCalledTimes(2);
  });

  it('is registered in getCronJobs with the correct schedule and service name', async () => {
    const jobs = await paymentService.getCronJobs();
    const job = jobs.find((j) => j.name.startsWith('payment.auto-charge-due-rent.'));
    expect(job).toBeDefined();
    expect(job!.schedule).toBe('0 6 * * *');
    expect(job!.service).toBe('PaymentCronService');
    expect(job!.enabled).toBe(true);
    expect(typeof job!.handler).toBe('function');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// autoChargeOverdueMaintenancePayments (private — accessed via any cast)
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - autoChargeOverdueMaintenancePayments', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

  const TENANT_PROFILE_ID = new Types.ObjectId();
  const TENANT_USER_ID = new Types.ObjectId();

  const makeDueNonRentPayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: `PYT-${Math.random().toString(36).slice(2)}`,
    cuid: CUID,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.MAINTENANCE,
    baseAmount: 15000,
    dueDate: new Date(Date.now() - 60 * 60 * 1000),
    tenant: TENANT_PROFILE_ID,
    isManualEntry: false,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      list: jest.fn(),
      updateById: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        settings: { tenantFeatures: { onlinePayments: true } },
      }),
    } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({ _id: TENANT_PROFILE_ID, user: TENANT_USER_ID }),
    } as unknown as jest.Mocked<ProfileDAO>;

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
    });
    jest
      .spyOn((paymentService as any).paymentCronService as any, 'payPendingChargeInternal')
      .mockResolvedValue({ success: true } as any);
  });

  afterEach(() => jest.restoreAllMocks());

  it('queries due maintenance and late fee payments, including existing open invoices', async () => {
    mockPaymentDAO.list.mockResolvedValue({ items: [], total: 0 } as any);

    await (paymentService as any).paymentCronService.autoChargeOverdueMaintenancePayments();

    const [query] = mockPaymentDAO.list.mock.calls[0] as [any];
    expect(query.paymentType.$in).toEqual(
      expect.arrayContaining([PaymentRecordType.MAINTENANCE, PaymentRecordType.LATE_FEE])
    );
    expect(query.gatewayPaymentId).toBeUndefined();
    expect(query.gatewayChargeId.$exists).toBe(false);
    expect(query.dueDate.$lt).toBeInstanceOf(Date);
  });

  it('auto-charges due late fee payments through payPendingChargeInternal', async () => {
    const lateFee = makeDueNonRentPayment({
      paymentType: PaymentRecordType.LATE_FEE,
      gatewayPaymentId: 'in_existing_open_late_fee',
    });
    mockPaymentDAO.list.mockResolvedValue({ items: [lateFee], total: 1 } as any);

    await (paymentService as any).paymentCronService.autoChargeOverdueMaintenancePayments();

    expect(
      (paymentService as any).paymentCronService.payPendingChargeInternal
    ).toHaveBeenCalledWith(lateFee, TENANT_USER_ID.toString());
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// buildLineItemsFromFees
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - buildLineItemsFromFees', () => {
  let paymentService: PaymentService;

  beforeEach(() => {
    paymentService = makeServiceWithMocks();
  });

  const baseFees = {
    monthly: { rent: 150000, petFee: 0, total: 150000 },
    late: { daysLate: 0, fee: 0, type: 'fixed', percentage: 0, gracePeriod: 5 },
    deposits: { security: 0, pet: 0, total: 0 },
    currency: 'USD',
  };

  const callBuild = (fees: any, options?: any) =>
    (paymentService as any).rentPaymentService.buildLineItemsFromFees(fees, options);

  it('should produce a single rent line item for standard monthly rent', () => {
    const items = callBuild(baseFees);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({ description: 'Monthly Rent', amountInCents: 150000 });
  });

  it('should include pet fee when present', () => {
    const fees = { ...baseFees, monthly: { rent: 150000, petFee: 5000, total: 155000 } };
    const items = callBuild(fees);
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ description: 'Pet Fee', amountInCents: 5000 });
  });

  it('should include late fee with description containing days late', () => {
    const fees = {
      ...baseFees,
      late: { daysLate: 10, fee: 7500, type: 'fixed', percentage: 0, gracePeriod: 5 },
    };
    const items = callBuild(fees);
    expect(items).toHaveLength(2);
    expect(items[1].description).toContain('Late Fee');
    expect(items[1].description).toContain('10 days late');
    expect(items[1].amountInCents).toBe(7500);
  });

  it('should include percentage in late fee description when type is percentage', () => {
    const fees = {
      ...baseFees,
      late: { daysLate: 7, fee: 7500, type: 'percentage', percentage: 5, gracePeriod: 5 },
    };
    const items = callBuild(fees);
    expect(items[1].description).toContain('5%');
  });

  it('should include security and pet deposits on first payment', () => {
    const fees = {
      ...baseFees,
      deposits: { security: 150000, pet: 25000, total: 175000 },
    };
    const items = callBuild(fees, { isFirstPayment: true });
    expect(items).toHaveLength(3);
    expect(items.find((i: any) => i.description === 'Security Deposit')).toEqual({
      description: 'Security Deposit',
      amountInCents: 150000,
    });
    expect(items.find((i: any) => i.description === 'Pet Deposit')).toEqual({
      description: 'Pet Deposit',
      amountInCents: 25000,
    });
  });

  it('should NOT include deposits when isFirstPayment is false', () => {
    const fees = {
      ...baseFees,
      deposits: { security: 150000, pet: 25000, total: 175000 },
    };
    const items = callBuild(fees, { isFirstPayment: false });
    expect(items).toHaveLength(1);
    expect(items[0].description).toBe('Monthly Rent');
  });

  it('should include management fee when provided', () => {
    const items = callBuild(baseFees, { managementFee: 12000 });
    expect(items).toHaveLength(2);
    expect(items[1]).toEqual({ description: 'Management Fee', amountInCents: 12000 });
  });

  it('should NOT include management fee when zero', () => {
    const items = callBuild(baseFees, { managementFee: 0 });
    expect(items).toHaveLength(1);
  });

  it('should throw when no valid fees produce line items', () => {
    const fees = {
      monthly: { rent: 0, petFee: 0, total: 0 },
      late: { daysLate: 0, fee: 0, type: 'fixed', percentage: 0, gracePeriod: 5 },
      deposits: { security: 0, pet: 0, total: 0 },
      currency: 'USD',
    };
    expect(() => callBuild(fees)).toThrow('No valid fees found on lease');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// getPaymentByUid — lineItems
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getPaymentByUid lineItems', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

  beforeEach(() => {
    mockPaymentDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockClientDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should return lineItems in the response when present on the payment', async () => {
    const lineItems = [
      { description: 'Monthly Rent', amountInCents: 150000 },
      { description: 'Pet Fee', amountInCents: 5000 },
    ];
    const payment = makePayment({
      lineItems,
      toObject: function () {
        return { ...this };
      },
      tenant: {
        personalInfo: { firstName: 'Jane', lastName: 'Doe', phoneNumber: '555-1234' },
        user: { email: 'jane@test.com' },
        puid: 'PUID001',
      },
      lease: null,
    });

    mockClientDAO.findFirst.mockResolvedValue({ _id: new Types.ObjectId(), cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);

    const result = await paymentService.getPaymentByUid(CUID, PYTUID);

    expect(result.success).toBe(true);
    expect(result.data.lineItems).toEqual(lineItems);
  });

  it('should return empty lineItems array for manual entries without line items', async () => {
    const payment = makePayment({
      isManualEntry: true,
      toObject: function () {
        return { ...this };
      },
      tenant: {
        personalInfo: { firstName: 'John', lastName: 'Smith' },
        user: { email: 'john@test.com' },
        puid: 'PUID002',
      },
      lease: null,
    });

    mockClientDAO.findFirst.mockResolvedValue({ _id: new Types.ObjectId(), cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);

    const result = await paymentService.getPaymentByUid(CUID, PYTUID);

    expect(result.success).toBe(true);
    expect(result.data.lineItems).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createManualTrackingPayment
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - createManualTrackingPayment', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };

  const profileId = new Types.ObjectId();
  const leaseObjectId = new Types.ObjectId();

  const makeProfile = () => ({ _id: profileId });
  const makeTrackedPayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: 'PYT-TRACK-001',
    cuid: CUID,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.CASH,
    baseAmount: 350000,
    processingFee: 0,
    isManualEntry: false,
    ...overrides,
  });

  beforeEach(() => {
    mockPaymentDAO = { insert: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockEmitter = { emit: jest.fn(), on: jest.fn() };

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
      emitterService: mockEmitter,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a PENDING payment record with isManualEntry false and no gatewayPaymentId', async () => {
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockPaymentDAO.insert.mockResolvedValue(makeTrackedPayment() as any);

    const dueDate = new Date('2026-05-01');
    await (paymentService as any).rentPaymentService.createManualTrackingPayment({
      cuid: CUID,
      tenantId: 'user-id-123',
      dueDate,
      baseAmount: 350000,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.CASH,
      leaseId: leaseObjectId.toString(),
      period: { month: 5, year: 2026 },
    });

    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: CUID,
        status: PaymentRecordStatus.PENDING,
        isManualEntry: false,
        processingFee: 0,
        baseAmount: 350000,
        paymentMethod: PaymentMethod.CASH,
        paymentType: PaymentRecordType.RENT,
      })
    );
    expect(mockPaymentDAO.insert.mock.calls[0][0].gatewayPaymentId).toBeUndefined();
  });

  it('emits PAYMENT_REQUEST_CREATED after inserting the record', async () => {
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    const payment = makeTrackedPayment({ pytuid: 'PYT-EMIT' });
    mockPaymentDAO.insert.mockResolvedValue(payment as any);

    const dueDate = new Date('2026-05-01');
    await (paymentService as any).rentPaymentService.createManualTrackingPayment({
      cuid: CUID,
      tenantId: 'user-id-123',
      dueDate,
      baseAmount: 350000,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.CASH,
    });

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      'payment:request:created',
      expect.objectContaining({
        tenantUserId: 'user-id-123',
        amountInCents: 350000,
        dueDate,
        pytuid: 'PYT-EMIT',
        cuid: CUID,
      })
    );
  });

  it('maps MAINTENANCE paymentType correctly', async () => {
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockPaymentDAO.insert.mockResolvedValue(
      makeTrackedPayment({ paymentType: PaymentRecordType.MAINTENANCE }) as any
    );

    await (paymentService as any).rentPaymentService.createManualTrackingPayment({
      cuid: CUID,
      tenantId: 'user-id-123',
      dueDate: new Date(),
      baseAmount: 50000,
      paymentType: PaymentRecordType.MAINTENANCE,
      paymentMethod: PaymentMethod.OTHER,
      maintenanceRequestUid: 'MR-001',
    });

    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentType: PaymentRecordType.MAINTENANCE,
        maintenanceRequestUid: 'MR-001',
      })
    );
  });

  it('throws NotFoundError when tenant profile is not found', async () => {
    mockProfileDAO.findFirst.mockResolvedValue(null);

    await expect(
      (paymentService as any).rentPaymentService.createManualTrackingPayment({
        cuid: CUID,
        tenantId: 'missing-user',
        dueDate: new Date(),
        baseAmount: 350000,
        paymentType: PaymentRecordType.RENT,
        paymentMethod: PaymentMethod.CASH,
      })
    ).rejects.toThrow(NotFoundError);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleLeaseActivated
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleLeaseActivated', () => {
  let paymentService: PaymentService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };

  const leaseId = new Types.ObjectId().toString();
  const luid = 'LS-001';
  const tenantId = 'user-tenant-id';

  const makeLease = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    luid,
    cuid: CUID,
    fees: { acceptedPaymentMethod: 'cash', rentAmount: 350000, securityDeposit: 0 },
    duration: { startDate: new Date('2026-05-01') },
    includeManagementFee: false,
    ...overrides,
  });

  beforeEach(() => {
    mockLeaseDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<LeaseDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockPaymentDAO = {
      insert: jest.fn(),
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockEmitter = { emit: jest.fn(), on: jest.fn() };

    paymentService = makeServiceWithMocks({
      leaseDAO: mockLeaseDAO,
      profileDAO: mockProfileDAO,
      paymentDAO: mockPaymentDAO,
      emitterService: mockEmitter,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('calls createManualTrackingPayment for non-auto-debit leases', async () => {
    mockLeaseDAO.findFirst.mockResolvedValue(
      makeLease({
        fees: { acceptedPaymentMethod: 'cash', rentAmount: 350000, securityDeposit: 0 },
      }) as any
    );
    mockProfileDAO.findFirst.mockResolvedValue({ _id: new Types.ObjectId() } as any);
    mockPaymentDAO.insert.mockResolvedValue({ pytuid: 'PYT-TRACK' } as any);

    await (paymentService as any).rentPaymentService.handleLeaseActivated({
      leaseId,
      luid,
      cuid: CUID,
      tenantId,
    });

    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        status: PaymentRecordStatus.PENDING,
        isManualEntry: false,
        paymentType: PaymentRecordType.RENT,
        paymentMethod: PaymentMethod.CASH,
      })
    );
  });

  it('calls createManualTrackingPayment with CHECK method for check leases', async () => {
    mockLeaseDAO.findFirst.mockResolvedValue(
      makeLease({
        fees: { acceptedPaymentMethod: 'check', rentAmount: 350000, securityDeposit: 0 },
      }) as any
    );
    mockProfileDAO.findFirst.mockResolvedValue({ _id: new Types.ObjectId() } as any);
    mockPaymentDAO.insert.mockResolvedValue({ pytuid: 'PYT-CHECK' } as any);

    await (paymentService as any).rentPaymentService.handleLeaseActivated({
      leaseId,
      luid,
      cuid: CUID,
      tenantId,
    });

    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: PaymentMethod.CHECK })
    );
  });

  it('does not throw when payment creation fails — never blocks activation', async () => {
    mockLeaseDAO.findFirst.mockResolvedValue(makeLease() as any);
    mockProfileDAO.findFirst.mockResolvedValue(null); // will cause NotFoundError inside

    await expect(
      (paymentService as any).rentPaymentService.handleLeaseActivated({
        leaseId,
        luid,
        cuid: CUID,
        tenantId,
      })
    ).resolves.not.toThrow();
  });

  it('returns early without creating a payment when lease is not found', async () => {
    mockLeaseDAO.findFirst.mockResolvedValue(null);

    await (paymentService as any).rentPaymentService.handleLeaseActivated({
      leaseId,
      luid,
      cuid: CUID,
      tenantId,
    });

    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// queueWeeklyRentInvoices / queueDailySafetyNetInvoices
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - queueWeeklyRentInvoices', () => {
  let paymentService: PaymentService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };
  let mockQueueFactory: { getQueue: jest.Mock };
  let mockPaymentQueue: { addCreateRentInvoiceJob: jest.Mock };

  // Rent due tomorrow so it falls within the 7-day window
  const rentDueDay = new Date().getDate() + 1 > 28 ? 1 : new Date().getDate() + 1;

  const makeAutoDebitLease = () => ({
    _id: new Types.ObjectId(),
    luid: 'LS-AUTO',
    cuid: CUID,
    tenantId: new Types.ObjectId(),
    fees: {
      acceptedPaymentMethod: 'auto-debit',
      rentDueDay,
      rentAmount: 350000,
      securityDeposit: 0,
    },
    includeManagementFee: false,
    duration: { startDate: new Date('2020-01-01') },
  });

  const makeCashLease = () => ({
    _id: new Types.ObjectId(),
    luid: 'LS-CASH',
    cuid: CUID,
    tenantId: new Types.ObjectId(),
    fees: { acceptedPaymentMethod: 'cash', rentDueDay, rentAmount: 350000, securityDeposit: 0 },
    includeManagementFee: false,
    duration: { startDate: new Date('2020-01-01') },
  });

  beforeEach(() => {
    mockPaymentQueue = { addCreateRentInvoiceJob: jest.fn() };
    mockQueueFactory = { getQueue: jest.fn().mockReturnValue(mockPaymentQueue) };

    mockLeaseDAO = { list: jest.fn() } as unknown as jest.Mocked<LeaseDAO>;
    mockPaymentDAO = {
      findByPeriod: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockClientDAO = {
      getClientByCuid: jest
        .fn()
        .mockResolvedValue({ settings: { tenantFeatures: { onlinePayments: true } } }),
    } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    } as unknown as jest.Mocked<ProfileDAO>;
    mockEmitter = { emit: jest.fn(), on: jest.fn() };

    paymentService = makeServiceWithMocks({
      leaseDAO: mockLeaseDAO,
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emitterService: mockEmitter,
    });
    // queueFactory lives on paymentCronService after the refactor
    (paymentService as any).paymentCronService.queueFactory = mockQueueFactory;
  });

  afterEach(() => jest.clearAllMocks());

  it('queues a Stripe invoice job for auto-debit leases', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeAutoDebitLease()], total: 1 } as any);
    mockPaymentDAO.insert = jest.fn();

    await (paymentService as any).paymentCronService.queueWeeklyRentInvoices();

    expect(mockPaymentQueue.addCreateRentInvoiceJob).toHaveBeenCalledTimes(1);
    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });

  it('creates a manual tracking record for cash leases instead of queuing a Stripe job', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeCashLease()], total: 1 } as any);
    mockPaymentDAO.insert = jest.fn().mockResolvedValue({ pytuid: 'PYT-CASH' } as any);

    await (paymentService as any).paymentCronService.queueWeeklyRentInvoices();

    expect(mockPaymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: PaymentMethod.CASH,
        status: PaymentRecordStatus.PENDING,
        isManualEntry: false,
      })
    );
  });

  it('skips a lease when a payment record already exists for the period', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeCashLease()], total: 1 } as any);
    mockPaymentDAO.findByPeriod = jest.fn().mockResolvedValue({ pytuid: 'EXISTING' });
    mockPaymentDAO.insert = jest.fn();

    await (paymentService as any).paymentCronService.queueWeeklyRentInvoices();

    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
    expect(mockPaymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
  });

  it('skips auto-debit lease when online payments are disabled for the client', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeAutoDebitLease()], total: 1 } as any);
    mockClientDAO.getClientByCuid = jest
      .fn()
      .mockResolvedValue({ settings: { tenantFeatures: { onlinePayments: false } } });
    mockPaymentDAO.insert = jest.fn();

    await (paymentService as any).paymentCronService.queueWeeklyRentInvoices();

    expect(mockPaymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });
});

describe('PaymentService - queueDailySafetyNetInvoices', () => {
  let paymentService: PaymentService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };
  let mockQueueFactory: { getQueue: jest.Mock };
  let mockPaymentQueue: { addCreateRentInvoiceJob: jest.Mock };

  const rentDueDay = new Date().getDate();

  const makeAutoDebitLease = () => ({
    _id: new Types.ObjectId(),
    luid: 'LS-AUTO-DAILY',
    cuid: CUID,
    tenantId: new Types.ObjectId(),
    fees: {
      acceptedPaymentMethod: 'auto-debit',
      rentDueDay,
      rentAmount: 350000,
      securityDeposit: 0,
    },
    duration: { startDate: new Date('2020-01-01') },
    includeManagementFee: false,
  });

  const makeCheckLease = () => ({
    _id: new Types.ObjectId(),
    luid: 'LS-CHECK-DAILY',
    cuid: CUID,
    tenantId: new Types.ObjectId(),
    fees: { acceptedPaymentMethod: 'check', rentDueDay, rentAmount: 350000, securityDeposit: 0 },
    duration: { startDate: new Date('2020-01-01') },
    includeManagementFee: false,
  });

  beforeEach(() => {
    mockPaymentQueue = { addCreateRentInvoiceJob: jest.fn() };
    mockQueueFactory = { getQueue: jest.fn().mockReturnValue(mockPaymentQueue) };

    mockLeaseDAO = { list: jest.fn() } as unknown as jest.Mocked<LeaseDAO>;
    mockPaymentDAO = {
      findByPeriod: jest.fn().mockResolvedValue(null),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockClientDAO = {
      getClientByCuid: jest
        .fn()
        .mockResolvedValue({ settings: { tenantFeatures: { onlinePayments: true } } }),
    } as unknown as jest.Mocked<ClientDAO>;
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() }),
    } as unknown as jest.Mocked<ProfileDAO>;
    mockEmitter = { emit: jest.fn(), on: jest.fn() };

    paymentService = makeServiceWithMocks({
      leaseDAO: mockLeaseDAO,
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emitterService: mockEmitter,
    });
    // queueFactory lives on paymentCronService after the refactor
    (paymentService as any).paymentCronService.queueFactory = mockQueueFactory;
  });

  afterEach(() => jest.clearAllMocks());

  it('queues a Stripe invoice job for auto-debit leases due today', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeAutoDebitLease()], total: 1 } as any);
    mockPaymentDAO.insert = jest.fn();

    await (paymentService as any).paymentCronService.queueDailySafetyNetInvoices();

    expect(mockPaymentQueue.addCreateRentInvoiceJob).toHaveBeenCalledTimes(1);
    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });

  it('creates a manual tracking record for check leases due today', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeCheckLease()], total: 1 } as any);
    mockPaymentDAO.insert = jest.fn().mockResolvedValue({ pytuid: 'PYT-CHECK-DAILY' } as any);

    await (paymentService as any).paymentCronService.queueDailySafetyNetInvoices();

    expect(mockPaymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        paymentMethod: PaymentMethod.CHECK,
        status: PaymentRecordStatus.PENDING,
        isManualEntry: false,
      })
    );
  });

  it('skips when a payment record already exists for the period', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeCheckLease()], total: 1 } as any);
    mockPaymentDAO.findByPeriod = jest.fn().mockResolvedValue({ pytuid: 'EXISTING' });
    mockPaymentDAO.insert = jest.fn();

    await (paymentService as any).paymentCronService.queueDailySafetyNetInvoices();

    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });

  it('skips auto-debit lease when online payments are disabled', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeAutoDebitLease()], total: 1 } as any);
    mockClientDAO.getClientByCuid = jest
      .fn()
      .mockResolvedValue({ settings: { tenantFeatures: { onlinePayments: false } } });
    mockPaymentDAO.insert = jest.fn();

    await (paymentService as any).paymentCronService.queueDailySafetyNetInvoices();

    expect(mockPaymentQueue.addCreateRentInvoiceJob).not.toHaveBeenCalled();
    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createManualTrackingPayment — lineItems persistence
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - createManualTrackingPayment lineItems', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;

  const profileId = new Types.ObjectId();

  beforeEach(() => {
    mockPaymentDAO = { insert: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
    });

    mockProfileDAO.findFirst.mockResolvedValue({ _id: profileId } as any);
    mockPaymentDAO.insert.mockResolvedValue({
      _id: new Types.ObjectId(),
      pytuid: 'PYT-LI-001',
    } as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('persists lineItems on the payment record when provided', async () => {
    const lineItems = [
      { description: 'Monthly Rent', amountInCents: 200000 },
      { description: 'Late Fee', amountInCents: 5000 },
    ];

    await (paymentService as any).rentPaymentService.createManualTrackingPayment({
      cuid: CUID,
      tenantId: 'user-id-123',
      dueDate: new Date('2026-05-01'),
      baseAmount: 205000,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.ONLINE,
      leaseId: new Types.ObjectId().toString(),
      period: { month: 5, year: 2026 },
      lineItems,
    });

    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(expect.objectContaining({ lineItems }));
  });

  it('omits lineItems from the insert when not provided', async () => {
    await (paymentService as any).rentPaymentService.createManualTrackingPayment({
      cuid: CUID,
      tenantId: 'user-id-123',
      dueDate: new Date('2026-05-01'),
      baseAmount: 200000,
      paymentType: PaymentRecordType.RENT,
      paymentMethod: PaymentMethod.CASH,
    });

    const insertArg = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertArg.lineItems).toBeUndefined();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// payPendingCharge — lazy RENT invoice creation
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - payPendingCharge (RENT lazy invoice)', () => {
  const TENANT_USER_ID = new Types.ObjectId().toString();
  const PROFILE_OID = new Types.ObjectId();
  const LAZY_ACCOUNT_ID = 'acct_test_lazy';
  const PLATFORM_CUSTOMER = 'cus_platform_tenant';
  const INVOICE_ID = 'in_lazy_001';

  const makeRentPayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: 'PYT-LAZY-001',
    cuid: CUID,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.ONLINE,
    baseAmount: 200000,
    processingFee: 0,
    currency: 'CAD',
    tenant: PROFILE_OID,
    lineItems: [{ description: 'Monthly Rent', amountInCents: 200000 }],
    gatewayPaymentId: null,
    equals: (id: any) => PROFILE_OID.equals(id),
    ...overrides,
  });

  const makeTenantProfile = () => ({
    _id: PROFILE_OID,
    tenantInfo: {
      paymentGatewayCustomers: new Map([['platform', PLATFORM_CUSTOMER]]),
      paymentMandates: new Map([[LAZY_ACCOUNT_ID, 'mandate_abc']]),
      paymentMethods: new Map([[LAZY_ACCOUNT_ID, 'pm_xyz']]),
    },
  });

  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockGateway: jest.Mocked<PaymentGatewayService>;

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockSubscriptionDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<SubscriptionDAO>;
    mockGateway = {
      createInvoice: jest.fn(),
      finalizeInvoice: jest.fn(),
      payInvoice: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;

    const mockPlanConfig = {
      getTransactionFeePercent: jest.fn().mockReturnValue(0.029),
      getAchTransactionFeePercent: jest.fn().mockReturnValue(1.99),
      calculatePaymentGatewayFee: jest.fn().mockReturnValue(0),
    } as unknown as SubscriptionPlanConfig;

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      subscriptionDAO: mockSubscriptionDAO,
      paymentGatewayService: mockGateway,
    });
    (paymentService as any).subscriptionPlanConfig = mockPlanConfig;

    mockPaymentDAO.findFirst.mockResolvedValue(makeRentPayment() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeTenantProfile() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({
      accountId: LAZY_ACCOUNT_ID,
      chargesEnabled: true,
    } as any);
    mockSubscriptionDAO.findFirst.mockResolvedValue({ planName: 'basic', deletedAt: null } as any);
    mockGateway.createInvoice.mockResolvedValue({
      success: true,
      data: { invoiceId: INVOICE_ID },
    } as any);
    mockGateway.finalizeInvoice.mockResolvedValue({ success: true } as any);
    mockGateway.payInvoice.mockResolvedValue({ success: true } as any);
    mockPaymentDAO.updateById.mockResolvedValue({} as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates invoice lazily and charges when gatewayPaymentId is null', async () => {
    const result = await paymentService.payPendingCharge(CUID, 'PYT-LAZY-001', TENANT_USER_ID);

    expect(mockGateway.createInvoice).toHaveBeenCalledTimes(1);
    expect(mockGateway.createInvoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantCustomerId: PLATFORM_CUSTOMER,
        connectedAccountId: LAZY_ACCOUNT_ID,
        lineItems: [{ description: 'Monthly Rent', amountInCents: 200000 }],
        cuid: CUID,
        paymentMethodId: 'pm_xyz',
      })
    );
    expect(mockGateway.finalizeInvoice).toHaveBeenCalledWith(expect.anything(), INVOICE_ID);
    expect(mockGateway.payInvoice).toHaveBeenCalledWith(expect.anything(), INVOICE_ID, {
      paymentMethod: 'pm_xyz',
      mandate: 'mandate_abc',
    });
    expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(expect.any(String), {
      gatewayPaymentId: INVOICE_ID,
    });
    expect(result.success).toBe(true);
  });

  it('throws BadRequestError when lineItems are missing on a no-invoice payment', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeRentPayment({ lineItems: [] }) as any);

    await expect(
      paymentService.payPendingCharge(CUID, 'PYT-LAZY-001', TENANT_USER_ID)
    ).rejects.toThrow(BadRequestError);

    expect(mockGateway.createInvoice).not.toHaveBeenCalled();
  });

  it('skips invoice creation and pays directly when gatewayPaymentId already exists', async () => {
    const existingInvoiceId = 'in_existing_123';
    mockPaymentDAO.findFirst.mockResolvedValue(
      makeRentPayment({ gatewayPaymentId: existingInvoiceId }) as any
    );

    const result = await paymentService.payPendingCharge(CUID, 'PYT-LAZY-001', TENANT_USER_ID);

    expect(mockGateway.createInvoice).not.toHaveBeenCalled();
    expect(mockGateway.finalizeInvoice).not.toHaveBeenCalled();
    expect(mockGateway.payInvoice).toHaveBeenCalledWith(expect.anything(), existingInvoiceId, {
      paymentMethod: 'pm_xyz',
      mandate: 'mandate_abc',
    });
    expect(result.success).toBe(true);
  });

  it('creates, finalizes, and pays a late fee invoice with the tenant payment method', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(
      makeRentPayment({
        paymentType: PaymentRecordType.LATE_FEE,
        description: 'Late fee for April',
        baseAmount: 15000,
        lineItems: undefined,
      }) as any
    );

    const result = await paymentService.payPendingCharge(CUID, 'PYT-LAZY-001', TENANT_USER_ID);

    expect(mockGateway.createInvoice).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        tenantCustomerId: PLATFORM_CUSTOMER,
        connectedAccountId: LAZY_ACCOUNT_ID,
        paymentMethodId: 'pm_xyz',
        lineItems: [{ description: 'Late fee for April', amountInCents: 15000 }],
      })
    );
    expect(mockGateway.finalizeInvoice).toHaveBeenCalledWith(expect.anything(), INVOICE_ID);
    expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(expect.any(String), {
      gatewayPaymentId: INVOICE_ID,
    });
    expect(mockGateway.payInvoice).toHaveBeenCalledWith(expect.anything(), INVOICE_ID, {
      paymentMethod: 'pm_xyz',
      mandate: 'mandate_abc',
    });
    expect(result.success).toBe(true);
  });

  it('pays an existing late fee invoice instead of rejecting the retry', async () => {
    const existingInvoiceId = 'in_existing_late_fee';
    mockPaymentDAO.findFirst.mockResolvedValue(
      makeRentPayment({
        paymentType: PaymentRecordType.LATE_FEE,
        gatewayPaymentId: existingInvoiceId,
        baseAmount: 15000,
      }) as any
    );

    const result = await paymentService.payPendingCharge(CUID, 'PYT-LAZY-001', TENANT_USER_ID);

    expect(mockGateway.createInvoice).not.toHaveBeenCalled();
    expect(mockGateway.finalizeInvoice).not.toHaveBeenCalled();
    expect(mockGateway.payInvoice).toHaveBeenCalledWith(expect.anything(), existingInvoiceId, {
      paymentMethod: 'pm_xyz',
      mandate: 'mandate_abc',
    });
    expect(result.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MaintenancePaymentService - payVendor
// Vendor payout now reads from Invoice (not a vendor expense payment record).
// ═════════════════════════════════════════════════════════════════════════════

describe('MaintenancePaymentService - payVendor', () => {
  const MRUID = 'MR-VENDOR-001';
  const INVUID = 'INV-001';
  const VENDOR_USER_OID = new Types.ObjectId();
  const VENDOR_UID = 'VENDOR-UID-ABC';
  const PM_ACCOUNT_ID = 'acct_pm_test';
  const VENDOR_ACCOUNT_ID = 'acct_vendor_test';
  const TRANSFER_ID = 'tr_test_001';

  const makeInvoice = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    invuid: INVUID,
    mruid: MRUID,
    cuid: CUID,
    status: InvoiceStatus.APPROVED,
    vendorPayoutStatus: 'pending',
    fundsAvailable: true, // default happy path — funds already confirmed settled
    amountInCents: 45000,
    currency: 'CAD',
    submittedBy: VENDOR_USER_OID,
    description: 'Plumbing repair',
    ...overrides,
  });

  let service: MaintenancePaymentService;
  let mockInvoiceDAO: jest.Mocked<InvoiceDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockVendorDAO: { findFirst: jest.Mock };
  let mockGateway: jest.Mocked<PaymentGatewayService>;
  let mockPaymentDAO: { findFirst: jest.Mock };
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };
  let mockUserDAO: jest.Mocked<UserDAO>;

  const VENDOR_VUID = 'VUID-TEST-001';

  const makeVendorRecord = (payoutAccount: Record<string, any> = {}) => ({
    vuid: VENDOR_VUID,
    connectedClients: [
      {
        cuid: CUID,
        payoutAccount: {
          isSetup: true,
          payoutsEnabled: true,
          chargesEnabled: true,
          payoutsBlocked: false,
          ...payoutAccount,
        },
      },
    ],
  });

  beforeEach(() => {
    mockInvoiceDAO = {
      findByMaintenanceRequest: jest.fn(),
      updateById: jest.fn(),
    } as unknown as jest.Mocked<InvoiceDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
      findByVuid: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockVendorDAO = { findFirst: jest.fn() };
    mockGateway = {
      createTransfer: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    mockPaymentDAO = { findFirst: jest.fn() };
    mockEmitter = { emit: jest.fn(), on: jest.fn() };
    mockUserDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<UserDAO>;

    service = new MaintenancePaymentService({
      invoiceDAO: mockInvoiceDAO,
      paymentDAO: mockPaymentDAO as any,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      paymentGatewayService: mockGateway,
      emitterService: mockEmitter as unknown as EventEmitterService,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      userDAO: mockUserDAO,
      vendorDAO: mockVendorDAO as any,
      profileDAO: {} as any,
      clientDAO: {} as any,
      leaseDAO: {} as any,
      subscriptionDAO: {} as any,
      subscriptionPlanConfig: {} as any,
    });

    // Happy-path defaults
    mockInvoiceDAO.findByMaintenanceRequest.mockResolvedValue(makeInvoice() as any);
    mockInvoiceDAO.updateById.mockResolvedValue({} as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({
      accountId: PM_ACCOUNT_ID,
      chargesEnabled: true,
    } as any);
    mockUserDAO.findFirst.mockResolvedValue({ _id: VENDOR_USER_OID, uid: VENDOR_UID } as any);
    mockPaymentProcessorDAO.findByVuid.mockResolvedValue({
      accountId: VENDOR_ACCOUNT_ID,
    } as any);
    mockVendorDAO.findFirst.mockResolvedValue(makeVendorRecord() as any);
    mockPaymentDAO.findFirst.mockResolvedValue({
      gatewayChargeId: 'ch_test_charge_123',
      status: 'paid',
      paymentType: 'maintenance',
    } as any);
    mockGateway.createTransfer.mockResolvedValue({
      success: true,
      data: { transferId: TRANSFER_ID, amount: 45000 },
    } as any);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a Stripe transfer and updates Invoice vendorPayoutStatus to paid', async () => {
    const result = await service.payVendor(CUID, MRUID);

    expect(mockInvoiceDAO.findByMaintenanceRequest).toHaveBeenCalledWith(MRUID, CUID);
    expect(mockGateway.createTransfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        amountInCents: 45000,
        currency: 'cad',
        destination: VENDOR_ACCOUNT_ID,
        sourceTransaction: 'ch_test_charge_123',
        metadata: expect.objectContaining({ mruid: MRUID, cuid: CUID, invuid: INVUID }),
      })
    );
    expect(mockInvoiceDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: expect.objectContaining({
          vendorPayoutStatus: 'paid',
          vendorPayoutTransferId: TRANSFER_ID,
        }),
      })
    );
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_VENDOR_PAID,
      expect.objectContaining({ mruid: MRUID, cuid: CUID, transferId: TRANSFER_ID, invuid: INVUID })
    );
    expect(result.success).toBe(true);
  });

  it('throws NotFoundError when no invoice found for the mruid', async () => {
    mockInvoiceDAO.findByMaintenanceRequest.mockResolvedValue(null);

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(NotFoundError);
    expect(mockGateway.createTransfer).not.toHaveBeenCalled();
  });

  it('throws BadRequestError when invoice is not yet approved', async () => {
    mockInvoiceDAO.findByMaintenanceRequest.mockResolvedValue(
      makeInvoice({ status: InvoiceStatus.PENDING }) as any
    );

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mockGateway.createTransfer).not.toHaveBeenCalled();
  });

  it('throws BadRequestError when vendor already paid (idempotency guard via Invoice)', async () => {
    mockInvoiceDAO.findByMaintenanceRequest.mockResolvedValue(
      makeInvoice({ vendorPayoutStatus: 'paid' }) as any
    );

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mockGateway.createTransfer).not.toHaveBeenCalled();
  });

  it('throws BadRequestError when PM has no payment processor', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
  });

  it('throws NotFoundError when vendor user record not found', async () => {
    mockUserDAO.findFirst.mockResolvedValue(null);

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when vendor has no payout account', async () => {
    mockPaymentProcessorDAO.findByVuid.mockResolvedValue(null);

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when vendor payout account is not yet verified (payoutsEnabled false in connectedClients)', async () => {
    mockVendorDAO.findFirst.mockResolvedValue(
      makeVendorRecord({ isSetup: true, payoutsEnabled: false }) as any
    );

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when tenant payment charge not found', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mockGateway.createTransfer).not.toHaveBeenCalled();
  });

  it('throws BadRequestError when payment record has no gatewayChargeId', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue({ status: 'paid', gatewayChargeId: null } as any);

    await expect(service.payVendor(CUID, MRUID)).rejects.toThrow(BadRequestError);
    expect(mockGateway.createTransfer).not.toHaveBeenCalled();
  });

  it('passes sourceTransaction from payment record gatewayChargeId', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue({
      gatewayChargeId: 'ch_custom_id',
      status: 'paid',
      paymentType: 'maintenance',
    } as any);

    await service.payVendor(CUID, MRUID);

    expect(mockGateway.createTransfer).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sourceTransaction: 'ch_custom_id' })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// MaintenancePaymentService - handleMaintenanceInvoiceApproved
// Vendor expense record no longer created — only tenant charge (if billable).
// ═════════════════════════════════════════════════════════════════════════════

describe('MaintenancePaymentService - handleMaintenanceInvoiceApproved', () => {
  const MRUID = 'MR-APPROVED-001';
  const TENANT_ID = new Types.ObjectId().toString();
  const VENDOR_ID = new Types.ObjectId().toString();

  const makePayload = (overrides: Record<string, any> = {}) => ({
    mruid: MRUID,
    cuid: CUID,
    title: 'Fix leaking pipe',
    amount: 30000,
    currency: 'USD',
    approvedBy: new Types.ObjectId().toString(),
    vendorId: VENDOR_ID,
    tenantId: TENANT_ID,
    isBillable: true,
    invoiceLineItems: [],
    requestId: new Types.ObjectId().toString(),
    ...overrides,
  });

  let service: MaintenancePaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn().mockResolvedValue(null),
      insert: jest.fn().mockResolvedValue({ pytuid: 'PYT-001', mruid: MRUID } as any),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockProfileDAO = {
      getProfileByUserId: jest.fn().mockResolvedValue({ _id: new Types.ObjectId() } as any),
    } as unknown as jest.Mocked<ProfileDAO>;
    mockSubscriptionDAO = {
      findFirst: jest.fn().mockResolvedValue({ planName: 'growth', deletedAt: null } as any),
    } as unknown as jest.Mocked<SubscriptionDAO>;
    mockLeaseDAO = {
      getActiveLeaseByTenant: jest.fn().mockResolvedValue({ fees: { currency: 'USD' } } as any),
    } as unknown as jest.Mocked<LeaseDAO>;
    mockEmitter = { emit: jest.fn(), on: jest.fn() };

    service = new MaintenancePaymentService({
      invoiceDAO: {} as any,
      paymentDAO: mockPaymentDAO,
      paymentProcessorDAO: {} as any,
      paymentGatewayService: {} as any,
      emitterService: mockEmitter as unknown as EventEmitterService,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      userDAO: {} as any,
      vendorDAO: {} as any,
      profileDAO: mockProfileDAO,
      clientDAO: {} as any,
      leaseDAO: mockLeaseDAO,
      subscriptionDAO: mockSubscriptionDAO,
      subscriptionPlanConfig: { getTransactionFeePercent: jest.fn().mockReturnValue(4.0) } as any,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('does NOT create a vendor expense payment record on invoice approval', async () => {
    await (service as any).handleMaintenanceInvoiceApproved(makePayload());

    const insertCalls = mockPaymentDAO.insert.mock.calls;
    const vendorExpenseCalls = insertCalls.filter((args: any[]) => args[0]?.vendorId != null);
    expect(vendorExpenseCalls).toHaveLength(0);
  });

  it('creates a tenant charge when isBillable=true and tenantId is provided', async () => {
    await (service as any).handleMaintenanceInvoiceApproved(makePayload({ isBillable: true }));

    expect(mockPaymentDAO.insert).toHaveBeenCalledTimes(1);
    const insertArg = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertArg.vendorId).toBeUndefined();
    expect(insertArg.maintenanceRequestUid).toBe(MRUID);
  });

  it('creates NO payment records when isBillable=false', async () => {
    await (service as any).handleMaintenanceInvoiceApproved(makePayload({ isBillable: false }));

    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });

  it('creates NO payment records when isBillable=true but tenantId is missing', async () => {
    await (service as any).handleMaintenanceInvoiceApproved(
      makePayload({ isBillable: true, tenantId: undefined })
    );

    expect(mockPaymentDAO.insert).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PaymentService - getVendorEarnings
// Now uses InvoiceDAO.listByVendor instead of PaymentDAO.
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - getVendorEarnings', () => {
  const VENDOR_UID = 'VENDOR-UID-EARN';
  const VENDOR_OID = new Types.ObjectId();
  const INVUID_1 = 'INV-EARN-001';
  const INVUID_2 = 'INV-EARN-002';

  const makeInvoice = (overrides: Record<string, any> = {}) => ({
    invuid: INVUID_1,
    mruid: 'MR-001',
    description: 'Roof repair',
    amountInCents: 80000,
    vendorPayoutStatus: 'pending',
    vendorPaidAt: undefined,
    createdAt: new Date('2026-03-01'),
    ...overrides,
  });

  let paymentService: PaymentService;
  let mockInvoiceDAO: jest.Mocked<InvoiceDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;

  beforeEach(() => {
    mockInvoiceDAO = {
      listByVendor: jest.fn(),
    } as unknown as jest.Mocked<InvoiceDAO>;
    mockUserDAO = {
      findFirst: jest.fn().mockResolvedValue({ _id: VENDOR_OID, uid: VENDOR_UID } as any),
    } as unknown as jest.Mocked<UserDAO>;

    paymentService = makeServiceWithMocks({ userDAO: mockUserDAO });
    (paymentService as any).invoiceDAO = mockInvoiceDAO;
  });

  afterEach(() => jest.clearAllMocks());

  it('returns invoice-based earnings with correct paid/pending split', async () => {
    mockInvoiceDAO.listByVendor.mockResolvedValue({
      items: [
        makeInvoice({
          invuid: INVUID_1,
          vendorPayoutStatus: 'paid',
          vendorPaidAt: new Date(),
          amountInCents: 80000,
        }),
        makeInvoice({
          invuid: INVUID_2,
          mruid: 'MR-002',
          description: 'AC repair',
          vendorPayoutStatus: 'pending',
          amountInCents: 45000,
        }),
      ],
      pagination: { total: 2, currentPage: 1, perPage: 50, totalPages: 1 },
    } as any);

    const result = await paymentService.getVendorEarnings(CUID, VENDOR_UID);

    expect(result.success).toBe(true);
    expect(result.data.items).toHaveLength(2);
    expect(result.data.items[0].invuid).toBe(INVUID_1);
    expect(result.data.items[0].status).toBe(PaymentRecordStatus.PAID);
    expect(result.data.items[1].invuid).toBe(INVUID_2);
    expect(result.data.items[1].status).toBe(PaymentRecordStatus.PENDING);

    expect(result.data.stats.totalPaidInCents).toBe(80000);
    expect(result.data.stats.pendingPayoutInCents).toBe(45000);
    expect(result.data.stats.completedJobs).toBe(1);
    expect(result.data.stats.expectedEarningsInCents).toBe(45000);
  });

  it('queries invoiceDAO with approved status filter', async () => {
    mockInvoiceDAO.listByVendor.mockResolvedValue({ items: [], pagination: null } as any);

    await paymentService.getVendorEarnings(CUID, VENDOR_UID);

    expect(mockInvoiceDAO.listByVendor).toHaveBeenCalledWith(
      expect.arrayContaining([VENDOR_OID.toString()]),
      CUID,
      expect.objectContaining({ status: InvoiceStatus.APPROVED })
    );
  });

  it('throws NotFoundError when vendor does not exist', async () => {
    mockUserDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.getVendorEarnings(CUID, VENDOR_UID)).rejects.toThrow(NotFoundError);
  });

  it('returns zero stats when vendor has no invoices', async () => {
    mockInvoiceDAO.listByVendor.mockResolvedValue({ items: [], pagination: null } as any);

    const result = await paymentService.getVendorEarnings(CUID, VENDOR_UID);

    expect(result.data.stats.totalPaidInCents).toBe(0);
    expect(result.data.stats.pendingPayoutInCents).toBe(0);
    expect(result.data.stats.completedJobs).toBe(0);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleInvoicePaymentFailed — failure metadata
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService — handleInvoicePaymentFailed — failure metadata', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockStripeService: any;

  const INVOICE_ID = 'in_test123';
  const existingPayment = makePayment({
    status: PaymentRecordStatus.PENDING,
    gatewayPaymentId: INVOICE_ID,
  });

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn().mockResolvedValue(existingPayment),
      update: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockStripeService = {
      createPaymentCheckoutSession: jest.fn(),
      getPaymentIntentReceiptUrl: jest.fn().mockResolvedValue(null),
      getPaymentIntentChargeInfo: jest.fn().mockResolvedValue({ chargeId: null, receiptUrl: null }),
      getInvoicePaymentDetails: jest.fn().mockResolvedValue({ chargeId: null }),
      retrievePaymentMethod: jest.fn(),
    };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      stripeService: mockStripeService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('persists failure.reason and failure.lastFailedAt when retries exhausted', async () => {
    // When no default_payment_method is present on the invoice data,
    // the code uses the default failureReason ('Payment failed').
    // attempt_count=1, next_payment_attempt=undefined → exhausted → FAILED status.
    const invoiceData = {
      attempt_count: 1,
      next_payment_attempt: undefined,
    };

    await paymentService.handleInvoicePaymentFailed(INVOICE_ID, invoiceData);

    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      expect.objectContaining({ _id: existingPayment._id }),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: PaymentRecordStatus.FAILED,
          'failure.reason': 'Payment failed',
          'failure.lastFailedAt': expect.any(Date),
        }),
      })
    );
  });

  it('includes failure.retryCount in the $set when retries exhausted', async () => {
    const invoiceData = { attempt_count: 1 };

    await paymentService.handleInvoicePaymentFailed(INVOICE_ID, invoiceData);

    const updateCall = mockPaymentDAO.update.mock.calls[0][1];
    expect(updateCall.$set['failure.retryCount']).toBeDefined();
  });

  it('stores default failure.reason when no default_payment_method in invoice data', async () => {
    // When no default_payment_method is present on the invoice data,
    // failureReason defaults to 'Payment failed'
    const invoiceData = { attempt_count: 1 };

    await paymentService.handleInvoicePaymentFailed(INVOICE_ID, invoiceData);

    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $set: expect.objectContaining({
          'failure.reason': 'Payment failed',
        }),
      })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// payPendingCharge — retry cap
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService — payPendingCharge — retry cap', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;

  const TENANT_USER_ID = new Types.ObjectId().toString();
  const tenantProfile = { _id: new Types.ObjectId() };

  const makeFailedPayment = (retryCount?: number) =>
    makePayment({
      status: PaymentRecordStatus.FAILED,
      gatewayPaymentId: 'in_old',
      failure: retryCount !== undefined ? { retryCount } : undefined,
    });

  beforeEach(() => {
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({
        ...tenantProfile,
        tenantInfo: { paymentMandates: { get: jest.fn().mockReturnValue(null) } },
        paymentGatewayCustomers: { get: jest.fn() },
      }),
    } as unknown as jest.Mocked<ProfileDAO>;

    mockPaymentProcessorDAO = {
      findFirst: jest.fn().mockResolvedValue({ accountId: 'acct_123', chargesEnabled: true }),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;

    mockPaymentDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn().mockResolvedValue({}),
    } as unknown as jest.Mocked<PaymentDAO>;

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('throws BadRequestError when retryCount is at the cap (3)', async () => {
    const payment = makeFailedPayment(3);
    // tenant must own the payment
    (payment as any).tenant = tenantProfile._id;
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);

    await expect(paymentService.payPendingCharge(CUID, PYTUID, TENANT_USER_ID)).rejects.toThrow(
      BadRequestError
    );

    await expect(paymentService.payPendingCharge(CUID, PYTUID, TENANT_USER_ID)).rejects.toThrow(
      'Maximum retry attempts reached'
    );
  });

  it('increments failure.retryCount to 2 when current count is 1', async () => {
    const payment = makeFailedPayment(1);
    (payment as any).tenant = tenantProfile._id;
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);

    // payPendingCharge will proceed further (invoice creation etc.) — let it throw on missing gateway
    try {
      await paymentService.payPendingCharge(CUID, PYTUID, TENANT_USER_ID);
    } catch {
      // expected to fail past the retry block — we only care about the updateById call
    }

    expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ 'failure.retryCount': 2 })
    );
  });

  it('sets failure.retryCount to 1 on the first retry (no prior failure object)', async () => {
    const payment = makeFailedPayment(undefined);
    (payment as any).tenant = tenantProfile._id;
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);

    try {
      await paymentService.payPendingCharge(CUID, PYTUID, TENANT_USER_ID);
    } catch {
      // expected
    }

    expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ 'failure.retryCount': 1 })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// queueWeeklyRentInvoices / queueDailySafetyNetInvoices — currency propagation
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService — cron currency propagation', () => {
  let paymentService: PaymentService;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Build a lease whose rentDueDay falls today. Uses non-auto-debit so it hits createManualTrackingPayment.
  const makeLease = (currency: string) => ({
    _id: new Types.ObjectId(),
    cuid: CUID,
    tenantId: new Types.ObjectId(),
    fees: {
      rentDueDay: today.getDate(),
      currency,
      acceptedPaymentMethod: 'bank_transfer', // non-auto-debit → createManualTrackingPayment path
      rentAmount: 150000,
      managementFee: 0,
      lateFeeType: 'fixed',
      lateFeeAmount: 0,
      lateFeeDays: 5,
    },
    duration: { startDate: new Date('2020-01-01') },
    status: 'active',
    deletedAt: null,
  });

  const tenantProfile = { _id: new Types.ObjectId() };

  beforeEach(() => {
    mockLeaseDAO = {
      list: jest.fn(),
    } as unknown as jest.Mocked<LeaseDAO>;

    mockPaymentDAO = {
      findByPeriod: jest.fn().mockResolvedValue(null), // no existing record → proceed
      insert: jest.fn().mockResolvedValue({ pytuid: 'PYT-TEST', cuid: CUID }),
    } as unknown as jest.Mocked<PaymentDAO>;

    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue(tenantProfile),
    } as unknown as jest.Mocked<ProfileDAO>;

    mockClientDAO = {
      getClientByCuid: jest
        .fn()
        .mockResolvedValue({ settings: { tenantFeatures: { onlinePayments: true } } }),
    } as unknown as jest.Mocked<ClientDAO>;

    paymentService = makeServiceWithMocks({
      leaseDAO: mockLeaseDAO,
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
      clientDAO: mockClientDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('queueWeeklyRentInvoices — passes lease.fees.currency to paymentDAO.insert', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeLease('CAD')], total: 1 } as any);

    await (paymentService as any).paymentCronService.queueWeeklyRentInvoices();

    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'CAD' })
    );
  });

  it('queueDailySafetyNetInvoices — passes lease.fees.currency to paymentDAO.insert', async () => {
    mockLeaseDAO.list.mockResolvedValue({ items: [makeLease('GBP')], total: 1 } as any);

    await (paymentService as any).paymentCronService.queueDailySafetyNetInvoices();

    expect(mockPaymentDAO.insert).toHaveBeenCalledWith(
      expect.objectContaining({ currency: 'GBP' })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// payPendingCharge — ACSS per-transaction limit pre-flight check
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - payPendingCharge (ACSS per-transaction limit)', () => {
  const TENANT_USER_ID = new Types.ObjectId().toString();
  const PROFILE_OID = new Types.ObjectId();
  const ACCOUNT_ID = 'acct_acss_test';
  const PLATFORM_CUSTOMER = 'cus_acss_tenant';
  const INVOICE_ID = 'in_acss_001';

  const makeAcssPayment = (baseAmount: number, overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: 'PYT-ACSS-001',
    cuid: CUID,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.ONLINE,
    baseAmount,
    processingFee: 80,
    currency: 'CAD',
    tenant: PROFILE_OID,
    lineItems: [{ description: 'Monthly Rent', amountInCents: baseAmount }],
    gatewayPaymentId: null,
    equals: (id: any) => PROFILE_OID.equals(id),
    ...overrides,
  });

  // Profile with mandate present — signals ACSS debit
  const makeAcssProfile = () => ({
    _id: PROFILE_OID,
    tenantInfo: {
      paymentGatewayCustomers: new Map([['platform', PLATFORM_CUSTOMER]]),
      paymentMandates: new Map([[ACCOUNT_ID, 'mandate_acss_xyz']]),
      paymentMethods: new Map([[ACCOUNT_ID, 'pm_acss_xyz']]),
    },
  });

  // Profile without a mandate — no ACSS limit check should run
  const makeCardProfile = () => ({
    _id: PROFILE_OID,
    tenantInfo: {
      paymentGatewayCustomers: new Map([['platform', PLATFORM_CUSTOMER]]),
      paymentMandates: new Map(),
      paymentMethods: new Map([[ACCOUNT_ID, 'pm_card_xyz']]),
    },
  });

  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockSubscriptionDAO: jest.Mocked<SubscriptionDAO>;
  let mockGateway: jest.Mocked<PaymentGatewayService>;
  let originalAcssLimit: number;

  beforeEach(() => {
    // Temporarily lower the limit so tests don't need multi-million cent amounts
    const { envVariables } = jest.requireActual('@shared/config') as any;
    originalAcssLimit = envVariables.STRIPE.ACSS_PER_TXN_LIMIT_CAD;
    envVariables.STRIPE.ACSS_PER_TXN_LIMIT_CAD = 200_000; // $2,000 CAD

    mockPaymentDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockProfileDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ProfileDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockSubscriptionDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<SubscriptionDAO>;
    mockGateway = {
      createInvoice: jest
        .fn()
        .mockResolvedValue({ success: true, data: { invoiceId: INVOICE_ID } } as any),
      finalizeInvoice: jest.fn().mockResolvedValue({ success: true } as any),
      payInvoice: jest.fn().mockResolvedValue({ success: true } as any),
      retrievePaymentMethod: jest.fn(),
      voidInvoice: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      subscriptionDAO: mockSubscriptionDAO,
      paymentGatewayService: mockGateway,
    });
    (paymentService as any).subscriptionPlanConfig = {
      getTransactionFeePercent: jest.fn().mockReturnValue(4.5),
      getAchTransactionFeePercent: jest.fn().mockReturnValue(1.99),
      calculatePaymentGatewayFee: jest.fn().mockReturnValue(80),
    };

    mockPaymentProcessorDAO.findFirst.mockResolvedValue({
      accountId: ACCOUNT_ID,
      chargesEnabled: true,
    } as any);
    mockSubscriptionDAO.findFirst.mockResolvedValue({
      planName: 'essential',
      deletedAt: null,
    } as any);
  });

  afterEach(() => {
    // Restore original limit
    const { envVariables } = jest.requireActual('@shared/config') as any;
    envVariables.STRIPE.ACSS_PER_TXN_LIMIT_CAD = originalAcssLimit;
    jest.clearAllMocks();
  });

  it('proceeds with invoice creation when ACSS mandate exists and amount exceeds limit (no preemptive block)', async () => {
    // The preemptive ACSS limit check was removed. The code now proceeds to
    // create and pay the invoice. If the bank debit fails, Stripe returns an
    // error and the webhook handler retries with card. With mocks returning
    // success, the payment goes through normally.
    mockPaymentDAO.findFirst.mockResolvedValue(makeAcssPayment(300_000) as any); // $3,000 > $2,000 limit
    mockProfileDAO.findFirst.mockResolvedValue(makeAcssProfile() as any);

    const result = await paymentService.payPendingCharge(CUID, 'PYT-ACSS-001', TENANT_USER_ID);

    expect(result.success).toBe(true);
    expect(result.routeToCard).toBeUndefined();
    expect(mockGateway.createInvoice).toHaveBeenCalledTimes(1);
    expect(mockGateway.payInvoice).toHaveBeenCalledTimes(1);
  });

  it('proceeds normally when ACSS mandate exists but amount is within limit', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeAcssPayment(150_000) as any); // $1,500 < $2,000 limit
    mockProfileDAO.findFirst.mockResolvedValue(makeAcssProfile() as any);

    const result = await paymentService.payPendingCharge(CUID, 'PYT-ACSS-001', TENANT_USER_ID);

    expect(result.routeToCard).toBeUndefined();
    expect(mockGateway.createInvoice).toHaveBeenCalledTimes(1);
    expect(mockGateway.payInvoice).toHaveBeenCalledTimes(1);
  });

  it('proceeds normally when amount is exactly at the limit', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeAcssPayment(200_000) as any); // exactly $2,000
    mockProfileDAO.findFirst.mockResolvedValue(makeAcssProfile() as any);

    const result = await paymentService.payPendingCharge(CUID, 'PYT-ACSS-001', TENANT_USER_ID);

    expect(result.routeToCard).toBeUndefined();
    expect(mockGateway.payInvoice).toHaveBeenCalledTimes(1);
  });

  it('skips ACSS limit check when no mandate exists (card payment path)', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeAcssPayment(500_000) as any); // $5,000 — would exceed limit
    mockProfileDAO.findFirst.mockResolvedValue(makeCardProfile() as any);
    // Card profile has no mandate, so the bank-debit-without-mandate block will throw.
    // We just assert the limit check itself does not intercept.
    mockGateway.retrievePaymentMethod = jest.fn().mockResolvedValue({
      success: true,
      data: { type: 'card' },
    });

    // With a card type and no mandate, the flow proceeds past the limit check.
    // The payment will attempt to create an invoice normally.
    const result = await paymentService.payPendingCharge(CUID, 'PYT-ACSS-001', TENANT_USER_ID);

    expect(result.routeToCard).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// PaymentService — recordManualPayment — manual record counter
// ═══════════════════════════════════════════════════════════════════════════════

describe('PaymentService — recordManualPayment — manual record counter', () => {
  const TENANT_ID = new Types.ObjectId().toString();
  const REQUESTING_USER = new Types.ObjectId().toString();
  const PROFILE_ID = new Types.ObjectId();

  const makeManualPaymentData = () => ({
    tenantId: TENANT_ID,
    paymentType: PaymentRecordType.RENT,
    paymentMethod: PaymentMethod.CASH,
    baseAmount: 100000,
    processingFee: 0,
    paidAt: new Date(),
    period: { month: 3, year: 2026 },
    description: 'Cash rent payment',
  });

  it('increments manualRecords.countThisPeriod after recording a manual payment', async () => {
    const now = new Date();
    const currentPeriodStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const mockSubscriptionDAO = {
      findFirst: jest.fn().mockReturnValue(
        Promise.resolve({
          cuid: CUID,
          startDate: currentPeriodStart,
          manualRecords: { countThisPeriod: 5, periodStart: currentPeriodStart },
        })
      ),
      update: jest.fn().mockReturnValue(Promise.resolve(true)),
    } as any;

    const mockPaymentDAO = {
      insert: jest.fn().mockReturnValue(Promise.resolve(makePayment({ isManualEntry: true }))),
    } as any;

    const paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve({ cuid: CUID })) } as any,
      profileDAO: {
        findFirst: jest.fn().mockReturnValue(Promise.resolve({ _id: PROFILE_ID, user: TENANT_ID })),
      } as any,
      subscriptionDAO: mockSubscriptionDAO,
    });

    await paymentService.recordManualPayment(
      CUID,
      REQUESTING_USER,
      'different-sub-id',
      makeManualPaymentData() as any
    );

    // Give fire-and-forget time to execute
    await new Promise((r) => setTimeout(r, 50));

    expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
      { cuid: CUID },
      { $inc: { 'manualRecords.countThisPeriod': 1 } }
    );
  });

  it('resets counter when billing period has rolled over', async () => {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 2);

    const mockSubscriptionDAO = {
      findFirst: jest.fn().mockReturnValue(
        Promise.resolve({
          cuid: CUID,
          startDate: lastMonth,
          manualRecords: { countThisPeriod: 20, periodStart: lastMonth },
        })
      ),
      update: jest.fn().mockReturnValue(Promise.resolve(true)),
    } as any;

    const mockPaymentDAO = {
      insert: jest.fn().mockReturnValue(Promise.resolve(makePayment({ isManualEntry: true }))),
    } as any;

    const paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve({ cuid: CUID })) } as any,
      profileDAO: {
        findFirst: jest.fn().mockReturnValue(Promise.resolve({ _id: PROFILE_ID, user: TENANT_ID })),
      } as any,
      subscriptionDAO: mockSubscriptionDAO,
    });

    await paymentService.recordManualPayment(
      CUID,
      REQUESTING_USER,
      'different-sub-id',
      makeManualPaymentData() as any
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSubscriptionDAO.update).toHaveBeenCalledWith(
      { cuid: CUID },
      expect.objectContaining({
        $set: expect.objectContaining({
          'manualRecords.countThisPeriod': 1,
        }),
      })
    );
  });

  it('does not throw when subscription is missing (fire-and-forget)', async () => {
    const mockSubscriptionDAO = {
      findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
      update: jest.fn(),
    } as any;

    const mockPaymentDAO = {
      insert: jest.fn().mockReturnValue(Promise.resolve(makePayment({ isManualEntry: true }))),
    } as any;

    const paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      clientDAO: { findFirst: jest.fn().mockReturnValue(Promise.resolve({ cuid: CUID })) } as any,
      profileDAO: {
        findFirst: jest.fn().mockReturnValue(Promise.resolve({ _id: PROFILE_ID, user: TENANT_ID })),
      } as any,
      subscriptionDAO: mockSubscriptionDAO,
    });

    // Should not throw
    await paymentService.recordManualPayment(
      CUID,
      REQUESTING_USER,
      'different-sub-id',
      makeManualPaymentData() as any
    );

    await new Promise((r) => setTimeout(r, 50));

    expect(mockSubscriptionDAO.update).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createCardPaymentSession
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - createCardPaymentSession', () => {
  const TENANT_USER_ID = new Types.ObjectId().toString();
  const PROFILE_ID = new Types.ObjectId();
  const CONNECT_ACCOUNT_ID = 'acct_connect_123';
  const CHECKOUT_URL = 'https://checkout.stripe.com/pay/session_123';

  const makeDefaults = () => ({
    payment: makePayment({
      tenant: PROFILE_ID,
      period: { month: 5, year: 2026 },
      currency: 'usd',
      applicationFee: 500,
    }),
    processor: {
      accountId: CONNECT_ACCOUNT_ID,
      chargesEnabled: true,
      ownerType: 'client',
    },
    profile: { _id: PROFILE_ID, user: new Types.ObjectId(TENANT_USER_ID) },
    tenantUser: { _id: new Types.ObjectId(TENANT_USER_ID), email: 'tenant@example.com' },
    stripeSession: { id: 'cs_123', url: CHECKOUT_URL },
  });

  it('returns checkoutUrl on success', async () => {
    const d = makeDefaults();
    const mockStripe = {
      createPaymentCheckoutSession: jest.fn().mockResolvedValue(d.stripeSession),
    };
    const svc = makeServiceWithMocks({
      paymentDAO: { findFirst: jest.fn().mockResolvedValue(d.payment) } as any,
      paymentProcessorDAO: { findFirst: jest.fn().mockResolvedValue(d.processor) } as any,
      profileDAO: { findFirst: jest.fn().mockResolvedValue(d.profile) } as any,
      userDAO: { findFirst: jest.fn().mockResolvedValue(d.tenantUser) } as any,
      stripeService: mockStripe,
    });

    const result = await svc.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID);

    expect(result.success).toBe(true);
    expect(result.data.checkoutUrl).toBe(CHECKOUT_URL);
    expect(mockStripe.createPaymentCheckoutSession).toHaveBeenCalledWith(
      expect.objectContaining({
        customerEmail: 'tenant@example.com',
        destinationAccountId: CONNECT_ACCOUNT_ID,
        metadata: expect.objectContaining({ pytuid: PYTUID, cuid: CUID }),
      })
    );
  });

  it('throws NotFoundError when payment does not exist', async () => {
    const svc = makeServiceWithMocks({
      paymentDAO: { findFirst: jest.fn().mockResolvedValue(null) } as any,
    });

    await expect(svc.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID)).rejects.toThrow(
      NotFoundError
    );
  });

  it('throws BadRequestError when payment is already PAID', async () => {
    const d = makeDefaults();
    const svc = makeServiceWithMocks({
      paymentDAO: {
        findFirst: jest.fn().mockResolvedValue({ ...d.payment, status: PaymentRecordStatus.PAID }),
      } as any,
    });

    await expect(svc.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID)).rejects.toThrow(
      BadRequestError
    );
  });

  it('throws BadRequestError when payment is CANCELLED', async () => {
    const d = makeDefaults();
    const svc = makeServiceWithMocks({
      paymentDAO: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...d.payment, status: PaymentRecordStatus.CANCELLED }),
      } as any,
    });

    await expect(svc.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID)).rejects.toThrow(
      BadRequestError
    );
  });

  it('throws BadRequestError when tenant does not own the payment', async () => {
    const d = makeDefaults();
    const differentTenantId = new Types.ObjectId().toString();
    const differentProfile = {
      _id: new Types.ObjectId(),
      user: new Types.ObjectId(differentTenantId),
    };
    const svc = makeServiceWithMocks({
      paymentDAO: { findFirst: jest.fn().mockResolvedValue(d.payment) } as any,
      profileDAO: { findFirst: jest.fn().mockResolvedValue(differentProfile) } as any,
    });

    await expect(svc.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID)).rejects.toThrow(
      BadRequestError
    );
  });

  it('throws BadRequestError when PM Connect account has charges disabled', async () => {
    const d = makeDefaults();
    const svc = makeServiceWithMocks({
      paymentDAO: { findFirst: jest.fn().mockResolvedValue(d.payment) } as any,
      profileDAO: { findFirst: jest.fn().mockResolvedValue(d.profile) } as any,
      paymentProcessorDAO: {
        findFirst: jest.fn().mockResolvedValue({ ...d.processor, chargesEnabled: false }),
      } as any,
    });

    await expect(svc.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID)).rejects.toThrow(
      BadRequestError
    );
  });

  it('works for OVERDUE payment', async () => {
    const d = makeDefaults();
    const mockStripe = {
      createPaymentCheckoutSession: jest.fn().mockResolvedValue(d.stripeSession),
    };
    const svc = makeServiceWithMocks({
      paymentDAO: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ ...d.payment, status: PaymentRecordStatus.OVERDUE }),
      } as any,
      paymentProcessorDAO: { findFirst: jest.fn().mockResolvedValue(d.processor) } as any,
      profileDAO: { findFirst: jest.fn().mockResolvedValue(d.profile) } as any,
      userDAO: { findFirst: jest.fn().mockResolvedValue(d.tenantUser) } as any,
      stripeService: mockStripe,
    });

    const result = await svc.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID);
    expect(result.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// handleCardPaymentSessionCompleted
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - handleCardPaymentSessionCompleted', () => {
  const PROFILE_ID = new Types.ObjectId();
  const SESSION_ID = 'cs_completed_123';
  const PAYMENT_INTENT_ID = 'pi_abc123';

  const makeSession = (overrides: Record<string, any> = {}) => ({
    id: SESSION_ID,
    payment_intent: PAYMENT_INTENT_ID,
    metadata: { pytuid: PYTUID, cuid: CUID },
    payment_status: 'paid',
    ...overrides,
  });

  it('marks a PENDING payment as PAID and includes tenantId and paymentType', async () => {
    const payment = makePayment({ tenant: PROFILE_ID, paymentType: 'rent' });
    const mockPaymentDAO = {
      findFirst: jest.fn().mockResolvedValue(payment),
      update: jest.fn().mockResolvedValue({}),
    } as any;
    const mockEmitter = { emit: jest.fn(), on: jest.fn() };

    const svc = makeServiceWithMocks({ paymentDAO: mockPaymentDAO, emitterService: mockEmitter });
    await svc.handleCardPaymentSessionCompleted(
      makeSession({ metadata: { pytuid: PYTUID, cuid: CUID, uid: 'user123' } })
    );

    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id, cuid: payment.cuid },
      {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PAID,
          paidAt: expect.any(Date),
          gatewayPaymentId: PAYMENT_INTENT_ID,
        }),
      }
    );
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.PAYMENT_SUCCEEDED,
      expect.objectContaining({
        pytuid: PYTUID,
        tenantId: 'user123',
        paymentType: 'rent',
      })
    );
  });

  it('is idempotent — skips if payment already PAID', async () => {
    const payment = makePayment({ tenant: PROFILE_ID, status: PaymentRecordStatus.PAID });
    const mockPaymentDAO = {
      findFirst: jest.fn().mockResolvedValue(payment),
      update: jest.fn(),
    } as any;

    const svc = makeServiceWithMocks({ paymentDAO: mockPaymentDAO });
    await svc.handleCardPaymentSessionCompleted(makeSession());

    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
  });

  it('skips gracefully when pytuid is missing from metadata', async () => {
    const mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as any;

    const svc = makeServiceWithMocks({ paymentDAO: mockPaymentDAO });
    await svc.handleCardPaymentSessionCompleted(makeSession({ metadata: {} }));

    expect(mockPaymentDAO.findFirst).not.toHaveBeenCalled();
    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
  });

  it('skips gracefully when payment record not found', async () => {
    const mockPaymentDAO = {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
    } as any;

    const svc = makeServiceWithMocks({ paymentDAO: mockPaymentDAO });
    await svc.handleCardPaymentSessionCompleted(makeSession());

    expect(mockPaymentDAO.update).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// calculateRentFees — ACH vs card fee selection
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService — calculateRentFees fee model', () => {
  let paymentService: PaymentService;

  beforeEach(() => {
    paymentService = makeServiceWithMocks();
    // Use the real subscriptionPlanConfig so platform.config.json rates apply
    (paymentService as any).rentPaymentService.subscriptionPlanConfig = subscriptionPlanConfig;
  });

  afterEach(() => jest.clearAllMocks());

  it('uses ACH gateway fee ($0.80 flat) when paymentMethodType is auto-debit', () => {
    // 1.99% on $1,500 = $29.85 applicationFee; gateway cost = $0.80; platformRevenue = $29.05
    const result = (paymentService as any).rentPaymentService.calculateRentFees(
      150000,
      1.99,
      'stripe',
      'auto-debit'
    );

    expect(result.baseAmount).toBe(150000);
    expect(result.applicationFee).toBe(2985); // 1.99% of $1,500 in cents
    expect(result.gatewayProcessingFee).toBe(80); // ACSS flat $0.80
    expect(result.platformNetRevenue).toBe(2985 - 80); // $29.05
  });

  it('uses card gateway fee (2.9% + $0.30) when paymentMethodType is card', () => {
    // 4.5% on $1,500 = $67.50; gateway = 2.9% × $1,500 + $0.30 = $43.80; platform nets $23.70
    const result = (paymentService as any).rentPaymentService.calculateRentFees(
      150000,
      4.5,
      'stripe',
      'card'
    );

    expect(result.baseAmount).toBe(150000);
    expect(result.applicationFee).toBe(6750); // 4.5% of $1,500
    expect(result.gatewayProcessingFee).toBe(4380); // 2.9% × 150000 + 30 = 4380
    expect(result.platformNetRevenue).toBe(6750 - 4380); // $23.70
  });

  it('defaults to card gateway fee when no paymentMethodType provided', () => {
    const result = (paymentService as any).rentPaymentService.calculateRentFees(150000, 4.5);

    expect(result.gatewayProcessingFee).toBe(4380);
  });

  it('ACH nets more platform revenue per transaction than card despite lower application fee', () => {
    const ach = (paymentService as any).rentPaymentService.calculateRentFees(
      150000,
      1.99,
      'stripe',
      'auto-debit'
    );
    const card = (paymentService as any).rentPaymentService.calculateRentFees(
      150000,
      4.5,
      'stripe',
      'card'
    );

    expect(ach.platformNetRevenue).toBeGreaterThan(card.platformNetRevenue);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// createCardCheckoutSession — tenant charged baseAmount only
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService — createCardCheckoutSession charges baseAmount only', () => {
  const TENANT_USER_ID = new Types.ObjectId().toString();
  const PROFILE_OID = new Types.ObjectId();
  const CHECKOUT_URL = 'https://checkout.stripe.com/pay/cs_test_abc';

  const makePaymentRecord = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: PYTUID,
    cuid: CUID,
    paymentType: PaymentRecordType.RENT,
    status: PaymentRecordStatus.PENDING,
    tenant: { equals: (id: any) => PROFILE_OID.equals(id) },
    baseAmount: 150000, // $1,500.00 in cents
    processingFee: 4380, // $43.80 — must NOT be added to checkout amount
    currency: 'usd',
    period: { month: 6, year: 2026 },
    dueDate: new Date('2026-06-01'),
    ...overrides,
  });

  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockStripeService: { createPaymentCheckoutSession: jest.Mock };
  let paymentService: PaymentService;

  beforeEach(() => {
    mockPaymentDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockProfileDAO = {
      findFirst: jest.fn().mockResolvedValue({ _id: PROFILE_OID }),
    } as unknown as jest.Mocked<ProfileDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn().mockResolvedValue({ accountId: 'acct_test_123', chargesEnabled: true }),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockUserDAO = {
      findFirst: jest.fn().mockResolvedValue({ email: 'tenant@test.com' }),
    } as unknown as jest.Mocked<UserDAO>;
    mockStripeService = {
      createPaymentCheckoutSession: jest.fn().mockResolvedValue({
        url: CHECKOUT_URL,
        id: 'cs_test_abc',
      }),
    };

    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      profileDAO: mockProfileDAO,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      userDAO: mockUserDAO,
      stripeService: mockStripeService as any,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('passes baseAmount (not baseAmount + processingFee) to Stripe checkout line item', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaymentRecord() as any);

    await paymentService.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID);

    const callArgs = mockStripeService.createPaymentCheckoutSession.mock.calls[0][0];
    expect(callArgs.lineItems[0].amountInCents).toBe(150000); // baseAmount only — processingFee not added
  });

  it('returns checkoutUrl on success', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaymentRecord() as any);

    const result = await paymentService.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID);

    expect(result.success).toBe(true);
    expect(result.data?.checkoutUrl).toBe(CHECKOUT_URL);
  });

  it('does NOT inflate amount even when processingFee is large', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(
      makePaymentRecord({ baseAmount: 300000, processingFee: 8730 }) as any
    );

    await paymentService.createCardPaymentSession(CUID, PYTUID, TENANT_USER_ID);

    const callArgs = mockStripeService.createPaymentCheckoutSession.mock.calls[0][0];
    expect(callArgs.lineItems[0].amountInCents).toBe(300000); // baseAmount only, not 308730
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PaymentWebhookService - handleInvoicePaymentSucceeded (MAINTENANCE stamping)
// When a MAINTENANCE payment is paid, the linked Invoice must be stamped with
// tenantPaymentStatus: 'paid' and the Stripe charge ID.
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentWebhookService - handleInvoicePaymentSucceeded - MAINTENANCE invoice stamp', () => {
  const INVOICE_ID = 'in_maint_stamp_001';
  const CHARGE_ID = 'ch_maint_stamp_001';
  const MRUID = 'MR-STAMP-001';

  const makeMaintenancePayment = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    pytuid: 'PYT-STAMP-001',
    cuid: CUID,
    status: PaymentRecordStatus.PENDING,
    paymentType: PaymentRecordType.MAINTENANCE,
    baseAmount: 30000,
    gatewayPaymentId: INVOICE_ID,
    maintenanceRequestUid: MRUID,
    paymentMethod: PaymentMethod.OTHER,
    ...overrides,
  });

  let webhookService: PaymentWebhookService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockInvoiceDAO: jest.Mocked<InvoiceDAO>;
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockInvoiceDAO = {
      update: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<InvoiceDAO>;
    mockEmitter = { emit: jest.fn(), on: jest.fn() };

    webhookService = new PaymentWebhookService({
      paymentGatewayService: {} as any,
      paymentProcessorDAO: {} as any,
      subscriptionDAO: {} as any,
      emitterService: mockEmitter as unknown as EventEmitterService,
      stripeService: {
        getInvoicePaymentDetails: jest.fn().mockResolvedValue({ chargeId: CHARGE_ID }),
      } as any,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
      profileDAO: {} as any,
      paymentDAO: mockPaymentDAO,
      invoiceDAO: mockInvoiceDAO,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('stamps Invoice tenantPaymentStatus=paid and stripeChargeId when a MAINTENANCE payment succeeds', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeMaintenancePayment() as any);

    await webhookService.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(mockInvoiceDAO.update).toHaveBeenCalledWith(
      { mruid: MRUID, cuid: CUID, isDeleted: false },
      {
        $set: expect.objectContaining({
          tenantPaymentStatus: TenantPaymentStatus.PAID,
          stripeChargeId: CHARGE_ID,
        }),
      }
    );
  });

  it('stamps Invoice tenantPaymentStatus=paid without stripeChargeId when charge is absent', async () => {
    // Override the stripeService mock to return no chargeId for this test
    webhookService = new PaymentWebhookService({
      paymentGatewayService: {} as any,
      paymentProcessorDAO: {} as any,
      subscriptionDAO: {} as any,
      emitterService: mockEmitter as unknown as EventEmitterService,
      stripeService: {
        getInvoicePaymentDetails: jest.fn().mockResolvedValue({ chargeId: null }),
      } as any,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
      profileDAO: {} as any,
      paymentDAO: mockPaymentDAO,
      invoiceDAO: mockInvoiceDAO,
    });
    mockPaymentDAO.findFirst.mockResolvedValue(makeMaintenancePayment() as any);

    await webhookService.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(mockInvoiceDAO.update).toHaveBeenCalledWith(
      { mruid: MRUID, cuid: CUID, isDeleted: false },
      { $set: { tenantPaymentStatus: TenantPaymentStatus.PAID } }
    );
  });

  it('does NOT stamp Invoice for non-MAINTENANCE payment types', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(
      makeMaintenancePayment({
        paymentType: PaymentRecordType.RENT,
        maintenanceRequestUid: undefined,
      }) as any
    );

    await webhookService.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(mockInvoiceDAO.update).not.toHaveBeenCalled();
  });

  it('emits MAINTENANCE_CHARGE_PAID after stamping the invoice', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makeMaintenancePayment() as any);

    await webhookService.handleInvoicePaymentSucceeded(INVOICE_ID, {});

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_CHARGE_PAID,
      expect.objectContaining({ mruid: MRUID, cuid: CUID, chargeId: CHARGE_ID })
    );
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PaymentCronService - checkFundsAvailability
// Twice-daily cron: checks Stripe Connect balance per PM account and flips
// fundsAvailable on invoices where tenant has already paid.
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentCronService - checkFundsAvailability', () => {
  const PM_ACCOUNT_ID = 'acct_pm_funds_test';
  const INVUID = 'INV-FUNDS-001';
  const MRUID = 'MR-FUNDS-001';

  const makeSettledInvoice = (overrides: Record<string, any> = {}) => ({
    _id: new Types.ObjectId(),
    invuid: INVUID,
    mruid: MRUID,
    cuid: CUID,
    amountInCents: 50000,
    currency: 'CAD',
    vendorPayoutStatus: 'pending',
    tenantPaymentStatus: 'paid',
    fundsAvailable: false,
    isDeleted: false,
    ...overrides,
  });

  let cronService: PaymentCronService;
  let mockInvoiceDAO: jest.Mocked<InvoiceDAO>;
  let mockPaymentProcessorDAO: jest.Mocked<PaymentProcessorDAO>;
  let mockStripe: { getConnectBalance: jest.Mock };
  let mockEmitter: { emit: jest.Mock; on: jest.Mock };
  let mockClientDAO: jest.Mocked<ClientDAO>;

  beforeEach(() => {
    mockInvoiceDAO = {
      findPendingFundsCheck: jest.fn(),
      updateById: jest.fn().mockResolvedValue({} as any),
    } as unknown as jest.Mocked<InvoiceDAO>;
    mockPaymentProcessorDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockStripe = { getConnectBalance: jest.fn() };
    mockEmitter = { emit: jest.fn(), on: jest.fn() };
    mockClientDAO = {
      getDistinctTimezones: jest.fn().mockResolvedValue(['UTC']),
      getClientByCuid: jest.fn(),
    } as unknown as jest.Mocked<ClientDAO>;

    cronService = new PaymentCronService({
      paymentGatewayService: {} as any,
      paymentProcessorDAO: mockPaymentProcessorDAO,
      subscriptionPlanConfig: {} as any,
      emitterService: mockEmitter as unknown as EventEmitterService,
      subscriptionDAO: {} as any,
      stripeService: mockStripe as unknown as StripeService,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      invoiceDAO: mockInvoiceDAO,
      queueFactory: { getQueue: jest.fn() } as any,
      profileDAO: {} as any,
      paymentDAO: {} as any,
      clientDAO: mockClientDAO,
      leaseDAO: {} as any,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('returns early without Stripe call when no invoices need a funds check', async () => {
    mockInvoiceDAO.findPendingFundsCheck.mockResolvedValue([]);

    await (cronService as any).checkFundsAvailability();

    expect(mockStripe.getConnectBalance).not.toHaveBeenCalled();
    expect(mockInvoiceDAO.updateById).not.toHaveBeenCalled();
    expect(mockEmitter.emit).not.toHaveBeenCalled();
  });

  it('flips fundsAvailable and emits MAINTENANCE_FUNDS_AVAILABLE when Stripe balance is sufficient', async () => {
    mockInvoiceDAO.findPendingFundsCheck.mockResolvedValue([makeSettledInvoice()] as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: PM_ACCOUNT_ID } as any);
    mockStripe.getConnectBalance.mockResolvedValue({
      available: [{ currency: 'cad', amount: 200000 }],
      pending: [],
    });

    await (cronService as any).checkFundsAvailability();

    expect(mockInvoiceDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: expect.objectContaining({ fundsAvailable: true, fundsAvailableAt: expect.any(Date) }),
      })
    );
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_FUNDS_AVAILABLE,
      expect.objectContaining({ mruid: MRUID, cuid: CUID, invuid: INVUID, amountInCents: 50000 })
    );
  });

  it('skips invoice without updating when Stripe balance is insufficient', async () => {
    mockInvoiceDAO.findPendingFundsCheck.mockResolvedValue([makeSettledInvoice()] as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: PM_ACCOUNT_ID } as any);
    mockStripe.getConnectBalance.mockResolvedValue({
      available: [{ currency: 'cad', amount: 10000 }], // less than 50000
      pending: [],
    });

    await (cronService as any).checkFundsAvailability();

    expect(mockInvoiceDAO.updateById).not.toHaveBeenCalled();
    expect(mockEmitter.emit).not.toHaveBeenCalled();
  });

  it('skips entire cuid batch when no payment processor account found', async () => {
    mockInvoiceDAO.findPendingFundsCheck.mockResolvedValue([makeSettledInvoice()] as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);

    await (cronService as any).checkFundsAvailability();

    expect(mockStripe.getConnectBalance).not.toHaveBeenCalled();
    expect(mockInvoiceDAO.updateById).not.toHaveBeenCalled();
  });

  it('makes one Stripe balance call per unique PM account across multiple invoices', async () => {
    const cuid2 = 'CUID_2';
    const invoices = [
      makeSettledInvoice({ invuid: 'INV-001', cuid: CUID }),
      makeSettledInvoice({ invuid: 'INV-002', cuid: CUID }),
      makeSettledInvoice({ invuid: 'INV-003', cuid: cuid2 }),
    ];
    mockInvoiceDAO.findPendingFundsCheck.mockResolvedValue(invoices as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ accountId: PM_ACCOUNT_ID } as any);
    mockStripe.getConnectBalance.mockResolvedValue({
      available: [{ currency: 'cad', amount: 999999 }],
      pending: [],
    });

    await (cronService as any).checkFundsAvailability();

    // 2 cuids → 2 Stripe balance calls (not 3 per invoice)
    expect(mockStripe.getConnectBalance).toHaveBeenCalledTimes(2);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// PaymentCronService - getCronJobs (async timezone-aware registration)
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentCronService - getCronJobs', () => {
  let cronService: PaymentCronService;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  beforeEach(() => {
    mockClientDAO = {
      getDistinctTimezones: jest.fn(),
      getClientByCuid: jest.fn(),
    } as unknown as jest.Mocked<ClientDAO>;

    cronService = new PaymentCronService({
      paymentGatewayService: {} as any,
      paymentProcessorDAO: {} as any,
      subscriptionPlanConfig: {} as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
      subscriptionDAO: {} as any,
      stripeService: {} as any,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      invoiceDAO: {} as any,
      queueFactory: { getQueue: jest.fn() } as any,
      profileDAO: {} as any,
      paymentDAO: {} as any,
      clientDAO: mockClientDAO,
      leaseDAO: {} as any,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('returns fixed UTC jobs plus per-timezone variants', async () => {
    mockClientDAO.getDistinctTimezones.mockResolvedValue(['America/Vancouver', 'Africa/Lagos']);

    const jobs = await cronService.getCronJobs();

    const names = jobs.map((j) => j.name);

    // Fixed UTC jobs
    expect(names).toContain('payment.weekly-rent-invoices');
    expect(names).toContain('payment.daily-rent-safety-net');
    expect(names).toContain('payment.check-funds-availability-morning');
    expect(names).toContain('payment.check-funds-availability-evening');

    // Per-timezone variants for each timezone
    for (const tz of ['America/Vancouver', 'Africa/Lagos']) {
      expect(names).toContain(`payment.auto-charge-overdue-maintenance.${tz}`);
      expect(names).toContain(`payment.auto-charge-due-rent.${tz}`);
      expect(names).toContain(`payment.mark-overdue.${tz}`);
    }
  });

  it('falls back to UTC when getDistinctTimezones returns empty', async () => {
    mockClientDAO.getDistinctTimezones.mockResolvedValue([]);

    const jobs = await cronService.getCronJobs();

    const names = jobs.map((j) => j.name);
    expect(names).toContain('payment.auto-charge-due-rent.UTC');
    expect(names).toContain('payment.mark-overdue.UTC');
  });

  it('timezone-aware jobs carry the correct timezone field', async () => {
    mockClientDAO.getDistinctTimezones.mockResolvedValue(['America/Vancouver']);

    const jobs = await cronService.getCronJobs();

    const tzJob = jobs.find((j) => j.name === 'payment.auto-charge-due-rent.America/Vancouver');
    expect(tzJob).toBeDefined();
    expect(tzJob!.timezone).toBe('America/Vancouver');
  });

  it('funds availability jobs have no timezone field (fixed UTC)', async () => {
    mockClientDAO.getDistinctTimezones.mockResolvedValue(['UTC']);

    const jobs = await cronService.getCronJobs();

    const morningJob = jobs.find((j) => j.name === 'payment.check-funds-availability-morning');
    expect(morningJob).toBeDefined();
    expect(morningJob!.timezone).toBeUndefined();
  });
});
