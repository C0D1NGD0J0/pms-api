import { envVariables } from '@shared/config';
import { createBullBoard } from '@bull-board/api';
import { ExpressAdapter } from '@bull-board/express';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
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

const registeredQueues: string[] = [];
export class BullBoardService {
  public readonly serverAdapter: ExpressAdapter;
  private adapters: BullMQAdapter[] = [];
  private initialized = false;

  constructor() {
    this.serverAdapter = new ExpressAdapter();
    this.serverAdapter.setBasePath(envVariables.BULL_BOARD.BASE_PATH);
  }

  public registerQueue(queue: Queue.Queue): void {
    registeredQueues.push(queue.name);
    if (!registeredQueues.includes(queue.name)) {
      const adapter = new BullMQAdapter(queue);
      this.adapters.push(adapter);
      this.adapters = [...new Set(this.adapters)];
      if (this.initialized) {
        this.initialize();
      }
    }
  }

  public initialize(): void {
    createBullBoard({
      serverAdapter: this.serverAdapter,
      queues: this.adapters,
    });
    this.initialized = true;
  }
}
