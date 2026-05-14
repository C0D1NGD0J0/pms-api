import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { CronService } from '@services/cron/cron.service';

interface CronJobData {
  jobName: string;
  service: string;
}

interface IConstructor {
  cronService: CronService;
}

export class CronWorker {
  private log: Logger;
  private cronService: CronService;

  // In-process guard: prevents the same job from running concurrently if the cron
  // interval is shorter than the job's execution time. Bull's lock mechanism covers
  // concurrent execution across multiple worker processes; this covers the same process.
  // Phase 2: replace with a Redis SETNX-based distributed lock for multi-process safety.
  private activeJobs: Set<string> = new Set();

  constructor({ cronService }: IConstructor) {
    this.log = createLogger('CronWorker');
    this.cronService = cronService;
  }

  /**
   * Execute a cron job
   * NOTE: This runs in WORKER process only
   */
  executeCronJob = async (job: Job<CronJobData>) => {
    const { jobName, service } = job.data;

    if (this.activeJobs.has(jobName)) {
      this.log.warn(
        { jobName, service },
        'CronWorker: job already running — skipping overlapping execution'
      );
      return { success: true, skipped: true, reason: 'already_running' };
    }

    this.activeJobs.add(jobName);
    const startTime = Date.now();

    const handler = this.cronService.getJobHandler(jobName);
    if (!handler) {
      this.activeJobs.delete(jobName);
      throw new Error(`No handler found for cron job: ${jobName}`);
    }

    try {
      await handler();
      const duration = Date.now() - startTime;
      this.log.info(
        `✓ Cron job completed: ${jobName} - Duration: (${duration}ms) - Service: ${service}`
      );
      return { success: true, duration };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      this.log.error(`✗ Cron job failed: ${jobName} (${duration}ms)`, {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    } finally {
      this.activeJobs.delete(jobName);
    }
  };
}
