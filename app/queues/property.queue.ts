import { JOB_NAME } from '@utils/index';
import { CsvJobData } from '@interfaces/index';
import { PropertyWorker } from '@workers/property.worker';

import { BaseQueue } from './base.queue';

interface IConstructor {
  propertyWorker: PropertyWorker;
}

export class PropertyQueue extends BaseQueue {
  private readonly propertyWorker: PropertyWorker;

  constructor({ propertyWorker }: IConstructor) {
    super('propertyQueue');
    this.propertyWorker = propertyWorker;
    this.processJobs();
  }

  async addCsvValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.CSV_VALIDATION_JOB, data);
    return jobId;
  }

  async addCsvImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.CSV_IMPORT_JOB, data);
    return jobId;
  }

  private processJobs() {
    this.processQueueJobs(JOB_NAME.CSV_VALIDATION_JOB, 2, this.propertyWorker.processCsvValidation);
    this.processQueueJobs(JOB_NAME.CSV_IMPORT_JOB, 1, this.propertyWorker.processCsvImport);
  }
}
