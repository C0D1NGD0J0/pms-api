import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PropertyService } from '@services/index';
import { DocumentFailureJobData, DocumentUpdateJobData } from '@queues/documentProcessing.queue';

interface IConstructor {
  propertyService: PropertyService;
}

export class DocumentProcessingWorker {
  private readonly propertyService: PropertyService;
  private log: Logger;

  constructor({ propertyService }: IConstructor) {
    this.log = createLogger('DocumentProcessingWorker');
    this.propertyService = propertyService;
  }

  updateDocuments = async (job: Job<DocumentUpdateJobData>): Promise<void> => {
    const { propertyId, uploadResults, userId, resourceType } = job.data;

    this.log.info(`Processing document update for property ${propertyId}`, {
      propertyId,
      uploadResultsCount: uploadResults.length,
      userId,
      resourceType,
    });

    try {
      job.progress(20);

      const result = await this.propertyService.updatePropertyDocuments(
        propertyId,
        uploadResults,
        userId
      );

      job.progress(80);

      if (!result.success) {
        throw new Error('Failed to update property documents');
      }

      job.progress(100);
      this.log.info(`Successfully updated documents for property ${propertyId}`);

      return Promise.resolve();
    } catch (error: any) {
      this.log.error(`Error updating documents for property ${propertyId}:`, {
        propertyId,
        error: error.message,
        stack: error.stack,
      });

      try {
        await this.propertyService.markDocumentsAsFailed(propertyId, error.message);
      } catch (markFailedError: any) {
        this.log.error(`Failed to mark documents as failed for property ${propertyId}:`, {
          propertyId,
          error: markFailedError.message,
        });
      }

      return Promise.reject(new Error(error.message));
    }
  };

  markDocumentsAsFailed = async (job: Job<DocumentFailureJobData>): Promise<void> => {
    const { propertyId, error, userId, resourceType } = job.data;

    this.log.info(`Marking documents as failed for property ${propertyId}`, {
      propertyId,
      error,
      userId,
      resourceType,
    });

    try {
      job.progress(50);

      await this.propertyService.markDocumentsAsFailed(propertyId, error);

      job.progress(100);
      this.log.info(`Successfully marked documents as failed for property ${propertyId}`);

      return Promise.resolve();
    } catch (markFailedError: any) {
      this.log.error(`Error marking documents as failed for property ${propertyId}:`, {
        propertyId,
        error: markFailedError.message,
        stack: markFailedError.stack,
      });

      return Promise.reject(new Error(markFailedError.message));
    }
  };
}
