import * as Sentry from '@sentry/node';
import { envVariables } from '@shared/config';
import { cleanSharedDLQ, BaseQueue } from '@queues/base.queue';

// Minimal Bull stand-in: records event handlers so tests can fire 'failed' directly
const handlers: Record<string, (...args: any[]) => any> = {};
const dlqAdd = jest.fn().mockResolvedValue(undefined);
const dlqClean = jest.fn();
jest.mock('bull', () =>
  jest.fn().mockImplementation((name: string) => ({
    name,
    on: jest.fn((event: string, cb: any) => {
      if (name !== 'dead-letter-queue') handlers[event] = cb;
    }),
    once: jest.fn(),
    add: name === 'dead-letter-queue' ? dlqAdd : jest.fn(),
    clean: dlqClean,
    process: jest.fn(),
  }))
);

const scope = { setFingerprint: jest.fn(), setTags: jest.fn(), setContext: jest.fn() };
jest.mock('@sentry/node', () => ({
  withScope: jest.fn((callback: (s: unknown) => void) => callback(scope)),
  captureException: jest.fn(),
}));

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

  describe('Sentry reporting (free plan: once per problem per window)', () => {
    const DAY_MS = 24 * 60 * 60 * 1000;

    it('reports a permanent failure once, tagged and fingerprinted by queue, job and message', async () => {
      const err = new Error('report sentry unique failure');

      await handlers.failed(makeJob(3, 3), err);

      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
      expect(Sentry.captureException).toHaveBeenCalledWith(err);
      expect(scope.setFingerprint).toHaveBeenCalledWith([
        'queue-job-failed',
        'test-queue',
        'csv_validation',
        'report sentry unique failure',
      ]);
      expect(scope.setTags).toHaveBeenCalledWith(
        expect.objectContaining({ queue: 'test-queue', jobName: 'csv_validation' })
      );
      expect(scope.setContext).toHaveBeenCalledWith('job', {
        data: { userId: 'u1', csvFilePath: '/tmp/x.csv' },
      });
    });

    it('does not report a failure that will be retried', async () => {
      await handlers.failed(makeJob(1, 3), new Error('retry sentry failure'));

      expect(Sentry.captureException).not.toHaveBeenCalled();
    });

    it('reports the same failure again only after the throttle window', async () => {
      // A local .env may shorten the window; this test pins it
      const throttle = jest.replaceProperty(
        envVariables.SERVER,
        'SENTRY_JOB_FAILURE_THROTTLE_MS',
        DAY_MS
      );
      const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
      const err = new Error('throttled sentry failure');

      await handlers.failed(makeJob(3, 3), err);
      now.mockReturnValue(1_000_000 + DAY_MS - 1);
      await handlers.failed(makeJob(3, 3), err);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + DAY_MS);
      await handlers.failed(makeJob(3, 3), err);
      expect(Sentry.captureException).toHaveBeenCalledTimes(2);

      now.mockRestore();
      throttle.restore();
    });

    it('still moves every permanent failure to the DLQ while throttled', async () => {
      const err = new Error('dlq while throttled');

      await handlers.failed(makeJob(3, 3), err);
      await handlers.failed(makeJob(3, 3), err);

      expect(dlqAdd).toHaveBeenCalledTimes(2);
      expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    });
  });

  describe('cleanSharedDLQ', () => {
    it('removes waiting and failed DLQ entries older than the grace period', async () => {
      dlqClean.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValueOnce([{ id: 3 }]);

      const removed = await cleanSharedDLQ(30 * 24 * 60 * 60 * 1000);

      expect(dlqClean).toHaveBeenNthCalledWith(1, 30 * 24 * 60 * 60 * 1000, 'wait');
      expect(dlqClean).toHaveBeenNthCalledWith(2, 30 * 24 * 60 * 60 * 1000, 'failed');
      expect(removed).toBe(3);
    });
  });
});
