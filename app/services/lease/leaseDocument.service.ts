import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { LeaseDAO } from '@dao/index';
import { createLogger } from '@utils/index';
import { S3Service } from '@services/fileUpload';
import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { ILeaseDocument } from '@interfaces/lease.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  IPromiseReturnedData,
  ISuccessReturnData,
  UploadResult,
} from '@interfaces/utils.interface';

import { assignUploadedLeaseDocumentTypes, findActiveLeasePDF } from './leaseHelpers';

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

  /** Attaches a document the controller has already uploaded to S3. */
  async uploadLeaseDocument(
    cuid: string,
    leaseId: string,
    document: UploadResult | undefined,
    uploadedBy: string
  ): IPromiseReturnedData<ILeaseDocument> {
    if (!document) {
      throw new BadRequestError({ message: 'No file provided' });
    }

    const lease = await this._findLease(leaseId, cuid);

    const updated = await this.leaseDAO.updateLeaseDocuments(
      lease._id.toString(),
      assignUploadedLeaseDocumentTypes(lease, [
        { ...document, resourceId: lease._id.toString(), publicuid: lease.luid },
      ]),
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

  async getLeaseDocumentUrl(
    cuid: string,
    leaseId: string,
    viewer?: ICurrentUser
  ): IPromiseReturnedData<string> {
    const lease = await this._findLease(leaseId, cuid);

    // A tenant's read grant is scoped to their own leases
    if (viewer?.client?.role === ROLES.TENANT && lease.tenantId?.toString() !== viewer.sub) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    // Prefer the signed copy, then the agreement, over supporting documents
    const activeDoc =
      findActiveLeasePDF(lease) || lease.leaseDocuments?.find((d: any) => d.status === 'active');
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
    const updated = await this.leaseDAO.updateLeaseDocumentStatus(
      lease._id.toString(),
      'deleted',
      undefined,
      cuid
    );
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

    // Internal only: LeaseService passes the _id of a lease it already loaded by luid
    const lease = await this.leaseDAO.findFirst({
      _id: new Types.ObjectId(leaseId),
      deletedAt: null,
    });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    const updatedLease = await this.leaseDAO.updateLeaseDocuments(
      leaseId,
      assignUploadedLeaseDocumentTypes(lease, uploadResults),
      userId
    );
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

  // Every caller is a request handler naming the lease by its luid
  private async _findLease(luid: string, cuid: string): Promise<ILeaseDocument> {
    const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
    if (!lease) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }
    return lease;
  }
}
