// Break circular import: invoice.service → @services/index → DI container
jest.mock('@di/index', () => ({ container: {} }));

import { Types } from 'mongoose';
import { PaymentDAO } from '@dao/index';
import { InvoiceService } from '@services/invoice/invoice.service';
import { PaymentRecordStatus } from '@interfaces/payments.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';

// ── Constants ──────────────────────────────────────────────────────────────────

const CUID = 'MMQHHVX09JJT';
const PYTUID = 'ACXP3MSZY59E';
const JOB_ID = 'job-abc123';

// ── Factories ──────────────────────────────────────────────────────────────────

const makePayment = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  pytuid: PYTUID,
  cuid: CUID,
  status: PaymentRecordStatus.PAID,
  isManualEntry: true,
  invoiceNumber: 'INV-2026-001',
  baseAmount: 150000,
  processingFee: 0,
  currency: 'USD',
  paymentType: 'rent',
  paymentMethod: 'cash',
  ...overrides,
});

// Builds an InvoiceService with injectable mocks.
// Returns the service plus the key mocks for assertion.
const makeService = (
  overrides: {
    paymentDAO?: jest.Mocked<PaymentDAO>;
    addToPdfQueue?: jest.Mock;
  } = {}
) => {
  const addToPdfQueue =
    overrides.addToPdfQueue ??
    (jest.fn().mockReturnValue(Promise.resolve({ id: JOB_ID })) as jest.Mock);
  const getQueue = jest.fn().mockReturnValue({ addToPdfQueue });

  const service = new InvoiceService({
    paymentDAO: (overrides.paymentDAO ?? {}) as jest.Mocked<PaymentDAO>,
    queueFactory: { getQueue } as any,
    pdfGeneratorService: {} as any,
    mediaUploadService: {} as any,
    invoiceTemplateRenderer: { render: jest.fn().mockReturnValue(Promise.resolve('<html></html>')) } as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    sseService: { sendToUser: jest.fn() } as any,
  });

  return { service, getQueue, addToPdfQueue };
};

// ═════════════════════════════════════════════════════════════════════════════
// InvoiceService.requestInvoice
// ═════════════════════════════════════════════════════════════════════════════

describe('InvoiceService - requestInvoice', () => {
  let mockPaymentDAO: jest.Mocked<PaymentDAO>;

  beforeEach(() => {
    mockPaymentDAO = {
      findFirst: jest.fn(),
    } as unknown as jest.Mocked<PaymentDAO>;
  });

  afterEach(() => { jest.clearAllMocks(); });

  it('returns { status: "ready", url } immediately when invoiceDocument.url is already cached', async () => {
    const cachedUrl = 'https://s3.example.com/invoices/inv-001.pdf';
    (mockPaymentDAO.findFirst as jest.Mock).mockReturnValue(
      Promise.resolve(
        makePayment({
          invoiceDocument: { url: cachedUrl, key: 'invoices/inv-001.pdf', generatedAt: new Date() },
        })
      )
    );

    const { service } = makeService({ paymentDAO: mockPaymentDAO });
    const result = await service.requestInvoice(PYTUID, CUID);

    expect(result).toEqual({ status: 'ready', url: cachedUrl });
  });

  it('does not enqueue a PDF job when URL is already cached', async () => {
    (mockPaymentDAO.findFirst as jest.Mock).mockReturnValue(
      Promise.resolve(
        makePayment({
          invoiceDocument: {
            url: 'https://s3.example.com/cached.pdf',
            key: 'cached.pdf',
            generatedAt: new Date(),
          },
        })
      )
    );

    const addToPdfQueue = jest.fn() as jest.Mock;
    const { service } = makeService({ paymentDAO: mockPaymentDAO, addToPdfQueue });

    await service.requestInvoice(PYTUID, CUID);

    expect(addToPdfQueue).not.toHaveBeenCalled();
  });

  it('enqueues a PDF job and returns { status: "queued", jobId } when no URL is cached', async () => {
    (mockPaymentDAO.findFirst as jest.Mock).mockReturnValue(
      Promise.resolve(makePayment())
    );

    const { service, getQueue, addToPdfQueue } = makeService({ paymentDAO: mockPaymentDAO });
    const result = await service.requestInvoice(PYTUID, CUID);

    expect(result.status).toBe('queued');
    expect(getQueue).toHaveBeenCalledWith('pdfGeneratorQueue');
    expect(addToPdfQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: CUID,
        resource: expect.objectContaining({
          resourceId: PYTUID,
          resourceName: 'payment-invoice',
          resourceType: 'document',
        }),
      })
    );
  });

  it('returns the job id from the queue in the queued response', async () => {
    (mockPaymentDAO.findFirst as jest.Mock).mockReturnValue(
      Promise.resolve(makePayment())
    );
    const addToPdfQueue = jest.fn().mockReturnValue(
      Promise.resolve({ id: 'specific-job-id' })
    ) as jest.Mock;

    const { service } = makeService({ paymentDAO: mockPaymentDAO, addToPdfQueue });
    const result = await service.requestInvoice(PYTUID, CUID);

    expect(result).toEqual({ status: 'queued', jobId: 'specific-job-id' });
  });

  it('throws NotFoundError when payment does not exist', async () => {
    (mockPaymentDAO.findFirst as jest.Mock).mockReturnValue(Promise.resolve(null));

    const { service } = makeService({ paymentDAO: mockPaymentDAO });

    await expect(service.requestInvoice(PYTUID, CUID)).rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when payment is not a manual entry', async () => {
    (mockPaymentDAO.findFirst as jest.Mock).mockReturnValue(
      Promise.resolve(makePayment({ isManualEntry: false }))
    );

    const { service } = makeService({ paymentDAO: mockPaymentDAO });

    await expect(service.requestInvoice(PYTUID, CUID)).rejects.toThrow(BadRequestError);
  });

  it('queries payment with cuid and pytuid filter and excludes deleted records', async () => {
    (mockPaymentDAO.findFirst as jest.Mock).mockReturnValue(Promise.resolve(null));

    const { service } = makeService({ paymentDAO: mockPaymentDAO });

    await service.requestInvoice(PYTUID, CUID).catch(() => {});

    expect(mockPaymentDAO.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ pytuid: PYTUID, cuid: CUID, deletedAt: null })
    );
  });
});
