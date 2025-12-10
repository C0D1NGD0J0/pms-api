import { QUEUE_NAMES } from '@utils/constants';

import { BaseQueue } from './base.queue';

export class CronQueue extends BaseQueue {
  constructor({ cronWorker }: { cronWorker: any }) {
    super(QUEUE_NAMES.CRON_QUEUE);

    // process all cron jobs with a single worker
    this.processQueueJobs('*', 1, cronWorker.executeCronJob);
  }

  /**
   * Remove a repeatable job by name and cron pattern
   * Used when disabling a cron job
   */
  async removeRepeatable(jobName: string, cronPattern: string): Promise<void> {
    await this.queue.removeRepeatable(`cron:${jobName}`, {
      cron: cronPattern,
    });
  }
}
