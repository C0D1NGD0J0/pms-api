import { Types } from 'mongoose';

// Break the circular import chain: payments.service → @shared/middlewares → @di/index → registerResources → payments.service (undefined)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { SubscriptionPlanConfig } from '@services/subscription';
import { PaymentService } from '@services/payments/payments.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
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
    emitterService: { emit: jest.Mock; on: jest.Mock };
  }> = {}
) =>
  new PaymentService({
    paymentDAO: (overrides.paymentDAO ?? {}) as jest.Mocked<PaymentDAO>,
    clientDAO: (overrides.clientDAO ?? {}) as jest.Mocked<ClientDAO>,
    profileDAO: (overrides.profileDAO ?? {}) as jest.Mocked<ProfileDAO>,
    leaseDAO: (overrides.leaseDAO ?? {}) as jest.Mocked<LeaseDAO>,
    paymentProcessorDAO: (overrides.paymentProcessorDAO ?? {}) as jest.Mocked<PaymentProcessorDAO>,
    paymentGatewayService: (overrides.paymentGatewayService ?? {}) as jest.Mocked<PaymentGatewayService>,
    emitterService: (overrides.emitterService ?? { emit: jest.fn(), on: jest.fn() }) as any,
    subscriptionDAO: {} as jest.Mocked<SubscriptionDAO>,
    userDAO: {} as jest.Mocked<UserDAO>,
    subscriptionPlanConfig: {} as jest.Mocked<SubscriptionPlanConfig>,
    queueFactory: { getQueue: jest.fn() } as any,
  });

// ═════════════════════════════════════════════════════════════════════════════
// cancelPayment
// ═════════════════════════════════════════════════════════════════════════════

describe('PaymentService - cancelPayment', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  beforeEach(() => {
    mockPaymentDAO = { findFirst: jest.fn(), updateById: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockClientDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<ClientDAO>;
    paymentService = makeServiceWithMocks({ paymentDAO: mockPaymentDAO, clientDAO: mockClientDAO });
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
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.CANCELLED } as any);

    const result = await paymentService.cancelPayment(CUID, PYTUID);
    expect(result.success).toBe(true);
  });

  it('should include a cancellation note when reason is provided', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.CANCELLED } as any);

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
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.CANCELLED } as any);

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

    mockPaymentDAO.findFirst.mockResolvedValue(makePayment({ status: PaymentRecordStatus.PAID }) as any);
    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(BadRequestError);

    mockPaymentDAO.findFirst.mockResolvedValue(makePayment({ status: PaymentRecordStatus.CANCELLED }) as any);
    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(BadRequestError);
  });

  it('should call updateById with the correct payment _id', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.CANCELLED } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(
      payment._id.toString(),
      expect.objectContaining({ status: PaymentRecordStatus.CANCELLED })
    );
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

    paymentService = makeServiceWithMocks({ clientDAO: mockClientDAO, paymentDAO: mockPaymentDAO, profileDAO: mockProfileDAO });
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

  const makeStat = (status: PaymentRecordStatus, baseAmount: number, overrides: Record<string, any> = {}) => ({
    pytuid: `PYT-${Math.random()}`,
    cuid: CUID,
    status,
    paymentType: PaymentRecordType.RENT,
    baseAmount,
    processingFee: 0,
    ...overrides,
  });

  beforeEach(() => {
    mockClientDAO = { findFirst: jest.fn().mockResolvedValue({ cuid: CUID }) } as unknown as jest.Mocked<ClientDAO>;
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

  const makeProfile = (overrides: Record<string, any> = {}) => ({ _id: new Types.ObjectId(), user: TENANT_ID, ...overrides });
  const makeLease = (overrides: Record<string, any> = {}) => ({ _id: new Types.ObjectId(), luid: LEASE_ID, cuid: CUID, ...overrides });
  const makeClient = (overrides: Record<string, any> = {}) => ({ _id: new Types.ObjectId(), cuid: CUID, deletedAt: null, ...overrides });

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
    mockLeaseDAO = { findById: jest.fn() } as unknown as jest.Mocked<LeaseDAO>;
    paymentService = makeServiceWithMocks({ paymentDAO: mockPaymentDAO, clientDAO: mockClientDAO, profileDAO: mockProfileDAO, leaseDAO: mockLeaseDAO });
  });

  afterEach(() => jest.clearAllMocks());

  it('should create a manual payment with status PAID, processingFee 0, and isManualEntry true', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
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
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
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

    const result = await paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData({ leaseId: undefined }));

    expect(result.success).toBe(true);
    expect(mockLeaseDAO.findById).not.toHaveBeenCalled();
  });

  it('should include receipt data when provided', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData({
      receipt: { url: 'https://s3.aws.com/receipts/receipt.pdf', filename: 'receipt.pdf', key: 'receipts/abc123.pdf' },
    }));

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.receipt?.url).toBe('https://s3.aws.com/receipts/receipt.pdf');
  });

  it('should throw NotFoundError when client, profile, or lease is not found', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())).rejects.toThrow(NotFoundError);

    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())).rejects.toThrow(NotFoundError);

    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(null);
    await expect(paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError when lease belongs to a different client', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease({ cuid: 'DIFFERENT_CUID' }) as any);

    await expect(paymentService.recordManualPayment(CUID, USER_ID, USER_ID, makeData())).rejects.toThrow(NotFoundError);
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

  const makeProcessor = (overrides: Record<string, any> = {}) => ({ cuid: CUID, accountId: 'acct_test_123', ...overrides });

  beforeEach(() => {
    mockPaymentDAO = { findFirst: jest.fn(), updateById: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockPaymentProcessorDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = { createRefund: jest.fn() } as unknown as jest.Mocked<PaymentGatewayService>;
    mockProfileDAO = { findFirst: jest.fn().mockResolvedValue(null) } as unknown as jest.Mocked<ProfileDAO>;
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
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: { refundId: 're_test_123', status: 'succeeded', amount: 150000, currency: 'usd' } } as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.REFUNDED, refund: { refundedAt: new Date(), amount: 150000 } } as any);

    const result = await paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {});

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(PaymentRecordStatus.REFUNDED);
  });

  it('should route refund through paymentGatewayService with correct params', async () => {
    const payment = makePaidPayment();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: {} } as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.REFUNDED } as any);

    await paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, { amount: 50000, reason: 'Partial refund' });

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
    expect(mockPaymentDAO.updateById.mock.calls[0][1]).toMatchObject({ status: PaymentRecordStatus.REFUNDED, 'refund.amount': 200000 });
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
    await expect(paymentService.refundPayment('', PYTUID, ADMIN_ID, {})).rejects.toThrow(BadRequestError);
    await expect(paymentService.refundPayment(CUID, '', ADMIN_ID, {})).rejects.toThrow(BadRequestError);
  });

  it('should throw NotFoundError when payment does not exist', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(NotFoundError);
  });

  it('should throw BadRequestError when payment is not PAID (PENDING or CANCELLED)', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ status: PaymentRecordStatus.PENDING }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(BadRequestError);

    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ status: PaymentRecordStatus.CANCELLED }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when payment has no gatewayChargeId (manual entry)', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ gatewayChargeId: null }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when partial refund amount exceeds baseAmount', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ baseAmount: 100000 }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, { amount: 200000 })).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when payment processor is not configured or has no accountId', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(BadRequestError);

    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor({ accountId: null }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, ADMIN_ID, {})).rejects.toThrow(BadRequestError);
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

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      update: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
    mockPaymentGatewayService = {
      getCharge: jest.fn(),
      createTransferReversal: jest.fn(),
    } as unknown as jest.Mocked<PaymentGatewayService>;
    mockEmitterService = { emit: jest.fn(), on: jest.fn() };
    paymentService = makeServiceWithMocks({
      paymentDAO: mockPaymentDAO,
      paymentGatewayService: mockPaymentGatewayService,
      emitterService: mockEmitterService,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should reverse transfer, update payment record, and emit event', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentGatewayService.getCharge.mockResolvedValue({ success: true, data: { transfer: TRANSFER_ID } } as any);
    mockPaymentGatewayService.createTransferReversal.mockResolvedValue({ success: true, data: { reversalId: 'trr_test', amount: 150000 } } as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    const result = await paymentService.handleDisputeCreated(DISPUTE_ID, makeDisputeData());

    expect(result.success).toBe(true);
    expect(mockPaymentGatewayService.createTransferReversal).toHaveBeenCalledWith(
      'stripe',
      TRANSFER_ID,
      150000
    );
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id },
      {
        $set: expect.objectContaining({
          'dispute.disputeId': DISPUTE_ID,
          'dispute.amount': 150000,
          'dispute.reason': 'fraudulent',
          'dispute.disputedAt': expect.any(Date),
        }),
      }
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
    expect(result.message).toBe('Payment record not found');
    expect(mockPaymentGatewayService.getCharge).not.toHaveBeenCalled();
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });

  it('should skip transfer reversal when charge has no transfer, still update and emit event', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentGatewayService.getCharge.mockResolvedValue({ success: true, data: { transfer: null } } as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    const result = await paymentService.handleDisputeCreated(DISPUTE_ID, makeDisputeData());

    expect(result.success).toBe(true);
    expect(mockPaymentGatewayService.createTransferReversal).not.toHaveBeenCalled();
    expect(mockPaymentDAO.update).toHaveBeenCalled();
    expect(mockEmitterService.emit).toHaveBeenCalledWith('payment:dispute:created', expect.any(Object));
  });

  it('should correctly extract chargeId when disputeData.charge is an object', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentGatewayService.getCharge.mockResolvedValue({ success: true, data: { transfer: TRANSFER_ID } } as any);
    mockPaymentGatewayService.createTransferReversal.mockResolvedValue({ success: true, data: {} } as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    await paymentService.handleDisputeCreated(DISPUTE_ID, makeDisputeData({ charge: { id: CHARGE_ID } }));

    expect(mockPaymentDAO.findFirst).toHaveBeenCalledWith({ gatewayChargeId: CHARGE_ID, deletedAt: null });
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
    mockPaymentDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentDAO>;
    mockPaymentProcessorDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentProcessorDAO>;
    mockPaymentGatewayService = { createTransfer: jest.fn() } as unknown as jest.Mocked<PaymentGatewayService>;
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
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createTransfer.mockResolvedValue({ success: true, data: { transferId: 'tr_new_123', amount: 150000 } } as any);

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
    expect(result.message).toBe('Payment record not found');
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
    mockPaymentProcessorDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentProcessorDAO>;
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
    mockPaymentProcessorDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentProcessorDAO>;
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
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ cuid: CUID, accountId: 'acct_pm_123' } as any);
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
    mockPaymentProcessorDAO = { findFirst: jest.fn() } as unknown as jest.Mocked<PaymentProcessorDAO>;
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
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ cuid: CUID, accountId: 'acct_pm_123' } as any);
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
    await expect(paymentService.getExternalDashboardLoginLink(CUID)).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when gateway returns failure', async () => {
    mockPaymentProcessorDAO.findFirst.mockResolvedValue({ cuid: CUID, accountId: 'acct_pm_123' } as any);
    mockPaymentGatewayService.createDashboardLoginLink.mockResolvedValue({
      success: false,
      message: 'Link creation failed',
      data: null,
    } as any);

    await expect(paymentService.getExternalDashboardLoginLink(CUID)).rejects.toThrow(BadRequestError);
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
  const CHARGE_ID = 'ch_test_abc';

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

  it('should mark payment as PAID and emit PAYMENT_SUCCEEDED event', async () => {
    const payment = makePaymentRecord();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.update.mockResolvedValue(payment as any);

    const result = await paymentService.handleInvoicePaymentSucceeded(INVOICE_ID, {
      charge: CHARGE_ID,
    });

    expect(result.success).toBe(true);
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id },
      {
        $set: expect.objectContaining({
          status: PaymentRecordStatus.PAID,
          gatewayChargeId: CHARGE_ID,
          paidAt: expect.any(Date),
        }),
      }
    );
    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      'payment:succeeded',
      expect.objectContaining({ cuid: CUID, pytuid: PYTUID, invoiceId: INVOICE_ID })
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

    const result = await paymentService.handleInvoicePaymentSucceeded(INVOICE_ID, {
      charge: CHARGE_ID,
    });

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
      { _id: payment._id },
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
      next_payment_attempt: null,
    });

    expect(result.success).toBe(true);
    expect(mockPaymentDAO.update).toHaveBeenCalledWith(
      { _id: payment._id },
      { $set: { status: PaymentRecordStatus.FAILED } }
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
      { _id: payment._id },
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
      { _id: payment._id },
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
