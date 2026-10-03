import { SmsQueue } from '@queues/sms.queue';
import { QUEUE_RESOURCE_NAMES } from '@di/registerResources';
import { QueueFactory } from '@services/queue/queueFactory.service';

// Mock BaseQueue so we don't need Redis in unit tests
jest.mock('@queues/base.queue', () => ({
  BaseQueue: class MockBaseQueue {
    constructor(_opts: any) {}
    addJobToQueue = jest.fn().mockResolvedValue({ id: 'mock-job-id' });
    processAllQueueJobs = jest.fn();
  },
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
