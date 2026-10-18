import { BaseQueue } from '@queues/base.queue';

// Minimal Bull stand-in: records event handlers so tests can fire 'failed' directly
const handlers: Record<string, (...args: any[]) => any> = {};
const dlqAdd = jest.fn().mockResolvedValue(undefined);
jest.mock('bull', () =>
  jest.fn().mockImplementation((name: string) => ({
    name,
    on: jest.fn((event: string, cb: any) => {
      if (name !== 'dead-letter-queue') handlers[event] = cb;
    }),
    once: jest.fn(),
    add: name === 'dead-letter-queue' ? dlqAdd : jest.fn(),
    process: jest.fn(),
  }))
);

class TestQueue extends BaseQueue {
  onFailedForGood = jest.fn().mockResolvedValue(undefined);

  protected async onJobFailedPermanently(job: any, error: Error): Promise<void> {
    await this.onFailedForGood(job, error);
  }
}

const makeJob = (attemptsMade: number, attempts: number) => ({
  id: 'job-1',
  name: 'csv_validation',
  attemptsMade,
  opts: { attempts },
  data: { userId: 'u1', csvContentBase64: 'Q1NW', csvFilePath: '/tmp/x.csv' },
});

describe('BaseQueue permanent-failure hook', () => {
  let queue: TestQueue;

  beforeEach(() => {
    jest.clearAllMocks();
    queue = new TestQueue({ queueName: 'test-queue' });
  });

  it('does not run while the job still has retries left', async () => {
    await handlers.failed(makeJob(1, 3), new Error('boom'));

    expect(queue.onFailedForGood).not.toHaveBeenCalled();
  });

  it('runs once the job has used its last attempt, whatever the cause', async () => {
    const job = makeJob(3, 3);
    const timeout = new Error('Promise timed out after 60000 milliseconds');

    await handlers.failed(job, timeout);

    expect(queue.onFailedForGood).toHaveBeenCalledWith(job, timeout);
  });

  it('still moves the job to the DLQ if the hook throws', async () => {
    queue.onFailedForGood.mockRejectedValueOnce(new Error('sse down'));

    await handlers.failed(makeJob(1, 1), new Error('boom'));

    expect(dlqAdd).toHaveBeenCalled();
  });

  it('keeps uploaded file contents out of the DLQ copy', async () => {
    await handlers.failed(makeJob(1, 1), new Error('boom'));

    const dlqData = dlqAdd.mock.calls[0][1].data;
    expect(dlqData).not.toHaveProperty('csvContentBase64');
    expect(dlqData).toEqual({ userId: 'u1', csvFilePath: '/tmp/x.csv' });
  });
});
