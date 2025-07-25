import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import Queue, { QueueOptions as BullQueueOptions, JobOptions as BullJobOptions } from 'bull';

export const DEFAULT_JOB_OPTIONS: BullJobOptions = {
  attempts: 3,
  timeout: 60000,
  backoff: { type: 'fixed', delay: 10000 },
  removeOnComplete: 100,
  removeOnFail: 500,
  delay: 5000,
};

export const DEFAULT_QUEUE_OPTIONS: BullQueueOptions = {
  settings: {
    maxStalledCount: 1800000,
    lockDuration: 3600000, // 1hr
    stalledInterval: 300000,
  },
  redis: {
    host: envVariables.REDIS.HOST,
    port: envVariables.REDIS.PORT,
    ...(envVariables.SERVER.ENV === 'production'
      ? { username: envVariables.REDIS.USERNAME, password: envVariables.REDIS.PASSWORD }
      : {}),
    family: 0,
    ...(envVariables.SERVER.ENV === 'production'
      ? {
          connectTimeout: 30000,
          lazyConnect: true,
          keepAlive: 60000,
          maxRetriesPerRequest: 3,
        }
      : {}),
  },
};

export type JobData = any;

export let serverAdapter: ExpressAdapter;
const bullMQAdapters: BullAdapter[] = [];
let deadLetterQueue: Queue.Queue | null;

export class BaseQueue<T extends JobData = JobData> {
  protected log: Logger;
  protected dlq: Queue.Queue;
  protected queue: Queue.Queue;

  constructor(queueName: string) {
    this.log = createLogger(queueName);
    this.queue = new Queue(queueName, envVariables.REDIS.URL, DEFAULT_QUEUE_OPTIONS);

    if (!deadLetterQueue) {
      const dlqName = `${queueName}-DLQ`;
      deadLetterQueue = new Queue(dlqName, envVariables.REDIS.URL, DEFAULT_QUEUE_OPTIONS);
    }
    this.dlq = deadLetterQueue;
    this.addQueueToBullBoard(this.queue, this.dlq);
    this.initializeQueueEvents();
    this.autoResumeQueue();

    deadLetterQueue = null;
  }

  protected initializeQueueEvents(): void {
    this.queue.on('completed', (job, result) => {
      const processingTime = job.finishedOn ? job.finishedOn - job.processedOn! : 'N/A';
      this.log.info(
        { jobId: job.id, jobName: job.name, processingTimeMs: processingTime, result: result },
        `Job ${job.id} (${job.name}) completed successfully.`
      );
    });

    this.queue.on('failed', async (job, err) => {
      this.log.error(
        { jobId: job.id, jobName: job.name, attemptsMade: job.attemptsMade, error: err },
        `Job ${job.id} (${job.name}) failed after ${job.attemptsMade} attempts: ${err.message}`
      );

      if (job.attemptsMade >= (job.opts.attempts ?? DEFAULT_JOB_OPTIONS.attempts ?? 3)) {
        this.log.warn(
          { jobId: job.id, jobName: job.name },
          `Job ${job.id} reached max attempts. Moving to DLQ: ${this.dlq.name}`
        );
        try {
          await this.dlq.add(
            job.name,
            {
              originalJobId: job.id,
              originalQueue: this.queue.name,
              data: job.data,
              failedReason: err.message,
              failedStack: err.stack,
              failedTimestamp: new Date().toISOString(),
              attemptsMade: job.attemptsMade,
            },
            { removeOnComplete: true, removeOnFail: true }
          );
        } catch (dlqError: any) {
          this.log.error(
            { jobId: job.id, dlqName: this.dlq.name, error: dlqError },
            `Failed to move job ${job.id} to DLQ: ${dlqError.message}`
          );
        }
      }
    });

    this.queue.on('error', (error) => {
      this.log.error({ error }, `Queue ${this.queue.name} encountered an error: ${error.message}`);
    });

    this.queue.on('stalled', (job) => {
      this.log.warn(
        { jobId: job.id, jobName: job.name },
        `Job ${job.id} (${job.name}) has stalled.`
      );
      job.moveToFailed({ message: 'Job stalled' }, true);
    });
  }

  addQueueToBullBoard(queue: Queue.Queue, dlq?: Queue.Queue): void {
    if (!serverAdapter) {
      serverAdapter = new ExpressAdapter();
      serverAdapter.setBasePath(envVariables.BULL_BOARD.BASE_PATH);
    }

    let adaptersToAdd: Queue.Queue[] = [queue];
    if (dlq && dlq !== queue) {
      adaptersToAdd.push(dlq);
    }

    const existingQueueNames = bullMQAdapters.map(
      (adapter) => (adapter as any).queue?.name || 'unknown'
    );

    adaptersToAdd = adaptersToAdd.filter((q) => !existingQueueNames.includes(q.name));
    adaptersToAdd.forEach((q) => {
      bullMQAdapters.push(new BullAdapter(q));
    });
    createBullBoard({
      serverAdapter,
      queues: bullMQAdapters,
    });
  }

  /**
   * Add a job to the queue with type safety
   */
  async addJobToQueue(name: string, data: T): Promise<Queue.Job<T>> {
    try {
      return await this.queue.add(name, data, DEFAULT_JOB_OPTIONS);
    } catch (error) {
      this.log.error(
        { jobName: name, queueName: this.queue.name, error: error },
        `Failed to add job '${name}' to queue: ${error.message}`
      );
      throw error;
    }
  }

  /**
   * Process jobs in the queue
   */
  processQueueJobs(
    name: string,
    concurrency = 5,
    callback: Queue.ProcessCallbackFunction<T>
  ): void {
    this.queue.process(name, concurrency, callback);
  }

  /**
   * Gracefully shut down the queue
   */
  async shutdown(): Promise<void> {
    try {
      this.log.info(`Shutting down queue ${this.queue.name}...`);

      // Pause queue to prevent new jobs
      await this.queue.pause();

      // Wait for active jobs to complete (with timeout)
      const maxWaitTime = 30000; // 30 seconds
      const startTime = Date.now();

      while (Date.now() - startTime < maxWaitTime) {
        const activeJobs = await this.queue.getActive();
        if (activeJobs.length === 0) {
          break;
        }
        this.log.info(`Waiting for ${activeJobs.length} active jobs to complete...`);
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      this.queue.removeAllListeners();
      if (this.dlq) {
        this.dlq.removeAllListeners();
      }

      await this.queue.close();
      if (this.dlq) {
        await this.dlq.close();
      }
      this.log.info(`Queue ${this.queue.name} shutdown complete`);
    } catch (error) {
      this.log.error(`Error shutting down queue ${this.queue.name}:`, error);
    }
  }

  /**
   * Get queue statistics
   */
  async getJobCounts(): Promise<Queue.JobCounts> {
    return this.queue.getJobCounts();
  }

  /**
   * Empty the queue
   */
  async clearQueue(): Promise<void> {
    return this.queue.empty();
  }

  /**
   * Pause the queue
   */
  async pauseQueue(): Promise<void> {
    return this.queue.pause();
  }

  /**
   * Resume the queue
   */
  async resumeQueue(): Promise<void> {
    return this.queue.resume();
  }

  private async autoResumeQueue(): Promise<void> {
    try {
      const isPaused = await this.queue.isPaused();

      if (isPaused) {
        await this.queue.resume();
        this.log.info(`⚠️ Resumed previously paused queue: ${this.queue.name}`);
      }
    } catch (error) {
      this.log.warn({ error }, `Failed to auto-resume queue ${this.queue.name}: ${error.message}`);
    }
  }

  /**
   * Get a job by ID
   */
  async getJob(jobId: string | number): Promise<Queue.Job<T> | null> {
    return this.queue.getJob(jobId);
  }
  /**
   * Get the status of a job
   * @param jobId
   * @returns { exists: boolean; id: string; state: string; progress: number; data: T; result: any; completedOn: Date | undefined; failedReason: string | undefined }
   */
  async getJobStatus(jobId: string) {
    const job = await this.getJob(jobId);
    if (!job) {
      return { exists: false };
    }

    return {
      exists: true,
      id: job.id,
      state: await job.getState(),
      progress: job.progress(),
      data: job.data,
      result: job.returnvalue,
      completedOn: job.finishedOn ? new Date(job.finishedOn) : undefined,
      failedReason: job.failedReason,
    };
  }
}
