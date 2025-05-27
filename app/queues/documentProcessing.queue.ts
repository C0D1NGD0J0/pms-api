import { QUEUE_NAMES, JOB_NAME } from '@utils/index';
import { DocumentProcessingWorker } from '@workers/index';

import { BaseQueue } from './base.queue';

export interface DocumentUpdateJobData {
  uploadResults: any[];
  resourceType: string;
  propertyId: string;
  userId: string;
}

export interface DocumentFailureJobData {
  resourceType: string;
  propertyId: string;
  userId: string;
  error: string;
}

export class DocumentProcessingQueue extends BaseQueue {
  constructor({
    documentProcessingWorker,
  }: {
    documentProcessingWorker: DocumentProcessingWorker;
  }) {
    super(QUEUE_NAMES.DOCUMENT_PROCESSING_QUEUE);
    this.processQueueJobs(
      JOB_NAME.DOCUMENT_UPDATE_JOB,
      3,
      documentProcessingWorker.updateDocuments
    );
    this.processQueueJobs(
      JOB_NAME.DOCUMENT_FAILURE_JOB,
      5,
      documentProcessingWorker.markDocumentsAsFailed
    );
  }

  async addDocumentUpdateJob(data: DocumentUpdateJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.DOCUMENT_UPDATE_JOB, data);
  }

  async addDocumentFailureJob(data: DocumentFailureJobData): Promise<void> {
    await this.addJobToQueue(JOB_NAME.DOCUMENT_FAILURE_JOB, data);
  }
}
