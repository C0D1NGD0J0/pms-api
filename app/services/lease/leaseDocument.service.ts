import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { LeaseDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { S3Service } from '@services/fileUpload';
import { ILeaseDocument } from '@interfaces/lease.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  IPromiseReturnedData,
  ISuccessReturnData,
  UploadResult,
} from '@interfaces/utils.interface';

interface IConstructor {
  s3Service: S3Service;
  leaseDAO: LeaseDAO;
}

export class LeaseDocumentService {
  private readonly log: Logger;
  private readonly leaseDAO: LeaseDAO;
  private readonly s3Service: S3Service;

  constructor({ leaseDAO, s3Service }: IConstructor) {
    this.leaseDAO = leaseDAO;
    this.s3Service = s3Service;
    this.log = createLogger('LeaseDocumentService');
  }

  async uploadLeaseDocument(
    cuid: string,
    leaseId: string,
    file: any,
    uploadedBy: string
  ): IPromiseReturnedData<ILeaseDocument> {
    if (!file) {
      throw new BadRequestError({ message: 'No file provided' });
    }

    const lease = await this._findLease(leaseId, cuid);

    const uploadResult: UploadResult = {
      key: file.key || file.location,
      url: file.location || file.path,
      size: file.size,
      mimeType: file.mimetype,
    };

    const updated = await this.leaseDAO.updateLeaseDocuments(
      lease._id.toString(),
      [uploadResult],
      uploadedBy
    );

    if (!updated) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'upload document' }),
      });
    }

    return {
      success: true,
      data: updated,
      message: t('common.success.created', { resource: 'Lease document' }),
    };
  }

  async getLeaseDocumentUrl(cuid: string, leaseId: string): IPromiseReturnedData<string> {
    const lease = await this._findLease(leaseId, cuid);

    const activeDoc = lease.leaseDocuments?.find((d: any) => d.status === 'active');
    if (!activeDoc?.key) {
      throw new NotFoundError({ message: 'No active document found for this lease' });
    }

    const presignedUrl = await this.s3Service.getSignedUrl(activeDoc.key, {
      disposition: 'inline',
    });
    return {
      success: true,
      data: presignedUrl,
      message: t('common.success.retrieved', { resource: 'Document URL' }),
    };
  }

  async removeLeaseDocument(
    cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    const lease = await this._findLease(leaseId, cuid);

    const activeDoc = lease.leaseDocuments?.find((d: any) => d.status === 'active');
    if (!activeDoc?.key) {
      throw new NotFoundError({ message: 'No active document found for this lease' });
    }

    // Soft-delete: mark as deleted in DB but keep S3 file for audit/record purposes
    const updated = await this.leaseDAO.updateLeaseDocumentStatus(leaseId, 'deleted');
    if (!updated) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'remove document' }),
      });
    }

    return {
      success: true,
      data: updated,
      message: t('common.success.deleted', { resource: 'Lease document' }),
    };
  }

  async updateLeaseDocuments(
    leaseId: string,
    uploadResults: UploadResult[],
    userId: string
  ): Promise<ISuccessReturnData> {
    if (!leaseId) {
      throw new BadRequestError({ message: t('common.errors.required', { field: 'Lease ID' }) });
    }

    if (!uploadResults || uploadResults.length === 0) {
      throw new BadRequestError({
        message: t('common.errors.required', { field: 'Upload results' }),
      });
    }

    const query = Types.ObjectId.isValid(leaseId)
      ? { _id: new Types.ObjectId(leaseId), deletedAt: null }
      : { luid: leaseId, deletedAt: null };

    const lease = await this.leaseDAO.findFirst(query);
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    const updatedLease = await this.leaseDAO.updateLeaseDocuments(leaseId, uploadResults, userId);
    if (!updatedLease) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'update lease documents' }),
      });
    }

    return {
      success: true,
      data: updatedLease,
      message: t('common.success.updated', { resource: 'Lease documents' }),
    };
  }

  async markLeaseDocumentsAsFailed(leaseId: string, errorMessage: string): Promise<void> {
    this.log.warn('Marking lease documents as failed', { leaseId, errorMessage });
    await this.leaseDAO.updateLeaseDocumentStatus(leaseId, 'failed', errorMessage);
  }

  private async _findLease(leaseId: string, cuid?: string): Promise<ILeaseDocument> {
    const query: Record<string, any> = Types.ObjectId.isValid(leaseId)
      ? { _id: new Types.ObjectId(leaseId), deletedAt: null }
      : { luid: leaseId, deletedAt: null };
    if (cuid) query.cuid = cuid;

    const lease = await this.leaseDAO.findFirst(query);
    if (!lease) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }
    return lease;
  }
}
