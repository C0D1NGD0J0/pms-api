import Logger from 'bunyan';
import { DoneCallback, Job } from 'bull';
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

  constructor({ cronService }: IConstructor) {
    this.log = createLogger('CronWorker');
    this.cronService = cronService;
  }

  /**
   * Execute a cron job
   * NOTE: This runs in WORKER process only
   */
  executeCronJob = (job: Job<CronJobData>, done: DoneCallback): void => {
    const { jobName, service } = job.data;
    const startTime = Date.now();

    const handler = this.cronService.getJobHandler(jobName);
    if (!handler) {
      const error = new Error(`No handler found for cron job: ${jobName}`);
      return done(error);
    }

    handler()
      .then(() => {
        const duration = Date.now() - startTime;
        this.log.info(
          `✓ Cron job completed: ${jobName} - Duration: (${duration}ms) - Service: ${service}`
        );
        done(null, { success: true, duration });
      })
      .catch((error: any) => {
        const duration = Date.now() - startTime;
        this.log.error(`✗ Cron job failed: ${jobName} (${duration}ms)`, {
          error: error.message,
          stack: error.stack,
        });
        done(error);
      });
  };
}
