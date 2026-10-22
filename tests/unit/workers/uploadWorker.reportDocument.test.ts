import { jest } from '@jest/globals';
import { EventTypes } from '@interfaces/index';
import { UploadWorker } from '@workers/upload.worker';
import { PropertyMediaService } from '@services/property/propertyMedia.service';

const mockS3Service = {
  uploadFiles: jest.fn() as any,
  deleteFiles: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
  on: jest.fn() as any,
};

const mockInspectionService = {
  updateReportDocument: jest.fn() as any,
};

const mockSseService = {
  broadcastToClient: jest.fn() as any,
  sendToUser: jest.fn() as any,
};

const CUID = 'test-client-cuid';
const IUID = 'insp-iuid-1';
const RESOURCE_ID = 'insp-abc123';
const ACTOR_ID = 'user-actor-id';

const makeJob = (overrides: Record<string, any> = {}) => {
  const baseResource = {
    resourceName: 'inspection',
    resourceType: 'document',
    resourceId: RESOURCE_ID,
    fieldName: 'reportDocument',
    actorId: ACTOR_ID,
    ...overrides.resource,
  };

  // Upload jobs carry S3 results only (UploadJobData); each test sets job.data.results
  return {
    data: {
      resource: baseResource,
      results: (overrides.results ?? []) as any[],
    },
    progress: jest.fn() as any,
  };
};

const makeUploadResult = (overrides: Record<string, any> = {}) => ({
  mediatype: 'document',
  documentName: 'report.pdf',
  resourceName: 'inspection',
  resourceId: RESOURCE_ID,
  fieldName: 'reportDocument',
  publicuid: 'pub-123',
  mimeType: 'application/pdf',
  filename: 'report.pdf',
  size: 204800,
  key: 'inspection/report_123.pdf',
  url: 'https://s3.example.com/report.pdf',
  ...overrides,
});

let worker: UploadWorker;

beforeEach(() => {
  jest.clearAllMocks();

  worker = new UploadWorker({
    s3Service: mockS3Service as any,
    emitterService: mockEmitterService as any,
    inspectionService: mockInspectionService as any,
    sseService: mockSseService as any,
  });
});

describe('UploadWorker — inspection report document dispatch', () => {
  it('saves the report, then broadcasts report-ready to the whole client', async () => {
    const job = makeJob();
    const uploadResult = makeUploadResult();
    job.data.results = [uploadResult];
    mockInspectionService.updateReportDocument.mockReturnValue(
      Promise.resolve({ cuid: CUID, iuid: IUID })
    );
    mockSseService.broadcastToClient.mockReturnValue(Promise.resolve());

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).toHaveBeenCalledWith(
      RESOURCE_ID,
      uploadResult
    );
    expect(mockSseService.broadcastToClient).toHaveBeenCalledWith(
      CUID,
      { resource: 'inspection', action: 'report-ready', resourceUId: IUID },
      'resource-event'
    );
    expect(mockSseService.sendToUser).not.toHaveBeenCalled();
  });

  it('should skip inspection report dispatch when resourceName is not "inspection"', async () => {
    const job = makeJob({ resource: { resourceName: 'lease' } });
    job.data.results = [makeUploadResult()];

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
  });

  it('should skip inspection report dispatch when fieldName is not "reportDocument"', async () => {
    const job = makeJob({ resource: { fieldName: 'roomMedia' } });
    job.data.results = [makeUploadResult()];

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
    expect(mockSseService.broadcastToClient).not.toHaveBeenCalled();
  });

  it('should skip when no upload result has both key and url', async () => {
    const job = makeJob();
    const uploadResult = makeUploadResult({ key: undefined });
    job.data.results = [uploadResult];

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
    expect(mockSseService.broadcastToClient).not.toHaveBeenCalled();
  });

  it('should not throw when SSE broadcast fails (non-fatal)', async () => {
    const job = makeJob();
    const uploadResult = makeUploadResult();
    job.data.results = [uploadResult];
    mockInspectionService.updateReportDocument.mockReturnValue(
      Promise.resolve({ cuid: CUID, iuid: IUID })
    );
    mockSseService.broadcastToClient.mockReturnValue(
      Promise.reject(new Error('SSE connection lost'))
    );

    await expect(worker.uploadAsset(job as any)).resolves.not.toThrow();

    expect(mockInspectionService.updateReportDocument).toHaveBeenCalledWith(
      RESOURCE_ID,
      uploadResult
    );
  });

  it('should skip SSE broadcast when the inspection was not found', async () => {
    const job = makeJob();
    job.data.results = [makeUploadResult()];
    mockInspectionService.updateReportDocument.mockReturnValue(Promise.resolve(null));

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).toHaveBeenCalled();
    expect(mockSseService.broadcastToClient).not.toHaveBeenCalled();
  });
});

describe('UploadWorker — generated lease and invoice PDFs', () => {
  it('hands the results to the UPLOAD_COMPLETED listeners that save them', async () => {
    const results = [makeUploadResult({ resourceName: 'lease', fieldName: 'document' })];
    const job = makeJob({ resource: { resourceName: 'lease', fieldName: 'document' } });
    job.data.results = results;

    await worker.uploadAsset(job as any);

    expect(mockEmitterService.emit).toHaveBeenCalledWith(
      EventTypes.UPLOAD_COMPLETED,
      expect.objectContaining({ resourceName: 'lease', resourceId: RESOURCE_ID, results })
    );
    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
  });

  it('never uploads to S3 itself — the files arrive already uploaded', async () => {
    const job = makeJob();
    job.data.results = [makeUploadResult()];
    mockInspectionService.updateReportDocument.mockReturnValue(Promise.resolve(null));

    await worker.uploadAsset(job as any);

    expect(mockS3Service.uploadFiles).not.toHaveBeenCalled();
  });

  it('should reject a job with no upload results', async () => {
    const job = makeJob();
    job.data.results = [];

    await expect(worker.uploadAsset(job as any)).rejects.toThrow('No upload results to persist');
    expect(mockEmitterService.emit).not.toHaveBeenCalled();
  });
});

describe('PropertyMediaService — upload event listeners', () => {
  it('should not persist on UPLOAD_COMPLETED, since property uploads are saved in the request', () => {
    const emitterService = { on: jest.fn() as any, off: jest.fn() as any };

    new PropertyMediaService({
      propertyDAO: {} as any,
      mediaUploadService: {} as any,
      emitterService: emitterService as any,
    }).registerEventListeners();

    const registeredEvents = emitterService.on.mock.calls.map((call: any[]) => call[0]);
    expect(registeredEvents).not.toContain(EventTypes.UPLOAD_COMPLETED);
    expect(registeredEvents).toContain(EventTypes.UPLOAD_FAILED);
  });
});

describe('UploadWorker — remote asset removal', () => {
  const makeRemovalJob = (data: unknown) => ({ data: { data } });

  it('should delete every queued key in one bulk call', async () => {
    const s3Keys = ['property/a_1.jpg', 'property/b_2.jpg'];
    mockS3Service.deleteFiles.mockReturnValue(Promise.resolve(true));

    await worker.deleteAsset(makeRemovalJob(s3Keys) as any);

    expect(mockS3Service.deleteFiles).toHaveBeenCalledWith(s3Keys);
  });

  it('should reject when there are no keys to delete', async () => {
    await expect(worker.deleteAsset(makeRemovalJob([]) as any)).rejects.toThrow(
      'No remote data-asset to delete.'
    );
    expect(mockS3Service.deleteFiles).not.toHaveBeenCalled();
  });

  it('should reject when S3 reports a failed deletion so the job is retried', async () => {
    mockS3Service.deleteFiles.mockReturnValue(Promise.resolve(false));

    await expect(worker.deleteAsset(makeRemovalJob(['property/a_1.jpg']) as any)).rejects.toThrow(
      'Remote asset deletion failed'
    );
  });
});
