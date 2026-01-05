import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { PdfQueue } from '@queues/index';
import { LeaseCache } from '@caching/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { QueueFactory } from '@services/queue';
import { ProfileDAO, ClientDAO, LeaseDAO } from '@dao/index';
import { determineTemplateType, createLogger } from '@utils/index';
import { IProfileWithUser, OwnershipType } from '@interfaces/index';
import { PdfGeneratorService, MediaUploadService } from '@services/index';
import { EventEmitterService, NotificationService } from '@services/index';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { ILeaseDocument, SigningMethod, LeaseStatus } from '@interfaces/lease.interface';
import { IRequestContext, ResourceContext, UploadResult } from '@interfaces/utils.interface';
import { NotificationPriorityEnum, NotificationTypeEnum } from '@interfaces/notification.interface';
import {
  PdfGenerationRequestedPayload,
  UploadCompletedPayload,
  UploadFailedPayload,
  PdfGeneratedPayload,
  EventTypes,
} from '@interfaces/events.interface';

import { LeaseTemplateService } from './leaseTemplateService';

interface IConstructor {
  notificationService: NotificationService;
  pdfGeneratorService: PdfGeneratorService;
  mediaUploadService: MediaUploadService;
  emitterService: EventEmitterService;
  queueFactory: QueueFactory;
  propertyDAO: PropertyDAO;
  leaseCache: LeaseCache;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
}

export class LeasePdfService {
  private readonly log: Logger;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly leaseCache: LeaseCache;
  private readonly propertyDAO: PropertyDAO;
  private readonly queueFactory: QueueFactory;
  private readonly emitterService: EventEmitterService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly notificationService: NotificationService;
  private readonly leaseTemplateService: LeaseTemplateService;
  private readonly pendingSenderInfo: Map<string, { email: string; name: string }>;

  constructor({
    clientDAO,
    emitterService,
    leaseCache,
    leaseDAO,
    mediaUploadService,
    notificationService,
    pdfGeneratorService,
    profileDAO,
    propertyDAO,
    queueFactory,
  }: IConstructor) {
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.leaseCache = leaseCache;
    this.propertyDAO = propertyDAO;
    this.queueFactory = queueFactory;
    this.pendingSenderInfo = new Map();
    this.emitterService = emitterService;
    this.log = createLogger('LeasePdfService');
    this.mediaUploadService = mediaUploadService;
    this.pdfGeneratorService = pdfGeneratorService;
    this.notificationService = notificationService;
    this.leaseTemplateService = new LeaseTemplateService();
    this.setupEventListeners();
  }

  /**
   * Generate PDF for a lease
   * Called by PdfWorker or directly when PDF is needed
   */
  async generateLeasePDF(
    cuid: string,
    leaseId: string,
    templateType?: string
  ): Promise<{
    success: boolean;
    pdfUrl?: string;
    s3Key?: string;
    error?: string;
    metadata?: { fileSize?: number; generationTime?: number };
  }> {
    try {
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
        throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
      }

      if (lease.status === LeaseStatus.PENDING_SIGNATURE) {
        throw new ValidationRequestError({
          message: 'Cannot edit lease while pending signature. Withdraw it first.',
        });
      }

      if (!lease.tenantId) {
        throw new BadRequestError({
          message: 'Lease tenant information is incomplete. Cannot generate PDF.',
        });
      }

      const tenantDetails = await this.profileDAO.findFirst(
        { user: lease.tenantId },
        { populate: [{ path: 'user', select: 'email' }] }
      );

      if (!tenantDetails) {
        throw new BadRequestError({
          message: 'Tenant information is incomplete. Cannot generate PDF.',
        });
      }

      const previewData = await this.generateLeasePreview(cuid, lease.luid);
      const finalTemplateType =
        templateType || determineTemplateType(lease.property.propertyType || '');
      const html = await this.leaseTemplateService.transformAndRender(
        previewData,
        finalTemplateType
      );

      const pdfResult = await this.pdfGeneratorService.generatePdf(html, {
        format: 'Letter',
        printBackground: true,
      });

      if (!pdfResult.success || !pdfResult.buffer) {
        throw new Error(pdfResult.error || 'PDF generation failed');
      }

      const fileName = `${Date.now()}_${lease.leaseNumber}.pdf`;
      this.mediaUploadService.handleBuffer(pdfResult.buffer, fileName, {
        primaryResourceId: leaseId,
        uploadedBy: lease.createdBy?.toString() || 'system',
        resourceContext: ResourceContext.LEASE,
      });

      return {
        success: true,
        pdfUrl: 'pending',
        s3Key: 'pending',
        metadata: {
          fileSize: pdfResult.metadata?.fileSize,
          generationTime: pdfResult.metadata?.generationTime,
        },
      };
    } catch (error) {
      this.log.error({ error, leaseId, cuid }, 'Failed to generate lease PDF');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      };
    }
  }

  /**
   * Queue lease PDF generation (called by controller)
   * Adds job to queue and returns immediately
   */
  async queueLeasePdfGeneration(
    leaseId: string,
    cuid: string,
    ctx: IRequestContext,
    templateType?: string
  ): Promise<{ success: boolean; jobId?: string | number; error?: string }> {
    try {
      const lease = await this.leaseDAO.findFirst({
        _id: new Types.ObjectId(leaseId),
        cuid,
        deletedAt: null,
      });
      if (!lease) {
        throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
      }

      const pdfGeneratorQueue = this.queueFactory.getQueue('pdfGeneratorQueue') as PdfQueue;
      const job = await pdfGeneratorQueue.addToPdfQueue({
        resource: {
          resourceId: leaseId,
          resourceName: 'lease',
          actorId: ctx.currentuser?.sub || 'system',
          resourceType: 'document',
          fieldName: 'leaseDocument',
        },
        cuid,
        templateType,
      });

      return {
        success: true,
        jobId: job?.id,
      };
    } catch (error) {
      this.log.error({ error, leaseId }, 'Failed to queue PDF generation');
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Generate lease preview data for PDF rendering
   */
  async generateLeasePreview(cuid: string, luid: string) {
    this.log.info(`Generating preview from existing lease ${luid} for client ${cuid}`);

    const lease = await this.leaseDAO.findFirst(
      { luid, cuid, deletedAt: null },
      {
        populate: ['tenantInfo', 'propertyInfo', 'propertyUnitInfo'],
      }
    );

    if (!lease) {
      throw new BadRequestError({ message: 'Lease not found' });
    }

    const property = await this.propertyDAO.findFirst(
      { _id: lease.property.id, cuid, deletedAt: null },
      {
        select: '+owner +authorization',
      }
    );

    if (!property) {
      throw new BadRequestError({ message: 'Property not found' });
    }

    const propertyId =
      typeof lease.property.id === 'string' ? lease.property.id : lease.property.id.toString();
    const landlordInfo = await this.buildLandlordInfo(cuid, propertyId);

    const baseData = {
      leaseNumber: lease.leaseNumber,
      templateType: lease.templateType,
      currentDate: new Date().toISOString(),
      jurisdiction: property.address.country || property.address.city || 'State/Province',

      tenantName: lease.tenantInfo?.fullname || '',
      tenantEmail: lease.tenantInfo?.email || '',
      tenantPhone: lease.tenantInfo?.phoneNumber || '',
      coTenants: lease.coTenants?.map((ct) => ({
        name: ct.name,
        email: ct.email,
        phone: ct.phone,
        occupation: ct.occupation,
      })),

      startDate: lease.duration.startDate.toISOString(),
      endDate: lease.duration.endDate.toISOString(),
      leaseType: lease.type,

      monthlyRent: lease.fees.monthlyRent,
      securityDeposit: lease.fees.securityDeposit,
      rentDueDay: lease.fees.rentDueDay,
      currency: lease.fees.currency,

      petPolicy: lease.petPolicy,
      renewalOptions: lease.renewalOptions,
      legalTerms: lease.legalTerms,
      utilitiesIncluded: lease.utilitiesIncluded,
      signingMethod: lease.signingMethod || SigningMethod.MANUAL,
      requiresNotarization: true,

      ...landlordInfo,
      propertyName: property.name,
      propertyType: property.propertyType,
      propertyAddress: lease.property.address,
      unitNumber: (lease as any).propertyUnitInfo?.unitNumber || 'N/A',
    };

    return baseData;
  }

  /**
   * Send PDF generation status notification to lease creator
   * @param lease - Lease document
   * @param cuid - Client ID
   * @param status - Generation status: 'started', 'completed', or 'failed'
   * @param errorMessage - Error message if status is 'failed'
   */
  async notifyPdfGenerationStatus(
    lease: ILeaseDocument,
    cuid: string,
    status: 'started' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    try {
      const createdById = lease.createdBy as Types.ObjectId;
      const leaseNumber = lease.leaseNumber || `Lease-${lease._id}`;

      let messageKey:
        | 'lease.pdfGenerationStarted'
        | 'lease.pdfGenerated'
        | 'lease.pdfGenerationFailed';
      let notificationType: import('@interfaces/notification.interface').NotificationTypeEnum;
      let notificationPriority: import('@interfaces/notification.interface').NotificationPriorityEnum;

      if (status === 'started') {
        messageKey = 'lease.pdfGenerationStarted';
        notificationType = NotificationTypeEnum.INFO;
        notificationPriority = NotificationPriorityEnum.LOW;
      } else if (status === 'completed') {
        messageKey = 'lease.pdfGenerated';
        notificationType = NotificationTypeEnum.SUCCESS;
        notificationPriority = NotificationPriorityEnum.MEDIUM;
      } else {
        messageKey = 'lease.pdfGenerationFailed';
        notificationType = NotificationTypeEnum.ERROR;
        notificationPriority = NotificationPriorityEnum.HIGH;
      }

      const variables: Record<string, any> = {
        leaseNumber,
        ...(errorMessage && { errorMessage }),
      };

      await this.notificationService.createNotificationFromTemplate(
        messageKey,
        variables,
        createdById.toString(),
        notificationType,
        notificationPriority,
        cuid,
        createdById.toString(),
        {
          resourceName: ResourceContext.LEASE,
          resourceUid: lease.luid,
          resourceId: lease._id.toString(),
          metadata: {
            leaseNumber,
            status,
          },
        }
      );

      this.log.info(`Sent PDF generation ${status} notification for lease ${lease._id}`, {
        leaseId: lease._id,
        leaseNumber,
        recipientId: createdById,
        status,
      });
    } catch (error) {
      this.log.error('Failed to send PDF generation notification', {
        leaseId: lease._id,
        status,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Don't throw - notification failure shouldn't break PDF generation flow
    }
  }

  /**
   * Build landlord information for lease preview
   */
  private async buildLandlordInfo(
    cuid: string,
    propertyId: string
  ): Promise<{
    landlordName?: string;
    landlordAddress?: string;
    landlordEmail?: string;
    landlordPhone?: string;
    isExternalOwner?: boolean;
    managementCompanyName?: string;
    managementCompanyAddress?: string;
    managementCompanyEmail?: string;
    managementCompanyPhone?: string;
  }> {
    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      throw new BadRequestError({ message: 'Client not found' });
    }

    const property = await this.propertyDAO.findFirst(
      { _id: propertyId, cuid, deletedAt: null },
      {
        select: '+owner +authorization',
      }
    );

    if (!property) {
      throw new BadRequestError({ message: 'Property not found' });
    }

    if (!property.isManagementAuthorized()) {
      throw new BadRequestError({
        message: 'Property has not been authorized for management.',
      });
    }

    let managementInfo;
    if (client.accountType.isEnterpriseAccount && client.companyProfile) {
      managementInfo = {
        managementCompanyName: client.companyProfile?.legalEntityName,
        managementCompanyAddress: client.companyProfile?.companyAddress,
        managementCompanyEmail: client.companyProfile?.companyEmail,
        managementCompanyPhone: client.companyProfile?.companyPhone,
      };

      if (property.owner?.type === OwnershipType.EXTERNAL_OWNER && property.owner.name) {
        return {
          ...managementInfo,
          landlordName: property.owner.name,
          landlordAddress: property.owner.notes || 'N/A',
          landlordEmail: property.owner.email || 'N/A',
          landlordPhone: property.owner.phone || 'N/A',
          isExternalOwner: true,
        };
      }

      if (property.owner?.type === OwnershipType.COMPANY_OWNED) {
        return {
          landlordName: client.companyProfile?.legalEntityName || 'N/A',
          landlordAddress: client.companyProfile?.companyAddress || 'N/A',
          landlordEmail: client.companyProfile?.companyEmail || 'N/A',
          landlordPhone: client.companyProfile?.companyPhone || 'N/A',
          isExternalOwner: false,
        };
      }
    }

    if (!client.accountType.isEnterpriseAccount) {
      if (
        (property.owner?.type === OwnershipType.SELF_OWNED ||
          property.owner?.type === OwnershipType.EXTERNAL_OWNER) &&
        property.owner.name
      ) {
        return {
          landlordName: property.owner.name,
          landlordAddress: property.owner.notes || 'N/A',
          landlordEmail: property.owner.email || 'N/A',
          landlordPhone: property.owner.phone || 'N/A',
          isExternalOwner: false,
        };
      }
    }

    const profile = (await this.profileDAO.findFirst(
      { user: client.accountAdmin.toString() },
      { populate: 'user' }
    )) as unknown as IProfileWithUser;

    return {
      landlordName:
        client.companyProfile?.legalEntityName ||
        `${profile.personalInfo.firstName} ${profile.personalInfo.lastName}`,
      landlordAddress:
        client.companyProfile?.companyAddress || profile.personalInfo.location || 'N/A',
      landlordEmail: client.companyProfile?.companyEmail || `${profile.user.email || 'N/A'}`,
      landlordPhone:
        client.companyProfile?.companyPhone || `${profile.personalInfo.phoneNumber || 'N/A'}`,
      isExternalOwner: false,
    };
  }

  /**
   * Setup event listeners for PDF-related events
   */
  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));

    this.emitterService.on(
      EventTypes.PDF_GENERATION_REQUESTED,
      this.handlePdfGenerationRequest.bind(this)
    );
    this.emitterService.on(
      EventTypes.PDF_GENERATED,
      this.handlePdfGeneratedForESignature.bind(this)
    );
  }

  /**
   * Handle PDF generation request event
   */
  private handlePdfGenerationRequest = async (
    payload: PdfGenerationRequestedPayload
  ): Promise<void> => {
    try {
      const { jobId, resource, templateType, cuid, senderInfo } = payload;

      this.log.info('Handling PDF generation request', { jobId, resourceId: resource.resourceId });

      // Store senderInfo for later use when upload completes
      if (senderInfo) {
        this.pendingSenderInfo.set(resource.resourceId, senderInfo);
      }

      const result = await this.generateLeasePDF(cuid, resource.resourceId, templateType);

      // Only emit PDF_GENERATED if PDF already existed (has real URL, not 'pending')
      // Otherwise, wait for UPLOAD_COMPLETED event to emit PDF_GENERATED
      if (result.success && result.pdfUrl?.startsWith('https://')) {
        this.log.info('PDF already existed, emitting PDF_GENERATED immediately', {
          leaseId: resource.resourceId,
        });
        this.emitterService.emit(EventTypes.PDF_GENERATED, {
          jobId,
          leaseId: resource.resourceId,
          pdfUrl: result.pdfUrl,
          s3Key: result.s3Key || '',
          fileSize: result.metadata?.fileSize,
          generationTime: result.metadata?.generationTime,
          senderInfo,
        });
        // Clean up stored senderInfo
        this.pendingSenderInfo.delete(resource.resourceId);
      } else if (!result.success) {
        this.emitterService.emit(EventTypes.PDF_GENERATION_FAILED, {
          jobId,
          resourceId: resource.resourceId,
          error: result.error || 'PDF generation failed',
        });
        // Clean up stored senderInfo
        this.pendingSenderInfo.delete(resource.resourceId);
      } else {
        // PDF is being uploaded, wait for UPLOAD_COMPLETED event
        this.log.info('PDF upload in progress, waiting for UPLOAD_COMPLETED event', {
          leaseId: resource.resourceId,
        });
      }
    } catch (error) {
      this.log.error('Error handling PDF generation request', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload,
      });

      this.emitterService.emit(EventTypes.PDF_GENERATION_FAILED, {
        jobId: payload.jobId,
        resourceId: payload.resource.resourceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      // Clean up stored senderInfo
      this.pendingSenderInfo.delete(payload.resource.resourceId);
    }
  };

  /**
   * Handle PDF generated event for e-signature workflow
   */
  private handlePdfGeneratedForESignature = async (payload: PdfGeneratedPayload): Promise<void> => {
    try {
      const { leaseId, s3Key, senderInfo } = payload;

      this.log.info('PDF generated, checking if e-signature is pending', { leaseId });

      // Check if lease is waiting for e-signature
      const lease = await this.leaseDAO.findById(leaseId);

      if (!lease) {
        this.log.warn('Lease not found for PDF generation event', { leaseId });
        return;
      }

      // Only re-queue if lease status is READY_FOR_SIGNATURE and signingMethod is electronic
      if (
        lease.signingMethod !== 'electronic' ||
        ![LeaseStatus.READY_FOR_SIGNATURE].includes(lease.status)
      ) {
        this.log.info('Lease not waiting for e-signature, skipping', {
          leaseId,
          signingMethod: lease.signingMethod,
          status: lease.status,
        });
        return;
      }

      // Re-queue e-signature job now that PDF is ready
      this.log.info('Re-queueing e-signature job after PDF generation', { leaseId, s3Key });

      const eSignatureQueue = this.queueFactory.getQueue('eSignatureQueue');
      await (eSignatureQueue as any).addToESignatureRequestQueue({
        resource: {
          resourceId: leaseId,
          resourceName: 'lease',
          actorId: lease.createdBy.toString(),
          resourceType: 'document',
          fieldName: 'eSignature',
        },
        cuid: lease.cuid,
        luid: lease.luid,
        leaseId,
        senderInfo,
      });
    } catch (error) {
      this.log.error('Error handling PDF generated event for e-signature', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload,
      });
    }
  };

  /**
   * Handle upload completed event
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
   * Mark lease documents as failed
   */
  private async markLeaseDocumentsAsFailed(leaseId: string, errorMessage: string): Promise<void> {
    this.log.warn('Marking lease documents as failed', {
      leaseId,
      errorMessage,
    });

    await this.leaseDAO.updateLeaseDocumentStatus(leaseId, 'failed', errorMessage);
  }

  /**
   * Update lease with uploaded document information
   */
  private async updateLeaseDocuments(
    leaseId: string,
    uploadResults: UploadResult[],
    userId: string
  ): Promise<void> {
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
  }
}
