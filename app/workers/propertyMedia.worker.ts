import { Job } from 'bull';
import Logger from 'bunyan';
import { createLogger } from '@utils/index';
import { PropertyMediaService } from '@services/index';
import {
  PropertyMediaFailureJobData,
  PropertyMediaUpdateJobData,
} from '@queues/propertyMedia.queue';

interface IConstructor {
  propertyMediaService: PropertyMediaService;
}

export class PropertyMediaWorker {
  private readonly propertyMediaService: PropertyMediaService;
  private log: Logger;

  constructor({ propertyMediaService }: IConstructor) {
    this.log = createLogger('PropertyMediaWorker');
    this.propertyMediaService = propertyMediaService;
  }

  updateDocuments = async (job: Job<PropertyMediaUpdateJobData>): Promise<void> => {
    const { propertyId, uploadResults, userId, resourceType } = job.data;

    this.log.info(`Processing document update for property ${propertyId}`, {
      propertyId,
      uploadResultsCount: uploadResults.length,
      userId,
      resourceType,
    });

    try {
      job.progress(20);

      const result = await this.propertyMediaService.updatePropertyDocuments(
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
        await this.propertyMediaService.markDocumentsAsFailed(propertyId, error.message);
      } catch (markFailedError: any) {
        this.log.error(`Failed to mark documents as failed for property ${propertyId}:`, {
          propertyId,
          error: markFailedError.message,
        });
      }

      return Promise.reject(new Error(error.message));
    }
  };

  markDocumentsAsFailed = async (job: Job<PropertyMediaFailureJobData>): Promise<void> => {
    const { propertyId, error, userId, resourceType } = job.data;

    this.log.info(`Marking documents as failed for property ${propertyId}`, {
      propertyId,
      error,
      userId,
      resourceType,
    });

    try {
      job.progress(50);

      await this.propertyMediaService.markDocumentsAsFailed(propertyId, error);

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
