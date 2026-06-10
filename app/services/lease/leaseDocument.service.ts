import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { LeaseDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { BadRequestError } from '@shared/customErrors';
import { ILeaseDocument } from '@interfaces/lease.interface';
import {
  IPromiseReturnedData,
  ISuccessReturnData,
  UploadResult,
} from '@interfaces/utils.interface';

interface IConstructor {
  leaseDAO: LeaseDAO;
}

export class LeaseDocumentService {
  private readonly log: Logger;
  private readonly leaseDAO: LeaseDAO;

  constructor({ leaseDAO }: IConstructor) {
    this.leaseDAO = leaseDAO;
    this.log = createLogger('LeaseDocumentService');
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
}
