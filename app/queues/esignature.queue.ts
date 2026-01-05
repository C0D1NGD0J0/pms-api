import { ESignatureWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { BoldSignJobData } from '@interfaces/esignature.interface';

import { BaseQueue } from './base.queue';

export class ESignatureQueue extends BaseQueue<BoldSignJobData> {
  constructor({ eSignatureWorker }: { eSignatureWorker: ESignatureWorker }) {
    super(QUEUE_NAMES.LEASE_SIGNATURE_REQUEST_QUEUE);
    this.processQueueJobs(JOB_NAME.REQUEST_SIGNATURE, 2, eSignatureWorker.sendForSignature);
  }

  addToESignatureRequestQueue(data: BoldSignJobData) {
    return this.addJobToQueue(JOB_NAME.REQUEST_SIGNATURE, data, {
      timeout: 60000,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
    });
  }
}
