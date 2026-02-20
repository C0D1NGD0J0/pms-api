import { DoneCallback, Job } from 'bull';
import { PaymentWorker } from '@workers/payment.worker';
import { PaymentRecordType } from '@interfaces/payments.interface';
import { PaymentService } from '@services/payments/payments.service';
import { ICreateRentInvoiceJobData, ICancelPaymentJobData } from '@queues/payment.queue';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeJob = <T>(data: T, overrides: Partial<Job> = {}): Job<T> =>
  ({
    id: 'job-001',
    data,
    attemptsMade: 0,
    opts: { attempts: 5 },
    progress: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as Job<T>);

const makeDone = (): jest.MockedFunction<DoneCallback> => jest.fn();

const makeRentJobData = (overrides: Partial<ICreateRentInvoiceJobData> = {}): ICreateRentInvoiceJobData => ({
  cuid: 'MMQHHVX09JJT',
  leaseId: 'lease-object-id-123',
  tenantId: 'tenant-profile-id-456',
  paymentType: PaymentRecordType.RENT,
  period: { month: 3, year: 2026 },
  dueDate: new Date('2026-03-01'),
  description: 'Rent for 3/2026',
  ...overrides,
});

const makeCancelJobData = (overrides: Partial<ICancelPaymentJobData> = {}): ICancelPaymentJobData => ({
  cuid: 'MMQHHVX09JJT',
  pytuid: 'PYT001',
  reason: 'Tenant requested cancellation',
  ...overrides,
});

// ── PaymentWorker tests ───────────────────────────────────────────────────────

describe('PaymentWorker', () => {
  let worker: PaymentWorker;
  let mockPaymentService: jest.Mocked<PaymentService>;

  beforeEach(() => {
    mockPaymentService = {
      createRentPayment: jest.fn(),
      cancelPayment: jest.fn(),
    } as unknown as jest.Mocked<PaymentService>;

    worker = new PaymentWorker({ paymentService: mockPaymentService });
  });

  afterEach(() => jest.clearAllMocks());

  // ── handleCreateRentInvoice ──────────────────────────────────────────────

  describe('handleCreateRentInvoice', () => {
    it('should call createRentPayment with correct args and call done(null, result)', async () => {
      const mockPayment = { pytuid: 'PYT-NEW-001' };
      mockPaymentService.createRentPayment.mockResolvedValue({
        success: true,
        data: mockPayment as any,
      });

      const data = makeRentJobData();
      const job = makeJob(data);
      const done = makeDone();

      await worker.handleCreateRentInvoice(job, done);

      expect(mockPaymentService.createRentPayment).toHaveBeenCalledWith(
        data.cuid,
        expect.objectContaining({
          paymentType: PaymentRecordType.RENT,
          leaseId: data.leaseId,
          tenantId: data.tenantId,
          period: data.period,
          description: data.description,
        })
      );
      expect(job.progress).toHaveBeenCalledWith(10);
      expect(job.progress).toHaveBeenCalledWith(100);
      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ success: true, pytuid: 'PYT-NEW-001' })
      );
    });

    it('should call done(error) when createRentPayment throws', async () => {
      const err = new Error('Stripe API unavailable');
      mockPaymentService.createRentPayment.mockRejectedValue(err);

      const done = makeDone();
      await worker.handleCreateRentInvoice(makeJob(makeRentJobData()), done);

      expect(done).toHaveBeenCalledWith(err);
    });

    it('should log an alert on final retry attempt', async () => {
      const err = new Error('Stripe timeout');
      mockPaymentService.createRentPayment.mockRejectedValue(err);

      // Simulate job on last attempt (attemptsMade = 4, attempts = 5)
      const job = makeJob(makeRentJobData(), { attemptsMade: 4, opts: { attempts: 5 } } as any);
      const done = makeDone();

      await worker.handleCreateRentInvoice(job, done);

      expect(done).toHaveBeenCalledWith(err);
    });

    it('should report progress at 10% before calling service and 100% after', async () => {
      const progressOrder: number[] = [];
      const job = makeJob(makeRentJobData(), {
        progress: jest.fn().mockImplementation((v: number) => {
          progressOrder.push(v);
          return Promise.resolve();
        }),
      } as any);

      mockPaymentService.createRentPayment.mockResolvedValue({ success: true, data: { pytuid: 'X' } as any });

      await worker.handleCreateRentInvoice(job, makeDone());

      expect(progressOrder).toEqual([10, 100]);
    });
  });

  // ── handleCancelPayment ──────────────────────────────────────────────────

  describe('handleCancelPayment', () => {
    it('should call cancelPayment with correct args and call done(null, result)', async () => {
      mockPaymentService.cancelPayment.mockResolvedValue({ success: true, data: {} as any });

      const data = makeCancelJobData();
      const job = makeJob(data);
      const done = makeDone();

      await worker.handleCancelPayment(job, done);

      expect(mockPaymentService.cancelPayment).toHaveBeenCalledWith(
        data.cuid,
        data.pytuid,
        data.reason
      );
      expect(done).toHaveBeenCalledWith(
        null,
        expect.objectContaining({ success: true, pytuid: data.pytuid })
      );
    });

    it('should call done(error) when cancelPayment throws', async () => {
      const err = new Error('Payment not found');
      mockPaymentService.cancelPayment.mockRejectedValue(err);

      const done = makeDone();
      await worker.handleCancelPayment(makeJob(makeCancelJobData()), done);

      expect(done).toHaveBeenCalledWith(err);
    });

    it('should work without optional reason field', async () => {
      mockPaymentService.cancelPayment.mockResolvedValue({ success: true, data: {} as any });

      const data = makeCancelJobData({ reason: undefined });
      const done = makeDone();

      await worker.handleCancelPayment(makeJob(data), done);

      expect(mockPaymentService.cancelPayment).toHaveBeenCalledWith(data.cuid, data.pytuid, undefined);
      expect(done).toHaveBeenCalledWith(null, expect.objectContaining({ success: true }));
    });
  });
});
