import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/index';
import { UploadWorker } from '@workers/upload.worker';
import { InvoiceService } from '@services/invoice/invoice.service';
import { LeasePdfService } from '@services/lease/leasePdf.service';
import { mockSubscriptionService } from '@tests/setup/externalMocks';
import { PropertyMediaService } from '@services/property/propertyMedia.service';

/** Emitter mock that keeps the last handler registered per event, so tests can fire it. */
const makeEmitter = () => {
  const handlers: Record<string, (payload: any) => any> = {};
  return {
    handlers,
    emit: jest.fn(),
    on: jest.fn((event: string, handler: (payload: any) => any) => {
      handlers[event] = handler;
    }),
  };
};

const uploadFailed = (resourceName: string) => ({
  error: { message: 'S3 down' },
  resourceType: 'document',
  resourceName,
  resourceId: 'RESOURCE-1',
});

describe('UploadWorker — UPLOAD_FAILED payload', () => {
  it('includes resourceName so listeners can tell whose upload failed', async () => {
    const emitterService = makeEmitter();
    const worker = new UploadWorker({
      s3Service: {} as any,
      emitterService: emitterService as any,
      inspectionService: {
        updateReportDocument: jest.fn().mockRejectedValue(new Error('DB down')),
      } as any,
      sseService: {} as any,
    });

    await expect(
      worker.uploadAsset({
        data: {
          resource: {
            resourceName: 'inspection',
            resourceId: 'INS1',
            fieldName: 'reportDocument',
            actorId: 'A1',
          },
          results: [{ key: 'inspection/r.pdf', url: 'https://s3/r.pdf', filename: 'r.pdf' }],
        },
        progress: jest.fn(),
      } as any)
    ).rejects.toThrow('DB down');

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.UPLOAD_FAILED,
      expect.objectContaining({ resourceName: 'inspection', resourceId: 'INS1' })
    );
  });
});

describe('LeasePdfService — event routing', () => {
  const makeService = () => {
    const emitterService = makeEmitter();
    const service = new LeasePdfService({
      subscriptionService: mockSubscriptionService as any,
      clientDAO: {} as any,
      emitterService: emitterService as any,
      leaseTemplateService: {} as any,
      sseService: {} as any,
      leaseCache: {} as any,
      leaseDAO: {} as any,
      mediaUploadService: {} as any,
      notificationService: {} as any,
      pdfGeneratorService: {} as any,
      profileDAO: {} as any,
      propertyDAO: {} as any,
      queueFactory: {} as any,
    });
    service.registerEventListeners();
    const markFailed = jest
      .spyOn(service as any, 'markLeaseDocumentsAsFailed')
      .mockResolvedValue(undefined);
    const generate = jest
      .spyOn(service as any, 'generateLeasePDF')
      .mockResolvedValue({ success: false });
    return { handlers: emitterService.handlers, markFailed, generate };
  };

  it('ignores PDF requests for invoices, which InvoiceService renders', async () => {
    const { handlers, generate } = makeService();

    await handlers[EventTypes.PDF_GENERATION_REQUESTED]({
      jobId: 1,
      cuid: 'C1',
      resource: { resourceName: 'payment-invoice', resourceId: 'PYT1' },
    });

    expect(generate).not.toHaveBeenCalled();
  });

  it('renders PDF requests for leases', async () => {
    const { handlers, generate } = makeService();

    await handlers[EventTypes.PDF_GENERATION_REQUESTED]({
      jobId: 1,
      cuid: 'C1',
      resource: { resourceName: 'lease', resourceId: 'L1' },
    });

    expect(generate).toHaveBeenCalledWith('C1', 'L1', undefined);
  });

  it('marks lease documents failed only for lease upload failures', async () => {
    const { handlers, markFailed } = makeService();

    await handlers[EventTypes.UPLOAD_FAILED](uploadFailed('property'));
    expect(markFailed).not.toHaveBeenCalled();

    await handlers[EventTypes.UPLOAD_FAILED](uploadFailed('lease'));
    expect(markFailed).toHaveBeenCalledWith('RESOURCE-1', 'S3 down');
  });
});

describe('PropertyMediaService — UPLOAD_FAILED routing', () => {
  it('marks property documents failed only for property upload failures', async () => {
    const emitterService = makeEmitter();
    const service = new PropertyMediaService({
      propertyDAO: {} as any,
      mediaUploadService: {} as any,
      emitterService: emitterService as any,
    });
    service.registerEventListeners();
    const markFailed = jest.spyOn(service, 'markDocumentsAsFailed').mockResolvedValue(undefined);

    await emitterService.handlers[EventTypes.UPLOAD_FAILED](uploadFailed('lease'));
    expect(markFailed).not.toHaveBeenCalled();

    await emitterService.handlers[EventTypes.UPLOAD_FAILED](uploadFailed('property'));
    expect(markFailed).toHaveBeenCalledWith('RESOURCE-1', 'S3 down');
  });
});

// Generated files are saved by the worker process, after the request that asked for them has
// returned — so the save refreshes caches and tells the whole client, not only the requester.
describe('Generated PDFs — cache refresh and client-wide notification', () => {
  const pdfResult = { key: 'lease/agreement.pdf', url: 'https://s3/agreement.pdf' };

  it('a saved lease PDF invalidates the lease caches and broadcasts document-added', async () => {
    const emitterService = makeEmitter();
    const lease = { _id: new Types.ObjectId(), luid: 'L1', cuid: 'C1', status: 'draft' };
    const leaseDAO = {
      findFirst: jest.fn().mockResolvedValue(lease),
      updateLeaseDocuments: jest.fn().mockResolvedValue({ ...lease, leaseDocuments: [{}] }),
    };
    const leaseCache = {
      invalidateLease: jest.fn().mockResolvedValue({ success: true }),
      invalidateLeaseLists: jest.fn().mockResolvedValue({ success: true }),
    };
    const sseService = {
      broadcastToClient: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn(),
    };
    new LeasePdfService({
      subscriptionService: mockSubscriptionService as any,
      clientDAO: {} as any,
      emitterService: emitterService as any,
      leaseTemplateService: {} as any,
      sseService: sseService as any,
      leaseCache: leaseCache as any,
      leaseDAO: leaseDAO as any,
      mediaUploadService: {} as any,
      notificationService: {} as any,
      pdfGeneratorService: {} as any,
      profileDAO: {} as any,
      propertyDAO: {} as any,
      queueFactory: {} as any,
    }).registerEventListeners();

    await emitterService.handlers[EventTypes.UPLOAD_COMPLETED]({
      results: [pdfResult],
      actorId: new Types.ObjectId().toString(),
      resourceType: 'document',
      resourceName: 'lease',
      resourceId: lease._id.toString(),
      fieldName: 'document',
    });

    expect(leaseDAO.updateLeaseDocuments).toHaveBeenCalled();
    expect(leaseCache.invalidateLease).toHaveBeenCalledWith('C1', 'L1');
    expect(leaseCache.invalidateLeaseLists).toHaveBeenCalledWith('C1');
    expect(sseService.broadcastToClient).toHaveBeenCalledWith(
      'C1',
      { resource: 'lease', action: 'document-added', resourceUId: 'L1' },
      'resource-event'
    );
    expect(sseService.sendToUser).not.toHaveBeenCalled();
  });

  it('a saved invoice PDF broadcasts document-attached to the client (its actor is "system")', async () => {
    const emitterService = makeEmitter();
    const paymentDAO = { update: jest.fn().mockResolvedValue({ pytuid: 'PYT1', cuid: 'C1' }) };
    const sseService = {
      broadcastToClient: jest.fn().mockResolvedValue(undefined),
      sendToUser: jest.fn(),
    };
    new InvoiceService({
      paymentDAO: paymentDAO as any,
      queueFactory: {} as any,
      pdfGeneratorService: {} as any,
      mediaUploadService: {} as any,
      invoiceTemplateRenderer: {} as any,
      emitterService: emitterService as any,
      sseService: sseService as any,
    }).registerEventListeners();

    await emitterService.handlers[EventTypes.UPLOAD_COMPLETED]({
      results: [{ key: 'payment-invoice/i.pdf', url: 'https://s3/i.pdf' }],
      actorId: 'system',
      resourceType: 'document',
      resourceName: 'payment-invoice',
      resourceId: 'PYT1',
      fieldName: 'invoiceDocument',
    });

    expect(paymentDAO.update).toHaveBeenCalledWith(
      { pytuid: 'PYT1' },
      { $set: { invoiceDocument: expect.objectContaining({ key: 'payment-invoice/i.pdf' }) } }
    );
    expect(sseService.broadcastToClient).toHaveBeenCalledWith(
      'C1',
      { resource: 'invoice', action: 'document-attached', resourceUId: 'PYT1' },
      'resource-event'
    );
    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.INVOICE_GENERATED,
      expect.objectContaining({ pytuid: 'PYT1', cuid: 'C1' })
    );
    expect(sseService.sendToUser).not.toHaveBeenCalled();
  });
});
