import { UploadWorker } from '@workers/index';
import { UploadJobData } from '@interfaces/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';

import { BaseQueue } from './base.queue';

export class UploadQueue extends BaseQueue {
  constructor({ uploadWorker }: { uploadWorker: UploadWorker }) {
    super(QUEUE_NAMES.MEDIA_QUEUE);
    this.processQueueJobs(JOB_NAME.MEDIA_UPLOAD_JOB, 5, uploadWorker.uploadAsset);
    this.processQueueJobs(JOB_NAME.MEDIA_REMOVAL_JOB, 15, uploadWorker.deleteAsset);
  }

  addToUploadQueue(qname: string, data: UploadJobData): void {
    this.addJobToQueue(qname, data);
  }

  addToRemovalQueue(qname: string, data: any): void {
    this.addJobToQueue(qname, data);
  }
}
