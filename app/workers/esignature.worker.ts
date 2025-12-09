import { Job } from 'bull';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { LeaseDAO } from '@dao/leaseDAO';
import { createLogger } from '@utils/index';
import { ProfileDAO } from '@dao/profileDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { EventEmitterService } from '@services/index';
import { EventTypes } from '@interfaces/events.interface';
import { BoldSignService } from '@services/esignature/boldSign.service';
import { MediaUploadService } from '@services/mediaUpload/mediaUpload.service';
import { BoldSignJobResult, BoldSignJobData } from '@interfaces/esignature.interface';
import {
  LeaseESignatureRequestedPayload,
  LeaseESignatureFailedPayload,
  LeaseESignatureSentPayload,
} from '@interfaces/lease.interface';

interface IConstructor {
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  boldSignService: BoldSignService;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
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

  constructor({
    emitterService,
    boldSignService,
    mediaUploadService,
    leaseDAO,
    profileDAO,
    propertyDAO,
  }: IConstructor) {
    this.log = createLogger('ESignatureWorker');
    this.emitterService = emitterService;
    this.boldSignService = boldSignService;
    this.mediaUploadService = mediaUploadService;
    this.leaseDAO = leaseDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
  }

  sendForSignature = async (job: Job<BoldSignJobData>): Promise<BoldSignJobResult> => {
    const { resource, cuid, luid, leaseId, senderInfo } = job.data;
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

      const property = await this.propertyDAO.findFirst({
        _id: new Types.ObjectId(lease.property.id),
      });
      if (!property) {
        throw new Error('Property not found');
      }

      const propertyManager = await this.profileDAO.findFirst(
        { user: new Types.ObjectId(property.managedBy) },
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
      job.progress(70);

      // order is important: property manager signs first, then tenant, then co-tenants
      const signers: Array<{
        name: string;
        email: string;
        role: 'tenant' | 'co_tenant' | 'property_manager';
        userId?: Types.ObjectId;
      }> = [
        {
          name:
            `${propertyManager.personalInfo?.firstName || ''} ${propertyManager.personalInfo?.lastName || ''}`.trim() ||
            'Property Manager',
          email: pmUser.email,
          role: 'property_manager',
          userId: propertyManager._id,
        },
        {
          name:
            `${tenant.personalInfo?.firstName || ''} ${tenant.personalInfo?.lastName || ''}`.trim() ||
            'Tenant',
          email: tenantUser.email,
          role: 'tenant',
          userId: tenant._id,
        },
      ];

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
}
