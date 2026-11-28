import * as Sentry from '@sentry/node';
import { CronWorker } from '@workers/cron.worker';

jest.mock('@sentry/node', () => ({
  withMonitor: jest.fn((_slug: string, callback: () => unknown) => callback()),
}));

describe('CronWorker — Sentry cron monitor', () => {
  const getJobHandler = jest.fn();
  const getCronJob = jest.fn();
  const worker = new CronWorker({ cronService: { getJobHandler, getCronJob } as any });

  const job = (jobName: string) => ({ data: { jobName, service: 'PaymentCronService' } }) as any;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('sends check-ins for a monitored job', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    getJobHandler.mockReturnValue(handler);
    getCronJob.mockReturnValue({
      name: 'payment.daily-rent-safety-net',
      schedule: '0 5 * * *',
      timeout: 300000,
      sentryMonitor: true,
    });

    const result = await worker.executeCronJob(job('payment.daily-rent-safety-net'));

    expect(Sentry.withMonitor).toHaveBeenCalledWith('payment.daily-rent-safety-net', handler, {
      schedule: { type: 'crontab', value: '0 5 * * *' },
      timezone: 'UTC',
      checkinMargin: 30,
      maxRuntime: 5,
    });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toEqual(expect.objectContaining({ success: true }));
  });

  it('runs an unmonitored job without check-ins', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    getJobHandler.mockReturnValue(handler);
    getCronJob.mockReturnValue({ name: 'lease.expiry', schedule: '0 1 * * *' });

    await worker.executeCronJob(job('lease.expiry'));

    expect(Sentry.withMonitor).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('still rethrows when a monitored job fails', async () => {
    getJobHandler.mockReturnValue(jest.fn().mockRejectedValue(new Error('db down')));
    getCronJob.mockReturnValue({ name: 'payment.x', schedule: '0 5 * * *', sentryMonitor: true });

    await expect(worker.executeCronJob(job('payment.x'))).rejects.toThrow('db down');
  });

  it('skips a job with no handler before touching Sentry', async () => {
    getJobHandler.mockReturnValue(undefined);

    const result = await worker.executeCronJob(job('payment.x'));

    expect(result).toEqual(expect.objectContaining({ skipped: true, reason: 'handler_not_ready' }));
    expect(Sentry.withMonitor).not.toHaveBeenCalled();
  });
});
