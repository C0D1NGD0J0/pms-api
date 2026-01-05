import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { LeaseDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { EventEmitterService } from '@services/index';
import { BadRequestError } from '@shared/customErrors';
import { ILeaseDocument } from '@interfaces/lease.interface';
import {
  IPromiseReturnedData,
  ISuccessReturnData,
  UploadResult,
} from '@interfaces/utils.interface';
import {
  UploadCompletedPayload,
  UploadFailedPayload,
  EventTypes,
} from '@interfaces/events.interface';

interface IConstructor {
  emitterService: EventEmitterService;
  leaseDAO: LeaseDAO;
}

export class LeaseDocumentService {
  private readonly log: Logger;
  private readonly leaseDAO: LeaseDAO;
  private readonly emitterService: EventEmitterService;
  private readonly pendingSenderInfo: Map<string, { email: string; name: string }>;

  constructor({ leaseDAO, emitterService }: IConstructor) {
    this.leaseDAO = leaseDAO;
    this.emitterService = emitterService;
    this.pendingSenderInfo = new Map();
    this.log = createLogger('LeaseDocumentService');
    this.setupEventListeners();
  }

  /**
   * Upload a document for a lease
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @param _file - File to upload
   * @param _uploadedBy - User ID of uploader
   */
  async uploadLeaseDocument(
    cuid: string,
    leaseId: string,
    _file: any,
    _uploadedBy: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Uploading document for lease ${leaseId}`);
    throw new Error('uploadLeaseDocument not yet implemented');
  }

  /**
   * Get URL for a lease document
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   */
  async getLeaseDocumentUrl(cuid: string, leaseId: string): IPromiseReturnedData<string> {
    this.log.info(`Getting document URL for lease ${leaseId}`);
    throw new Error('getLeaseDocumentUrl not yet implemented');
  }

  /**
   * Remove a document from a lease
   * @param cuid - Client ID
   * @param leaseId - Lease ID
   * @param _userId - User ID requesting removal
   */
  async removeLeaseDocument(
    cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Removing document for lease ${leaseId}`);
    throw new Error('removeLeaseDocument not yet implemented');
  }

  /**
   * Update lease with uploaded document information
   * @param leaseId - Lease ID (ObjectId or luid)
   * @param uploadResults - Array of upload results
   * @param userId - User ID who uploaded
   */
  async updateLeaseDocuments(
    leaseId: string,
    uploadResults: UploadResult[],
    userId: string
  ): Promise<ISuccessReturnData> {
    if (!leaseId) {
      throw new BadRequestError({ message: 'Lease ID is required' });
    }

    if (!uploadResults || uploadResults.length === 0) {
      throw new BadRequestError({ message: 'Upload results are required' });
    }

    // Flexible query - supports both ObjectId and luid
    const query = Types.ObjectId.isValid(leaseId)
      ? { _id: new Types.ObjectId(leaseId), deletedAt: null }
      : { luid: leaseId, deletedAt: null };

    const lease = await this.leaseDAO.findFirst(query);
    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }
    const updatedLease = await this.leaseDAO.updateLeaseDocuments(leaseId, uploadResults, userId);
    if (!updatedLease) {
      throw new BadRequestError({ message: 'Unable to update lease documents' });
    }
    return {
      success: true,
      data: updatedLease,
      message: 'Lease documents updated successfully',
    };
  }

  /**
   * Mark lease documents as failed
   * @param leaseId - Lease ID
   * @param errorMessage - Error message to record
   */
  async markLeaseDocumentsAsFailed(leaseId: string, errorMessage: string): Promise<void> {
    this.log.warn('Marking lease documents as failed', {
      leaseId,
      errorMessage,
    });

    await this.leaseDAO.updateLeaseDocumentStatus(leaseId, 'failed', errorMessage);
  }

  /**
   * Store sender info for lease document email notifications
   * @param leaseId - Lease ID
   * @param senderInfo - Sender email and name
   */
  storePendingSenderInfo(leaseId: string, senderInfo: { email: string; name: string }): void {
    this.pendingSenderInfo.set(leaseId, senderInfo);
    this.log.debug('Stored pending sender info', { leaseId, senderInfo });
  }

  /**
   * Get stored sender info for a lease
   * @param leaseId - Lease ID
   */
  getPendingSenderInfo(leaseId: string): { email: string; name: string } | undefined {
    return this.pendingSenderInfo.get(leaseId);
  }

  /**
   * Clear stored sender info for a lease
   * @param leaseId - Lease ID
   */
  clearPendingSenderInfo(leaseId: string): void {
    this.pendingSenderInfo.delete(leaseId);
  }

  /**
   * Handle upload completed event
   * @param payload - Upload completed event payload
   */
  private async handleUploadCompleted(payload: UploadCompletedPayload): Promise<void> {
    const { results, resourceName, resourceId, actorId } = payload;

    if (resourceName !== 'lease') {
      this.log.debug('Ignoring non-lease upload event', { resourceName });
      return;
    }

    try {
      await this.updateLeaseDocuments(resourceId, results, actorId);
      const senderInfo = this.pendingSenderInfo.get(resourceId);
      if (senderInfo) {
        this.log.info('PDF upload completed, emitting PDF_GENERATED event', {
          leaseId: resourceId,
          hasSenderInfo: !!senderInfo,
        });

        const pdfResult = results.find((r) => r.key && r.url);
        if (pdfResult) {
          this.emitterService.emit(EventTypes.PDF_GENERATED, {
            jobId: 'upload-completed',
            leaseId: resourceId,
            pdfUrl: pdfResult.url,
            s3Key: pdfResult.key || '',
            fileSize: pdfResult.size,
            senderInfo,
          });

          // Clean up stored senderInfo
          this.pendingSenderInfo.delete(resourceId);
        } else {
          this.log.warn('No PDF result found in upload results', { resourceId });
        }
      }
    } catch (error) {
      this.log.error('Error processing lease upload completed event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        leaseId: resourceId,
      });

      // Clean up stored senderInfo on error
      this.pendingSenderInfo.delete(resourceId);

      try {
        await this.markLeaseDocumentsAsFailed(
          resourceId,
          `Failed to process completed upload: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      } catch (markFailedError) {
        this.log.error('Failed to mark lease documents as failed after upload processing error', {
          error: markFailedError instanceof Error ? markFailedError.message : 'Unknown error',
          leaseId: resourceId,
        });
      }
    }
  }

  /**
   * Handle upload failed event
   * @param payload - Upload failed event payload
   */
  private async handleUploadFailed(payload: UploadFailedPayload): Promise<void> {
    const { error, resourceId } = payload;

    this.log.error('Received upload failed event for lease', {
      resourceId,
      error: error.message,
    });

    try {
      await this.markLeaseDocumentsAsFailed(resourceId, error.message);
    } catch (markFailedError) {
      this.log.error('Failed to mark lease documents as failed', {
        error: markFailedError instanceof Error ? markFailedError.message : 'Unknown error',
        leaseId: resourceId,
      });
    }
  }

  /**
   * Setup event listeners for upload events
   */
  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));
    this.log.info('Lease document service event listeners registered');
  }

  /**
   * Cleanup event listeners
   */
  cleanupEventListeners(): void {
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.emitterService.off(EventTypes.UPLOAD_FAILED, this.handleUploadFailed);
    this.log.info('Lease document service event listeners removed');
  }
}
