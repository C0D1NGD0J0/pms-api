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

const mockMaintenanceRequestService = {
  persistUploadedMedia: jest.fn() as any,
};

const mockInspectionService = {
  updateReportDocument: jest.fn() as any,
  persistUploadedMedia: jest.fn() as any,
};

const mockPropertyMediaService = {
  updatePropertyDocuments: jest.fn() as any,
};

const mockSseService = {
  broadcastToClient: jest.fn() as any,
  sendToUser: jest.fn() as any,
};

const CUID = 'test-client-cuid';
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
    maintenanceRequestService: mockMaintenanceRequestService as any,
    propertyMediaService: mockPropertyMediaService as any,
    inspectionService: mockInspectionService as any,
    sseService: mockSseService as any,
  });
});

describe('UploadWorker — inspection report document dispatch', () => {
  it('should call updateReportDocument and broadcast SSE on successful report upload', async () => {
    const job = makeJob();
    const uploadResult = makeUploadResult();
    job.data.results = [uploadResult];
    mockInspectionService.updateReportDocument.mockReturnValue(Promise.resolve(CUID));
    mockSseService.broadcastToClient.mockReturnValue(Promise.resolve());

    await worker.uploadAsset(job as any);

    // Verify updateReportDocument was called with correct args
    expect(mockInspectionService.updateReportDocument).toHaveBeenCalledWith(
      RESOURCE_ID,
      uploadResult
    );

    // Verify SSE broadcast was called with correct payload
    expect(mockSseService.broadcastToClient).toHaveBeenCalledWith(
      CUID,
      { resource: 'inspection', action: 'report-ready' },
      'resource-event'
    );

    // Verify persistUploadedMedia was NOT called (reportDocument != room media)
    expect(mockInspectionService.persistUploadedMedia).not.toHaveBeenCalled();
  });

  it('should skip inspection report dispatch when resourceName is not "inspection"', async () => {
    const job = makeJob({ resource: { resourceName: 'maintenance' } });
    const uploadResult = makeUploadResult();
    job.data.results = [uploadResult];
    mockMaintenanceRequestService.persistUploadedMedia.mockReturnValue(Promise.resolve(CUID));
    mockSseService.sendToUser.mockReturnValue(Promise.resolve());

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
  });

  it('should skip inspection report dispatch when fieldName is not "reportDocument"', async () => {
    const job = makeJob({ resource: { fieldName: 'roomMedia' } });
    const uploadResult = makeUploadResult();
    job.data.results = [uploadResult];
    mockInspectionService.persistUploadedMedia.mockReturnValue(Promise.resolve(CUID));
    mockSseService.sendToUser.mockReturnValue(Promise.resolve());

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
    // Room media path should be invoked instead
    expect(mockInspectionService.persistUploadedMedia).toHaveBeenCalled();
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
    mockInspectionService.updateReportDocument.mockReturnValue(Promise.resolve(CUID));
    mockSseService.broadcastToClient.mockReturnValue(
      Promise.reject(new Error('SSE connection lost'))
    );

    // Should not throw despite SSE failure
    await expect(worker.uploadAsset(job as any)).resolves.not.toThrow();

    // updateReportDocument should still have been called
    expect(mockInspectionService.updateReportDocument).toHaveBeenCalledWith(
      RESOURCE_ID,
      uploadResult
    );
  });

  it('should not interfere with room media uploads (fieldName !== "reportDocument")', async () => {
    const job = makeJob({
      resource: { fieldName: 'roomMedia', roomIndex: 2 },
    });
    const uploadResult = makeUploadResult({ fieldName: 'roomMedia' });
    job.data.results = [uploadResult];
    mockInspectionService.persistUploadedMedia.mockReturnValue(Promise.resolve(CUID));
    mockSseService.sendToUser.mockReturnValue(Promise.resolve());

    await worker.uploadAsset(job as any);

    // Report document path should NOT be triggered
    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
    expect(mockSseService.broadcastToClient).not.toHaveBeenCalled();

    // Room media path SHOULD be triggered
    expect(mockInspectionService.persistUploadedMedia).toHaveBeenCalledWith(
      RESOURCE_ID,
      [uploadResult],
      ACTOR_ID,
      2
    );

    // SSE sendToUser for room media should be triggered
    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      ACTOR_ID,
      CUID,
      {
        resource: 'inspection',
        action: 'media-updated',
        resourceUId: RESOURCE_ID,
        count: 1,
      },
      'resource-event'
    );
  });

  it('should skip SSE broadcast when updateReportDocument returns null', async () => {
    const job = makeJob();
    const uploadResult = makeUploadResult();
    job.data.results = [uploadResult];
    mockInspectionService.updateReportDocument.mockReturnValue(Promise.resolve(null));

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).toHaveBeenCalled();
    expect(mockSseService.broadcastToClient).not.toHaveBeenCalled();
  });
});

describe('UploadWorker — property media dispatch', () => {
  const PROPERTY_PID = 'prop-pid-123';

  const makePropertyJob = (overrides: Record<string, any> = {}) =>
    makeJob({
      resource: {
        resourceName: 'property',
        resourceId: PROPERTY_PID,
        fieldName: 'images',
        ...overrides,
      },
    });

  const makePropertyUploadResult = (overrides: Record<string, any> = {}) =>
    makeUploadResult({
      mediatype: 'image',
      resourceName: 'property',
      resourceId: PROPERTY_PID,
      fieldName: 'images',
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      key: 'property/photo_123.jpg',
      url: 'https://s3.example.com/photo.jpg',
      ...overrides,
    });

  it('should call updatePropertyDocuments on successful property image upload', async () => {
    const job = makePropertyJob();
    const uploadResult = makePropertyUploadResult();
    job.data.results = [uploadResult];
    mockPropertyMediaService.updatePropertyDocuments.mockReturnValue(
      Promise.resolve({ success: true })
    );

    await worker.uploadAsset(job as any);

    expect(mockPropertyMediaService.updatePropertyDocuments).toHaveBeenCalledWith(
      PROPERTY_PID,
      [uploadResult],
      ACTOR_ID
    );
  });

  it('should not call property persistence for non-property resources', async () => {
    const job = makeJob({ resource: { resourceName: 'maintenance' } });
    const uploadResult = makeUploadResult();
    job.data.results = [uploadResult];
    mockMaintenanceRequestService.persistUploadedMedia.mockReturnValue(Promise.resolve(CUID));
    mockSseService.sendToUser.mockReturnValue(Promise.resolve());

    await worker.uploadAsset(job as any);

    expect(mockPropertyMediaService.updatePropertyDocuments).not.toHaveBeenCalled();
  });

  it('should reject a job with no upload results and persist nothing', async () => {
    const job = makePropertyJob();
    job.data.results = [];

    await expect(worker.uploadAsset(job as any)).rejects.toThrow('No upload results to persist');

    expect(mockPropertyMediaService.updatePropertyDocuments).not.toHaveBeenCalled();
  });

  it('never uploads to S3 itself — the files arrive already uploaded', async () => {
    const job = makePropertyJob();
    job.data.results = [makePropertyUploadResult()];
    mockPropertyMediaService.updatePropertyDocuments.mockReturnValue(
      Promise.resolve({ success: true })
    );

    await worker.uploadAsset(job as any);

    expect(mockS3Service.uploadFiles).not.toHaveBeenCalled();
  });

  it('should handle property document uploads', async () => {
    const job = makePropertyJob({ fieldName: 'documents' });
    const uploadResult = makePropertyUploadResult({
      fieldName: 'documents',
      mediatype: 'document',
      mimeType: 'application/pdf',
      filename: 'deed.pdf',
    });
    job.data.results = [uploadResult];
    mockPropertyMediaService.updatePropertyDocuments.mockReturnValue(
      Promise.resolve({ success: true })
    );

    await worker.uploadAsset(job as any);

    expect(mockPropertyMediaService.updatePropertyDocuments).toHaveBeenCalledWith(
      PROPERTY_PID,
      [uploadResult],
      ACTOR_ID
    );
  });
});

describe('PropertyMediaService — upload event listeners', () => {
  it('should not persist on UPLOAD_COMPLETED, since the worker already persists directly', () => {
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
