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
      this.log.debug(`Lazy initializing queue: ${queueName}`);
      try {
        const queue = container.resolve(queueName);
        this.initializedQueues.add(queueName);
        this.log.debug(`Successfully initialized queue: ${queueName}`);
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
      try {
        const worker = container.resolve(workerName);
        this.initializedWorkers.add(workerName);
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
   * Force initialize all queues (for worker process)
   * Workers are automatically injected into queue constructors, no need to resolve separately
   * Returns list of successfully initialized queues
   */
  public async initializeAllQueues(): Promise<{ queues: string[]; failed: string[] }> {
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
      'paymentQueue',
    ];

    this.log.info('Force initializing all queues (workers auto-injected via DI)');

    const initializedQueues: string[] = [];
    const failed: string[] = [];

    // Stagger initialization to avoid overwhelming Redis with simultaneous connections
    for (const queueName of queueNames) {
      try {
        this.getQueue(queueName);
        initializedQueues.push(queueName);
        // Small delay between each queue to prevent thundering herd
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        this.log.error(`Failed to initialize queue ${queueName}:`, error);
        failed.push(queueName);
      }
    }

    return { queues: initializedQueues, failed };
  }

  /**
   * Gracefully shut down all initialized queues
   */
  public async shutdownAll(): Promise<void> {
    const queueNames = Array.from(this.initializedQueues);
    await Promise.allSettled(
      queueNames.map(async (name) => {
        try {
          const queue: BaseQueue = container.resolve(name);
          await queue.shutdown();
          this.log.info(`Queue ${name} shut down`);
        } catch (err) {
          this.log.warn(`Failed to shut down queue ${name}:`, err);
        }
      })
    );
  }

  /**
   * Clear initialization tracking (for testing)
   */
  public reset(): void {
    this.initializedQueues.clear();
    this.initializedWorkers.clear();
  }
}
