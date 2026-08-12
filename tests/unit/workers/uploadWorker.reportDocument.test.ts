import { jest } from '@jest/globals';
import { UploadWorker } from '@workers/upload.worker';
import { EventTypes } from '@interfaces/index';

// ─── Mock Dependencies ─────────────────────────────────────────────────────

const mockS3Service = {
  uploadFiles: jest.fn() as any,
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

  const baseFiles = overrides.files ?? [
    {
      originalFileName: 'report.pdf',
      fieldName: 'reportDocument',
      mimeType: 'application/pdf',
      path: '/tmp/report.pdf',
      filename: 'report.pdf',
      fileSize: 204800,
      status: 'pending' as const,
      uploadedAt: new Date(),
    },
  ];

  return {
    data: {
      resource: baseResource,
      files: baseFiles,
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
    inspectionService: mockInspectionService as any,
    sseService: mockSseService as any,
  });
});

describe('UploadWorker — inspection report document dispatch', () => {
  it('should call updateReportDocument and broadcast SSE on successful report upload', async () => {
    const job = makeJob();
    const uploadResult = makeUploadResult();
    mockS3Service.uploadFiles.mockReturnValue(Promise.resolve([uploadResult]));
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
    mockS3Service.uploadFiles.mockReturnValue(Promise.resolve([uploadResult]));
    mockMaintenanceRequestService.persistUploadedMedia.mockReturnValue(Promise.resolve(CUID));
    mockSseService.sendToUser.mockReturnValue(Promise.resolve());

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
  });

  it('should skip inspection report dispatch when fieldName is not "reportDocument"', async () => {
    const job = makeJob({ resource: { fieldName: 'roomMedia' } });
    const uploadResult = makeUploadResult();
    mockS3Service.uploadFiles.mockReturnValue(Promise.resolve([uploadResult]));
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
    mockS3Service.uploadFiles.mockReturnValue(Promise.resolve([uploadResult]));

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).not.toHaveBeenCalled();
    expect(mockSseService.broadcastToClient).not.toHaveBeenCalled();
  });

  it('should not throw when SSE broadcast fails (non-fatal)', async () => {
    const job = makeJob();
    const uploadResult = makeUploadResult();
    mockS3Service.uploadFiles.mockReturnValue(Promise.resolve([uploadResult]));
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
    mockS3Service.uploadFiles.mockReturnValue(Promise.resolve([uploadResult]));
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
    mockS3Service.uploadFiles.mockReturnValue(Promise.resolve([uploadResult]));
    mockInspectionService.updateReportDocument.mockReturnValue(Promise.resolve(null));

    await worker.uploadAsset(job as any);

    expect(mockInspectionService.updateReportDocument).toHaveBeenCalled();
    expect(mockSseService.broadcastToClient).not.toHaveBeenCalled();
  });
});
