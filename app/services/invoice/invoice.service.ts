import Logger from 'bunyan';
import { PaymentDAO } from '@dao/index';
import { PdfQueue } from '@queues/index';
import { createLogger } from '@utils/index';
import { QueueFactory } from '@services/queue';
import { MoneyUtils } from '@utils/money.utils';
import { EventEmitterService } from '@services/index';
import { ResourceContext } from '@interfaces/utils.interface';
import { IPaymentPopulated } from '@interfaces/payments.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PdfGeneratorService, MediaUploadService } from '@services/index';
import {
  PdfGenerationRequestedPayload,
  InvoiceGeneratedPayload,
  UploadCompletedPayload,
  UploadFailedPayload,
  EventTypes,
} from '@interfaces/events.interface';

export interface InvoiceTemplateData {
  period?: { month: number; year: number };
  propertyAddress: string;
  processingFee?: number; // cents
  invoiceNumber: string;
  paymentMethod: string;
  leaseNumber?: string;
  description?: string;
  companyName?: string;
  paymentType: string;
  tenantName: string;
  baseAmount: number; // cents
  currency: string;
  status: string;
  dueDate?: Date;
  paidAt?: Date;
}

interface IConstructor {
  pdfGeneratorService: PdfGeneratorService;
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  queueFactory: QueueFactory;
  paymentDAO: PaymentDAO;
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const STATUS_BADGE: Record<string, { bg: string; fg: string }> = {
  paid: { bg: '#dcfce7', fg: '#166534' },
  pending: { bg: '#fef9c3', fg: '#854d0e' },
  overdue: { bg: '#fee2e2', fg: '#991b1b' },
  failed: { bg: '#fee2e2', fg: '#991b1b' },
  cancelled: { bg: '#f3f4f6', fg: '#6b7280' },
  refunded: { bg: '#dbeafe', fg: '#1e40af' },
};

const RESOURCE_NAME = 'payment-invoice';

export class InvoiceService {
  private readonly log: Logger;
  private readonly paymentDAO: PaymentDAO;
  private readonly queueFactory: QueueFactory;
  private readonly emitterService: EventEmitterService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly pdfGeneratorService: PdfGeneratorService;

  constructor({
    pdfGeneratorService,
    mediaUploadService,
    emitterService,
    queueFactory,
    paymentDAO,
  }: IConstructor) {
    this.log = createLogger('InvoiceService');
    this.pdfGeneratorService = pdfGeneratorService;
    this.mediaUploadService = mediaUploadService;
    this.emitterService = emitterService;
    this.queueFactory = queueFactory;
    this.paymentDAO = paymentDAO;
    this.setupEventListeners();
  }

  /**
   * Builds a professional invoice HTML string from structured data.
   * Exported as a standalone method so other services (e.g. mailer) can call it
   * independently of the queue flow.
   */
  buildInvoiceHtml(data: InvoiceTemplateData): string {
    const {
      invoiceNumber,
      status,
      tenantName,
      propertyAddress,
      leaseNumber,
      paymentType,
      paymentMethod,
      period,
      dueDate,
      paidAt,
      baseAmount,
      processingFee = 0,
      currency,
      description,
      companyName = 'Property Management',
    } = data;

    const badge = STATUS_BADGE[status.toLowerCase()] ?? STATUS_BADGE['cancelled'];
    const total = baseAmount + processingFee;
    const fmt = (cents: number) => `${currency} ${MoneyUtils.centsToDisplay(cents)}`;
    const fmtDate = (d: Date) =>
      d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const typeLabel = paymentType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const methodLabel = paymentMethod.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif;
      font-size: 11px;
      color: #111827;
      background: #ffffff;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .page { padding: 48px 56px; min-height: 100vh; }

    /* ── Header ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 24px;
      margin-bottom: 32px;
      border-bottom: 2px solid #111827;
    }
    .brand-name { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; color: #111827; }
    .brand-sub  { font-size: 10px; color: #9ca3af; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.6px; }
    .invoice-id { text-align: right; }
    .invoice-id .label { font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px; color: #9ca3af; }
    .invoice-id .number { font-size: 16px; font-weight: 700; color: #111827; margin-top: 2px; }
    .badge {
      display: inline-block;
      padding: 3px 10px;
      border-radius: 20px;
      font-size: 9px;
      font-weight: 700;
      letter-spacing: 0.5px;
      text-transform: uppercase;
      margin-top: 8px;
      background: ${badge.bg};
      color: ${badge.fg};
    }

    /* ── Billing columns ── */
    .billing { display: flex; gap: 48px; margin-bottom: 32px; }
    .billing-col { flex: 1; }
    .billing-col .col-label {
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
      color: #9ca3af; font-weight: 600; margin-bottom: 8px;
    }
    .billing-col .col-name { font-size: 13px; font-weight: 700; color: #111827; margin-bottom: 4px; }
    .billing-col .col-detail { font-size: 11px; color: #4b5563; line-height: 1.6; }

    /* ── Section ── */
    .section { margin-bottom: 28px; }
    .section-title {
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.6px;
      color: #9ca3af; font-weight: 600;
      padding-bottom: 8px;
      border-bottom: 1px solid #e5e7eb;
      margin-bottom: 4px;
    }

    /* ── Detail rows ── */
    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 8px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .detail-row:last-child { border-bottom: none; }
    .detail-key   { color: #6b7280; }
    .detail-value { font-weight: 600; color: #111827; }

    /* ── Amount table ── */
    table { width: 100%; border-collapse: collapse; }
    thead tr { background: #f9fafb; }
    th {
      padding: 10px 14px; text-align: left;
      font-size: 9px; text-transform: uppercase; letter-spacing: 0.5px;
      color: #6b7280; font-weight: 600;
    }
    th:last-child { text-align: right; }
    td { padding: 12px 14px; border-bottom: 1px solid #f3f4f6; color: #111827; }
    td:last-child { text-align: right; font-weight: 600; }
    .total-row td {
      border-top: 2px solid #111827;
      border-bottom: none;
      font-size: 13px;
      font-weight: 700;
      padding-top: 14px;
    }

    /* ── Footer ── */
    .footer {
      margin-top: 40px;
      padding-top: 16px;
      border-top: 1px solid #e5e7eb;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .footer-note { font-size: 9px; color: #9ca3af; line-height: 1.6; }
    .footer-right { font-size: 9px; color: #d1d5db; text-align: right; }
  </style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div class="header">
    <div>
      <div class="brand-name">${companyName}</div>
      <div class="brand-sub">Payment Invoice</div>
    </div>
    <div class="invoice-id">
      <div class="label">Invoice Number</div>
      <div class="number">${invoiceNumber}</div>
      <span class="badge">${status.toUpperCase()}</span>
    </div>
  </div>

  <!-- Billing -->
  <div class="billing">
    <div class="billing-col">
      <div class="col-label">Bill To</div>
      <div class="col-name">${tenantName}</div>
      <div class="col-detail">${propertyAddress}</div>
    </div>
    <div class="billing-col">
      <div class="col-label">Payment Reference</div>
      <div class="col-detail">
        ${leaseNumber ? `Lease&nbsp;&nbsp;<strong>${leaseNumber}</strong><br>` : ''}
        ${period ? `Period&nbsp;&nbsp;<strong>${MONTHS[period.month - 1]} ${period.year}</strong><br>` : ''}
        ${dueDate ? `Due&nbsp;&nbsp;<strong>${fmtDate(dueDate)}</strong><br>` : ''}
        ${paidAt ? `Paid&nbsp;&nbsp;<strong>${fmtDate(paidAt)}</strong>` : ''}
      </div>
    </div>
  </div>

  <!-- Payment details -->
  <div class="section">
    <div class="section-title">Payment Details</div>
    <div class="detail-row"><span class="detail-key">Payment Type</span><span class="detail-value">${typeLabel}</span></div>
    <div class="detail-row"><span class="detail-key">Payment Method</span><span class="detail-value">${methodLabel}</span></div>
    <div class="detail-row"><span class="detail-key">Status</span><span class="detail-value">${status.toUpperCase()}</span></div>
    ${description ? `<div class="detail-row"><span class="detail-key">Notes</span><span class="detail-value">${description}</span></div>` : ''}
  </div>

  <!-- Amount breakdown -->
  <div class="section">
    <div class="section-title">Amount Breakdown</div>
    <table>
      <thead>
        <tr><th>Description</th><th>Amount</th></tr>
      </thead>
      <tbody>
        <tr><td>${typeLabel}</td><td>${fmt(baseAmount)}</td></tr>
        ${processingFee > 0 ? `<tr><td>Processing Fee</td><td>${fmt(processingFee)}</td></tr>` : ''}
        <tr class="total-row"><td>Total</td><td>${fmt(total)}</td></tr>
      </tbody>
    </table>
  </div>

  <!-- Footer -->
  <div class="footer">
    <div class="footer-note">
      This is a manually recorded payment — not processed via an online payment gateway.<br>
      Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.
    </div>
    <div class="footer-right">${invoiceNumber}</div>
  </div>

</div>
</body>
</html>`;
  }

  // ── Public: enqueue invoice generation ───────────────────────────────────────

  /**
   * Queue invoice PDF generation for a manual payment.
   * If the invoice was already generated, returns the cached URL immediately.
   */
  async requestInvoice(
    pytuid: string,
    cuid: string
  ): Promise<{ status: 'ready'; url: string } | { status: 'queued'; jobId: string | number }> {
    const payment = await this.paymentDAO.findFirst({ pytuid, cuid, deletedAt: null });
    if (!payment) throw new NotFoundError({ message: 'Payment not found' });
    if (!payment.isManualEntry) {
      throw new BadRequestError({
        message: 'Invoice only available for manually recorded payments',
      });
    }

    // Return cached URL if already generated
    if (payment.invoiceDocument?.url) {
      return { status: 'ready', url: payment.invoiceDocument.url };
    }

    const pdfQueue = this.queueFactory.getQueue('pdfGeneratorQueue') as PdfQueue;
    const job = await pdfQueue.addToPdfQueue({
      resource: {
        resourceId: pytuid,
        resourceName: RESOURCE_NAME,
        actorId: 'system',
        resourceType: 'document',
        fieldName: 'invoiceDocument',
      },
      cuid,
    });

    this.log.info('Invoice generation queued', { pytuid, cuid, jobId: job?.id });
    return { status: 'queued', jobId: job?.id ?? 'unknown' };
  }

  // ── Private: event listener setup ────────────────────────────────────────────

  /**
   * Register event handlers. Only activates in the worker process — Puppeteer
   * must not run inside the main API process.
   */
  private setupEventListeners(): void {
    if (process.env.PROCESS_TYPE !== 'worker') return;

    this.emitterService.on(
      EventTypes.PDF_GENERATION_REQUESTED,
      this.handlePdfGenerationRequest.bind(this)
    );
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));
  }

  // ── Private: generate PDF in worker ──────────────────────────────────────────
  private handlePdfGenerationRequest = async (
    payload: PdfGenerationRequestedPayload
  ): Promise<void> => {
    const { resource, cuid, jobId } = payload;

    if (resource.resourceName !== RESOURCE_NAME) return; // not ours

    this.log.info('Handling invoice PDF generation request', {
      jobId,
      pytuid: resource.resourceId,
      cuid,
    });

    try {
      const payment = await this.paymentDAO.findFirst(
        { pytuid: resource.resourceId, cuid, deletedAt: null },
        {
          populate: [
            { path: 'lease', select: 'leaseNumber property' },
            { path: 'tenant', select: 'personalInfo' },
          ],
        }
      );
      if (!payment) {
        this.log.warn('Invoice generation: payment not found', { pytuid: resource.resourceId });
        return;
      }

      const populated = payment as unknown as IPaymentPopulated;
      const lease = populated.lease;
      const tenant = populated.tenant;
      const tenantName =
        `${tenant?.personalInfo?.firstName || ''} ${tenant?.personalInfo?.lastName || ''}`.trim() ||
        'Tenant';
      const propertyAddress =
        typeof lease?.property?.address === 'string'
          ? lease.property.address
          : (lease?.property?.address as any)?.fullAddress || '—';

      const html = this.buildInvoiceHtml({
        invoiceNumber: payment.invoiceNumber,
        status: payment.status as string,
        tenantName,
        propertyAddress,
        leaseNumber: lease?.leaseNumber,
        paymentType: payment.paymentType as string,
        paymentMethod: payment.paymentMethod as string,
        period: payment.period,
        dueDate: payment.dueDate,
        paidAt: payment.paidAt,
        baseAmount: payment.baseAmount,
        processingFee: payment.processingFee,
        currency: payment.currency,
        description: payment.description,
      });

      const result = await this.pdfGeneratorService.generatePdf(html, {
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
        displayHeaderFooter: false,
      });

      if (!result.success || !result.buffer) {
        this.log.error('Invoice PDF generation failed', { pytuid: resource.resourceId });
        this.emitterService.emit(EventTypes.PDF_GENERATION_FAILED, {
          jobId,
          resourceId: resource.resourceId,
          error: 'PDF generation failed',
        });
        return;
      }

      // Fire-and-forget upload — UPLOAD_COMPLETED will update the payment record
      this.mediaUploadService
        .handleBuffer(result.buffer, `invoice-${payment.invoiceNumber}.pdf`, {
          primaryResourceId: resource.resourceId,
          uploadedBy: resource.actorId,
          resourceContext: ResourceContext.PAYMENT,
          fieldName: 'invoiceDocument',
        })
        .catch((err) => {
          this.log.error(
            { error: err, pytuid: resource.resourceId },
            'Failed to queue invoice PDF buffer for upload'
          );
        });

      this.log.info('Invoice PDF generated, upload queued', {
        pytuid: resource.resourceId,
        fileSize: result.metadata?.fileSize,
      });
    } catch (error) {
      this.log.error('Error handling invoice generation request', {
        error: error instanceof Error ? error.message : String(error),
        pytuid: resource.resourceId,
      });
    }
  };

  // ── Private: handle S3 upload completion ─────────────────────────────────────
  private handleUploadCompleted = async (payload: UploadCompletedPayload): Promise<void> => {
    if (payload.resourceName !== RESOURCE_NAME) return;

    const { results, resourceId: pytuid } = payload;
    const pdfResult = results.find((r) => r.url && r.key);
    if (!pdfResult) {
      this.log.warn('Invoice upload completed but no PDF result found', { pytuid });
      return;
    }

    try {
      await this.paymentDAO.update(
        { pytuid },
        {
          $set: {
            invoiceDocument: {
              url: pdfResult.url,
              key: pdfResult.key,
              generatedAt: new Date(),
            },
          },
        }
      );

      this.emitterService.emit(EventTypes.INVOICE_GENERATED, {
        jobId: 'upload-completed',
        pytuid,
        cuid: '',
        invoiceUrl: pdfResult.url,
        s3Key: pdfResult.key ?? '',
        fileSize: pdfResult.size,
      } as InvoiceGeneratedPayload);

      this.log.info('Invoice document URL saved to payment record', { pytuid, url: pdfResult.url });
    } catch (error) {
      this.log.error('Error saving invoice document URL', {
        error: error instanceof Error ? error.message : String(error),
        pytuid,
      });
    }
  };

  private handleUploadFailed = (payload: UploadFailedPayload): void => {
    this.log.error('Invoice PDF upload failed', { resourceId: payload.resourceId });
  };
}
