import { Types } from 'mongoose';
import { SubscriptionPlanConfig } from '@services/subscription';
import { PaymentService } from '@services/payments/payments.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PaymentRecordStatus, PaymentRecordType } from '@interfaces/payments.interface';
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const CUID = 'MMQHHVX09JJT';
const PYTUID = 'PYT001';

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

// ── cancelPayment tests ───────────────────────────────────────────────────────

describe('PaymentService - cancelPayment', () => {
  let paymentService: PaymentService;
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
      updateById: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;

    mockClientDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<ClientDAO>;

    paymentService = new PaymentService({
      paymentDAO: mockPaymentDAO,
      clientDAO: mockClientDAO,
      paymentProcessorDAO: {} as jest.Mocked<PaymentProcessorDAO>,
      subscriptionDAO: {} as jest.Mocked<SubscriptionDAO>,
      profileDAO: {} as jest.Mocked<ProfileDAO>,
      leaseDAO: {} as jest.Mocked<LeaseDAO>,
      userDAO: {} as jest.Mocked<UserDAO>,
      paymentGatewayService: {} as jest.Mocked<PaymentGatewayService>,
      subscriptionPlanConfig: {} as jest.Mocked<SubscriptionPlanConfig>,
    });
  });

  afterEach(() => jest.clearAllMocks());

  it('should cancel a pending payment and return success', async () => {
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
    const cancelled = { ...payment, status: PaymentRecordStatus.CANCELLED };

    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue(cancelled as any);

    const result = await paymentService.cancelPayment(CUID, PYTUID);

    expect(result.success).toBe(true);
  });

  it('should include a cancellation note when reason is provided', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.CANCELLED } as any);

    await paymentService.cancelPayment(CUID, PYTUID, 'Tenant moved out');

    const updateCall = mockPaymentDAO.updateById.mock.calls[0][1];
    expect(updateCall).toMatchObject({
      status: PaymentRecordStatus.CANCELLED,
      $push: { notes: expect.objectContaining({ text: 'Cancelled: Tenant moved out' }) },
    });
  });

  it('should NOT include $push notes when no reason is provided', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.CANCELLED } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    const updateCall = mockPaymentDAO.updateById.mock.calls[0][1];
    expect(updateCall.$push).toBeUndefined();
  });

  it('should throw BadRequestError when cuid is missing', async () => {
    await expect(paymentService.cancelPayment('', PYTUID)).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when pytuid is missing', async () => {
    await expect(paymentService.cancelPayment(CUID, '')).rejects.toThrow(BadRequestError);
  });

  it('should throw NotFoundError when client does not exist', async () => {
    mockClientDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(NotFoundError);
  });

  it('should throw NotFoundError when payment does not exist', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(null);

    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(NotFoundError);
  });

  it('should throw BadRequestError when payment is already PAID', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(makePayment({ status: PaymentRecordStatus.PAID }) as any);

    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when payment is already CANCELLED', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(
      makePayment({ status: PaymentRecordStatus.CANCELLED }) as any
    );

    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow(BadRequestError);
  });

  it('should call updateById with the correct payment _id', async () => {
    const payment = makePayment();
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(payment as any);
    mockPaymentDAO.updateById.mockResolvedValue({ ...payment, status: PaymentRecordStatus.CANCELLED } as any);

    await paymentService.cancelPayment(CUID, PYTUID);

    expect(mockPaymentDAO.updateById).toHaveBeenCalledWith(
      payment._id,
      expect.objectContaining({ status: PaymentRecordStatus.CANCELLED })
    );
  });

  it('should throw if updateById rejects', async () => {
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID } as any);
    mockPaymentDAO.findFirst.mockResolvedValue(makePayment() as any);
    mockPaymentDAO.updateById.mockRejectedValue(new Error('DB write failed'));

    await expect(paymentService.cancelPayment(CUID, PYTUID)).rejects.toThrow('DB write failed');
  });
});
