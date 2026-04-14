import { UploadWorker } from '@workers/index';
import { UploadJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';

import { BaseQueue } from './base.queue';

export class UploadQueue extends BaseQueue {
  constructor({ uploadWorker }: { uploadWorker: UploadWorker }) {
    super({ queueName: QUEUE_NAMES.MEDIA_QUEUE });
    // Single catch-all processor dispatches by job name.
    // Using two separate named processors on one queue caused Bull's shared
    // blocking client to stall jobs without ever invoking the callback.
    this.processAllQueueJobs(2, async (job) => {
      if (job.name === JOB_NAME.MEDIA_UPLOAD_JOB) {
        return uploadWorker.uploadAsset(job);
      }
      if (job.name === JOB_NAME.MEDIA_REMOVAL_JOB) {
        return uploadWorker.deleteAsset(job);
      }
      this.log.warn(`[mediaQueue] Unknown job name: ${job.name}`);
    });
  }

  addToUploadQueue(qname: string, data: UploadJobData): void {
    this.addJobToQueue(qname, data, {
      timeout: 120000,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }

  addToRemovalQueue(qname: string, data: any): void {
    this.addJobToQueue(qname, data, {
      timeout: 60000,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
      removeOnComplete: 100,
      removeOnFail: 500,
    });
  }
}
