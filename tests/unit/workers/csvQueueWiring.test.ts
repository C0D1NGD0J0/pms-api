import { JOB_NAME } from '@utils/constants';
import { PropertyQueue } from '@queues/property.queue';
import { InvitationQueue } from '@queues/invitation.queue';
import { attachCsvToJob, withCsvFile } from '@queues/csvFileTransfer';

// Mock BaseQueue so we don't need Redis in unit tests
jest.mock('@queues/base.queue', () => ({
  BaseQueue: class MockBaseQueue {
    constructor(_opts: any) {}
    addJobToQueue = jest.fn().mockResolvedValue({ id: 'job-1' });
    processQueueJobs = jest.fn();
  },
}));

jest.mock('@queues/csvFileTransfer', () => ({
  attachCsvToJob: jest.fn(async (data: any) => ({ ...data, csvContentBase64: 'Q1NW' })),
  withCsvFile: jest.fn((handler: any) => ({ wrapped: handler })),
}));
const jobData = {
  csvFilePath: '/api/uploads/x.csv',
  userId: 'u1',
  clientInfo: { cuid: 'C1' },
} as any;

describe('PropertyQueue CSV handoff', () => {
  const propertyWorker = {
    processCsvValidation: jest.fn(),
    processCsvImport: jest.fn(),
    notifyCsvJobFailed: jest.fn().mockResolvedValue(undefined),
  };

  it('wraps both CSV processors so the worker reads the CSV carried in the job', () => {
    const queue = new PropertyQueue({ propertyWorker: propertyWorker as any });

    expect((queue as any).processQueueJobs).toHaveBeenCalledWith(JOB_NAME.CSV_VALIDATION_JOB, 2, {
      wrapped: propertyWorker.processCsvValidation,
    });
    expect((queue as any).processQueueJobs).toHaveBeenCalledWith(JOB_NAME.CSV_IMPORT_JOB, 1, {
      wrapped: propertyWorker.processCsvImport,
    });
    expect(withCsvFile).toHaveBeenCalledWith(propertyWorker.processCsvValidation);
    expect(withCsvFile).toHaveBeenCalledWith(propertyWorker.processCsvImport);
  });

  it('puts the CSV in the job data for validation and import jobs (no S3)', async () => {
    const queue = new PropertyQueue({ propertyWorker: propertyWorker as any });

    await queue.addCsvValidationJob(jobData);
    await queue.addCsvImportJob(jobData);

    expect(attachCsvToJob).toHaveBeenCalledWith(jobData);
    for (const [, data] of (queue as any).addJobToQueue.mock.calls) {
      expect(data.csvContentBase64).toBe('Q1NW');
    }
  });
});

describe('InvitationQueue CSV handoff', () => {
  const invitationWorker = {
    processCsvValidation: jest.fn(),
    processCsvImport: jest.fn(),
    notifyCsvJobFailed: jest.fn().mockResolvedValue(undefined),
  };

  it('wraps both CSV processors and carries the CSV in every job', async () => {
    const queue = new InvitationQueue({ invitationWorker: invitationWorker as any });

    expect((queue as any).processQueueJobs).toHaveBeenCalledTimes(2);
    for (const [, , handler] of (queue as any).processQueueJobs.mock.calls) {
      expect(handler).toHaveProperty('wrapped');
    }

    await queue.addCsvValidationJob(jobData);
    await queue.addCsvImportJob(jobData);

    const added = (queue as any).addJobToQueue.mock.calls;
    expect(added).toHaveLength(2);
    for (const [, data] of added) expect(data.csvContentBase64).toBe('Q1NW');
  });
});

describe('CSV queues report jobs that failed for good', () => {
  it.each([
    ['PropertyQueue', JOB_NAME.CSV_VALIDATION_JOB],
    ['PropertyQueue', JOB_NAME.CSV_IMPORT_JOB],
    ['InvitationQueue', JOB_NAME.INVITATION_CSV_VALIDATION_JOB],
    ['InvitationQueue', JOB_NAME.INVITATION_CSV_IMPORT_JOB],
  ])('%s tells the user when a %s job fails for good', async (queueName, jobName) => {
    const worker = { notifyCsvJobFailed: jest.fn().mockResolvedValue(undefined) };
    const queue =
      queueName === 'PropertyQueue'
        ? new PropertyQueue({ propertyWorker: worker as any })
        : new InvitationQueue({ invitationWorker: worker as any });
    const job = { id: 'job-1', name: jobName, data: jobData };
    const error = new Error('job stalled more than allowable limit');

    await (queue as any).onJobFailedPermanently(job, error);

    expect(worker.notifyCsvJobFailed).toHaveBeenCalledWith(job, error);
  });

  it('ignores jobs that are not CSV imports', async () => {
    const worker = { notifyCsvJobFailed: jest.fn() };
    const queue = new PropertyQueue({ propertyWorker: worker as any });

    await (queue as any).onJobFailedPermanently({ name: 'some_other_job' }, new Error('x'));

    expect(worker.notifyCsvJobFailed).not.toHaveBeenCalled();
  });
});
