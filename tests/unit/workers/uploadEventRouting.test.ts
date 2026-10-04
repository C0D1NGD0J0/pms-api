import { EventTypes } from '@interfaces/index';
import { UploadWorker } from '@workers/upload.worker';
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
      maintenanceRequestService: {
        persistUploadedMedia: jest.fn().mockRejectedValue(new Error('DB down')),
      } as any,
      propertyMediaService: {} as any,
      inspectionService: {} as any,
      sseService: {} as any,
    });

    await expect(
      worker.uploadAsset({
        data: {
          resource: { resourceName: 'maintenance', resourceId: 'MR1', actorId: 'A1' },
          results: [{ key: 'maintenance/a.jpg', url: 'https://s3/a.jpg', filename: 'a.jpg' }],
        },
        progress: jest.fn(),
      } as any)
    ).rejects.toThrow('DB down');

    expect(emitterService.emit).toHaveBeenCalledWith(
      EventTypes.UPLOAD_FAILED,
      expect.objectContaining({ resourceName: 'maintenance', resourceId: 'MR1' })
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
