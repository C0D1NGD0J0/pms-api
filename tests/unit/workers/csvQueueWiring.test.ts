import { JOB_NAME } from '@utils/constants';
import { PropertyQueue } from '@queues/property.queue';
import { InvitationQueue } from '@queues/invitation.queue';
import { withStagedCsv, stageCsvInS3 } from '@queues/csvFileTransfer';

// Mock BaseQueue so we don't need Redis in unit tests
jest.mock('@queues/base.queue', () => ({
  BaseQueue: class MockBaseQueue {
    constructor(_opts: any) {}
    addJobToQueue = jest.fn().mockResolvedValue({ id: 'job-1' });
    processQueueJobs = jest.fn();
  },
}));

jest.mock('@queues/csvFileTransfer', () => ({
  stageCsvInS3: jest.fn(async (_s3: any, data: any) => ({
    ...data,
    csvS3Key: 'csv-imports/x.csv',
  })),
  withStagedCsv: jest.fn((_s3: any, handler: any) => ({ wrapped: handler })),
}));

const s3Service = { uploadBuffer: jest.fn() } as any;
const jobData = {
  csvFilePath: '/api/uploads/x.csv',
  userId: 'u1',
  clientInfo: { cuid: 'C1' },
} as any;

describe('PropertyQueue CSV staging', () => {
  const propertyWorker = { processCsvValidation: jest.fn(), processCsvImport: jest.fn() };

  it('wraps both CSV processors so the worker reads the staged CSV', () => {
    const queue = new PropertyQueue({ propertyWorker: propertyWorker as any, s3Service });

    expect((queue as any).processQueueJobs).toHaveBeenCalledWith(JOB_NAME.CSV_VALIDATION_JOB, 2, {
      wrapped: propertyWorker.processCsvValidation,
    });
    expect((queue as any).processQueueJobs).toHaveBeenCalledWith(JOB_NAME.CSV_IMPORT_JOB, 1, {
      wrapped: propertyWorker.processCsvImport,
    });
    expect(withStagedCsv).toHaveBeenCalledWith(s3Service, expect.any(Function));
  });

  it('stages the CSV in S3 before adding validation and import jobs', async () => {
    const queue = new PropertyQueue({ propertyWorker: propertyWorker as any, s3Service });

    await queue.addCsvValidationJob(jobData);
    await queue.addCsvImportJob(jobData);

    expect(stageCsvInS3).toHaveBeenCalledWith(s3Service, jobData);
    for (const [, data] of (queue as any).addJobToQueue.mock.calls) {
      expect(data.csvS3Key).toBe('csv-imports/x.csv');
    }
  });
});

describe('InvitationQueue CSV staging', () => {
  const invitationWorker = {
    processCsvValidation: jest.fn(),
    processCsvImport: jest.fn(),
  };

  it('wraps both CSV processors and stages the CSV for every add method', async () => {
    const queue = new InvitationQueue({ invitationWorker: invitationWorker as any, s3Service });

    expect((queue as any).processQueueJobs).toHaveBeenCalledTimes(2);
    for (const [, , handler] of (queue as any).processQueueJobs.mock.calls) {
      expect(handler).toHaveProperty('wrapped');
    }

    await queue.addCsvValidationJob(jobData);
    await queue.addCsvImportJob(jobData);

    const added = (queue as any).addJobToQueue.mock.calls;
    expect(added).toHaveLength(2);
    for (const [, data] of added) expect(data.csvS3Key).toBe('csv-imports/x.csv');
  });
});
