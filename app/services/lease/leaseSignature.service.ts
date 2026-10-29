/* eslint-disable no-case-declarations */
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { LeaseCache } from '@caching/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { QueueFactory } from '@services/queue';
import { ESignatureQueue } from '@queues/index';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { BadRequestError } from '@shared/customErrors';
import { EventTypes } from '@interfaces/events.interface';
import { IResourceEvent } from '@interfaces/sse.interface';
import { ProfileDAO, ClientDAO, LeaseDAO } from '@dao/index';
import { LEASING_CHECK_SELECT } from '@utils/propertyLeasing';
import { OwnershipType } from '@interfaces/property.interface';
import { ProcessedWebhookData } from '@services/external/esignature/boldSign.service';
import { PROPERTY_APPROVAL_ROLES, PROPERTY_STAFF_ROLES, createLogger } from '@utils/index';
import {
  EventEmitterService,
  NotificationService,
  BoldSignService,
  SSEService,
} from '@services/index';
import {
  IPromiseReturnedData,
  ISuccessReturnData,
  IRequestContext,
  ResourceContext,
} from '@interfaces/utils.interface';
import {
  LeaseESignatureCompletedPayload,
  LeaseESignatureFailedPayload,
  LeaseESignatureSentPayload,
  ILeaseESignatureStatusEnum,
  ILeaseDocument,
  LeaseStatus,
} from '@interfaces/lease.interface';

import {
  validateLeaseReadyForSignature,
  fetchPropertyManagerWithUser,
  validateResourceAvailable,
  findActiveLeaseAgreement,
  assertPropertyLeasable,
  fetchTenantWithUser,
  fetchPropertyUnit,
  validateUserRole,
  fetchLeaseByLuid,
  buildSenderInfo,
  getRefIdString,
  queueLeasePdf,
} from './leaseHelpers';

interface IConstructor {
  notificationService: NotificationService;
  emitterService: EventEmitterService;
  boldSignService: BoldSignService;
  propertyUnitDAO: PropertyUnitDAO;
  queueFactory: QueueFactory;
  propertyDAO: PropertyDAO;
  leaseCache: LeaseCache;
  profileDAO: ProfileDAO;
  sseService: SSEService;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
}

export class LeaseSignatureService {
  private readonly log: Logger;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly leaseCache: LeaseCache;
  private readonly propertyDAO: PropertyDAO;
  private readonly queueFactory: QueueFactory;
  private readonly boldSignService: BoldSignService;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly notificationService: NotificationService;
  private readonly sseService: SSEService;

  constructor({
    boldSignService,
    clientDAO,
    emitterService,
    leaseCache,
    leaseDAO,
    notificationService,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    queueFactory,
    sseService,
  }: IConstructor) {
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.leaseCache = leaseCache;
    this.propertyDAO = propertyDAO;
    this.queueFactory = queueFactory;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.boldSignService = boldSignService;
    this.log = createLogger('LeaseSignatureService');
    this.notificationService = notificationService;
    this.sseService = sseService;
  }

  private readonly onESignatureSent = this.handleESignatureSent.bind(this);
  private readonly onESignatureFailed = this.handleESignatureFailed.bind(this);

  /**
   * Setup event listeners for signature-related events
   */
  registerEventListeners(): void {
    this.emitterService.on(EventTypes.LEASE_ESIGNATURE_SENT, this.onESignatureSent);
    this.emitterService.on(EventTypes.LEASE_ESIGNATURE_FAILED, this.onESignatureFailed);
  }

  /**
   * Send a lease for electronic signature
   */
  async sendLeaseForSignature(cxt: IRequestContext): Promise<ISuccessReturnData> {
    const { cuid, luid } = cxt.request.params;
    const currentuser = cxt.currentuser!;
    validateUserRole(
      currentuser,
      [...PROPERTY_STAFF_ROLES, ...PROPERTY_APPROVAL_ROLES],
      'send leases for signature'
    );

    const client = await this.clientDAO.findFirst({ cuid, deletedAt: null });
    if (!client) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Client' }) });
    }

    const lease = await fetchLeaseByLuid(this.leaseDAO, luid, cuid);

    // Heal stale DRAFT+approved leases created before the status-transition fix
    if (lease.status === LeaseStatus.DRAFT && lease.approvalStatus === 'approved') {
      await this.leaseDAO.update(
        { _id: lease._id },
        { $set: { status: LeaseStatus.READY_FOR_SIGNATURE } }
      );
      lease.status = LeaseStatus.READY_FOR_SIGNATURE;
    }

    validateLeaseReadyForSignature(lease);
    if (lease.signingMethod !== 'electronic') {
      throw new BadRequestError({
        message: 'Lease must be set to electronic signing method to use e-signature',
      });
    }

    await fetchTenantWithUser(this.profileDAO, lease.tenantId);

    const property = await this.propertyDAO.findFirst(
      { _id: lease.property.id, deletedAt: null },
      { select: LEASING_CHECK_SELECT }
    );
    if (!property) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Property' }) });
    }
    validateResourceAvailable(property, 'property');
    // Verification may have lapsed (grace period expired) since the lease was drafted. Management
    // authorization isn't required here: without it the external owner signs directly
    assertPropertyLeasable(property, { requireManagementAuth: false });
    if (lease.property.unitId) {
      const propertyUnit = await fetchPropertyUnit(
        this.propertyUnitDAO,
        lease.property.unitId as string
      );
      validateResourceAvailable(propertyUnit, 'unit');
    }

    // Pre-flight: if external owner must sign directly, ensure they have an email
    const isExternalOwner = property.owner?.type === OwnershipType.EXTERNAL_OWNER;
    const isPmAuthorized = property.isManagementAuthorized();
    if (isExternalOwner && !isPmAuthorized && !property.owner?.email) {
      throw new BadRequestError({
        message:
          'This property has an external owner who must sign the lease, ' +
          'but no email address is on file. Please update the property owner ' +
          "email or grant PM authorization to sign on the owner's behalf.",
      });
    }

    const effectiveManagedBy = lease.property.managedBy || property.managedBy;
    if (effectiveManagedBy) {
      await fetchPropertyManagerWithUser(this.profileDAO, effectiveManagedBy);
    }

    const senderInfo = buildSenderInfo(client);

    const leasePDF = findActiveLeaseAgreement(lease);
    if (!leasePDF || !leasePDF.key) {
      await queueLeasePdf(this.queueFactory, lease, cxt.currentuser?.sub || 'system', {
        senderInfo,
      });

      return {
        success: true,
        message:
          'PDF generation in progress. E-signature will be sent automatically when PDF is ready.',
        data: {
          status: 'pdf_generation_pending',
          leaseId: luid,
        },
      };
    }

    const eSignatureQueue = this.queueFactory.getQueue('eSignatureQueue') as ESignatureQueue;
    const job = await eSignatureQueue.addToESignatureRequestQueue({
      resource: {
        resourceId: lease._id.toString(),
        resourceName: 'lease',
        actorId: cxt.currentuser?.sub || 'system',
        resourceType: 'document',
        fieldName: 'eSignature',
      },
      cuid,
      luid,
      leaseId: lease._id.toString(),
      managedBy: effectiveManagedBy?.toString(),
      senderInfo,
    });

    return {
      success: true,
      message: 'ESignature request queued for processing',
      data: {
        processId: job?.id,
      },
    };
  }

  /**
   * Cancel an e-signature request
   */
  async cancelSignature(
    cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Cancelling signature for lease ${leaseId}`);

    const lease = await this.leaseDAO.findFirst({ luid: leaseId, cuid });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    if (lease.status !== LeaseStatus.PENDING_SIGNATURE) {
      throw new BadRequestError({
        message: 'Lease is not pending signature and cannot be cancelled',
      });
    }

    const envelopeId = lease.eSignature?.envelopeId;
    if (envelopeId) {
      try {
        await this.boldSignService.revokeDocument(
          envelopeId,
          'Signature request cancelled by manager'
        );
      } catch (revokeError: any) {
        // Log but don't throw — the envelope may already be revoked or expired in BoldSign.
        // We still need to revert the lease status locally.
        this.log.warn('BoldSign revoke failed during cancel (proceeding to revert lease status)', {
          envelopeId,
          error: revokeError?.message || revokeError,
        });
      }
    }

    const updated = await this.leaseDAO.update(
      { _id: lease._id },
      {
        'eSignature.status': ILeaseESignatureStatusEnum.DRAFT,
        status: LeaseStatus.DRAFT,
        updatedAt: new Date(),
      }
    );

    if (!updated) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'update lease status' }),
      });
    }

    this.log.info(`Signature cancelled, lease ${leaseId} reverted to draft`);
    return { success: true, data: updated };
  }

  /**
   * Get signature details for a lease
   */
  async getSignatureDetails(cuid: string, leaseId: string): IPromiseReturnedData<any> {
    const lease = await this.leaseDAO.findFirst({ luid: leaseId, cuid, deletedAt: null });
    if (!lease) {
      throw new BadRequestError({ message: t('common.errors.notFound', { resource: 'Lease' }) });
    }

    return {
      success: true,
      data: {
        signingMethod: lease.signingMethod || 'pending',
        signedDate: lease.signedDate,
        eSignature: lease.eSignature || null,
        signatures: lease.signatures || [],
      },
    };
  }

  /**
   * Handle successful e-signature send
   */
  private async handleESignatureSent(payload: LeaseESignatureSentPayload): Promise<void> {
    const { leaseId, luid, cuid, envelopeId, sentAt, actorId } = payload;

    try {
      const lease = await this.leaseDAO.update(
        { _id: new Types.ObjectId(leaseId), cuid },
        {
          $set: {
            status: LeaseStatus.PENDING_SIGNATURE,
            'eSignature.envelopeId': envelopeId,
            'eSignature.status': 'sent',
            'eSignature.sentAt': sentAt,
            updatedAt: new Date(),
          },
        }
      );

      if (lease) {
        // Send notifications to tenant and property manager
        await this.notificationService.notifyLeaseESignatureSent({
          leaseNumber: lease.leaseNumber,
          leaseName: `Lease ${lease.leaseNumber}`,
          tenantId: lease.tenantId.toString(),
          propertyManagerId: lease.createdBy.toString(),
          envelopeId,
          actorId,
          cuid,
          resource: {
            resourceId: leaseId,
            resourceUid: luid,
            resourceType: 'lease' as any,
          },
        });
      }
    } catch (error) {
      this.log.error('Error handling LEASE_ESIGNATURE_SENT event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        luid,
      });
    }
  }

  /**
   * Handle failed e-signature send
   */
  private async handleESignatureFailed(payload: LeaseESignatureFailedPayload): Promise<void> {
    const { leaseId, luid, cuid, error, actorId } = payload;

    try {
      const lease = await this.leaseDAO.update(
        { _id: new Types.ObjectId(leaseId) },
        {
          $set: {
            'eSignature.status': ILeaseESignatureStatusEnum.FAILED,
            'eSignature.errorMessage': error,
            'eSignature.failedAt': new Date(),
            updatedAt: new Date(),
          },
        }
      );
      await this.leaseCache.invalidateLease(cuid, luid);
      if (lease) {
        // Notify property manager about the failure
        await this.notificationService.notifyLeaseESignatureFailed({
          leaseNumber: lease.leaseNumber,
          error,
          propertyManagerId: lease.createdBy.toString(),
          actorId,
          cuid,
          resource: {
            resourceId: leaseId,
            resourceUid: luid,
            resourceType: 'lease' as any,
          },
        });
      }

      this.log.info('Successfully handled LEASE_ESIGNATURE_FAILED event', { luid });
    } catch (error) {
      this.log.error('Error handling LEASE_ESIGNATURE_FAILED event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        luid,
      });
    }
  }

  /**
   * Handle e-signature webhook events from BoldSign
   * Processes all webhook event types in one method
   */
  async handleESignatureWebhook(
    eventType: string,
    documentId: string,
    data: any,
    processedData?: ProcessedWebhookData
  ): Promise<void> {
    try {
      const { recentSigner } = processedData || {};
      const lease = await this.leaseDAO.findFirst({ 'eSignature.envelopeId': documentId });
      let result = null;

      if (!lease) {
        this.log.warn('Lease not found for envelope ID', { documentId });
        throw new Error('Lease not found for envelope ID');
      }

      switch (eventType) {
        case 'SendFailed':
          result = await this.leaseDAO.update(
            { _id: lease._id },
            {
              'eSignature.status': ILeaseESignatureStatusEnum.VOIDED,
              'eSignature.errorMessage': data?.errorMessage || 'Send failed',
              'eSignature.failedAt': new Date(),
              status: LeaseStatus.DRAFT,
              updatedAt: new Date(),
            }
          );
          await this.notificationService.notifyLeaseESignatureFailed({
            leaseNumber: lease.leaseNumber,
            error: data?.errorMessage || 'Send failed',
            propertyManagerId: lease.createdBy.toString(),
            actorId: lease.createdBy.toString(),
            cuid: lease.cuid,
            resource: {
              resourceId: lease._id.toString(),
              resourceUid: lease.luid,
              resourceType: ResourceContext.LEASE,
            },
          });
          break;

        case 'Completed':
          const completedAt = new Date(data?.completedDate || Date.now());
          // BoldSign retries a webhook whose response it didn't see: only the first one activates
          const alreadyActivated =
            lease.status === LeaseStatus.ACTIVE &&
            lease.eSignature?.status === ILeaseESignatureStatusEnum.SIGNED;

          if (!alreadyActivated) {
            result = await this.leaseDAO.update(
              { _id: lease._id },
              {
                // 'signed' (not 'completed') — the lease model only activates electronic leases with eSignature.status === 'signed'
                'eSignature.status': ILeaseESignatureStatusEnum.SIGNED,
                'eSignature.completedAt': completedAt,
                status: LeaseStatus.ACTIVE,
                signedDate: completedAt,
                activatedAt: new Date(),
                updatedAt: new Date(),
              }
            );
          }

          // Fetched by the worker, never inline: a failed download here would make BoldSign
          // redeliver the webhook. Queued even on a redelivery — the jobId dedupes it.
          await this.queueSignedDocumentStorage(lease, documentId);

          if (!alreadyActivated) {
            await this.announceLeaseActivated(lease, {
              signers: data?.signers || [],
              documentId,
              completedAt,
            });
          }
          break;

        case 'Declined':
          result = await this.leaseDAO.update(
            { _id: lease._id },
            {
              'eSignature.status': ILeaseESignatureStatusEnum.DECLINED,
              'eSignature.declinedReason': data?.declineReason,
              status: LeaseStatus.DRAFT,
              updatedAt: new Date(),
            }
          );

          this.emitterService.emit(EventTypes.LEASE_ESIGNATURE_DECLINED, {
            leaseId: lease._id.toString(),
            luid: lease.luid,
            cuid: lease.cuid,
            documentId,
            declinedBy: recentSigner?.email || 'unknown',
            declinedAt: new Date(),
            declineReason: data?.declineReason,
          });
          break;

        case 'Expired':
          result = await this.leaseDAO.update(
            { _id: lease._id },
            {
              'eSignature.status': ILeaseESignatureStatusEnum.VOIDED,
              status: LeaseStatus.DRAFT,
              updatedAt: new Date(),
            }
          );
          break;

        case 'Revoked':
          result = await this.leaseDAO.update(
            { _id: lease._id },
            {
              'eSignature.status': ILeaseESignatureStatusEnum.DRAFT,
              status: LeaseStatus.DRAFT,
              updatedAt: new Date(),
            }
          );
          break;

        case 'Signed':
          if (!recentSigner) {
            this.log.warn('No signer info provided in Signed event', {
              leaseId: lease._id,
              luid: lease.luid,
            });
            break;
          }

          let signerId: Types.ObjectId | undefined;
          let signerRole: 'tenant' | 'co_tenant' | 'landlord' | 'property_manager' = 'tenant';
          let coTenantInfo: { name: string; email: string } | undefined;
          let landlordInfo: { name: string; email: string; phone?: string } | undefined;

          if (lease.tenantId) {
            const tenant = await this.profileDAO.findFirst(
              { user: lease.tenantId },
              { populate: 'user' }
            );
            const tenantUser =
              tenant?.user && typeof tenant.user === 'object' ? (tenant.user as any) : null;
            if (tenantUser?.email === recentSigner.email) {
              signerId = lease.tenantId as Types.ObjectId;
              signerRole = 'tenant';
            }
          }

          if (!signerId && lease.coTenants) {
            const coTenant = lease.coTenants.find((ct) => ct.email === recentSigner.email);
            if (coTenant) {
              signerRole = 'co_tenant';
              coTenantInfo = {
                name: coTenant.name,
                email: coTenant.email,
              };
            }
          }

          if (!signerId && !coTenantInfo && lease.property?.id) {
            const property = await this.propertyDAO.findFirst(
              { _id: lease.property.id },
              { select: '+owner' }
            );

            // Check if signer is the PM — lease-level managedBy overrides property-level
            const effectivePmId = lease.property.managedBy || property?.managedBy;
            if (effectivePmId) {
              const pm = await this.profileDAO.findFirst(
                { user: effectivePmId },
                { populate: 'user' }
              );
              const pmUser = pm?.user && typeof pm.user === 'object' ? (pm.user as any) : null;
              if (pmUser?.email === recentSigner.email) {
                signerId = effectivePmId as Types.ObjectId;
                signerRole = 'property_manager';
              }
            }

            // Check if signer is the external landlord/owner
            if (
              !signerId &&
              property?.owner?.type === OwnershipType.EXTERNAL_OWNER &&
              property.owner.email === recentSigner.email
            ) {
              signerRole = 'landlord';
              landlordInfo = {
                name: property.owner.name || recentSigner.name,
                email: property.owner.email,
                phone: property.owner.phone,
              };
            }
          }

          const signatureEntry: any = {
            role: signerRole,
            signatureMethod: 'electronic',
            signedAt: recentSigner.signedAt,
            ...(signerId ? { userId: signerId } : {}),
            ...(coTenantInfo ? { coTenantInfo } : {}),
            ...(landlordInfo ? { landlordInfo } : {}),
          };

          // check if signature already exists to prevent duplicates
          let signatureExists = false;
          if (signerId) {
            // For users with userId, check by userId
            signatureExists =
              lease.signatures?.some((sig) => sig.userId?.toString() === signerId.toString()) ||
              false;
          } else if (coTenantInfo) {
            // For co-tenants without userId, check by email
            signatureExists =
              lease.signatures?.some((sig) => sig.coTenantInfo?.email === coTenantInfo.email) ||
              false;
          } else if (landlordInfo) {
            // For landlords without userId, check by email
            signatureExists =
              lease.signatures?.some((sig) => sig.landlordInfo?.email === landlordInfo!.email) ||
              false;
          }

          if (!signatureExists) {
            await this.leaseDAO.update(
              { _id: lease._id },
              {
                $push: { signatures: signatureEntry },
              }
            );
          }
          break;
        default:
          this.log.info('Unhandled webhook event type', { eventType, documentId });
      }
      this.log.info('Webhook event type', result ? 'processed successfully' : 'no changes made', {
        eventType,
        documentId,
        result,
      });
    } catch (error: any) {
      this.log.error('Error handling e-signature webhook', {
        eventType,
        documentId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Side effects shared by every route to ACTIVE (completed e-signature, manual activation):
   * fresh caches, LEASE_ESIGNATURE_COMPLETED (rent, deposit, unit occupancy, emails) and an
   * SSE refresh for the tenant and the lease's creator.
   */
  async announceLeaseActivated(
    lease: Pick<ILeaseDocument, '_id' | 'luid' | 'cuid' | 'tenantId' | 'createdBy' | 'property'>,
    details: Pick<LeaseESignatureCompletedPayload, 'documentId' | 'signers' | 'completedAt'>
  ): Promise<void> {
    const tenantId = getRefIdString(lease.tenantId);
    const propertyId = getRefIdString(lease.property.id);

    await Promise.allSettled([
      this.leaseCache.invalidateLease(lease.cuid, lease.luid),
      this.leaseCache.invalidateLeaseLists(lease.cuid),
    ]);

    this.emitterService.emit(EventTypes.LEASE_ESIGNATURE_COMPLETED, {
      leaseId: lease._id.toString(),
      luid: lease.luid,
      cuid: lease.cuid,
      tenantId,
      propertyId,
      propertyUnitId: lease.property.unitId ? getRefIdString(lease.property.unitId) : undefined,
      propertyManagerId: lease.createdBy.toString(),
      ...details,
    });

    // Push real-time SSE refresh signal to both tenant and PM so their
    // lease list / lease detail pages refetch without a manual reload.
    const ssePayload: IResourceEvent = {
      resource: 'lease',
      action: 'status-changed',
      resourceUId: lease.luid,
      status: LeaseStatus.ACTIVE,
    };
    await Promise.allSettled([
      this.sseService.sendToUser(tenantId, lease.cuid, ssePayload, 'resource-event'),
      this.sseService.sendToUser(
        lease.createdBy.toString(),
        lease.cuid,
        ssePayload,
        'resource-event'
      ),
    ]);
  }

  private async queueSignedDocumentStorage(
    lease: Pick<ILeaseDocument, '_id' | 'luid' | 'cuid'>,
    documentId: string
  ): Promise<void> {
    try {
      const eSignatureQueue = this.queueFactory.getQueue('eSignatureQueue') as ESignatureQueue;
      await eSignatureQueue.addToStoreSignedDocumentQueue({
        leaseId: lease._id.toString(),
        luid: lease.luid,
        cuid: lease.cuid,
        documentId,
      });
    } catch (error: any) {
      // The lease is still active; the signed copy can be stored by re-queueing this job
      this.log.error('Failed to queue signed document storage', {
        luid: lease.luid,
        documentId,
        error: error?.message,
      });
    }
  }

  /**
   * Revoke a lease e-signature
   */
  async revokeLease(leaseId: string, reason: string): Promise<void> {
    try {
      const lease = await this.leaseDAO.findFirst({ luid: leaseId });
      if (!lease) {
        throw new Error('Lease not found');
      }
      await this.boldSignService.revokeDocument(lease.eSignature?.envelopeId ?? '', reason);
      this.log.info('Lease revoked successfully', { leaseId, reason });
    } catch (error: any) {
      this.log.error('Error revoking lease', {
        leaseId,
        reason,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Cleanup event listeners
   */
  cleanupEventListeners(): void {
    this.emitterService.off(EventTypes.LEASE_ESIGNATURE_SENT, this.onESignatureSent);
    this.emitterService.off(EventTypes.LEASE_ESIGNATURE_FAILED, this.onESignatureFailed);
    this.log.info('Lease signature service event listeners removed');
  }
}
