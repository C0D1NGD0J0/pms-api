import { container } from '@di/index';
import { createLogger } from '@utils/helpers';
import { BaseQueue } from '@queues/base.queue';

export class QueueFactory {
  private initializedQueues: Set<string> = new Set();
  private initializedWorkers: Set<string> = new Set();
  private readonly log = createLogger('QueueFactory');

  constructor() {
    this.log.info('QueueFactory initialized');
  }

  /**
   * Lazily initialize a queue only when it's first needed
   */
  public getQueue(queueName: string): BaseQueue {
    if (!this.initializedQueues.has(queueName)) {
      this.log.info(`Lazy initializing queue: ${queueName}`);

      try {
        const queue = container.resolve(queueName);
        this.initializedQueues.add(queueName);
        this.log.info(`Successfully initialized queue: ${queueName}`);
        return queue;
      } catch (error) {
        this.log.error(`Failed to initialize queue ${queueName}:`, error);
        throw error;
      }
    }

    return container.resolve(queueName);
  }

  /**
   * Lazily initialize a worker only when it's first needed
   */
  public getWorker(workerName: string): any {
    if (!this.initializedWorkers.has(workerName)) {
      this.log.info(`Lazy initializing worker: ${workerName}`);

      try {
        const worker = container.resolve(workerName);
        this.initializedWorkers.add(workerName);
        this.log.info(`Successfully initialized worker: ${workerName}`);
        return worker;
      } catch (error) {
        this.log.error(`Failed to initialize worker ${workerName}:`, error);
        throw error;
      }
    }

    return container.resolve(workerName);
  }

  /**
   * Get all initialized queues for cleanup
   */
  public getInitializedQueues(): string[] {
    return Array.from(this.initializedQueues);
  }

  /**
   * Get all initialized workers for cleanup
   */
  public getInitializedWorkers(): string[] {
    return Array.from(this.initializedWorkers);
  }

  /**
   * Force initialize all queues (for development or when explicitly needed)
   */
  public initializeAllQueues(): void {
    const queueNames = [
      'propertyMediaQueue',
      'emailQueue',
      'eventBusQueue',
      'propertyQueue',
      'propertyUnitQueue',
      'uploadQueue',
      'invitationQueue',
      'eSignatureQueue',
      'pdfGeneratorQueue',
      'cronQueue',
    ];

    const workerNames = [
      'propertyMediaWorker',
      'emailWorker',
      'propertyWorker',
      'propertyUnitWorker',
      'uploadWorker',
      'invitationWorker',
      'eSignatureWorker',
      'pdfGeneratorWorker',
      'cronWorker',
    ];

    this.log.info('Force initializing all queues and workers');

    queueNames.forEach((queueName) => {
      try {
        this.getQueue(queueName);
      } catch (error) {
        this.log.error(`Failed to initialize queue ${queueName}:`, error);
      }
    });

    workerNames.forEach((workerName) => {
      try {
        this.getWorker(workerName);
      } catch (error) {
        this.log.error(`Failed to initialize worker ${workerName}:`, error);
      }
    });
  }

  /**
   * Clear initialization tracking (for testing)
   */
  public reset(): void {
    this.initializedQueues.clear();
    this.initializedWorkers.clear();
  }
}
