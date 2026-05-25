import Logger from 'bunyan';
import { PaymentDAO } from '@dao/index';
import { PdfQueue } from '@queues/index';
import { createLogger } from '@utils/index';
import { QueueFactory } from '@services/queue';
import { MoneyUtils } from '@utils/money.utils';
import { EventEmitterService } from '@services/index';
import { SSEService } from '@services/sse/sse.service';
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

import { InvoiceTemplateRenderer, InvoiceRenderData } from './invoiceTemplateRenderer';

/**
 * @deprecated Use `InvoiceRenderData` from `invoiceTemplateRenderer` instead.
 * Kept for backward compatibility — will be removed in a future release.
 */
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
  invoiceTemplateRenderer: InvoiceTemplateRenderer;
  pdfGeneratorService: PdfGeneratorService;
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  queueFactory: QueueFactory;
  sseService: SSEService;
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

const RESOURCE_NAME = 'payment-invoice';

export class InvoiceService {
  private readonly log: Logger;
  private readonly paymentDAO: PaymentDAO;
  private readonly queueFactory: QueueFactory;
  private readonly sseService: SSEService;
  private readonly emitterService: EventEmitterService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly invoiceTemplateRenderer: InvoiceTemplateRenderer;

  constructor({
    invoiceTemplateRenderer,
    pdfGeneratorService,
    mediaUploadService,
    emitterService,
    sseService,
    queueFactory,
    paymentDAO,
  }: IConstructor) {
    this.log = createLogger('InvoiceService');
    this.invoiceTemplateRenderer = invoiceTemplateRenderer;
    this.pdfGeneratorService = pdfGeneratorService;
    this.mediaUploadService = mediaUploadService;
    this.emitterService = emitterService;
    this.sseService = sseService;
    this.queueFactory = queueFactory;
    this.paymentDAO = paymentDAO;
    this.setupEventListeners();
  }

  /**
   * Converts legacy `InvoiceTemplateData` into the generic `InvoiceRenderData`
   * and renders it via the shared EJS template.
   *
   * Other services should call `invoiceTemplateRenderer.render()` directly
   * with their own `InvoiceRenderData`.
   */
  async buildInvoiceHtml(data: InvoiceTemplateData): Promise<string> {
    const fmt = (cents: number) => `${data.currency} ${MoneyUtils.centsToDisplay(cents)}`;
    const fmtDate = (d: Date) =>
      d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

    const total = data.baseAmount + (data.processingFee ?? 0);

    const referenceEntries: { key: string; value: string }[] = [];
    if (data.leaseNumber) referenceEntries.push({ key: 'Lease', value: data.leaseNumber });
    if (data.period)
      referenceEntries.push({
        key: 'Period',
        value: `${MONTHS[data.period.month - 1]} ${data.period.year}`,
      });
    if (data.dueDate) referenceEntries.push({ key: 'Due', value: fmtDate(data.dueDate) });
    if (data.paidAt) referenceEntries.push({ key: 'Paid', value: fmtDate(data.paidAt) });

    const details: { key: string; value: string }[] = [
      { key: 'Payment Type', value: titleCase(data.paymentType) },
      { key: 'Payment Method', value: titleCase(data.paymentMethod) },
      { key: 'Status', value: data.status.toUpperCase() },
    ];
    if (data.description) details.push({ key: 'Notes', value: data.description });

    const lineItems = [{ description: titleCase(data.paymentType), amount: fmt(data.baseAmount) }];
    if (data.processingFee && data.processingFee > 0) {
      lineItems.push({ description: 'Processing Fee', amount: fmt(data.processingFee) });
    }

    const subtotals =
      data.processingFee && data.processingFee > 0
        ? [{ label: 'Subtotal', amount: fmt(data.baseAmount) }]
        : [];

    const renderData: InvoiceRenderData = {
      companyName: data.companyName ?? 'Property Management',
      documentTitle: 'Payment Invoice',
      invoiceNumber: data.invoiceNumber,
      statusLabel: data.status.toUpperCase(),
      statusKey: data.status.toLowerCase(),
      billTo: {
        label: 'Bill To',
        name: data.tenantName,
        address: data.propertyAddress,
      },
      reference: {
        label: 'Payment Reference',
        entries: referenceEntries,
      },
      details,
      detailsTitle: 'Payment Details',
      lineItems,
      lineItemsTitle: 'Amount Breakdown',
      subtotals,
      totalAmount: fmt(total),
      footerNote: `Generated on ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}.`,
    };

    return this.invoiceTemplateRenderer.render(renderData);
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

      const html = await this.buildInvoiceHtml({
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
      const updatedPayment = await this.paymentDAO.update(
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

      if (updatedPayment?.cuid && payload.actorId) {
        try {
          await this.sseService.sendToUser(
            payload.actorId,
            updatedPayment.cuid,
            { resource: 'invoice', action: 'document-attached', resourceUId: pytuid },
            'resource-event'
          );
        } catch (sseErr) {
          this.log.warn({ sseErr }, '[InvoiceService] SSE notify failed (non-fatal)');
        }
      }

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
    if (payload.resourceType !== RESOURCE_NAME) return;
    this.log.error('Invoice PDF upload failed', { resourceId: payload.resourceId });
  };
}
