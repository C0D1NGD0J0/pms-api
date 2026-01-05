import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { PropertyDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { BadRequestError } from '@shared/customErrors';
import { EventEmitterService, MediaUploadService } from '@services/index';
import { ISuccessReturnData, UploadResult } from '@interfaces/utils.interface';
import { UploadCompletedPayload, UploadFailedPayload, EventTypes } from '@interfaces/index';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  propertyDAO: PropertyDAO;
}

/**
 * PropertyMediaService
 *
 * Handles all media and document operations for properties including:
 * - Document uploads and updates
 * - Media file management
 * - Upload success/failure event handling
 * - Document status tracking
 *
 * Extracted from PropertyService to improve separation of concerns and maintainability.
 */
export class PropertyMediaService {
  private readonly log: Logger;
  private readonly propertyDAO: PropertyDAO;
  private readonly mediaUploadService: MediaUploadService;
  private readonly emitterService: EventEmitterService;

  constructor({ propertyDAO, mediaUploadService, emitterService }: IConstructor) {
    this.propertyDAO = propertyDAO;
    this.mediaUploadService = mediaUploadService;
    this.emitterService = emitterService;
    this.log = createLogger('PropertyMediaService');

    this.setupEventListeners();
  }

  /**
   * Setup event listeners for media upload events
   * @private
   */
  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));

    this.log.info('PropertyMediaService event listeners initialized');
  }

  /**
   * Update property documents after successful upload
   *
   * @param propertyUid - Property unique identifier (pid)
   * @param uploadResult - Array of upload results from media service
   * @param userid - User ID performing the update
   * @returns Success response with updated property
   *
   * @throws BadRequestError if propertyUid or uploadResult is missing
   * @throws BadRequestError if property not found or update fails
   */
  async updatePropertyDocuments(
    propertyUid: string,
    uploadResult: UploadResult[],
    userid: string
  ): Promise<ISuccessReturnData> {
    if (!propertyUid) {
      throw new BadRequestError({ message: t('property.errors.propertyIdRequired') });
    }

    if (!uploadResult || uploadResult.length === 0) {
      throw new BadRequestError({ message: t('property.errors.uploadResultRequired') });
    }

    const property = await this.propertyDAO.findFirst({
      pid: propertyUid,
      deletedAt: null,
    });

    if (!property) {
      throw new BadRequestError({ message: t('property.errors.unableToFind') });
    }

    const updatedProperty = await this.propertyDAO.updatePropertyDocument(
      propertyUid,
      uploadResult,
      userid
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to update property.' });
    }

    return { success: true, data: updatedProperty, message: 'Property updated successfully' };
  }

  /**
   * Mark documents as failed when upload processing fails
   *
   * @param propertyId - Property MongoDB ObjectId
   * @param errorMessage - Error message describing the failure
   *
   * Updates all pending documents to failed status with error message
   */
  async markDocumentsAsFailed(propertyId: string, errorMessage: string): Promise<void> {
    try {
      const property = await this.propertyDAO.findById(propertyId);
      if (!property || !property.documents) return;

      const updateOperations: any = {};
      const now = new Date();

      property.documents.forEach((doc, index) => {
        const isPending = doc.status === 'pending';

        if (isPending) {
          updateOperations[`documents.${index}.status`] = 'failed';
          updateOperations[`documents.${index}.errorMessage`] = errorMessage;
          updateOperations[`documents.${index}.processingCompleted`] = now;
        }
      });

      if (Object.keys(updateOperations).length > 0) {
        await this.propertyDAO.update(
          { _id: new Types.ObjectId(propertyId) },
          { $set: updateOperations }
        );

        this.log.warn(`Marked documents as failed for property ${propertyId}`, { errorMessage });
      }
    } catch (error) {
      this.log.error(`Error marking documents as failed for property ${propertyId}:`, error);
    }
  }

  /**
   * Handle UPLOAD_COMPLETED event
   *
   * @param payload - Upload completed event payload
   * @private
   *
   * Processes completed upload events for property documents and updates property records
   */
  private async handleUploadCompleted(payload: UploadCompletedPayload): Promise<void> {
    const { results, resourceName, resourceId, actorId } = payload;

    if (resourceName !== 'property') {
      this.log.debug(t('property.logging.ignoringUploadEvent'), {
        resourceName,
      });
      return;
    }

    try {
      await this.updatePropertyDocuments(resourceId, results, actorId);

      this.log.info(
        {
          propertyId: resourceId,
        },
        'Successfully processed upload completed event'
      );
    } catch (error) {
      this.log.error(
        {
          error: error instanceof Error ? error.message : 'Unknown error',
          propertyId: resourceId,
        },
        'Error processing upload completed event'
      );

      try {
        await this.markDocumentsAsFailed(
          resourceId,
          `Failed to process completed upload: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (markFailedError) {
        this.log.error(
          {
            error:
              markFailedError instanceof Error
                ? markFailedError.message
                : t('property.errors.unknownError'),
            propertyId: resourceId,
          },
          'Failed to mark documents as failed after upload processing error'
        );
      }
    }
  }

  /**
   * Handle UPLOAD_FAILED event
   *
   * @param payload - Upload failed event payload
   * @private
   *
   * Processes failed upload events and marks property documents as failed
   */
  private async handleUploadFailed(payload: UploadFailedPayload): Promise<void> {
    const { error, resourceType, resourceId } = payload;

    this.log.info(t('property.logging.receivedUploadFailedEvent'), {
      resourceType,
      resourceId,
      error: error.message,
    });

    try {
      await this.markDocumentsAsFailed(resourceId, error.message);

      this.log.info(t('property.logging.processedUploadFailedEvent'), {
        propertyId: resourceId,
      });
    } catch (markFailedError) {
      this.log.error(t('property.logging.errorProcessingUploadFailed'), {
        error:
          markFailedError instanceof Error
            ? markFailedError.message
            : t('property.errors.unknownError'),
        propertyId: resourceId,
      });
    }
  }

  /**
   * Cleanup method to remove event listeners
   * Should be called when service is being destroyed
   */
  async destroy(): Promise<void> {
    this.log.info('Cleaning up PropertyMediaService');

    // Remove all event listeners
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.emitterService.off(EventTypes.UPLOAD_FAILED, this.handleUploadFailed);

    this.log.info('PropertyMediaService event listeners removed');
  }
}
