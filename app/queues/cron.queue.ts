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

    if (process.env.PROCESS_TYPE === 'worker') {
      this.cleanupOrphanedRepeatKeys();
    }
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

  /**
   * Clean up orphaned repeat keys that accumulate over time
   * This prevents Redis command timeouts caused by thousands of stale keys
   */
  private async cleanupOrphanedRepeatKeys(): Promise<void> {
    try {
      const client = await this.queue.client;
      // Get all repeat:* keys (these are the job data keys)
      const repeatKeys = await client.keys(`bull:${QUEUE_NAMES.CRON_QUEUE}:repeat:*`);
      if (repeatKeys.length === 0) {
        this.log.info('No orphaned repeat keys found');
        return;
      }

      // Delete all repeat:* keys (Bull will recreate them for active jobs)
      // The repeat sorted set contains the actual job definitions
      // Batch deletions to avoid exceeding Redis argument limits
      const BATCH_SIZE = 1000;
      for (let i = 0; i < repeatKeys.length; i += BATCH_SIZE) {
        const batch = repeatKeys.slice(i, i + BATCH_SIZE);
        // eslint-disable-next-line @typescript-eslint/await-thenable
        await client.del(...batch);
      }
    } catch (error) {
      this.log.error({ error }, 'Failed to cleanup orphaned repeat keys');
    }
  }
}
