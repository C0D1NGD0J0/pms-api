import { CsvJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { S3Service } from '@services/fileUpload/awsS3';
import { InvitationWorker } from '@workers/invitation.worker';

import { BaseQueue } from './base.queue';
import { withStagedCsv, stageCsvInS3 } from './csvFileTransfer';

interface IConstructor {
  invitationWorker: InvitationWorker;
  s3Service: S3Service;
}

export class InvitationQueue extends BaseQueue {
  private readonly invitationWorker: InvitationWorker;
  private readonly s3Service: S3Service;

  constructor({ invitationWorker, s3Service }: IConstructor) {
    super({ queueName: QUEUE_NAMES.INVITATION_QUEUE });
    this.invitationWorker = invitationWorker;
    this.s3Service = s3Service;
    // CSV operations are heavy — low concurrency prevents BRPOPLPUSH
    // contention on the shared bclient and avoids overwhelming the system.
    this.processQueueJobs(
      JOB_NAME.INVITATION_CSV_VALIDATION_JOB,
      2,
      withStagedCsv(s3Service, this.invitationWorker.processCsvValidation)
    );
    this.processQueueJobs(
      JOB_NAME.INVITATION_CSV_IMPORT_JOB,
      1,
      withStagedCsv(s3Service, this.invitationWorker.processCsvImport)
    );
  }

  async addCsvValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(
      JOB_NAME.INVITATION_CSV_VALIDATION_JOB,
      await stageCsvInS3(this.s3Service, data),
      {
        attempts: 1, // no retries for CSV validation
        timeout: 60000,
        backoff: { type: 'fixed', delay: 10000 },
        removeOnComplete: 100,
        removeOnFail: 500,
        delay: 5000,
      }
    );
    return jobId;
  }

  async addCsvImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(
      JOB_NAME.INVITATION_CSV_IMPORT_JOB,
      await stageCsvInS3(this.s3Service, data),
      {
        // A retry would re-send invites already dispatched, and Bull's timeout doesn't
        // cancel the running handler — so run once, with room for large files.
        attempts: 1,
        timeout: 15 * 60 * 1000,
        removeOnComplete: 100,
        removeOnFail: 500,
        delay: 5000,
      }
    );
    return jobId;
  }
}
