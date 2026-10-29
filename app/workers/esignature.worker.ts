import { Job } from 'bull';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { LeaseDAO } from '@dao/leaseDAO';
import { LeaseCache } from '@caching/index';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { S3Service } from '@services/fileUpload';
import { EventTypes } from '@interfaces/events.interface';
import { OwnershipType } from '@interfaces/property.interface';
import { EventEmitterService, SSEService } from '@services/index';
import { buildSignedLeaseFilename } from '@services/lease/leaseHelpers';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { BoldSignService } from '@services/external/esignature/boldSign.service';
import {
  LeaseESignatureRequestedPayload,
  LeaseESignatureFailedPayload,
  LeaseESignatureSentPayload,
} from '@interfaces/lease.interface';
import {
  StoreSignedDocumentJobResult,
  StoreSignedDocumentJobData,
  BoldSignJobResult,
  BoldSignJobData,
} from '@interfaces/esignature.interface';

// BoldSign can briefly answer 404/409 right after Completed while it finalises the PDF;
// these (and throttling/timeouts) are retried, every other 4xx is permanent
const RETRYABLE_DOWNLOAD_STATUSES = [404, 408, 409, 429];

interface IConstructor {
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  boldSignService: BoldSignService;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  leaseCache: LeaseCache;
  sseService: SSEService;
  s3Service: S3Service;
  leaseDAO: LeaseDAO;
}

export class ESignatureWorker {
  private readonly log: Logger;
  private readonly emitterService: EventEmitterService;
  private readonly boldSignService: BoldSignService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly leaseDAO: LeaseDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly leaseCache: LeaseCache;
  private readonly sseService: SSEService;
  private readonly s3Service: S3Service;

  constructor({
    emitterService,
    boldSignService,
    mediaUploadService,
    leaseDAO,
    profileDAO,
    propertyDAO,
    leaseCache,
    sseService,
    s3Service,
  }: IConstructor) {
    this.log = createLogger('ESignatureWorker');
    this.emitterService = emitterService;
    this.boldSignService = boldSignService;
    this.mediaUploadService = mediaUploadService;
    this.leaseDAO = leaseDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.leaseCache = leaseCache;
    this.sseService = sseService;
    this.s3Service = s3Service;
  }

  sendForSignature = async (job: Job<BoldSignJobData>): Promise<BoldSignJobResult> => {
    const { resource, cuid, luid, leaseId, senderInfo, managedBy } = job.data;
    job.progress(10);

    try {
      this.emitterService.emit(EventTypes.LEASE_ESIGNATURE_REQUESTED, {
        jobId: job.id,
        leaseId,
        luid,
        cuid,
        actorId: resource.actorId,
      } as LeaseESignatureRequestedPayload);

      job.progress(20);
      const lease = await this.leaseDAO.findFirst(
        { _id: new Types.ObjectId(leaseId), cuid, deletedAt: null },
        {
          populate: [
            { path: 'property.id', select: '+owner +authorization' },
            { path: 'property.unitId' },
          ],
        }
      );
      if (!lease) {
        throw new Error('Lease not found');
      }

      job.progress(30);
      const leasePDF = lease.leaseDocuments?.find(
        (doc) => doc.documentType === 'lease_agreement' && doc.status === 'active'
      );
      if (!leasePDF || !leasePDF.key) {
        throw new Error(
          'Lease PDF not found. PDF must be generated before sending for e-signature.'
        );
      }

      const pdfBuffer = await this.mediaUploadService.downloadFileAsBuffer(leasePDF.key);
      job.progress(50);
      const tenant = await this.profileDAO.findFirst(
        { user: new Types.ObjectId(lease.tenantId) },
        { populate: 'user' }
      );
      if (!tenant || !tenant.user) {
        throw new Error('Tenant information not found');
      }

      const tenantUser = typeof tenant.user === 'object' ? (tenant.user as any) : null;
      if (!tenantUser || !tenantUser.email) {
        throw new Error('Tenant email not found');
      }
      job.progress(60);

      const property = await this.propertyDAO.findFirst(
        { _id: new Types.ObjectId(lease.property.id) },
        { select: '+owner +authorization' }
      );
      if (!property) {
        throw new Error('Property not found');
      }

      // Determine who signs on the landlord/owner side
      const isExternalOwner = property.owner?.type === OwnershipType.EXTERNAL_OWNER;
      const isPmAuthorized = property.isManagementAuthorized();
      const landlordSigns = isExternalOwner && !isPmAuthorized;

      const signers: Array<{
        name: string;
        email: string;
        role: 'tenant' | 'co_tenant' | 'landlord' | 'property_manager';
        userId?: Types.ObjectId;
      }> = [];

      if (landlordSigns) {
        // External owner signs directly — PM is not authorized to sign on their behalf
        if (!property.owner?.email) {
          throw new Error(
            'External owner email is required for direct landlord signing. ' +
              'Please update the property owner information or authorize PM to sign on behalf.'
          );
        }
        signers.push({
          name: property.owner.name || 'Property Owner',
          email: property.owner.email,
          role: 'landlord',
        });
      } else {
        // PM signs (company_owned, self_owned, or authorized external_owner).
        // Use lease-level managedBy override if present (set when PM is changed on the lease form),
        // otherwise fall back to the property's assigned manager.
        const pmUserId = managedBy || property.managedBy;
        const propertyManager = await this.profileDAO.findFirst(
          { user: new Types.ObjectId(pmUserId) },
          { populate: 'user' }
        );
        if (!propertyManager || !propertyManager.user) {
          throw new Error('Property manager information not found');
        }

        const pmUser =
          typeof propertyManager.user === 'object' ? (propertyManager.user as any) : null;
        if (!pmUser || !pmUser.email) {
          throw new Error('Property manager email not found');
        }

        signers.push({
          name:
            `${propertyManager.personalInfo?.firstName || ''} ${propertyManager.personalInfo?.lastName || ''}`.trim() ||
            'Property Manager',
          email: pmUser.email,
          role: 'property_manager',
          userId: propertyManager._id,
        });
      }
      job.progress(70);

      // Tenant always signs
      signers.push({
        name:
          `${tenant.personalInfo?.firstName || ''} ${tenant.personalInfo?.lastName || ''}`.trim() ||
          'Tenant',
        email: tenantUser.email,
        role: 'tenant',
        userId: tenant._id,
      });

      if (lease.coTenants && lease.coTenants.length > 0) {
        lease.coTenants.forEach((coTenant, index) => {
          if (coTenant.email) {
            signers.push({
              name: coTenant.name || `Co-Tenant ${index + 1}`,
              email: coTenant.email,
              role: 'co_tenant',
            });
          }
        });
      }

      job.progress(80);
      const result = await this.boldSignService.sendDocumentForSignature({
        title: `Lease Agreement - ${property.address?.fullAddress || property.name}`,
        pdfBuffer,
        pdfFileName: `lease-${lease.luid}.pdf`,
        signers,
        message: 'Please review and sign this lease agreement.',
        expiryDays: 30,
        senderInfo,
      });

      job.progress(90);
      this.emitterService.emit(EventTypes.LEASE_ESIGNATURE_SENT, {
        jobId: job.id,
        leaseId,
        luid,
        cuid,
        actorId: resource.actorId,
        envelopeId: result.documentId,
        signers: signers.map((s) => ({ name: s.name, email: s.email, role: s.role })),
        sentAt: new Date(),
      } as LeaseESignatureSentPayload);

      job.progress(100);
      return {
        success: true,
        documentId: result.documentId,
        signers: signers.map((s) => ({ name: s.name, email: s.email })),
      };
    } catch (error: any) {
      this.log.error(`Error processing BoldSign job ${job.id}:`, error);

      // Emit failure event
      this.emitterService.emit(EventTypes.LEASE_ESIGNATURE_FAILED, {
        jobId: job.id,
        leaseId,
        luid,
        cuid,
        actorId: resource.actorId,
        error: error.message,
        errorDetails: error.stack,
      } as LeaseESignatureFailedPayload);

      return {
        success: false,
        error: error.message,
      };
    }
  };

  /**
   * Copies a completed envelope's signed PDF from BoldSign onto the lease as 'signed_lease'.
   * Safe to re-run: the S3 key is derived from the envelope, so a retry overwrites the same
   * object and updateLeaseDocuments skips a key the lease already holds.
   */
  storeSignedDocument = async (
    job: Job<StoreSignedDocumentJobData>
  ): Promise<StoreSignedDocumentJobResult> => {
    const { cuid, luid, leaseId, documentId } = job.data;
    const log = this.log.child({ jobId: job.id, luid, cuid, documentId });

    const lease = await this.leaseDAO.findFirst({
      _id: new Types.ObjectId(leaseId),
      cuid,
      deletedAt: null,
    });
    if (!lease) {
      // Nothing to attach the document to; retrying won't change that
      log.warn('Lease not found, skipping signed document storage');
      return { success: false, skipped: true };
    }

    const filename = buildSignedLeaseFilename(lease.leaseNumber, documentId);
    const s3Key = `lease/signed_${lease.leaseNumber}|||${leaseId}|||_${documentId}.pdf`;
    const alreadyStored = lease.leaseDocuments?.some(
      (doc) =>
        doc.documentType === 'signed_lease' && (doc.key === s3Key || doc.filename === filename)
    );
    if (alreadyStored) {
      log.info('Signed document already stored, skipping');
      return { success: true, skipped: true, key: s3Key };
    }

    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await this.boldSignService.downloadSignedDocument(documentId);
    } catch (error: any) {
      const statusCode: number | undefined = error?.statusCode;
      const isPermanent =
        !!statusCode &&
        statusCode >= 400 &&
        statusCode < 500 &&
        !RETRYABLE_DOWNLOAD_STATUSES.includes(statusCode);
      if (isPermanent) {
        log.error(
          { statusCode, error: error?.message },
          'BoldSign refused the signed document download; not retrying'
        );
        await job.discard();
      }
      throw error;
    }
    await job.progress(50);

    const uploaded = await this.s3Service.uploadBuffer(
      pdfBuffer,
      s3Key,
      'application/pdf',
      leaseId
    );
    await job.progress(80);

    await this.leaseDAO.updateLeaseDocuments(
      leaseId,
      [
        {
          resourceId: leaseId,
          fieldName: 'leaseDocument',
          publicuid: luid,
          documentType: 'signed_lease',
          mimeType: 'application/pdf',
          actorId: lease.createdBy.toString(),
          size: pdfBuffer.length,
          url: uploaded.url,
          key: uploaded.key,
          filename,
        },
      ],
      lease.createdBy.toString(),
      cuid
    );

    await Promise.allSettled([
      this.leaseCache.invalidateLease(cuid, luid),
      this.leaseCache.invalidateLeaseLists(cuid),
    ]);
    try {
      // Everyone viewing the lease refetches and sees the signed copy
      await this.sseService.broadcastToClient(
        cuid,
        { resource: 'lease', action: 'document-added', resourceUId: luid },
        'resource-event'
      );
    } catch (sseErr) {
      log.warn({ sseErr }, 'SSE notify failed (non-fatal)');
    }

    log.info({ key: uploaded.key }, 'Stored signed lease document');
    return { success: true, key: uploaded.key };
  };
}
