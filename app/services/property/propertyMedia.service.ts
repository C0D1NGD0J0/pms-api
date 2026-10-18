import Logger from 'bunyan';
import { t } from '@shared/languages';
import { PropertyDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { UploadFailedPayload, EventTypes } from '@interfaces/index';
import { EventEmitterService, MediaUploadService } from '@services/index';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  propertyDAO: PropertyDAO;
}

/**
 * PropertyMediaService
 *
 * Handles all media and document operations for properties including:
 * - Media file management
 * - Upload failure event handling
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
  }

  private readonly onUploadFailed = this.handleUploadFailed.bind(this);

  /**
   * Subscribe to media upload events.
   * Property uploads are saved by PropertyService in the request that sent them, so
   * UPLOAD_COMPLETED is deliberately not handled here.
   */
  registerEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.onUploadFailed);
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
      const property = await this.propertyDAO.findFirst(
        { pid: propertyId, deletedAt: null },
        { projection: { documents: 1 } }
      );
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
        await this.propertyDAO.update({ pid: propertyId }, { $set: updateOperations });

        this.log.warn(`Marked documents as failed for property ${propertyId}`, { errorMessage });
      }
    } catch (error) {
      this.log.error(`Error marking documents as failed for property ${propertyId}:`, error);
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
    const { error, resourceType, resourceId, resourceName } = payload;
    if (resourceName !== 'property') return;

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
    this.emitterService.off(EventTypes.UPLOAD_FAILED, this.onUploadFailed);

    this.log.info('PropertyMediaService event listeners removed');
  }
}
