import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { PropertyMediaWorker } from '@workers/index';

import { BaseQueue } from './base.queue';

export interface PropertyMediaUpdateJobData {
  uploadResults: any[];
  resourceType: string;
  propertyId: string;
  userId: string;
}

export interface PropertyMediaFailureJobData {
  resourceType: string;
  propertyId: string;
  userId: string;
  error: string;
}

export class PropertyMediaQueue extends BaseQueue {
  constructor({ propertyMediaWorker }: { propertyMediaWorker: PropertyMediaWorker }) {
    super({ queueName: QUEUE_NAMES.PROPERTY_MEDIA_PROCESSING_QUEUE });
    this.processQueueJobs(JOB_NAME.DOCUMENT_UPDATE_JOB, 3, propertyMediaWorker.updateDocuments);
    this.processQueueJobs(
      JOB_NAME.DOCUMENT_FAILURE_JOB,
      5,
      propertyMediaWorker.markDocumentsAsFailed
    );
  }

  async addDocumentUpdateJob(data: PropertyMediaUpdateJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.DOCUMENT_UPDATE_JOB, data);
  }

  async addDocumentFailureJob(data: PropertyMediaFailureJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.DOCUMENT_FAILURE_JOB, data);
  }
}
