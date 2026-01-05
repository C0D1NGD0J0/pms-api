import { CsvJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { InvitationWorker } from '@workers/invitation.worker';

import { BaseQueue } from './base.queue';

interface IConstructor {
  invitationWorker: InvitationWorker;
}

export class InvitationQueue extends BaseQueue {
  private readonly invitationWorker: InvitationWorker;

  constructor({ invitationWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.INVITATION_QUEUE });
    this.invitationWorker = invitationWorker;
    this.processQueueJobs(
      JOB_NAME.INVITATION_CSV_VALIDATION_JOB,
      5,
      this.invitationWorker.processCsvValidation
    );
    this.processQueueJobs(
      JOB_NAME.INVITATION_CSV_IMPORT_JOB,
      5,
      this.invitationWorker.processCsvImport
    );
    this.processQueueJobs(
      JOB_NAME.INVITATION_BULK_USER_VALIDATION_JOB,
      5,
      this.invitationWorker.processCsvBulkUserValidation
    );
    this.processQueueJobs(
      JOB_NAME.INVITATION_BULK_USER_IMPORT_JOB,
      5,
      this.invitationWorker.processCsvBulkUserImport
    );
  }

  async addCsvValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.INVITATION_CSV_VALIDATION_JOB, data, {
      attempts: 1, // no retries for CSV validation
      timeout: 60000,
      backoff: { type: 'fixed', delay: 10000 },
      removeOnComplete: 100,
      removeOnFail: 500,
      delay: 5000,
    });
    return jobId;
  }

  async addCsvImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.INVITATION_CSV_IMPORT_JOB, data);
    return jobId;
  }

  async addCsvBulkUserValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.INVITATION_BULK_USER_VALIDATION_JOB, data, {
      attempts: 1, // no retries for CSV validation
      timeout: 60000,
      backoff: { type: 'fixed', delay: 10000 },
      removeOnComplete: 100,
      removeOnFail: 500,
      delay: 5000,
    });
    return jobId;
  }

  async addCsvBulkUserImportJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(JOB_NAME.INVITATION_BULK_USER_IMPORT_JOB, data);
    return jobId;
  }
}
