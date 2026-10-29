import { SmsQueue } from '@queues/sms.queue';
import { QUEUE_RESOURCE_NAMES } from '@di/registerResources';
import { QueueFactory } from '@services/queue/queueFactory.service';

// Mock BaseQueue so we don't need Redis in unit tests
const mockCleanSharedDLQ = jest.fn();
jest.mock('@queues/base.queue', () => ({
  BaseQueue: class MockBaseQueue {
    constructor(_opts: any) {}
    addJobToQueue = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
    processAllQueueJobs = jest.fn();
  },
  cleanSharedDLQ: (olderThanMs: number) => mockCleanSharedDLQ(olderThanMs),
}));

const mockResolve = jest.fn();
jest.mock('@di/index', () => ({ container: { resolve: (name: string) => mockResolve(name) } }));

describe('SmsQueue', () => {
  it('sends every SMS job through SmsWorker.sendSms', () => {
    const smsWorker = { sendSms: jest.fn() };

    const queue = new SmsQueue({ smsWorker: smsWorker as any });

    expect((queue as any).processAllQueueJobs).toHaveBeenCalledWith(2, smsWorker.sendSms);
  });
});

describe('QueueFactory.initializeAllQueues', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockResolve.mockReset();
  });
  afterEach(() => jest.useRealTimers());

  it('starts every registered queue, including smsQueue and userQueue', async () => {
    const factory = new QueueFactory();

    const run = factory.initializeAllQueues();
    await jest.runAllTimersAsync();
    const { queues, failed } = await run;

    expect(queues).toEqual(QUEUE_RESOURCE_NAMES);
    expect(queues).toEqual(expect.arrayContaining(['smsQueue', 'userQueue']));
    expect(failed).toEqual([]);
  });

  it('reports a queue that fails to start without stopping the others', async () => {
    mockResolve.mockImplementation((name: string) => {
      if (name === 'smsQueue') throw new Error('boom');
      return {};
    });
    const factory = new QueueFactory();

    const run = factory.initializeAllQueues();
    await jest.runAllTimersAsync();
    const { queues, failed } = await run;

    expect(failed).toEqual(['smsQueue']);
    expect(queues).toHaveLength(QUEUE_RESOURCE_NAMES.length - 1);
  });
});

describe('QueueFactory dead-letter cleanup cron', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const { envVariables } = jest.requireActual('@shared/config');
  const originalRetention = envVariables.SERVER.DLQ_RETENTION_DAYS;

  afterEach(() => {
    envVariables.SERVER.DLQ_RETENTION_DAYS = originalRetention;
    mockCleanSharedDLQ.mockReset();
  });

  const runCleanup = async () => {
    const [job] = new QueueFactory().getCronJobs();
    await job.handler();
    return job;
  };

  it('registers a daily job that cleans DLQ entries older than DLQ_RETENTION_DAYS', async () => {
    envVariables.SERVER.DLQ_RETENTION_DAYS = 30;
    mockCleanSharedDLQ.mockResolvedValue(4);

    const job = await runCleanup();

    expect(job).toEqual(
      expect.objectContaining({ name: 'queue:clean-dead-letter-queue', schedule: '15 3 * * *' })
    );
    expect(mockCleanSharedDLQ).toHaveBeenCalledWith(30 * DAY_MS);
  });

  it('falls back to 30 days when DLQ_RETENTION_DAYS is invalid', async () => {
    envVariables.SERVER.DLQ_RETENTION_DAYS = NaN;
    mockCleanSharedDLQ.mockResolvedValue(0);

    await runCleanup();

    expect(mockCleanSharedDLQ).toHaveBeenCalledWith(30 * DAY_MS);
  });
});
