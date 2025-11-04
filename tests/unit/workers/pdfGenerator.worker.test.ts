import { Job } from 'bull';
import { PdfWorker } from '@workers/pdfGenerator.worker';
import { EventEmitterService } from '@services/index';
import { PdfJobData } from '@interfaces/pdfGenerator.interface';
import { EventTypes } from '@interfaces/events.interface';

describe('PdfWorker', () => {
  let pdfWorker: PdfWorker;
  let mockEmitterService: jest.Mocked<EventEmitterService>;
  let mockJob: jest.Mocked<Job<PdfJobData>>;

  beforeEach(() => {
    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    pdfWorker = new PdfWorker({ emitterService: mockEmitterService });

    mockJob = {
      id: '123',
      progress: jest.fn(),
      data: {
        resource: {
          resourceId: '507f1f77bcf86cd799439011',
          resourceName: 'lease',
          actorId: '507f1f77bcf86cd799439012',
          resourceType: 'document',
          fieldName: 'leaseDocument',
        },
        cuid: 'MMQHHVX09JJT',
        templateType: 'residential-single-family',
      },
    } as any;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('generatePdf', () => {
    it('should update job progress', async () => {
      // Mock event to resolve immediately
      let resolvePromise: any;
      const promise = new Promise((resolve) => {
        resolvePromise = resolve;
      });

      mockEmitterService.on.mockImplementation((event, listener) => {
        if (event === EventTypes.PDF_GENERATED) {
          setTimeout(() => {
            listener({
              jobId: mockJob.id,
              leaseId: mockJob.data.resource.resourceId,
              pdfUrl: 'https://s3.amazonaws.com/test.pdf',
              s3Key: 'lease_123.pdf',
            });
            resolvePromise();
          }, 10);
        }
      });

      pdfWorker.generatePdf(mockJob);
      await promise;

      expect(mockJob.progress).toHaveBeenCalledWith(10);
      expect(mockJob.progress).toHaveBeenCalledWith(30);
    });

    it('should emit PDF_GENERATION_REQUESTED with correct payload', async () => {
      mockEmitterService.on.mockImplementation((event, listener) => {
        if (event === EventTypes.PDF_GENERATED) {
          setTimeout(() => {
            listener({
              jobId: mockJob.id,
              leaseId: mockJob.data.resource.resourceId,
              pdfUrl: 'test.pdf',
              s3Key: 'key',
            });
          }, 10);
        }
      });

      pdfWorker.generatePdf(mockJob);

      // Wait for emit
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_REQUESTED,
        expect.objectContaining({
          jobId: mockJob.id,
          resource: expect.objectContaining({
            resourceId: mockJob.data.resource.resourceId,
            resourceName: 'lease',
          }),
          cuid: 'MMQHHVX09JJT',
          templateType: 'residential-single-family',
        })
      );
    });

    it('should register event listeners', async () => {
      mockEmitterService.on.mockImplementation((event, listener) => {
        if (event === EventTypes.PDF_GENERATED) {
          setTimeout(() => {
            listener({
              jobId: mockJob.id,
              leaseId: mockJob.data.resource.resourceId,
              pdfUrl: 'test.pdf',
              s3Key: 'key',
            });
          }, 10);
        }
      });

      pdfWorker.generatePdf(mockJob);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockEmitterService.on).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATED,
        expect.any(Function)
      );
      expect(mockEmitterService.on).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_FAILED,
        expect.any(Function)
      );
    });

    it('should clean up listeners after completion', async () => {
      mockEmitterService.on.mockImplementation((event, listener) => {
        if (event === EventTypes.PDF_GENERATED) {
          setTimeout(() => {
            listener({
              jobId: mockJob.id,
              leaseId: mockJob.data.resource.resourceId,
              pdfUrl: 'test.pdf',
              s3Key: 'key',
            });
          }, 10);
        }
      });

      await pdfWorker.generatePdf(mockJob);

      expect(mockEmitterService.off).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATED,
        expect.any(Function)
      );
      expect(mockEmitterService.off).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_FAILED,
        expect.any(Function)
      );
    });

    it('should handle job without template type', async () => {
      mockJob.data.templateType = undefined;

      mockEmitterService.on.mockImplementation((event, listener) => {
        if (event === EventTypes.PDF_GENERATED) {
          setTimeout(() => {
            listener({
              jobId: mockJob.id,
              leaseId: mockJob.data.resource.resourceId,
              pdfUrl: 'test.pdf',
              s3Key: 'key',
            });
          }, 10);
        }
      });

      pdfWorker.generatePdf(mockJob);
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_REQUESTED,
        expect.objectContaining({
          templateType: undefined,
        })
      );
    });
  });
});
