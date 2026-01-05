import { CsvJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { PropertyWorker } from '@workers/property.worker';

import { BaseQueue } from './base.queue';

interface IConstructor {
  propertyWorker: PropertyWorker;
}

export class PropertyQueue extends BaseQueue {
  private readonly propertyWorker: PropertyWorker;

  constructor({ propertyWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.PROPERTY_QUEUE });
    this.propertyWorker = propertyWorker;
    this.processQueueJobs(JOB_NAME.CSV_VALIDATION_JOB, 2, this.propertyWorker.processCsvValidation);
    this.processQueueJobs(JOB_NAME.CSV_IMPORT_JOB, 1, this.propertyWorker.processCsvImport);
  }

  async addCsvValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.CSV_VALIDATION_JOB, data);
    return jobId;
  }

  async addCsvImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.CSV_IMPORT_JOB, data);
    return jobId;
  }
}
