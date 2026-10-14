import { Job } from 'bull';
import { CsvJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { PropertyWorker } from '@workers/property.worker';

import { BaseQueue } from './base.queue';
import { attachCsvToJob, withCsvFile } from './csvFileTransfer';

interface IConstructor {
  propertyWorker: PropertyWorker;
}

export class PropertyQueue extends BaseQueue {
  private readonly propertyWorker: PropertyWorker;

  constructor({ propertyWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.PROPERTY_QUEUE });
    this.propertyWorker = propertyWorker;
    this.processQueueJobs(
      JOB_NAME.CSV_VALIDATION_JOB,
      2,
      withCsvFile(this.propertyWorker.processCsvValidation)
    );
    this.processQueueJobs(
      JOB_NAME.CSV_IMPORT_JOB,
      1,
      withCsvFile(this.propertyWorker.processCsvImport)
    );
  }

  protected async onJobFailedPermanently(job: Job<CsvJobData>, error: Error): Promise<void> {
    if (job.name === JOB_NAME.CSV_VALIDATION_JOB || job.name === JOB_NAME.CSV_IMPORT_JOB) {
      await this.propertyWorker.notifyCsvJobFailed(job, error);
    }
  }

  async addCsvValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.CSV_VALIDATION_JOB, await attachCsvToJob(data));
    return jobId;
  }

  async addCsvImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.CSV_IMPORT_JOB, await attachCsvToJob(data));
    return jobId;
  }
}
