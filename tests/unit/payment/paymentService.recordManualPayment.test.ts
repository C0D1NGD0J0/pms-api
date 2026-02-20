import { Types } from 'mongoose';
import { NotFoundError } from '@shared/customErrors';
import { SubscriptionPlanConfig } from '@services/subscription';
import { PaymentService } from '@services/payments/payments.service';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const CUID = 'MMQHHVX09JJT';
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

const makeManualPaymentData = (overrides: Record<string, any> = {}) => ({
  paymentType: PaymentRecordType.RENT,
  paymentMethod: PaymentMethod.CASH,
  amount: 150000,
  paidAt: new Date('2026-03-01'),
  tenantId: TENANT_ID,
  leaseId: LEASE_ID,
  period: { month: 3, year: 2026 },
  description: 'March rent - cash payment',
  ...overrides,
});

// ── recordManualPayment tests ─────────────────────────────────────────────────

describe('PaymentService - recordManualPayment', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockProfileDAO: jest.Mocked<ProfileDAO>;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;

  beforeEach(() => {
    mockPaymentDAO = {
      insert: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;

    mockClientDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<ClientDAO>;

    mockProfileDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<ProfileDAO>;

    mockLeaseDAO = {
      findById: jest.fn(),
    } as unknown as jest.Mocked<LeaseDAO>;

    paymentService = new PaymentService({
      clientDAO: mockClientDAO,
      leaseDAO: mockLeaseDAO,
      paymentDAO: mockPaymentDAO,
      paymentProcessorDAO: {} as jest.Mocked<PaymentProcessorDAO>,
      profileDAO: mockProfileDAO,
      subscriptionDAO: {} as jest.Mocked<SubscriptionDAO>,
      userDAO: {} as jest.Mocked<UserDAO>,
      paymentGatewayService: {} as jest.Mocked<PaymentGatewayService>,
      subscriptionPlanConfig: {} as jest.Mocked<SubscriptionPlanConfig>,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should create manual payment record with status PAID', async () => {
    const client = makeClient();
    const profile = makeProfile();
    const lease = makeLease();
    const data = makeManualPaymentData();

    const expectedPayment = {
      _id: new Types.ObjectId(),
      pytuid: 'PYT001',
      cuid: CUID,
      status: PaymentRecordStatus.PAID,
      paymentMethod: PaymentMethod.CASH,
      isManualEntry: true,
      baseAmount: 150000,
      processingFee: 0,
    };

    mockClientDAO.findFirst.mockResolvedValue(client as any);
    mockProfileDAO.findFirst.mockResolvedValue(profile as any);
    mockLeaseDAO.findById.mockResolvedValue(lease as any);
    mockPaymentDAO.insert.mockResolvedValue(expectedPayment as any);

    const result = await paymentService.recordManualPayment(CUID, USER_ID, data);

    expect(result.success).toBe(true);
    expect(result.data.status).toBe(PaymentRecordStatus.PAID);
    expect(result.data.isManualEntry).toBe(true);
    expect(result.data.processingFee).toBe(0);
  });

  it('should throw NotFoundError if client not found', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);

    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, makeManualPaymentData())
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError if tenant profile not found', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(null);

    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, makeManualPaymentData())
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError if lease not found', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(null);

    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, makeManualPaymentData())
    ).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError if lease belongs to different client', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease({ cuid: 'DIFFERENT_CUID' }) as any);

    await expect(
      paymentService.recordManualPayment(CUID, USER_ID, makeManualPaymentData())
    ).rejects.toThrow(NotFoundError);
  });

  it('should work without leaseId (optional)', async () => {
    const client = makeClient();
    const profile = makeProfile();
    const data = makeManualPaymentData({ leaseId: undefined });

    mockClientDAO.findFirst.mockResolvedValue(client as any);
    mockProfileDAO.findFirst.mockResolvedValue(profile as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    const result = await paymentService.recordManualPayment(CUID, USER_ID, data);

    expect(result.success).toBe(true);
    expect(mockLeaseDAO.findById).not.toHaveBeenCalled();
  });

  it('should set processingFee to 0 for manual payments', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(CUID, USER_ID, makeManualPaymentData());

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.processingFee).toBe(0);
  });

  it('should set paidAt same as dueDate', async () => {
    const paidAt = new Date('2026-03-15');
    const data = makeManualPaymentData({ paidAt });

    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(CUID, USER_ID, data);

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.dueDate).toEqual(paidAt);
    expect(insertCall.paidAt).toEqual(paidAt);
  });

  it('should include receipt data if provided', async () => {
    const data = makeManualPaymentData({
      receipt: {
        url: 'https://s3.aws.com/receipts/receipt.pdf',
        filename: 'receipt.pdf',
        key: 'receipts/abc123.pdf',
      },
    });

    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(CUID, USER_ID, data);

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.receipt).toBeDefined();
    expect(insertCall.receipt?.url).toBe('https://s3.aws.com/receipts/receipt.pdf');
    expect(insertCall.receipt?.uploadedBy).toBeDefined();
  });

  it('should handle different payment methods', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    const methods = [
      PaymentMethod.CASH,
      PaymentMethod.CHECK,
      PaymentMethod.BANK_TRANSFER,
      PaymentMethod.OTHER,
    ];

    for (const method of methods) {
      const data = makeManualPaymentData({ paymentMethod: method });
      await paymentService.recordManualPayment(CUID, USER_ID, data);

      const insertCall =
        mockPaymentDAO.insert.mock.calls[mockPaymentDAO.insert.mock.calls.length - 1][0];
      expect(insertCall.paymentMethod).toBe(method);
    }
  });

  it('should set recordedBy to userId', async () => {
    mockClientDAO.findFirst.mockResolvedValue(makeClient() as any);
    mockProfileDAO.findFirst.mockResolvedValue(makeProfile() as any);
    mockLeaseDAO.findById.mockResolvedValue(makeLease() as any);
    mockPaymentDAO.insert.mockResolvedValue({} as any);

    await paymentService.recordManualPayment(CUID, USER_ID, makeManualPaymentData());

    const insertCall = mockPaymentDAO.insert.mock.calls[0][0];
    expect(insertCall.recordedBy).toBeDefined();
  });
});
