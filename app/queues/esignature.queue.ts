import { Job } from 'bull';
import { ESignatureWorker } from '@workers/index';
import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { StoreSignedDocumentJobData, BoldSignJobData } from '@interfaces/esignature.interface';

import { DEFAULT_JOB_OPTIONS, BaseQueue } from './base.queue';

type ESignatureJobData = BoldSignJobData | StoreSignedDocumentJobData;

export class ESignatureQueue extends BaseQueue<ESignatureJobData> {
  constructor({ eSignatureWorker }: { eSignatureWorker: ESignatureWorker }) {
    super({ queueName: QUEUE_NAMES.LEASE_SIGNATURE_REQUEST_QUEUE });

    // Use wildcard processor to avoid Bull's unreliable multi-named-processor routing
    this.processAllQueueJobs(2, async (job) => {
      switch (job.name) {
        case JOB_NAME.STORE_SIGNED_DOCUMENT:
          return eSignatureWorker.storeSignedDocument(job as Job<StoreSignedDocumentJobData>);
        case JOB_NAME.REQUEST_SIGNATURE:
          return eSignatureWorker.sendForSignature(job as Job<BoldSignJobData>);
        default:
          throw new Error(`Unknown e-signature job: ${job.name}`);
      }
    });
  }

  addToESignatureRequestQueue(data: BoldSignJobData) {
    return this.addJobToQueue(JOB_NAME.REQUEST_SIGNATURE, data, {
      timeout: 60000,
      attempts: 2,
      backoff: { type: 'fixed', delay: 5000 },
    });
  }

  /**
   * One job per envelope (jobId) so a re-delivered Completed webhook doesn't queue a second copy
   */
  addToStoreSignedDocumentQueue(data: StoreSignedDocumentJobData) {
    return this.addJobToQueue(JOB_NAME.STORE_SIGNED_DOCUMENT, data, {
      ...DEFAULT_JOB_OPTIONS,
      jobId: `signed-doc:${data.documentId}`,
      timeout: 60000,
      attempts: 5,
      backoff: { type: 'exponential', delay: 30000 },
    });
  }

  protected async onJobFailedPermanently(job: Job<ESignatureJobData>, error: Error): Promise<void> {
    if (job.name !== JOB_NAME.STORE_SIGNED_DOCUMENT) return;
    const { leaseId, luid, cuid, documentId } = job.data as StoreSignedDocumentJobData;
    this.log.error(
      { jobId: job.id, leaseId, luid, cuid, documentId, attemptsMade: job.attemptsMade },
      `Gave up storing the signed BoldSign PDF for lease ${luid} (document ${documentId}): ${error.message}`
    );
  }
}
