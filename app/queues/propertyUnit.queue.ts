import { PropertyUnitWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';

import { BaseQueue } from './base.queue';

export interface UnitBatchJobData {
  requestId: string;
  userId: string;
  units: any[];
  cid: string;
  pid: string;
}

interface IConstructor {
  propertyUnitWorker: PropertyUnitWorker;
}

export class PropertyUnitQueue extends BaseQueue {
  private readonly propertyUnitWorker: PropertyUnitWorker;

  constructor({ propertyUnitWorker }: IConstructor) {
    super(QUEUE_NAMES.PROPERTY_UNIT_QUEUE);
    this.propertyUnitWorker = propertyUnitWorker;
    this.processQueueJobs(
      JOB_NAME.UNIT_BATCH_CREATION_JOB,
      2,
      this.propertyUnitWorker.processUnitBatchCreation
    );
  }

  async addUnitBatchCreationJob(data: UnitBatchJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.UNIT_BATCH_CREATION_JOB, data);
    return jobId;
  }

  async getUnitBatchJobStatus(jobId: string) {
    return this.getJobStatus(jobId);
  }
}
