import { container } from '@di/setup';
import { QUEUE_NAMES } from '@utils/constants';

import { BaseQueue } from './base.queue';

export class CronQueue extends BaseQueue {
  constructor() {
    super({ queueName: QUEUE_NAMES.CRON_QUEUE });

    // process all cron jobs with a single worker
    // lazy load: gets cronWorker only when processing starts
    this.processQueueJobs('*', 1, async (job) => {
      const cronWorker = container.resolve('cronWorker');
      return cronWorker.executeCronJob(job);
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

  /**
   * Remove repeatable jobs whose names are not in the registered set.
   * Uses Bull's API (removeRepeatableByKey) so both the schedule entry
   * and its data key are removed atomically — safe to call on every restart.
   *
   * Called by CronService after all cron jobs have been registered.
   */
  async removeUnregisteredRepeatJobs(registeredJobNames: string[]): Promise<void> {
    try {
      const repeatableJobs = await this.queue.getRepeatableJobs();
      for (const job of repeatableJobs) {
        // Bull populates job.name (the first arg to queue.add()) reliably.
        // job.id is only set when repeat.jobId is used inside the repeat options,
        // which we don't do — so job.id is always undefined for our jobs.
        const jobName = job.name;
        if (!jobName || !registeredJobNames.includes(jobName)) {
          this.log.info(
            { jobKey: job.key, jobName: job.name },
            'CronQueue: removing unregistered repeat job'
          );
          await this.queue.removeRepeatableByKey(job.key);
        }
      }
    } catch (error) {
      this.log.error({ error }, 'CronQueue: failed to remove unregistered repeat jobs');
    }
  }
}
