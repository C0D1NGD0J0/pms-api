import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import Queue, { QueueOptions as BullQueueOptions, JobOptions as BullJobOptions } from 'bull';

export const DEFAULT_JOB_OPTIONS: BullJobOptions = {
  attempts: 2,
  timeout: 60000,
  backoff: { type: 'fixed', delay: 10000 },
  removeOnComplete: 1000,
  removeOnFail: 5000,
};

export const DEFAULT_QUEUE_OPTIONS: BullQueueOptions = {
  settings: {
    maxStalledCount: 1800000,
    lockDuration: 3600000, // 1hr
    stalledInterval: 100000,
  },
};

export type JobData = any;

let bullMQAdapters: BullAdapter[] = [];
export let serverAdapter: ExpressAdapter;

export class BaseQueue<T extends JobData = JobData> {
  protected log: Logger;
  protected queue: Queue.Queue;

  constructor(queueName: string) {
    this.log = createLogger(queueName);
    this.queue = new Queue(queueName, envVariables.REDIS.URL, DEFAULT_QUEUE_OPTIONS);
    this.initializeBullBoard(this.queue);
    this.initializeQueueEvents();
  }

  protected initializeQueueEvents(): void {
    this.queue.on('completed', (job, result) => {
      this.log.info(`Job ${job.id} has completed`, result);
    });

    this.queue.on('failed', (job, err) => {
      this.log.error(`Job ${job.id} has failed: ${err.message}`, err);
    });

    this.queue.on('error', (error) => {
      this.log.error('Queue error:', error);
    });

    this.queue.on('stalled', (job) => {
      this.log.error(`Job ${job.id} has stalled`);
      job.moveToFailed({ message: 'Job stalled and moved to failed' }, false);
    });
  }

  initializeBullBoard(queue: any): void {
    serverAdapter = new ExpressAdapter();
    serverAdapter.setBasePath(envVariables.BULL_BOARD.BASE_PATH);

    bullMQAdapters.push(new BullAdapter(queue));
    bullMQAdapters = [...new Set(bullMQAdapters)];

    createBullBoard({
      serverAdapter,
      queues: bullMQAdapters,
    });
    this.log.info('BullBoard initialized');
  }

  /**
   * Add a job to the queue with type safety
   */
  async addJobToQueue(name: string, data: T): Promise<Queue.Job<T>> {
    try {
      return await this.queue.add(name, data, DEFAULT_JOB_OPTIONS);
    } catch (error) {
      this.log.error(`Failed to add job '${name}' to queue:`, error);
      throw error;
    }
  }

  /**
   * Process jobs in the queue
   */
  processQueueJobs(
    name: string,
    concurrency: number,
    callback: Queue.ProcessCallbackFunction<T>
  ): void {
    this.queue.process(name, concurrency, callback);
  }

  /**
   * Gracefully shut down the queue
   */
  async shutdown(): Promise<void> {
    try {
      await this.queue.close();
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

  /**
   * Get a job by ID
   */
  async getJob(jobId: string | number): Promise<Queue.Job<T> | null> {
    return this.queue.getJob(jobId);
  }
}
