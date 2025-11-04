import { PdfQueue } from '@queues/pdfGenerator.queue';
import { PdfWorker } from '@workers/pdfGenerator.worker';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { PdfJobData } from '@interfaces/pdfGenerator.interface';

// Mock BaseQueue
jest.mock('@queues/base.queue', () => {
  return {
    BaseQueue: class MockBaseQueue {
      protected processQueueJobs = jest.fn();
      protected addJobToQueue = jest.fn();
      constructor(public queueName: string) {}
    },
  };
});

describe('PdfQueue', () => {
  let pdfQueue: PdfQueue;
  let mockPdfWorker: jest.Mocked<PdfWorker>;

  beforeEach(() => {
    // Create mock PdfWorker
    mockPdfWorker = {
      generatePdf: jest.fn(),
    } as any;

    // Create PdfQueue instance
    pdfQueue = new PdfQueue({ pdfGeneratorWorker: mockPdfWorker });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct queue name', () => {
      expect(pdfQueue['queueName']).toBe(QUEUE_NAMES.PDF_GENERATION_QUEUE);
    });

    it('should call processQueueJobs with correct parameters', () => {
      expect(pdfQueue['processQueueJobs']).toHaveBeenCalledWith(
        JOB_NAME.PDF_GENERATION_JOB,
        2, // concurrency
        mockPdfWorker.generatePdf
      );
    });
  });

  describe('addToPdfQueue', () => {
    it('should add job to queue with correct job name', async () => {
      const mockJobData: PdfJobData = {
        resource: {
          resourceId: '507f1f77bcf86cd799439011',
          resourceName: 'lease',
          actorId: '507f1f77bcf86cd799439012',
          resourceType: 'document',
          fieldName: 'leaseDocument',
        },
        cuid: 'MMQHHVX09JJT',
        templateType: 'residential-single-family',
      };

      const mockJob = { id: '123', data: mockJobData };
      (pdfQueue['addJobToQueue'] as jest.Mock).mockResolvedValue(mockJob);

      const result = await pdfQueue.addToPdfQueue(mockJobData);

      expect(pdfQueue['addJobToQueue']).toHaveBeenCalledWith(
        JOB_NAME.PDF_GENERATION_JOB,
        mockJobData
      );
      expect(result).toEqual(mockJob);
    });

    it('should handle job data without template type', async () => {
      const mockJobData: PdfJobData = {
        resource: {
          resourceId: '507f1f77bcf86cd799439011',
          resourceName: 'lease',
          actorId: '507f1f77bcf86cd799439012',
          resourceType: 'document',
          fieldName: 'leaseDocument',
        },
        cuid: 'MMQHHVX09JJT',
      };

      const mockJob = { id: '456', data: mockJobData };
      (pdfQueue['addJobToQueue'] as jest.Mock).mockResolvedValue(mockJob);

      const result = await pdfQueue.addToPdfQueue(mockJobData);

      expect(result).toEqual(mockJob);
    });
  });

  describe('queue configuration', () => {
    it('should process 2 jobs concurrently', () => {
      const processQueueJobsCall = (pdfQueue['processQueueJobs'] as jest.Mock).mock.calls[0];
      const concurrency = processQueueJobsCall[1];

      expect(concurrency).toBe(2);
    });

    it('should use correct job processor function', () => {
      const processQueueJobsCall = (pdfQueue['processQueueJobs'] as jest.Mock).mock.calls[0];
      const processorFn = processQueueJobsCall[2];

      expect(processorFn).toBe(mockPdfWorker.generatePdf);
    });
  });
});
