import { JOB_NAME } from '@utils/constants';
import { PaymentWorker } from '@workers/payment.worker';
import { PaymentRecordType } from '@interfaces/payments.interface';
import { ICreateRentInvoiceJobData, ICancelPaymentJobData, PaymentQueue } from '@queues/payment.queue';

// Mock BaseQueue so we don't need Redis in unit tests
jest.mock('@queues/base.queue', () => {
  return {
    BaseQueue: class MockBaseQueue {
      constructor(_opts: any) {}
      addJobToQueue = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
      processQueueJobs = jest.fn();
    },
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeWorker = (): jest.Mocked<PaymentWorker> =>
  ({
    handleCreateRentInvoice: jest.fn(),
    handleCancelPayment: jest.fn(),
  } as unknown as jest.Mocked<PaymentWorker>);

const makeRentJobData = (overrides: Partial<ICreateRentInvoiceJobData> = {}): ICreateRentInvoiceJobData => ({
  cuid: 'MMQHHVX09JJT',
  leaseId: 'lease-object-id-123',
  tenantId: 'tenant-profile-id-456',
  paymentType: PaymentRecordType.RENT,
  period: { month: 3, year: 2026 },
  dueDate: new Date('2026-03-01'),
  ...overrides,
});

const makeCancelJobData = (overrides: Partial<ICancelPaymentJobData> = {}): ICancelPaymentJobData => ({
  cuid: 'MMQHHVX09JJT',
  pytuid: 'PYT001',
  ...overrides,
});

// ── PaymentQueue tests ────────────────────────────────────────────────────────

describe('PaymentQueue', () => {
  let queue: PaymentQueue;
  let mockWorker: jest.Mocked<PaymentWorker>;

  beforeEach(() => {
    mockWorker = makeWorker();
    queue = new PaymentQueue({ paymentWorker: mockWorker });
  });

  afterEach(() => jest.clearAllMocks());

  describe('constructor', () => {
    it('should register job processors for all 3 job types', () => {
      expect((queue as any).processQueueJobs).toHaveBeenCalledTimes(3);
    });

    it('should register CREATE_RENT_INVOICE_JOB processor with concurrency 5', () => {
      expect((queue as any).processQueueJobs).toHaveBeenCalledWith(
        JOB_NAME.CREATE_RENT_INVOICE_JOB,
        5,
        mockWorker.handleCreateRentInvoice
      );
    });

    it('should register RETRY_FAILED_INVOICE_JOB processor', () => {
      expect((queue as any).processQueueJobs).toHaveBeenCalledWith(
        JOB_NAME.RETRY_FAILED_INVOICE_JOB,
        2,
        mockWorker.handleCreateRentInvoice
      );
    });

    it('should register CANCEL_PAYMENT_JOB processor with concurrency 10', () => {
      expect((queue as any).processQueueJobs).toHaveBeenCalledWith(
        JOB_NAME.CANCEL_PAYMENT_JOB,
        10,
        mockWorker.handleCancelPayment
      );
    });
  });

  describe('addCreateRentInvoiceJob', () => {
    it('should call addJobToQueue with CREATE_RENT_INVOICE_JOB and correct data', async () => {
      const data = makeRentJobData();
      await queue.addCreateRentInvoiceJob(data);

      expect((queue as any).addJobToQueue).toHaveBeenCalledWith(
        JOB_NAME.CREATE_RENT_INVOICE_JOB,
        data,
        expect.objectContaining({ attempts: 5, backoff: expect.objectContaining({ type: 'exponential' }) })
      );
    });

    it('should use 5 retry attempts with exponential backoff', async () => {
      await queue.addCreateRentInvoiceJob(makeRentJobData());

      const [, , options] = (queue as any).addJobToQueue.mock.calls[0];
      expect(options.attempts).toBe(5);
      expect(options.backoff.type).toBe('exponential');
      expect(options.backoff.delay).toBe(10000);
    });
  });

  describe('addRetryFailedInvoiceJob', () => {
    it('should call addJobToQueue with RETRY_FAILED_INVOICE_JOB', async () => {
      const data = makeRentJobData();
      await queue.addRetryFailedInvoiceJob(data);

      expect((queue as any).addJobToQueue).toHaveBeenCalledWith(
        JOB_NAME.RETRY_FAILED_INVOICE_JOB,
        data,
        expect.objectContaining({ attempts: 3 })
      );
    });

    it('should use longer backoff delay for retries (60s)', async () => {
      await queue.addRetryFailedInvoiceJob(makeRentJobData());

      const [, , options] = (queue as any).addJobToQueue.mock.calls[0];
      expect(options.backoff.delay).toBe(60000);
    });
  });

  describe('addCancelPaymentJob', () => {
    it('should call addJobToQueue with CANCEL_PAYMENT_JOB and correct data', async () => {
      const data = makeCancelJobData();
      await queue.addCancelPaymentJob(data);

      expect((queue as any).addJobToQueue).toHaveBeenCalledWith(
        JOB_NAME.CANCEL_PAYMENT_JOB,
        data
      );
    });

    it('should include optional reason when provided', async () => {
      const data = makeCancelJobData({ reason: 'Tenant moved out' });
      await queue.addCancelPaymentJob(data);

      const [, jobData] = (queue as any).addJobToQueue.mock.calls[0];
      expect(jobData.reason).toBe('Tenant moved out');
    });
  });
});
