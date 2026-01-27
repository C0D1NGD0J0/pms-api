import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { CronQueue } from '@queues/cron.queue';
import { QueueFactory } from '@services/queue';
import { LeaseService } from '@services/lease';
import { NotificationService } from '@services/notification';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';

interface IConstructor {
  notificationService?: NotificationService;
  leaseService: LeaseService;
  queueFactory: QueueFactory;
}

/**
 * CronService - Centralized cron job coordinator
 *
 * Production: Runs in WORKER process only
 * Development: Can run in API process for quick testing
 */
export class CronService {
  private log: Logger;
  private queueFactory: QueueFactory;
  private cronJobs: Map<string, ICronJob> = new Map();

  constructor({ queueFactory, leaseService }: IConstructor) {
    this.log = createLogger('CronService');
    this.queueFactory = queueFactory;

    // collects cron jobs from all services that implement ICronProvider
    const services: ICronProvider[] = [leaseService].filter(Boolean);

    this.registerAllCronJobs(services);
  }

  /**
   * Register cron jobs from all services
   */
  private registerAllCronJobs(services: ICronProvider[]): void {
    this.log.info(`Registering cron jobs from ${services.length} services`);

    services.forEach((service) => {
      const serviceName = service.constructor.name;

      try {
        if (typeof service.getCronJobs !== 'function') {
          this.log.warn(`Service ${serviceName} does not implement getCronJobs()`);
          return;
        }

        const jobs = service.getCronJobs();
        jobs.forEach((job) => {
          this.registerCronJob(job);
        });
      } catch (error) {
        this.log.error(`Error registering cron jobs from ${serviceName}:`, error);
      }
    });

    this.log.info(`Total cron jobs registered: ${this.cronJobs.size}`);
  }

  /**
   * Register a single cron job
   */
  private registerCronJob(cronJob: ICronJob): void {
    if (!cronJob.name || !cronJob.schedule || !cronJob.handler) {
      throw new Error('Invalid cron job: missing required fields');
    }

    this.cronJobs.set(cronJob.name, cronJob);
    if (cronJob.enabled) {
      this.scheduleCronJob(cronJob);
    }
  }

  private scheduleCronJob(cronJob: ICronJob): void {
    const cronQueue = this.queueFactory.getQueue('cronQueue') as CronQueue;
    cronQueue.addJobToQueue(
      cronJob.name,
      {
        jobName: cronJob.name,
        service: cronJob.service,
      },
      {
        repeat: {
          cron: cronJob.schedule,
          tz: cronJob.timezone || 'UTC',
        },
        jobId: `cron:${cronJob.name}`, // Prevent duplicates
        timeout: cronJob.timeout || 300000, // 5 min default
      }
    );
  }

  getJobHandler(jobName: string): (() => Promise<void>) | undefined {
    const job = this.cronJobs.get(jobName);
    return job?.handler;
  }

  getAllCronJobs(): ICronJob[] {
    return Array.from(this.cronJobs.values());
  }

  getCronJob(jobName: string): ICronJob | undefined {
    return this.cronJobs.get(jobName);
  }

  async enableCronJob(jobName: string): Promise<void> {
    const job = this.cronJobs.get(jobName);
    if (!job) {
      throw new Error(`Cron job not found: ${jobName}`);
    }

    if (job.enabled) {
      this.log.warn(`Cron job already enabled: ${jobName}`);
      return;
    }

    job.enabled = true;
    this.scheduleCronJob(job);
    this.log.info(`Enabled cron job: ${jobName}`);
  }

  async disableCronJob(jobName: string): Promise<void> {
    const job = this.cronJobs.get(jobName);
    if (!job) {
      throw new Error(`Cron job not found: ${jobName}`);
    }

    if (!job.enabled) {
      this.log.warn(`Cron job already disabled: ${jobName}`);
      return;
    }

    job.enabled = false;
    const cronQueue = this.queueFactory.getQueue('cronQueue') as CronQueue;
    await cronQueue.removeRepeatable(jobName, job.schedule);
  }

  async getNextExecutions(): Promise<Array<{ job: string; nextRun: Date }>> {
    const executions: Array<{ job: string; nextRun: Date }> = [];
    const cronQueue = this.queueFactory.getQueue('cronQueue') as CronQueue;

    for (const [jobName, job] of this.cronJobs.entries()) {
      if (job.enabled) {
        // get next run time from Bull queue
        const repeatableJobs = await cronQueue.getRepeatableJobs();
        const jobInfo = repeatableJobs.find((j) => j.id === `cron:${jobName}`);

        if (jobInfo?.next) {
          executions.push({
            job: jobName,
            nextRun: new Date(jobInfo.next),
          });
        }
      }
    }

    return executions.sort((a, b) => a.nextRun.getTime() - b.nextRun.getTime());
  }
}
