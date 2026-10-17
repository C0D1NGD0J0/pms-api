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
    const jobId = await this.addJobToQueue(
      JOB_NAME.CSV_VALIDATION_JOB,
      await attachCsvToJob(data),
      {
        // Every row is geocoded, so allow more than the 60s default; the user can just re-run it
        attempts: 1,
        timeout: 5 * 60 * 1000,
        removeOnComplete: 100,
        removeOnFail: 500,
        delay: 5000,
      }
    );
    return jobId;
  }

  async addCsvImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.CSV_IMPORT_JOB, await attachCsvToJob(data), {
      // A retry would insert the same properties again, and Bull's timeout doesn't stop the
      // first run — so one attempt with room to geocode and insert a large file.
      attempts: 1,
      timeout: 15 * 60 * 1000,
      removeOnComplete: 100,
      removeOnFail: 500,
      delay: 5000,
    });
    return jobId;
  }
}
