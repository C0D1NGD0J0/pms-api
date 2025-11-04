import { Job } from 'bull';
import { PdfWorker } from '@workers/pdfGenerator.worker';
import { EventEmitterService } from '@services/index';
import { PdfJobData, PdfJobResult } from '@interfaces/pdfGenerator.interface';
import { EventTypes } from '@interfaces/events.interface';

describe('PdfWorker', () => {
  let pdfWorker: PdfWorker;
  let mockEmitterService: jest.Mocked<EventEmitterService>;
  let mockJob: jest.Mocked<Job<PdfJobData>>;

  beforeEach(() => {
    // Create mock EventEmitterService
    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
    } as any;

    // Create PdfWorker instance
    pdfWorker = new PdfWorker({ emitterService: mockEmitterService });

    // Create mock job
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
    it('should emit PDF_GENERATION_REQUESTED event', async () => {
      // Setup: Mock event emission to resolve immediately
      mockEmitterService.emit.mockImplementation((event, payload) => {
        if (event === EventTypes.PDF_GENERATION_REQUESTED) {
          // Simulate immediate PDF_GENERATED event
          setTimeout(() => {
            const listeners = (mockEmitterService.on as jest.Mock).mock.calls
              .filter((call) => call[0] === EventTypes.PDF_GENERATED)
              .map((call) => call[1]);

            listeners.forEach((listener) =>
              listener({
                jobId: mockJob.id,
                leaseId: mockJob.data.resource.resourceId,
                pdfUrl: 'https://s3.amazonaws.com/test.pdf',
                s3Key: 'lease_123.pdf',
                fileSize: 12345,
                generationTime: 3000,
              })
            );
          }, 10);
        }
      });

      const promise = pdfWorker.generatePdf(mockJob);

      // Wait a bit for event to be emitted
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_REQUESTED,
        expect.objectContaining({
          jobId: mockJob.id,
          templateType: 'residential-single-family',
          leaseId: mockJob.data.resource.resourceId,
          actorId: mockJob.data.resource.actorId,
          cuid: 'MMQHHVX09JJT',
        })
      );

      await promise;
    });

    it('should update job progress', async () => {
      // Setup: Mock event emission
      mockEmitterService.emit.mockImplementation((event) => {
        if (event === EventTypes.PDF_GENERATION_REQUESTED) {
          setTimeout(() => {
            const listeners = (mockEmitterService.on as jest.Mock).mock.calls
              .filter((call) => call[0] === EventTypes.PDF_GENERATED)
              .map((call) => call[1]);

            listeners.forEach((listener) =>
              listener({
                jobId: mockJob.id,
                leaseId: mockJob.data.resource.resourceId,
                pdfUrl: 'https://s3.amazonaws.com/test.pdf',
                s3Key: 'lease_123.pdf',
              })
            );
          }, 10);
        }
      });

      await pdfWorker.generatePdf(mockJob);

      expect(mockJob.progress).toHaveBeenCalledWith(10); // Initial
      expect(mockJob.progress).toHaveBeenCalledWith(30); // Before emitting event
      expect(mockJob.progress).toHaveBeenCalledWith(100); // On success
    });

    it('should return success result when PDF is generated', async () => {
      const expectedResult = {
        jobId: mockJob.id,
        leaseId: mockJob.data.resource.resourceId,
        pdfUrl: 'https://s3.amazonaws.com/test.pdf',
        s3Key: 'lease_123.pdf',
        fileSize: 12345,
        generationTime: 3000,
      };

      // Mock event emission
      mockEmitterService.emit.mockImplementation((event) => {
        if (event === EventTypes.PDF_GENERATION_REQUESTED) {
          setTimeout(() => {
            const listeners = (mockEmitterService.on as jest.Mock).mock.calls
              .filter((call) => call[0] === EventTypes.PDF_GENERATED)
              .map((call) => call[1]);

            listeners.forEach((listener) => listener(expectedResult));
          }, 10);
        }
      });

      const result = await pdfWorker.generatePdf(mockJob);

      expect(result).toEqual({
        success: true,
        leaseId: expectedResult.leaseId,
        pdfUrl: expectedResult.pdfUrl,
        s3Key: expectedResult.s3Key,
        fileSize: expectedResult.fileSize,
        generationTime: expectedResult.generationTime,
      });
    });

    it('should return failure result when PDF generation fails', async () => {
      const errorPayload = {
        jobId: mockJob.id,
        leaseId: mockJob.data.resource.resourceId,
        error: 'Template not found',
      };

      // Mock event emission
      mockEmitterService.emit.mockImplementation((event) => {
        if (event === EventTypes.PDF_GENERATION_REQUESTED) {
          setTimeout(() => {
            const listeners = (mockEmitterService.on as jest.Mock).mock.calls
              .filter((call) => call[0] === EventTypes.PDF_GENERATION_FAILED)
              .map((call) => call[1]);

            listeners.forEach((listener) => listener(errorPayload));
          }, 10);
        }
      });

      const result = await pdfWorker.generatePdf(mockJob);

      expect(result).toEqual({
        success: false,
        leaseId: errorPayload.leaseId,
        error: errorPayload.error,
      });
    });

    it('should timeout after 5 minutes', async () => {
      jest.useFakeTimers();

      // Don't emit any events - let it timeout
      mockEmitterService.emit.mockImplementation(() => {
        // Do nothing
      });

      const promise = pdfWorker.generatePdf(mockJob);

      // Fast-forward time by 5 minutes
      jest.advanceTimersByTime(300000);

      await expect(promise).rejects.toThrow('PDF generation timeout after 5 minutes');

      jest.useRealTimers();
    });

    it('should clean up event listeners after completion', async () => {
      // Mock event emission
      mockEmitterService.emit.mockImplementation((event) => {
        if (event === EventTypes.PDF_GENERATION_REQUESTED) {
          setTimeout(() => {
            const listeners = (mockEmitterService.on as jest.Mock).mock.calls
              .filter((call) => call[0] === EventTypes.PDF_GENERATED)
              .map((call) => call[1]);

            listeners.forEach((listener) =>
              listener({
                jobId: mockJob.id,
                leaseId: mockJob.data.resource.resourceId,
                pdfUrl: 'https://s3.amazonaws.com/test.pdf',
                s3Key: 'lease_123.pdf',
              })
            );
          }, 10);
        }
      });

      await pdfWorker.generatePdf(mockJob);

      // Verify event listeners were removed
      expect(mockEmitterService.off).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATED,
        expect.any(Function)
      );
      expect(mockEmitterService.off).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_FAILED,
        expect.any(Function)
      );
    });

    it('should handle errors during processing', async () => {
      // Mock emit to throw error
      mockEmitterService.emit.mockImplementation(() => {
        throw new Error('Event emission failed');
      });

      const result = await pdfWorker.generatePdf(mockJob);

      expect(result).toEqual({
        success: false,
        leaseId: mockJob.data.resource.resourceId,
        error: 'Event emission failed',
      });
    });

    it('should only respond to events matching the job ID', async () => {
      // Mock event emission
      mockEmitterService.emit.mockImplementation((event) => {
        if (event === EventTypes.PDF_GENERATION_REQUESTED) {
          setTimeout(() => {
            const listeners = (mockEmitterService.on as jest.Mock).mock.calls
              .filter((call) => call[0] === EventTypes.PDF_GENERATED)
              .map((call) => call[1]);

            // Emit event with wrong job ID first
            listeners.forEach((listener) =>
              listener({
                jobId: 'wrong-id',
                leaseId: mockJob.data.resource.resourceId,
                pdfUrl: 'https://s3.amazonaws.com/wrong.pdf',
                s3Key: 'wrong.pdf',
              })
            );

            // Then emit correct event
            setTimeout(() => {
              listeners.forEach((listener) =>
                listener({
                  jobId: mockJob.id,
                  leaseId: mockJob.data.resource.resourceId,
                  pdfUrl: 'https://s3.amazonaws.com/correct.pdf',
                  s3Key: 'correct.pdf',
                })
              );
            }, 10);
          }, 10);
        }
      });

      const result = await pdfWorker.generatePdf(mockJob);

      // Should resolve with correct event, not wrong one
      expect(result.pdfUrl).toBe('https://s3.amazonaws.com/correct.pdf');
    });

    it('should handle job without template type', async () => {
      mockJob.data.templateType = undefined;

      mockEmitterService.emit.mockImplementation((event) => {
        if (event === EventTypes.PDF_GENERATION_REQUESTED) {
          setTimeout(() => {
            const listeners = (mockEmitterService.on as jest.Mock).mock.calls
              .filter((call) => call[0] === EventTypes.PDF_GENERATED)
              .map((call) => call[1]);

            listeners.forEach((listener) =>
              listener({
                jobId: mockJob.id,
                leaseId: mockJob.data.resource.resourceId,
                pdfUrl: 'https://s3.amazonaws.com/test.pdf',
                s3Key: 'lease_123.pdf',
              })
            );
          }, 10);
        }
      });

      const result = await pdfWorker.generatePdf(mockJob);

      expect(result.success).toBe(true);
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.PDF_GENERATION_REQUESTED,
        expect.objectContaining({
          templateType: undefined,
        })
      );
    });
  });
});
