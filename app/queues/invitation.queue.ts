import { Job } from 'bull';
import { CsvJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { InvitationWorker } from '@workers/invitation.worker';

import { BaseQueue } from './base.queue';
import { attachCsvToJob, withCsvFile } from './csvFileTransfer';

interface IConstructor {
  invitationWorker: InvitationWorker;
}

export class InvitationQueue extends BaseQueue {
  private readonly invitationWorker: InvitationWorker;

  constructor({ invitationWorker }: IConstructor) {
    super({ queueName: QUEUE_NAMES.INVITATION_QUEUE });
    this.invitationWorker = invitationWorker;
    // CSV operations are heavy — low concurrency prevents BRPOPLPUSH
    // contention on the shared bclient and avoids overwhelming the system.
    this.processQueueJobs(
      JOB_NAME.INVITATION_CSV_VALIDATION_JOB,
      2,
      withCsvFile(this.invitationWorker.processCsvValidation)
    );
    this.processQueueJobs(
      JOB_NAME.INVITATION_CSV_IMPORT_JOB,
      1,
      withCsvFile(this.invitationWorker.processCsvImport)
    );
  }

  protected async onJobFailedPermanently(job: Job<CsvJobData>, error: Error): Promise<void> {
    if (
      job.name === JOB_NAME.INVITATION_CSV_VALIDATION_JOB ||
      job.name === JOB_NAME.INVITATION_CSV_IMPORT_JOB
    ) {
      await this.invitationWorker.notifyCsvJobFailed(job, error);
    }
  }

  async addCsvValidationJob(data: CsvJobData) {
    const jobId = await this.addJobToQueue(
      JOB_NAME.INVITATION_CSV_VALIDATION_JOB,
      await attachCsvToJob(data),
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
      await attachCsvToJob(data),
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
