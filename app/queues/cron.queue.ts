import { container } from '@di/setup';
import { QUEUE_NAMES } from '@utils/constants';

import { BaseQueue } from './base.queue';

export class CronQueue extends BaseQueue {
  constructor() {
    super({ queueName: QUEUE_NAMES.CRON_QUEUE });

    // process all cron jobs with a single worker
    // lazy load: gets cronWorker only when processing starts
    this.processQueueJobs('*', 1, (job, done) => {
      const cronWorker = container.resolve('cronWorker');
      return cronWorker.executeCronJob(job, done);
    });
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

  /**
   * Get repeatable jobs
   * for getting next execution times
   */
  async getRepeatableJobs() {
    return this.queue.getRepeatableJobs();
  }
}
