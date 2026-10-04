import { CsvJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { S3Service } from '@services/fileUpload/awsS3';
import { PropertyWorker } from '@workers/property.worker';

import { BaseQueue } from './base.queue';
import { withStagedCsv, stageCsvInS3 } from './csvFileTransfer';

interface IConstructor {
  propertyWorker: PropertyWorker;
  s3Service: S3Service;
}

export class PropertyQueue extends BaseQueue {
  private readonly propertyWorker: PropertyWorker;
  private readonly s3Service: S3Service;

  constructor({ propertyWorker, s3Service }: IConstructor) {
    super({ queueName: QUEUE_NAMES.PROPERTY_QUEUE });
    this.propertyWorker = propertyWorker;
    this.s3Service = s3Service;
    this.processQueueJobs(
      JOB_NAME.CSV_VALIDATION_JOB,
      2,
      withStagedCsv(s3Service, this.propertyWorker.processCsvValidation)
    );
    this.processQueueJobs(
      JOB_NAME.CSV_IMPORT_JOB,
      1,
      withStagedCsv(s3Service, this.propertyWorker.processCsvImport)
    );
  }

  async addCsvValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(
      JOB_NAME.CSV_VALIDATION_JOB,
      await stageCsvInS3(this.s3Service, data)
    );
    return jobId;
  }

  async addCsvImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(
      JOB_NAME.CSV_IMPORT_JOB,
      await stageCsvInS3(this.s3Service, data)
    );
    return jobId;
  }
}
