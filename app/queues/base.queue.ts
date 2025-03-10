import Queue from 'bull';
import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';

import { DEFAULT_QUEUE_OPTIONS, DEFAULT_JOB_OPTIONS, BullBoardService } from './bullboard';

export type JobData = any;

export class BaseQueue<T extends JobData = JobData> {
  protected queue: Queue.Queue;
  protected log: Logger;

  constructor(
    queueName: string,
    private bullBoardService: BullBoardService
  ) {
    this.log = createLogger(queueName);

    this.queue = new Queue(queueName, envVariables.REDIS.URL, DEFAULT_QUEUE_OPTIONS);
    this.bullBoardService.registerQueue(this.queue);
    this.initializeQueueEvents();
  }

  /**
   * Initialize queue event handlers with proper error handling
   */
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

  /**
   * Add a job to the queue with type safety
   */
  public async addJob(name: string, data: T): Promise<Queue.Job<T>> {
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
  public processJobs(
    name: string,
    concurrency: number,
    callback: Queue.ProcessCallbackFunction<T>
  ): void {
    this.queue.process(name, concurrency, callback);
  }

  /**
   * Gracefully shut down the queue
   */
  public async shutdown(): Promise<void> {
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
  public async getJobCounts(): Promise<Queue.JobCounts> {
    return this.queue.getJobCounts();
  }

  /**
   * Empty the queue
   */
  public async clearQueue(): Promise<void> {
    return this.queue.empty();
  }

  /**
   * Pause the queue
   */
  public async pauseQueue(): Promise<void> {
    return this.queue.pause();
  }

  /**
   * Resume the queue
   */
  public async resumeQueue(): Promise<void> {
    return this.queue.resume();
  }

  /**
   * Get a job by ID
   */
  public async getJob(jobId: string | number): Promise<Queue.Job<T> | null> {
    return this.queue.getJob(jobId);
  }
}
