import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { PdfQueue } from '@queues/index';
import sanitizeHtml from 'sanitize-html';
import { LeaseCache } from '@caching/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { IUserRole } from '@shared/constants/roles.constants';
import { PdfGeneratorService, MediaUploadService } from '@services/index';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';
import { InvitationDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import { IPropertyDocument, IProfileWithUser, OwnershipType } from '@interfaces/index';
import { NotificationPriorityEnum, NotificationTypeEnum } from '@interfaces/notification.interface';
import {
  ValidationRequestError,
  InvalidRequestError,
  BadRequestError,
  ForbiddenError,
} from '@shared/customErrors';
import {
  EventEmitterService,
  NotificationService,
  InvitationService,
  BoldSignService,
  S3Service,
} from '@services/index';
import {
  PROPERTY_APPROVAL_ROLES,
  determineTemplateType,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  createLogger,
  MoneyUtils,
} from '@utils/index';
import {
  ILeaseESignatureStatusEnum,
  ILeaseFilterOptions,
  ILeaseDocument,
  ILeaseFormData,
  SigningMethod,
  LeaseStatus,
} from '@interfaces/lease.interface';
import {
  ListResultWithPagination,
  IPromiseReturnedData,
  ISuccessReturnData,
  IRequestContext,
  ResourceContext,
  UploadResult,
} from '@interfaces/utils.interface';
import {
  PdfGenerationRequestedPayload,
  PdfGenerationFailedPayload,
  UploadCompletedPayload,
  UploadFailedPayload,
  PdfGeneratedPayload,
  EventTypes,
} from '@interfaces/events.interface';

import { LeaseTemplateService } from './leaseTemplateService';
import { LeaseTemplateDataMapper } from './leaseTemplateDataMapper';
import { enforceLeaseApprovalRequirement } from './leaseValidators';
import { generatePendingChangesPreview, filterLeaseByRole } from './leaseTransformers';
import {
  handlePendingSignatureUpdate,
  handleClosedStatusUpdate,
  handleActiveUpdate,
  handleDraftUpdate,
} from './leaseUpdateHandlers';
import {
  calculateFinancialSummary,
  validateImmutableFields,
  constructActivityFeed,
  filterDocumentsByRole,
  buildLeaseTimeline,
  getUserPermissions,
} from './leaseHelpers';

interface IConstructor {
  notificationService: NotificationService;
  pdfGeneratorService: PdfGeneratorService;
  mediaUploadService: MediaUploadService;
  invitationService: InvitationService;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  boldSignService: BoldSignService;
  invitationDAO: InvitationDAO;
  pdfGeneratorQueue: PdfQueue;
  propertyDAO: PropertyDAO;
  leaseCache: LeaseCache;
  profileDAO: ProfileDAO;
  s3Service: S3Service;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class LeaseService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly s3Service: S3Service;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly leaseCache: LeaseCache;
  private readonly propertyDAO: PropertyDAO;
  private readonly pdfGeneratorQueue: PdfQueue;
  private readonly invitationDAO: InvitationDAO;
  private readonly boldSignService: BoldSignService;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly invitationService: InvitationService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly notificationService: NotificationService;
  private readonly leaseTemplateService: LeaseTemplateService;
  private readonly leaseTemplateDataMapper: LeaseTemplateDataMapper;

  constructor({
    notificationService,
    pdfGeneratorService,
    mediaUploadService,
    pdfGeneratorQueue,
    invitationService,
    emitterService,
    invitationDAO,
    propertyUnitDAO,
    boldSignService,
    s3Service,
    propertyDAO,
    profileDAO,
    clientDAO,
    leaseDAO,
    userDAO,
    leaseCache,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.s3Service = s3Service;
    this.profileDAO = profileDAO;
    this.leaseCache = leaseCache;
    this.propertyDAO = propertyDAO;
    this.invitationDAO = invitationDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.boldSignService = boldSignService;
    this.log = createLogger('LeaseService');
    this.invitationService = invitationService;
    this.pdfGeneratorQueue = pdfGeneratorQueue;
    this.mediaUploadService = mediaUploadService;
    this.pdfGeneratorService = pdfGeneratorService;
    this.notificationService = notificationService;
    this.leaseTemplateService = new LeaseTemplateService();
    this.leaseTemplateDataMapper = new LeaseTemplateDataMapper();
    this.setupEventListeners();
  }

  async createLease(
    cuid: string,
    data: ILeaseFormData,
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentuser = ctx.currentuser!;

    if (!cuid) {
      throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: t('common.errors.clientNotFound') });
    }

    const property = await this.propertyDAO.findFirst(
      {
        _id: new Types.ObjectId(data.property.id),
        cuid,
        approvalStatus: 'approved',
        deletedAt: null,
      },
      {
        select: '+owner +authorization',
      }
    );

    if (!property) {
      this.log.error(`Property with id ${data.property.id} not found for client ${cuid}`);
      throw new BadRequestError({ message: t('property.errors.notFound') });
    }

    if (!property.isManagementAuthorized()) {
      this.log.error(
        `Property with id ${data.property.id} is not authorized for management by client ${cuid}`
      );
      throw new BadRequestError({ message: t('property.errors.managementNotAuthorized') });
    }

    const { hasErrors, errors, tenantInfo, propertyInfo } = await this.validateLeaseData(
      cuid,
      data,
      property
    );
    if (hasErrors) {
      throw new ValidationRequestError({
        message: t('lease.errors.validationFailed') || 'Lease validation failed',
        errorInfo: errors,
      });
    }

    if (!tenantInfo || !tenantInfo.tenantId) {
      throw new BadRequestError({
        message:
          'Tenant information is required. Please provide either a valid tenant ID or email address with an existing invitation.',
      });
    }

    if (
      data.tenantInfo.email &&
      data.tenantInfo.firstName &&
      data.tenantInfo.lastName &&
      !data.tenantInfo.id &&
      tenantInfo.useInvitationIdAsTenantId
    ) {
      try {
        const invitationResult = await this.invitationService.sendInvitation(
          currentuser.sub,
          cuid,
          {
            inviteeEmail: data.tenantInfo.email,
            personalInfo: {
              firstName: data.tenantInfo.firstName,
              lastName: data.tenantInfo.lastName,
            },
            role: IUserRole.TENANT,
            status: 'pending',
          }
        );

        if (invitationResult.success && invitationResult.data.invitation) {
          tenantInfo.tenantId = invitationResult.data.invitation._id;
        } else {
          throw new Error('Failed to create invitation: No invitation returned');
        }
      } catch (invitationError) {
        this.log.error('Failed to create tenant invitation', {
          error: invitationError instanceof Error ? invitationError.message : 'Unknown error',
          email: data.tenantInfo.email,
        });

        throw new BadRequestError({
          message: `Failed to create tenant invitation: ${invitationError instanceof Error ? invitationError.message : 'Unknown error'}`,
        });
      }
    }

    const userRoleEnum = convertUserRoleToEnum(currentuser.client.role);
    if (
      !PROPERTY_STAFF_ROLES.includes(userRoleEnum) &&
      !PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)
    ) {
      throw new InvalidRequestError({ message: 'You are not authorized to create leases.' });
    }

    let approvalStatus: 'approved' | 'pending' = 'pending';
    let message = 'Lease submitted for approval';
    const approvalDetails: any[] = [];

    if (PROPERTY_APPROVAL_ROLES.includes(userRoleEnum)) {
      approvalStatus = 'approved';
      approvalDetails.push({
        action: 'created',
        actor: currentuser.sub,
        timestamp: new Date(),
        notes: 'Auto-approved by admin/manager',
      });
      message = 'Lease created and approved successfully';
    } else if (PROPERTY_STAFF_ROLES.includes(userRoleEnum)) {
      approvalStatus = 'pending';
      approvalDetails.push({
        action: 'created',
        actor: currentuser.sub,
        timestamp: new Date(),
      });
    }
    const landlordInfo = await this.buildLandlordInfo(cuid, data.property.id);

    const isMultiUnit = PropertyTypeManager.supportsMultipleUnits(property.propertyType);
    const hasUnitNumber = !!data.property.unitId;
    const ownershipType = property.owner?.type || 'company_owned';

    // If external_owner/self_owned AND has unit number, the landlord owns just the unit
    const hasUnitOwner =
      hasUnitNumber && (ownershipType === 'external_owner' || ownershipType === 'self_owned');

    const session = await this.leaseDAO.startSession();
    const result = await this.leaseDAO.withTransaction(session, async (session) => {
      const parsedLeaseData = {
        ...data,
        cuid,
        tenantId: tenantInfo.tenantId,
        createdBy: currentuser.sub,
        signingMethod: data.signingMethod || SigningMethod.PENDING,
        templateType: data.templateType || 'residential-single-family',
        landlordName: landlordInfo.landlordName,
        fees: MoneyUtils.parseLeaseFees(data.fees),
        internalNotes: data.internalNotes ? sanitizeHtml(data.internalNotes) : undefined,
        property: {
          id: data.property.id,
          address: propertyInfo?.address || 'REQUIRED',
          unitId: data.property.unitId,
          propertyType: propertyInfo?.propertyType,
          name: propertyInfo?.name,
          unitNumber: propertyInfo?.unitNumber,
          specifications: propertyInfo?.specifications,
        },
        approvalStatus,
        approvalDetails,
        useInvitationIdAsTenantId: tenantInfo.useInvitationIdAsTenantId,
        metadata: {
          ...landlordInfo,
          hasUnitOwner,
          isMultiUnit,
          ownershipType,
          propertyName: property.name,
          propertyType: property.propertyType,
        },
      };

      const lease = await this.leaseDAO.createLease(cuid, parsedLeaseData, session);

      if (tenantInfo.useInvitationIdAsTenantId) {
        this.log.warn('Lease created with invitation as temporary tenant', {
          leaseId: lease.luid,
          invitationId: tenantInfo.tenantId.toString(),
        });
      }

      return { lease };
    });

    if (approvalStatus === 'pending') {
      try {
        await this.notificationService.handlePropertyUpdateNotifications({
          userRole: currentuser.client.role,
          updatedProperty: result.lease as any,
          propertyName: `Lease ${result.lease.leaseNumber}`,
          actorUserId: currentuser.sub,
          actorDisplayName: currentuser.displayName,
          cuid,
          updateData: data,
          resource: {
            resourceType: ResourceContext.LEASE,
            resourceId: result.lease._id.toString(),
            resourceUid: result.lease.luid,
          },
        });
      } catch (notificationError) {
        this.log.error('Failed to send lease approval notification', {
          error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
          leaseId: result.lease.luid,
        });
      }
    }

    this.log.info(`Lease created successfully: ${result.lease.luid}`, {
      approvalStatus,
    });

    await this.leaseCache.invalidateLeaseLists(cuid);

    return { success: true, data: result.lease, message };
  }

  async getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    options: any
  ): ListResultWithPagination<ILeaseDocument> {
    this.log.info(`Getting filtered leases for client ${cuid}`, { filters });

    try {
      const cachedResult = await this.leaseCache.getClientLeases(cuid, options, filters as any);

      if (cachedResult.success && cachedResult.data) {
        this.log.info('Returning leases from cache', {
          cuid,
          count: cachedResult.data.leases?.length || 0,
        });

        return {
          success: true,
          data: cachedResult.data.leases,
          message: 'Leases retrieved successfully (cached)',
          pagination: {
            currentPage: options.page || 1,
            perPage: options.limit || 10,
            total: cachedResult.data.pagination.total,
            totalPages: Math.ceil(cachedResult.data.pagination.total / (options.limit || 10)),
            hasMoreResource:
              (options.page || 1) <
              Math.ceil(cachedResult.data.pagination.total / (options.limit || 10)),
          },
        } as any;
      }
      const result = await this.leaseDAO.getFilteredLeases(cuid, filters, options);

      await this.leaseCache.saveClientLeases(cuid, result.items, {
        pagination: options,
        filter: filters as any,
        totalCount: result.pagination?.total,
      });

      return {
        success: true,
        data: result.items,
        message: 'Leases retrieved successfully',
        pagination: result.pagination,
      } as any;
    } catch (error) {
      this.log.error('Error getting filtered leases:', error);
      throw error;
    }
  }

  async getLeaseById(
    cxt: IRequestContext,
    luid: string,
    includeFormattedData: boolean = true
  ): Promise<ISuccessReturnData<any>> {
    try {
      const { cuid } = cxt.request.params;

      if (!cuid || !luid) {
        throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
      }

      const lease = await this.leaseDAO.findFirst(
        { luid },
        includeFormattedData
          ? {
              populate: ['tenantInfo', 'propertyInfo', 'propertyUnitInfo'],
            }
          : undefined
      );

      if (!lease) {
        throw new InvalidRequestError({ message: t('lease.not_found') });
      }

      if (lease.cuid !== cuid) {
        throw new InvalidRequestError({ message: t('lease.invalid_access') });
      }

      if (!includeFormattedData) {
        return {
          success: true,
          message: t('lease.retrieved_successfully'),
          data: { lease },
        };
      }

      const userRole = convertUserRoleToEnum(cxt.currentuser!.client.role);

      if (userRole === IUserRole.TENANT) {
        const tenantIdStr =
          typeof lease.tenantId === 'object' && lease.tenantId !== null
            ? (lease.tenantId as any)._id?.toString()
            : lease.tenantId?.toString();

        if (tenantIdStr !== cxt.currentuser!.sub) {
          throw new InvalidRequestError({ message: t('lease.access_denied') });
        }
      }

      const filteredLease = filterLeaseByRole(lease, cxt.currentuser!.sub, userRole);
      const createdBy = await this.profileDAO.findFirst(
        { user: lease.createdBy },
        {
          select:
            'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber personalInfo.avatar.url',
        }
      );

      const response: any = {
        lease: {
          ...filteredLease,
          createdBy,
          tenant: {
            id: lease.tenantId,
            fullname: lease.tenantInfo?.fullname,
            email: (lease.tenantInfo as any).user?.email,
            phone: (lease.tenantInfo as any).personalInfo?.phoneNumber,
            avatar: (lease.tenantInfo as any).personalInfo?.avatar,
          },
        },
        property: lease.propertyInfo || lease.property,
        unit: {
          unitId: lease.propertyUnitInfo?._id,
          unitNumber: lease.propertyUnitInfo?.unitNumber,
          status: lease.propertyUnitInfo?.status,
          floor: lease.propertyUnitInfo?.floor,
          specifications: lease.propertyUnitInfo?.specifications,
        },
      };

      response.payments = [];
      response.documents = filterDocumentsByRole(lease.leaseDocuments || [], userRole);
      response.activity = constructActivityFeed(lease);
      response.timeline = buildLeaseTimeline(lease);
      response.permissions = getUserPermissions(lease, cxt.currentuser!);
      response.financialSummary = calculateFinancialSummary(lease);

      const pendingChangesPreview = generatePendingChangesPreview(lease, cxt.currentuser!);
      if (pendingChangesPreview) {
        response.pendingChangesPreview = pendingChangesPreview;
      }

      return {
        success: true,
        message: t('lease.retrieved_successfully'),
        data: response,
      };
    } catch (error: any) {
      this.log.error('Error getting lease by ID:', error);
      throw error;
    }
  }

  async updateLease(
    cxt: IRequestContext,
    luid: string,
    updateData: Partial<ILeaseFormData>
  ): Promise<ISuccessReturnData<any>> {
    try {
      const { cuid } = cxt.request.params;
      const currentUser = cxt.currentuser!;

      const userRole = convertUserRoleToEnum(currentUser.client.role);
      if (!PROPERTY_STAFF_ROLES.includes(userRole) && !PROPERTY_APPROVAL_ROLES.includes(userRole)) {
        throw new ForbiddenError({ message: 'You are not authorized to update leases.' });
      }

      const lease = await this.leaseDAO.findFirst({ luid, cuid, deletedAt: null });
      if (!lease) {
        throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
      }
      if (
        lease.status === LeaseStatus.PENDING_SIGNATURE &&
        !PROPERTY_APPROVAL_ROLES.includes(userRole)
      ) {
        throw new ValidationRequestError({
          message:
            'Cannot edit lease while pending signature. Only administrators can modify pending signature leases.',
        });
      }

      const cleanUpdateData = { ...updateData };
      const isApprovalRole = PROPERTY_APPROVAL_ROLES.includes(userRole);

      if (cleanUpdateData.fees) {
        cleanUpdateData.fees = MoneyUtils.parseMoneyInput(cleanUpdateData.fees);
      }

      if (cleanUpdateData.internalNotes) {
        cleanUpdateData.internalNotes = sanitizeHtml(cleanUpdateData.internalNotes);
      }

      validateImmutableFields(cleanUpdateData);

      switch (lease.status) {
        case LeaseStatus.PENDING_SIGNATURE:
          return await handlePendingSignatureUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole,
            this.leaseDAO,
            this.leaseCache
          );
        case LeaseStatus.TERMINATED:
        case LeaseStatus.CANCELLED:
        case LeaseStatus.EXPIRED:
          return await handleClosedStatusUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole,
            this.leaseDAO,
            this.leaseCache
          );
        case LeaseStatus.ACTIVE: {
          return await handleActiveUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole,
            this.leaseDAO,
            this.profileDAO,
            this.leaseCache
          );
        }
        case LeaseStatus.DRAFT:
          return await handleDraftUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            this.leaseDAO,
            this.profileDAO,
            this.leaseCache
          );
        default:
          throw new ValidationRequestError({
            message: `Cannot update lease with status: ${lease.status}`,
          });
      }
    } catch (error: any) {
      this.log.error('Error updating lease:', error);
      throw error;
    }
  }

  async deleteLease(cuid: string, leaseId: string, userId: string): IPromiseReturnedData<boolean> {
    this.log.info(`Deleting lease ${leaseId} for client ${cuid}`);

    const lease = await this.leaseDAO.findFirst({
      luid: leaseId,
      cuid,
      deletedAt: null,
    });

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }

    // Business Rule: Only DRAFT and CANCELLED leases can be deleted
    if (lease.status !== LeaseStatus.DRAFT && lease.status !== LeaseStatus.CANCELLED) {
      throw new ValidationRequestError({
        message: `Cannot delete ${lease.status} lease`,
        errorInfo: {
          status: [
            `Only DRAFT and CANCELLED leases can be deleted. This lease has status: ${lease.status}. Please cancel the lease first if you want to remove it.`,
          ],
        },
      });
    }

    // Perform soft delete
    const deleted = await lease.softDelete(new Types.ObjectId(userId));

    if (!deleted) {
      throw new BadRequestError({ message: 'Failed to delete lease' });
    }

    this.log.info('Lease deleted successfully', {
      leaseId: lease.luid,
      status: lease.status,
      deletedBy: userId,
    });

    // Invalidate lease cache
    await this.leaseCache.invalidateLease(cuid, leaseId);
    await this.leaseCache.invalidateLeaseLists(cuid);

    return {
      success: true,
      data: true,
      message: 'Lease deleted successfully',
    };
  }

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
      const templateData = this.leaseTemplateDataMapper.transformForTemplate(previewData);
      const finalTemplateType =
        templateType || determineTemplateType(lease.property.propertyType || '');
      const html = await this.leaseTemplateService.renderLeasePreview(
        templateData,
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

      const job = await this.pdfGeneratorQueue.addToPdfQueue({
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

  async activateLease(
    cuid: string,
    leaseId: string,
    _activationData: any,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Activating lease ${leaseId} for client ${cuid}`);

    // Get the lease first
    const lease = await this.leaseDAO.findFirst({
      luid: leaseId,
      cuid,
      deletedAt: null,
    });

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }

    enforceLeaseApprovalRequirement(lease, 'activate');

    throw new Error('activateLease not yet implemented');
  }

  async terminateLease(
    cuid: string,
    leaseId: string,
    _terminationData: any,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Terminating lease ${leaseId} for client ${cuid}`);
    throw new Error('terminateLease not yet implemented');
  }

  async uploadLeaseDocument(
    cuid: string,
    leaseId: string,
    _file: any,
    _uploadedBy: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Uploading document for lease ${leaseId}`);
    throw new Error('uploadLeaseDocument not yet implemented');
  }

  async getLeaseDocumentUrl(cuid: string, leaseId: string): IPromiseReturnedData<string> {
    this.log.info(`Getting document URL for lease ${leaseId}`);
    throw new Error('getLeaseDocumentUrl not yet implemented');
  }

  async removeLeaseDocument(
    cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Removing document for lease ${leaseId}`);
    throw new Error('removeLeaseDocument not yet implemented');
  }

  async sendLeaseForSignature(cxt: IRequestContext): Promise<ISuccessReturnData> {
    const { cuid, luid } = cxt.request.params;
    const currentuser = cxt.currentuser!;

    const userRole = convertUserRoleToEnum(currentuser.client.role);
    if (!PROPERTY_STAFF_ROLES.includes(userRole) && !PROPERTY_APPROVAL_ROLES.includes(userRole)) {
      throw new ForbiddenError({ message: 'You are not authorized to update leases.' });
    }

    const lease = await this.leaseDAO.findFirst({
      luid,
      cuid,
      deletedAt: null,
    });

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.notFound') });
    }

    if (![LeaseStatus.PENDING_SIGNATURE, LeaseStatus.DRAFT].includes(lease.status)) {
      throw new ValidationRequestError({
        message: 'Lease must be in DRAFT or PENDING_SIGNATURE state to send for signature',
      });
    }

    if (
      lease.eSignature?.status === ILeaseESignatureStatusEnum.SENT &&
      lease.eSignature?.envelopeId
    ) {
      throw new ValidationRequestError({
        message: 'Lease has already been sent for signatures',
      });
    }

    const leasePDF = lease.leaseDocuments?.find(
      (doc) => doc.documentType === 'lease_agreement' && doc.status === 'active'
    );
    if (!leasePDF || !leasePDF.key) {
      throw new ValidationRequestError({
        message: 'Lease PDF must be uploaded before sending for signature',
      });
    }

    const pdfBuffer = await this.s3Service.getFileBuffer(leasePDF.key);
    if (!pdfBuffer) {
      throw new ValidationRequestError({
        message: 'Lease PDF must be generated before sending for signature',
      });
    }

    const tenant = await this.profileDAO.findFirst({ _id: lease.tenantId }, { populate: 'user' });
    if (!tenant || !tenant.user) {
      throw new BadRequestError({ message: 'Tenant information not found' });
    }
    const tenantUser = typeof tenant.user === 'object' ? tenant.user : null;
    if (!tenantUser || !(tenantUser as any).email) {
      throw new BadRequestError({ message: 'Tenant email not found' });
    }

    // Get property manager/owner
    const property = await this.propertyDAO.findFirst({ _id: lease.property.id, deletedAt: null });
    if (!property) {
      throw new BadRequestError({ message: 'Property not found' });
    }

    if (property.status !== 'available') {
      throw new BadRequestError({
        message: 'Cannot send lease for signatures, as the selected property is not available.',
      });
    }

    let propertyUnit = null;
    if (lease.property.unitId) {
      propertyUnit = await this.propertyUnitDAO.findFirst({ _id: lease.property.unitId });
      if (!propertyUnit) {
        throw new BadRequestError({
          message: 'Property unit not found, unable to proceed with sending lease for signature.',
        });
      }

      if (propertyUnit.status !== 'available') {
        throw new BadRequestError({
          message: 'Cannot send lease for signatures, as the selected unit is not available.',
        });
      }
    }

    const propertyManager = await this.profileDAO.findFirst(
      { user: property.managedBy },
      { populate: 'user' }
    );
    if (!propertyManager || !propertyManager.user) {
      throw new BadRequestError({ message: 'Property manager information not found' });
    }
    const pmUser = typeof propertyManager.user === 'object' ? propertyManager.user : null;
    if (!pmUser || !(pmUser as any)?.email) {
      throw new BadRequestError({ message: 'Property manager email not found' });
    }

    const signers = [
      {
        name:
          `${tenant.personalInfo?.firstName || ''} ${tenant.personalInfo?.lastName || ''}`.trim() ||
          'Tenant',
        email: (tenantUser as any).email,
        role: 'tenant' as const,
        userId: (tenantUser as any)._id,
      },
      {
        name:
          `${propertyManager.personalInfo?.firstName || ''} ${propertyManager.personalInfo?.lastName || ''}`.trim() ||
          'Property Manager',
        email: (pmUser as any).email,
        role: 'property_manager' as const,
        userId: (pmUser as any)._id,
      },
    ];

    return {
      success: true,
      message: 'sendLeaseForSignature not yet implemented',
      data: { signers },
    };
  }

  async markAsManualySigned(
    _cuid: string,
    leaseId: string,
    _signedBy: any[],
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Marking lease ${leaseId} as manually signed`);
    throw new Error('markAsManualySigned not yet implemented');
  }

  async cancelSignature(
    _cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Cancelling signature for lease ${leaseId}`);
    throw new Error('cancelSignature not yet implemented');
  }

  async getSignatureDetails(cuid: string, leaseId: string): IPromiseReturnedData<any> {
    this.log.info(`Getting signature details for lease ${leaseId}`);
    throw new Error('getSignatureDetails not yet implemented');
  }

  async handleSignatureWebhook(event: any): IPromiseReturnedData<boolean> {
    this.log.info('Handling signature webhook', { eventType: event.type });
    throw new Error('handleSignatureWebhook not yet implemented');
  }

  /**
   * Helper method to build landlord and management company info based on property ownership
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
    if (client.accountType.isCorporate && client.companyProfile) {
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

    if (!client.accountType.isCorporate) {
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

    // const isMultiUnit = PropertyTypeManager.supportsMultipleUnits(property.propertyType);
    // const ownershipType = property.owner?.type || 'company_owned';

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
      unitNumber: (lease.property.unitId as any).unitNumber || 'N/A',
    };

    return baseData;
  }

  async getExpiringLeases(
    cuid: string,
    daysThreshold: number = 30
  ): IPromiseReturnedData<ILeaseDocument[]> {
    if (!cuid) {
      throw new BadRequestError({ message: 'Client ID is required' });
    }

    if (daysThreshold <= 0 || !Number.isInteger(daysThreshold) || daysThreshold > 365) {
      throw new BadRequestError({ message: 'Invalid days threshold provided.' });
    }

    const leases = await this.leaseDAO.getExpiringLeases(cuid, daysThreshold);

    return {
      success: true,
      message: `Found ${leases.length} lease(s) expiring within ${daysThreshold} days`,
      data: leases,
    };
  }

  async getLeaseStats(cuid: string, filters?: any): IPromiseReturnedData<any> {
    this.log.info(`Getting lease statistics for client ${cuid}`, { filters });

    try {
      const stats = await this.leaseDAO.getLeaseStats(cuid, filters);

      return {
        success: true,
        message: 'Lease statistics retrieved successfully',
        data: stats,
      };
    } catch (error) {
      this.log.error({ error, cuid }, 'Failed to get lease statistics');
      throw error;
    }
  }

  /**
   * Update lease with uploaded document information
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
   * Get pending lease approvals (admin/manager only)
   */
  async getPendingLeaseApprovals(
    cuid: string,
    currentuser: any,
    pagination: any
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to view pending approvals.',
      });
    }

    const filters = { approvalStatus: 'pending' as const };
    const leases = await this.leaseDAO.getFilteredLeases(cuid, filters, pagination);

    return {
      success: true,
      data: {
        items: leases.items,
        pagination: leases.pagination,
      },
      message: 'Pending lease approvals retrieved successfully',
    };
  }

  /**
   * Approve a pending lease
   */
  async approveLease(
    cuid: string,
    leaseId: string,
    currentuser: any,
    notes?: string
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to approve leases.',
      });
    }

    const lease = await this.leaseDAO.findFirst({
      luid: leaseId,
      cuid,
      deletedAt: null,
    });

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }

    if (lease.approvalStatus === 'approved' && !lease.pendingChanges) {
      throw new InvalidRequestError({
        message: 'Lease is already approved and has no pending changes.',
      });
    }

    const approvalEntry = {
      action: 'approved' as const,
      actor: currentuser.sub,
      timestamp: new Date(),
      ...(notes && { notes }),
    };

    const updateData: any = {
      $push: { approvalDetails: approvalEntry },
      $set: {
        approvalStatus: 'approved',
        lastModifiedBy: [
          {
            userId: currentuser.sub,
            name: currentuser.fullname,
            date: new Date(),
            action: 'updated',
          },
        ],
      },
    };

    if (lease.pendingChanges) {
      Object.keys(lease.pendingChanges).forEach((key) => {
        if (key !== 'updatedBy' && key !== 'updatedAt' && key !== 'displayName') {
          updateData.$set[key] = lease.pendingChanges![key];
        }
      });
      updateData.$set.pendingChanges = null;
    }

    const updatedLease = await this.leaseDAO.update(
      { luid: leaseId, cuid, deletedAt: null },
      updateData
    );

    const originalRequesterId = (lease.createdBy as Types.ObjectId).toString();
    if (originalRequesterId && originalRequesterId !== currentuser.sub) {
      try {
        await this.notificationService.notifyApprovalDecision(
          {
            resourceId: updatedLease!._id.toString(),
            resourceUid: updatedLease!.luid,
            resourceName: `Lease ${updatedLease!.leaseNumber}`,
          },
          currentuser.sub,
          cuid,
          'approved',
          originalRequesterId,
          notes,
          {
            tenantId: lease.tenantId?.toString(),
            propertyAddress: lease.property?.address,
            hadPendingChanges: !!lease.pendingChanges,
          }
        );
        this.log.info('Lease approval notification sent to creator', {
          leaseId,
          originalRequesterId,
        });
      } catch (notificationError) {
        this.log.error('Failed to send lease approval notification', {
          error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
          leaseId,
        });
      }
    }

    this.log.info('Lease approved successfully', {
      leaseId,
      approvedBy: currentuser.sub,
    });

    // Invalidate lease cache
    await this.leaseCache.invalidateLease(cuid, leaseId);
    await this.leaseCache.invalidateLeaseLists(cuid);

    return {
      success: true,
      data: updatedLease,
      message: 'Lease approved successfully',
    };
  }

  /**
   * Reject a pending lease
   */
  async rejectLease(
    cuid: string,
    leaseId: string,
    currentuser: any,
    reason: string
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to reject leases.',
      });
    }

    if (!reason) {
      throw new BadRequestError({ message: 'Rejection reason is required' });
    }

    const lease = await this.leaseDAO.findFirst({
      luid: leaseId,
      cuid,
      deletedAt: null,
    });

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }

    const approvalEntry = {
      action: 'rejected' as const,
      actor: currentuser.sub,
      timestamp: new Date(),
      notes: reason,
    };

    const updatedLease = await this.leaseDAO.update(
      { luid: leaseId, cuid, deletedAt: null },
      {
        $push: { approvalDetails: approvalEntry },
        $set: {
          approvalStatus: 'rejected',
          pendingChanges: null,
        },
      }
    );

    // Send notification to staff with rejection reason
    const originalRequesterId = (lease.createdBy as Types.ObjectId).toString();
    if (originalRequesterId && originalRequesterId !== currentuser.sub) {
      try {
        await this.notificationService.notifyApprovalDecision(
          {
            resourceId: updatedLease!._id.toString(),
            resourceUid: updatedLease!.luid,
            resourceName: `Lease ${updatedLease!.leaseNumber}`,
          },
          currentuser.sub,
          cuid,
          'rejected',
          originalRequesterId,
          reason,
          {
            tenantId: lease.tenantId?.toString(),
            propertyAddress: lease.property?.address,
            hadPendingChanges: !!lease.pendingChanges,
          }
        );
        this.log.info('Lease rejection notification sent to creator', {
          leaseId,
          originalRequesterId,
        });
      } catch (notificationError) {
        this.log.error('Failed to send lease rejection notification', {
          error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
          leaseId,
        });
      }
    }

    this.log.info('Lease rejected', {
      leaseId,
      rejectedBy: currentuser.sub,
      reason,
    });

    await this.leaseCache.invalidateLease(cuid, leaseId);
    await this.leaseCache.invalidateLeaseLists(cuid);

    return {
      success: true,
      data: updatedLease,
      message: 'Lease rejected',
    };
  }

  async bulkApproveLeases(
    cuid: string,
    leaseIds: string[],
    currentuser: any
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to bulk approve leases.',
      });
    }

    const approvalEntry = {
      action: 'approved' as const,
      actor: currentuser.sub,
      timestamp: new Date(),
      notes: 'Bulk approved',
    };

    const updateData = {
      $push: { approvalDetails: approvalEntry },
      $set: {
        approvalStatus: 'approved',
        pendingChanges: null,
      },
    };

    const result = await this.leaseDAO.updateMany(
      {
        luid: { $in: leaseIds },
        cuid,
        deletedAt: null,
        approvalStatus: 'pending',
      },
      updateData
    );

    this.log.info('Leases bulk approved', {
      count: result.modifiedCount,
      approvedBy: currentuser.sub,
    });

    await this.leaseCache.invalidateLeaseLists(cuid);

    return {
      success: true,
      data: { modifiedCount: result.modifiedCount },
      message: `${result.modifiedCount} lease(s) approved successfully`,
    };
  }

  async bulkRejectLeases(
    cuid: string,
    leaseIds: string[],
    currentuser: any,
    reason: string
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to bulk reject leases.',
      });
    }

    if (!reason) {
      throw new BadRequestError({ message: 'Rejection reason is required' });
    }

    const approvalEntry = {
      action: 'rejected' as const,
      actor: currentuser.sub,
      timestamp: new Date(),
      notes: reason,
    };

    const updateData = {
      $push: { approvalDetails: approvalEntry },
      $set: {
        approvalStatus: 'rejected',
        pendingChanges: null,
      },
    };

    const result = await this.leaseDAO.updateMany(
      {
        luid: { $in: leaseIds },
        cuid,
        deletedAt: null,
        approvalStatus: 'pending',
      },
      updateData
    );

    this.log.info('Leases bulk rejected', {
      count: result.modifiedCount,
      rejectedBy: currentuser.sub,
      reason,
    });

    await this.leaseCache.invalidateLeaseLists(cuid);

    return {
      success: true,
      data: { modifiedCount: result.modifiedCount },
      message: `${result.modifiedCount} lease(s) rejected`,
    };
  }

  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));

    this.emitterService.on(EventTypes.PDF_GENERATION_REQUESTED, this.handlePdfGenerationRequest);

    this.log.info('Lease service event listeners initialized');
  }

  private handlePdfGenerationRequest = async (
    payload: PdfGenerationRequestedPayload
  ): Promise<void> => {
    const { templateType, jobId, resource, cuid } = payload;

    try {
      this.log.info(
        `Handling PDF generation request for lease ${resource.resourceId}, job ${jobId}`
      );

      // Call your existing generateLeasePDF method
      const result = await this.generateLeasePDF(cuid, resource.resourceId, templateType);

      if (result.success && result.pdfUrl) {
        this.emitterService.emit(EventTypes.PDF_GENERATED, {
          jobId,
          leaseId: resource.resourceId,
          pdfUrl: result.pdfUrl,
          s3Key: result.s3Key || '',
          fileSize: result.metadata?.fileSize,
          generationTime: result.metadata?.generationTime,
        } as PdfGeneratedPayload);

        this.log.info(`PDF generated successfully for lease ${resource.resourceId}`, {
          jobId,
          pdfUrl: result.pdfUrl,
        });
      } else {
        throw new Error(result.error || 'PDF generation failed');
      }
    } catch (error) {
      this.log.error(
        { error, resourceId: resource.resourceId, jobId },
        'Failed to handle PDF generation request'
      );
      this.emitterService.emit(EventTypes.PDF_GENERATION_FAILED, {
        jobId,
        resourceId: resource.resourceId,
        error: error instanceof Error ? error.message : 'Unknown error',
      } as PdfGenerationFailedPayload);
    }
  };

  private async markLeaseDocumentsAsFailed(leaseId: string, errorMessage: string): Promise<void> {
    this.log.warn('Marking lease documents as failed', {
      leaseId,
      errorMessage,
    });

    await this.leaseDAO.updateLeaseDocumentStatus(leaseId, 'failed', errorMessage);
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
   * Validates lease data and collects all validation errors
   * @param cuid - Client ID
   * @param leaseData - Lease form data to validate
   * @param validationErrors - Object to collect validation errors
   * @returns Object with hasErrors boolean and errors record
   */
  private async validateLeaseData(
    cuid: string,
    leaseData: ILeaseFormData,
    propertyRecord: IPropertyDocument
  ): Promise<{
    hasErrors: boolean;
    errors: Record<string, string[]>;
    tenantInfo?: {
      tenantId: Types.ObjectId;
      useInvitationIdAsTenantId: boolean;
    } | null;
    propertyInfo?: {
      id: string;
      address: string;
      unitId: string | null;
      propertyType?: string;
      name?: string;
      unitNumber?: string;
      specifications?: {
        totalArea?: number;
        bedrooms?: number;
        bathrooms?: number;
        parkingSpaces?: number;
        floors?: number;
      };
    };
  }> {
    const validationErrors: Record<string, string[]> = {};
    let tenantInfo: { tenantId: Types.ObjectId; useInvitationIdAsTenantId: boolean } | null = null;

    if (leaseData.tenantInfo.id) {
      if (!Types.ObjectId.isValid(leaseData.tenantInfo.id)) {
        if (!validationErrors['tenantInfo.id']) validationErrors['tenantInfo.id'] = [];
        validationErrors['tenantInfo.id'].push('Invalid tenant ID format');
      } else {
        const user = await this.userDAO.findFirst({
          _id: new Types.ObjectId(leaseData.tenantInfo.id),
          activecuid: cuid,
          deletedAt: null,
        });

        if (!user) {
          if (!validationErrors['tenantInfo.id']) validationErrors['tenantInfo.id'] = [];
          validationErrors['tenantInfo.id'].push(t('lease.errors.tenantNotFound'));
        } else {
          const clientAccess = user.cuids.find((c) => c.cuid === cuid);
          if (!clientAccess || !clientAccess.roles.includes('tenant')) {
            if (!validationErrors['tenantInfo.id']) validationErrors['tenantInfo.id'] = [];
            validationErrors['tenantInfo.id'].push(t('common.errors.invalidUserRole'));
          } else {
            tenantInfo = {
              tenantId: user._id,
              useInvitationIdAsTenantId: false,
            };
          }
        }
      }
    } else if (leaseData.tenantInfo.email) {
      const client = await this.clientDAO.getClientByCuid(cuid);
      if (!client) {
        if (!validationErrors['client']) validationErrors['client'] = [];
        validationErrors['client'].push(t('common.errors.clientNotFound'));
      } else {
        const invitation = await this.invitationDAO.findFirst({
          inviteeEmail: leaseData.tenantInfo.email.toLowerCase(),
          clientId: client.id,
          role: 'tenant',
        });

        if (!invitation) {
          if (leaseData.tenantInfo.firstName && leaseData.tenantInfo.lastName) {
            this.log.info('No existing invitation found, will create new tenant invitation', {
              email: leaseData.tenantInfo.email,
            });
            tenantInfo = {
              tenantId: new Types.ObjectId(),
              useInvitationIdAsTenantId: true,
            };
          } else {
            if (!validationErrors['tenantInfo.email']) validationErrors['tenantInfo.email'] = [];
            validationErrors['tenantInfo.email'].push(
              `No tenant record found for '${leaseData.tenantInfo.email}'. Please provide firstName and lastName to send an invitation.`
            );
          }
        } else if (['pending', 'draft', 'sent'].includes(invitation.status)) {
          tenantInfo = {
            tenantId: invitation._id,
            useInvitationIdAsTenantId: true,
          };

          this.log.info('Lease using invitation ID as temporary tenant', {
            email: leaseData.tenantInfo.email,
            invitationId: invitation._id.toString(),
            invitationStatus: invitation.status,
          });
        } else {
          if (!validationErrors['tenantInfo.email']) validationErrors['tenantInfo.email'] = [];
          validationErrors['tenantInfo.email'].push(
            `Invitation status is '${invitation.status}'. Cannot create lease.`
          );
        }
      }
    } else {
      if (!validationErrors['tenantInfo']) validationErrors['tenantInfo'] = [];
      validationErrors['tenantInfo'].push('Either tenant ID or email is required');
    }

    let unit = null;

    if (!propertyRecord) {
      if (!validationErrors['property.id']) validationErrors['property.id'] = [];
      validationErrors['property.id'].push(t('property.errors.notFound'));
    } else {
      const isMultiUnit = PropertyTypeManager.supportsMultipleUnits(propertyRecord.propertyType);

      if (isMultiUnit) {
        if (!leaseData.property.unitId) {
          if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
          validationErrors['property.unitId'].push(
            `Unit ID is required for ${propertyRecord.propertyType} properties`
          );
        } else {
          unit = await this.propertyUnitDAO.findFirst({
            _id: leaseData.property.unitId,
            propertyId: propertyRecord._id,
            cuid,
          });

          if (!unit) {
            if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
            validationErrors['property.unitId'].push(
              'Unit not found or does not belong to this property'
            );
          } else {
            if (unit.status === PropertyUnitStatusEnum.OCCUPIED) {
              if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
              validationErrors['property.unitId'].push(
                'Unit is currently occupied and cannot be leased'
              );
            } else if (
              unit.status === PropertyUnitStatusEnum.MAINTENANCE ||
              unit.status === PropertyUnitStatusEnum.INACTIVE
            ) {
              if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
              validationErrors['property.unitId'].push(
                'Unit status indicates it cannot be leased at this time'
              );
            }
          }
        }
      }
    }

    if (
      leaseData.duration.endDate &&
      new Date(leaseData.duration.endDate) <= new Date(leaseData.duration.startDate)
    ) {
      if (!validationErrors['duration.endDate']) validationErrors['duration.endDate'] = [];
      validationErrors['duration.endDate'].push(t('lease.errors.endDateMustBeAfterStartDate'));
    }
    if (
      leaseData.duration.moveInDate &&
      new Date(leaseData.duration.moveInDate) < new Date(leaseData.duration.startDate)
    ) {
      if (!validationErrors['duration.moveInDate']) validationErrors['duration.moveInDate'] = [];
      validationErrors['duration.moveInDate'].push(
        t('lease.errors.moveInDateMustBeOnOrAfterStartDate')
      );
    }

    if (leaseData.fees.monthlyRent <= 0 || isNaN(leaseData.fees.monthlyRent)) {
      if (!validationErrors['fees.monthlyRent']) validationErrors['fees.monthlyRent'] = [];
      validationErrors['fees.monthlyRent'].push(t('lease.errors.rentMustBePositive'));
    }
    if (leaseData.fees.securityDeposit < 0 || isNaN(leaseData.fees.securityDeposit)) {
      if (!validationErrors['fees.securityDeposit']) validationErrors['fees.securityDeposit'] = [];
      validationErrors['fees.securityDeposit'].push(t('lease.errors.depositCannotBeNegative'));
    }
    if (leaseData.fees.rentDueDay < 1 || leaseData.fees.rentDueDay > 31) {
      if (!validationErrors['fees.rentDueDay']) validationErrors['fees.rentDueDay'] = [];
      validationErrors['fees.rentDueDay'].push(t('lease.errors.rentDueDayMustBeBetween1And31'));
    }
    if (leaseData.fees.lateFeeType === 'percentage' && !leaseData.fees.lateFeePercentage) {
      if (!validationErrors['fees.lateFeePercentage'])
        validationErrors['fees.lateFeePercentage'] = [];
      validationErrors['fees.lateFeePercentage'].push(
        'Late fee percentage is required when late fee type is percentage'
      );
    }

    const overlappingLeases = await this.leaseDAO.checkOverlappingLeases(
      cuid,
      leaseData.property.id,
      leaseData.property.unitId,
      new Date(leaseData.duration.startDate),
      leaseData.duration.endDate ? new Date(leaseData.duration.endDate) : new Date('2099-12-31')
    );
    if (overlappingLeases.length > 0) {
      if (!validationErrors['lease']) validationErrors['lease'] = [];
      validationErrors['lease'].push(t('lease.errors.overlappingLease'));
    }

    return {
      hasErrors: Object.keys(validationErrors).length > 0,
      errors: validationErrors,
      tenantInfo: tenantInfo || null,
      propertyInfo: {
        id: leaseData.property.id,
        unitId: leaseData.property.unitId || null,
        address: propertyRecord?.address.fullAddress || '',
        propertyType: propertyRecord?.propertyType,
        name: propertyRecord?.name,
        unitNumber: unit?.unitNumber,
        specifications: propertyRecord
          ? {
              totalArea:
                unit?.specifications?.totalArea || propertyRecord.specifications?.totalArea,
              bedrooms: unit?.specifications?.bedrooms || propertyRecord.specifications?.bedrooms,
              bathrooms:
                unit?.specifications?.bathrooms || propertyRecord.specifications?.bathrooms,
              parkingSpaces: propertyRecord.specifications?.parkingSpaces,
              floors: propertyRecord.specifications?.floors,
            }
          : undefined,
      },
    };
  }

  private async handleUploadCompleted(payload: UploadCompletedPayload): Promise<void> {
    const { results, resourceName, resourceId, actorId } = payload;

    if (resourceName !== 'lease') {
      this.log.debug('Ignoring non-lease upload event', { resourceName });
      return;
    }

    try {
      await this.updateLeaseDocuments(resourceId, results, actorId);

      this.log.info('Successfully processed lease upload completed event', {
        leaseId: resourceId,
        documentCount: results.length,
      });
    } catch (error) {
      this.log.error('Error processing lease upload completed event', {
        error: error instanceof Error ? error.message : 'Unknown error',
        leaseId: resourceId,
      });

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

  private async handleUploadFailed(payload: UploadFailedPayload): Promise<void> {
    const { error, resourceId } = payload;

    this.log.error('Received upload failed event for lease', {
      resourceId,
      error: error.message,
    });

    try {
      await this.markLeaseDocumentsAsFailed(resourceId, error.message);

      this.log.info('Successfully marked lease documents as failed', {
        leaseId: resourceId,
      });
    } catch (markFailedError) {
      this.log.error('Failed to mark lease documents as failed', {
        error: markFailedError instanceof Error ? markFailedError.message : 'Unknown error',
        leaseId: resourceId,
      });
    }
  }

  /**
   * Cleanup event listeners
   */
  cleanupEventListeners(): void {
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.emitterService.off(EventTypes.UPLOAD_FAILED, this.handleUploadFailed);

    this.log.info('Lease service event listeners removed');
  }
}
