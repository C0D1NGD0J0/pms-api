import { Job } from 'bull';
import { SmsWorker } from '@workers/sms.worker';
import { EmailWorker } from '@workers/email.worker';
import { PaymentWorker } from '@workers/payment.worker';
import { PaymentRecordType } from '@interfaces/payments.interface';
import { ICreateRentInvoiceJobData, ICancelPaymentJobData } from '@queues/payment.queue';

// ── Helpers ──────────────────────────────────────────────────────────

const makeJob = <T>(data: T, overrides: Partial<Job> = {}): Job<T> =>
  ({
    id: 'job-req-id-test',
    data,
    attemptsMade: 0,
    opts: { attempts: 3 },
    progress: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  }) as unknown as Job<T>;

// ── PaymentWorker requestId propagation ──────────────────────────────

describe('PaymentWorker — requestId child logger', () => {
  let worker: PaymentWorker;
  let mockPaymentService: any;
  let childLogSpy: jest.Mock;

  beforeEach(() => {
    mockPaymentService = {
      createRentPayment: jest.fn().mockResolvedValue({ success: true, data: { pytuid: 'PYT-1' } }),
      cancelPayment: jest.fn().mockResolvedValue({ success: true }),
    };
    worker = new PaymentWorker({ paymentService: mockPaymentService });

    // Spy on the worker's log.child to verify requestId propagation
    childLogSpy = jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    (worker as any).log.child = childLogSpy;
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a child logger with requestId for handleCreateRentInvoice', async () => {
    const data: ICreateRentInvoiceJobData = {
      cuid: 'TEST-CUID',
      leaseId: 'lease-123',
      tenantId: 'tenant-456',
      paymentType: PaymentRecordType.RENT,
      period: { month: 6, year: 2026 },
      dueDate: new Date('2026-06-01'),
      requestId: 'req-abc-123',
    };

    await worker.handleCreateRentInvoice(makeJob(data));

    expect(childLogSpy).toHaveBeenCalledWith({ requestId: 'req-abc-123' });
  });

  it('does NOT create a child logger when requestId is absent', async () => {
    const data: ICreateRentInvoiceJobData = {
      cuid: 'TEST-CUID',
      leaseId: 'lease-123',
      tenantId: 'tenant-456',
      paymentType: PaymentRecordType.RENT,
      period: { month: 6, year: 2026 },
      dueDate: new Date('2026-06-01'),
    };

    await worker.handleCreateRentInvoice(makeJob(data));

    expect(childLogSpy).not.toHaveBeenCalled();
  });

  it('creates a child logger with requestId for handleCancelPayment', async () => {
    const data: ICancelPaymentJobData = {
      cuid: 'TEST-CUID',
      pytuid: 'PYT-001',
      reason: 'Test cancellation',
      requestId: 'req-cancel-456',
    };

    await worker.handleCancelPayment(makeJob(data));

    expect(childLogSpy).toHaveBeenCalledWith({ requestId: 'req-cancel-456' });
  });
});

// ── EmailWorker requestId propagation ────────────────────────────────

describe('EmailWorker — requestId child logger', () => {
  let worker: EmailWorker;
  let childLogSpy: jest.Mock;
  let mockMailer: any;

  beforeEach(() => {
    mockMailer = { sendMail: jest.fn().mockResolvedValue(undefined) };
    const mockEmitter = { emit: jest.fn() };
    const mockProfileService = { getUserEmailPreferences: jest.fn().mockResolvedValue(null) };
    worker = new EmailWorker({
      mailerService: mockMailer,
      emitterService: mockEmitter as any,
      profileService: mockProfileService as any,
    });

    childLogSpy = jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    (worker as any).log.child = childLogSpy;
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a child logger when requestId is present in job data', async () => {
    const job = makeJob({
      requestId: 'req-email-789',
      emailType: 'TEST_EMAIL',
      subject: 'Test',
      to: 'user@test.com',
      data: {},
    });

    await worker.sendMail(job);

    expect(childLogSpy).toHaveBeenCalledWith({ requestId: 'req-email-789' });
  });

  it('does NOT create a child logger when requestId is absent', async () => {
    const job = makeJob({
      emailType: 'TEST_EMAIL',
      subject: 'Test',
      to: 'user@test.com',
      data: {},
    });

    await worker.sendMail(job);

    expect(childLogSpy).not.toHaveBeenCalled();
  });
});

// ── SmsWorker requestId propagation ──────────────────────────────────

describe('SmsWorker — requestId child logger', () => {
  let worker: SmsWorker;
  let childLogSpy: jest.Mock;
  let mockSmsService: any;

  beforeEach(() => {
    mockSmsService = {
      sendSMS: jest.fn().mockResolvedValue({ success: true, twilioSid: 'SM123' }),
    };
    const mockGuestPassDAO = {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue(undefined),
    };
    worker = new SmsWorker({
      smsService: mockSmsService,
      guestPassDAO: mockGuestPassDAO as any,
    });

    childLogSpy = jest.fn().mockReturnValue({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
    });
    (worker as any).log.child = childLogSpy;
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a child logger when requestId is present', async () => {
    const job = makeJob({
      requestId: 'req-sms-101',
      to: '+15551234567',
      body: 'Test SMS',
      cuid: 'TEST-CUID',
    });

    await worker.sendSms(job);

    expect(childLogSpy).toHaveBeenCalledWith({ requestId: 'req-sms-101' });
  });

  it('does NOT create a child logger when requestId is absent', async () => {
    const job = makeJob({
      to: '+15551234567',
      body: 'Test SMS',
      cuid: 'TEST-CUID',
    });

    await worker.sendSms(job);

    expect(childLogSpy).not.toHaveBeenCalled();
  });
});
