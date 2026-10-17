import { Job } from 'bull';
import { PropertyUnitWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';

import { BaseQueue } from './base.queue';

export interface UnitBatchJobData {
  requestId: string;
  userId: string;
  units: any[];
  cuid: string;
  pid: string;
}

interface IConstructor {
  propertyUnitWorker: PropertyUnitWorker;
}

export class PropertyUnitQueue extends BaseQueue {
  private readonly propertyUnitWorker: PropertyUnitWorker;

  constructor({ propertyUnitWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.PROPERTY_UNIT_QUEUE });
    this.propertyUnitWorker = propertyUnitWorker;
    this.processQueueJobs(
      JOB_NAME.UNIT_BATCH_CREATION_JOB,
      2,
      this.propertyUnitWorker.processUnitBatchCreation
    );
  }

  protected async onJobFailedPermanently(job: Job<UnitBatchJobData>, error: Error): Promise<void> {
    if (job.name === JOB_NAME.UNIT_BATCH_CREATION_JOB) {
      await this.propertyUnitWorker.notifyUnitBatchFailed(job, error);
    }
  }

  async addUnitBatchCreationJob(data: UnitBatchJobData) {
    return this.addJobToQueue(JOB_NAME.UNIT_BATCH_CREATION_JOB, data, {
      // A retry after the transaction commits would see its own units as duplicates and never
      // bump the unit counter, so one attempt; the user is told the outcome either way.
      attempts: 1,
      timeout: 5 * 60 * 1000,
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  async getUnitBatchJobStatus(jobId: string) {
    return this.getJobStatus(jobId);
  }
}
