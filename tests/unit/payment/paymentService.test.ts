import { Types } from 'mongoose';
import { SubscriptionPlanConfig } from '@services/subscription';
import { PaymentService } from '@services/payments/payments.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  PaymentRecordStatus,
  PaymentRecordType,
  PaymentMethod,
} from '@interfaces/payments.interface';
import { PaymentGatewayService } from '@services/paymentGateway/paymentGateway.service';
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
  }> = {}
) =>
  new PaymentService({
    paymentDAO: (overrides.paymentDAO ?? {}) as jest.Mocked<PaymentDAO>,
    clientDAO: (overrides.clientDAO ?? {}) as jest.Mocked<ClientDAO>,
    profileDAO: (overrides.profileDAO ?? {}) as jest.Mocked<ProfileDAO>,
    leaseDAO: (overrides.leaseDAO ?? {}) as jest.Mocked<LeaseDAO>,
    paymentProcessorDAO: (overrides.paymentProcessorDAO ?? {}) as jest.Mocked<PaymentProcessorDAO>,
    paymentGatewayService: (overrides.paymentGatewayService ?? {}) as jest.Mocked<PaymentGatewayService>,
    subscriptionDAO: {} as jest.Mocked<SubscriptionDAO>,
    userDAO: {} as jest.Mocked<UserDAO>,
    subscriptionPlanConfig: {} as jest.Mocked<SubscriptionPlanConfig>,
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

  it('should use refundAmount (not baseAmount) for partial refunds', async () => {
    mockPaymentDAO.findByCuid.mockResolvedValue({
      items: [makeStat(PaymentRecordStatus.REFUNDED, 100000, { refundAmount: 40000 })],
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

    const result = await paymentService.recordManualPayment(CUID, USER_ID, makeData());

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

    await paymentService.recordManualPayment(CUID, USER_ID, makeData({ paidAt }));

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.dueDate).toEqual(paidAt);
    expect(insertCall.paidAt).toEqual(paidAt);
  });

  it('should work without leaseId (optional field)', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    const result = await paymentService.recordManualPayment(CUID, USER_ID, makeData({ leaseId: undefined }));

    expect(result.success).toBe(true);
    expect(mockLeaseDAO.findById).not.toHaveBeenCalled();
  });

  it('should include receipt data when provided', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(CUID, USER_ID, makeData({
      receipt: { url: 'https://s3.aws.com/receipts/receipt.pdf', filename: 'receipt.pdf', key: 'receipts/abc123.pdf' },
    }));

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.receipt?.url).toBe('https://s3.aws.com/receipts/receipt.pdf');
  });

  it('should throw NotFoundError when client, profile, or lease is not found', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.recordManualPayment(CUID, USER_ID, makeData())).rejects.toThrow(NotFoundError);

    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.recordManualPayment(CUID, USER_ID, makeData())).rejects.toThrow(NotFoundError);

    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(null);
    await expect(paymentService.recordManualPayment(CUID, USER_ID, makeData())).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError when lease belongs to a different client', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease({ cuid: 'DIFFERENT_CUID' }) as any);

    await expect(paymentService.recordManualPayment(CUID, USER_ID, makeData())).rejects.toThrow(NotFoundError);
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
    paymentService = makeServiceWithMocks({ paymentDAO: mockPaymentDAO, paymentProcessorDAO: mockPaymentProcessorDAO, paymentGatewayService: mockPaymentGatewayService });
  });

  afterEach(() => jest.clearAllMocks());

  it('should refund a PAID payment and set status to REFUNDED', async () => {
    const payment = makePaidPayment();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: { refundId: 're_test_123', status: 'succeeded', amount: 150000, currency: 'usd' } } as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.REFUNDED, refundedAt: new Date(), refundAmount: 150000 } as any);

    const result = await paymentService.refundPayment(CUID, PYTUID, {});

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(PaymentRecordStatus.REFUNDED);
  });

  it('should route refund through paymentGatewayService with correct params', async () => {
    const payment = makePaidPayment();
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: {} } as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.REFUNDED } as any);

    await paymentService.refundPayment(CUID, PYTUID, { amount: 50000, reason: 'Partial refund' });

    expect(mockPaymentGatewayService.createRefund).toHaveBeenCalledWith(
      'stripe',
      expect.objectContaining({
        chargeId: 'ch_test_abc123',
        connectedAccountId: 'acct_test_123',
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

    await paymentService.refundPayment(CUID, PYTUID, {});
    expect(mockPaymentDAO.updateById.mock.calls[0][1]).toMatchObject({ status: PaymentRecordStatus.REFUNDED, refundAmount: 200000 });
    expect(mockPaymentDAO.updateById.mock.calls[0][1].refundedAt).toBeInstanceOf(Date);

    jest.clearAllMocks();
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ baseAmount: 200000 }) as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor() as any);
    mockPaymentGatewayService.createRefund.mockResolvedValue({ success: true, data: {} } as any);
    mockPaymentDAO.updateById.mockResolvedValue({} as any);

    await paymentService.refundPayment(CUID, PYTUID, { amount: 75000 });
    expect(mockPaymentDAO.updateById.mock.calls[0][1].refundAmount).toBe(75000);
  });

  it('should throw BadRequestError when cuid or pytuid is missing', async () => {
    await expect(paymentService.refundPayment('', PYTUID, {})).rejects.toThrow(BadRequestError);
    await expect(paymentService.refundPayment(CUID, '', {})).rejects.toThrow(BadRequestError);
  });

  it('should throw NotFoundError when payment does not exist', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.refundPayment(CUID, PYTUID, {})).rejects.toThrow(NotFoundError);
  });

  it('should throw BadRequestError when payment is not PAID (PENDING or CANCELLED)', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ status: PaymentRecordStatus.PENDING }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, {})).rejects.toThrow(BadRequestError);

    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ status: PaymentRecordStatus.CANCELLED }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, {})).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when payment has no gatewayChargeId (manual entry)', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ gatewayChargeId: null }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, {})).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when partial refund amount exceeds baseAmount', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment({ baseAmount: 100000 }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, { amount: 200000 })).rejects.toThrow(BadRequestError);
    expect(mockPaymentGatewayService.createRefund).not.toHaveBeenCalled();
  });

  it('should throw BadRequestError when payment processor is not configured or has no accountId', async () => {
    mockPaymentDAO.findFirst.mockResolvedValue(makePaidPayment() as any);
    mockPaymentProcessorDAO.findFirst.mockResolvedValue(null);
    await expect(paymentService.refundPayment(CUID, PYTUID, {})).rejects.toThrow(BadRequestError);

    mockPaymentProcessorDAO.findFirst.mockResolvedValue(makeProcessor({ accountId: null }) as any);
    await expect(paymentService.refundPayment(CUID, PYTUID, {})).rejects.toThrow(BadRequestError);
  });
});
