/* eslint-disable no-case-declarations */
import dayjs from 'dayjs';
import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import sanitizeHtml from 'sanitize-html';
import { LeaseCache } from '@caching/index';
import { MailService } from '@mailer/index';
import { envVariables } from '@shared/config';
import { PropertyDAO } from '@dao/propertyDAO';
import { QueueFactory } from '@services/queue';
import { IUserBasicInfo } from '@dao/interfaces';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { ESignatureQueue, PdfQueue } from '@queues/index';
import { IUserRole } from '@shared/constants/roles.constants';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';
import { ProcessedWebhookData } from '@services/esignature/boldSign.service';
import { InvitationDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import { PdfGeneratorService, MediaUploadService, UserService } from '@services/index';
import { IPropertyDocument, IProfileWithUser, OwnershipType, ICronJob } from '@interfaces/index';
import {
  PdfGenerationRequestedPayload,
  PdfGeneratedPayload,
  EventTypes,
} from '@interfaces/events.interface';
import {
  EventEmitterService,
  NotificationService,
  InvitationService,
  BoldSignService,
} from '@services/index';
import {
  ValidationRequestError,
  InvalidRequestError,
  BadRequestError,
  ForbiddenError,
} from '@shared/customErrors';
import {
  NotificationPriorityEnum,
  NotificationTypeEnum,
  RecipientTypeEnum,
} from '@interfaces/notification.interface';
import {
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
  MailType,
} from '@interfaces/utils.interface';
import {
  PROPERTY_APPROVAL_ROLES,
  determineTemplateType,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  LEASE_CONSTANTS,
  createLogger,
  MoneyUtils,
  JOB_NAME,
} from '@utils/index';

import { LeasePdfService } from './leasePdf.service';
import { LeaseRenewalService } from './leaseRenewal.service';
import { LeaseTemplateService } from './leaseTemplateService';
import { LeaseDocumentService } from './leaseDocument.service';
import { LeaseSignatureService } from './leaseSignature.service';
import {
  enforceLeaseApprovalRequirement,
  validateLeaseReadyForActivation,
  generatePendingChangesPreview,
  handlePendingSignatureUpdate,
  calculateFinancialSummary,
  validateLeaseTermination,
  handleClosedStatusUpdate,
  calculateRenewalMetadata,
  validateImmutableFields,
  constructActivityFeed,
  filterDocumentsByRole,
  handleActiveUpdate,
  buildLeaseTimeline,
  getUserPermissions,
  filterLeaseByRole,
  handleDraftUpdate,
  fetchLeaseByLuid,
} from './leaseHelpers';

interface IConstructor {
  leaseSignatureService: LeaseSignatureService;
  leaseDocumentService: LeaseDocumentService;
  leaseRenewalService: LeaseRenewalService;
  notificationService: NotificationService;
  pdfGeneratorService: PdfGeneratorService;
  mediaUploadService: MediaUploadService;
  invitationService: InvitationService;
  emitterService: EventEmitterService;
  leasePdfService: LeasePdfService;
  boldSignService: BoldSignService;
  propertyUnitDAO: PropertyUnitDAO;
  invitationDAO: InvitationDAO;
  mailerService: MailService;
  queueFactory: QueueFactory;
  propertyDAO: PropertyDAO;
  userService: UserService;
  leaseCache: LeaseCache;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class LeaseService {
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly leaseCache: LeaseCache;
  private readonly propertyDAO: PropertyDAO;
  private readonly userService: UserService;
  private readonly mailerService: MailService;
  private readonly queueFactory: QueueFactory;
  private readonly invitationDAO: InvitationDAO;
  private readonly boldSignService: BoldSignService;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly invitationService: InvitationService;
  private readonly mediaUploadService: MediaUploadService;
  private readonly pdfGeneratorService: PdfGeneratorService;
  private readonly notificationService: NotificationService;
  private readonly leaseTemplateService: LeaseTemplateService;
  private readonly leaseRenewalService: LeaseRenewalService;
  private readonly leaseDocumentService: LeaseDocumentService;
  private readonly leaseSignatureService: LeaseSignatureService;
  private readonly leasePdfService: LeasePdfService;

  constructor({
    boldSignService,
    clientDAO,
    emitterService,
    invitationDAO,
    invitationService,
    leaseCache,
    leaseDAO,
    leaseDocumentService,
    leasePdfService,
    leaseRenewalService,
    leaseSignatureService,
    mailerService,
    mediaUploadService,
    notificationService,
    pdfGeneratorService,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    queueFactory,
    userDAO,
    userService,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.leaseCache = leaseCache;
    this.propertyDAO = propertyDAO;
    this.userService = userService;
    this.queueFactory = queueFactory;
    this.mailerService = mailerService;
    this.invitationDAO = invitationDAO;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.boldSignService = boldSignService;
    this.log = createLogger('LeaseService');
    this.invitationService = invitationService;
    this.mediaUploadService = mediaUploadService;
    this.pdfGeneratorService = pdfGeneratorService;
    this.notificationService = notificationService;
    this.leaseTemplateService = new LeaseTemplateService();
    this.leaseDocumentService = leaseDocumentService;
    this.leasePdfService = leasePdfService;
    this.leaseRenewalService = leaseRenewalService;
    this.leaseSignatureService = leaseSignatureService;
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
    const landlordInfo = await this.buildLandlordInfo(cuid, data.property.id.toString());

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
  ): ListResultWithPagination<ILeaseDocument[]> {
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

      // Only calculate renewal metadata for active leases
      // draft_renewal leases ARE the renewal, so calculating renewal metadata would be wrong
      if (lease.status === 'active') {
        const renewalMetadata = calculateRenewalMetadata(lease);
        if (renewalMetadata) {
          response.renewalMetadata = renewalMetadata;
        }
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

      // Handle internalNotes separately - will append as new note to array
      // let noteToAdd = null;
      // if (cleanUpdateData.internalNotes && typeof cleanUpdateData.internalNotes === 'string') {
      //   noteToAdd = {
      //     note: cleanUpdateData.internalNotes.trim(),
      //     author: currentUser.fullname || 'Unknown',
      //     authorId: currentUser.sub,
      //     timestamp: new Date(),
      //   };
      //   // Remove from main update data
      //   delete cleanUpdateData.internalNotes;
      // }

      validateImmutableFields(cleanUpdateData);
      let result = null;
      switch (lease.status) {
        case LeaseStatus.READY_FOR_SIGNATURE:
        case LeaseStatus.PENDING_SIGNATURE:
          result = await handlePendingSignatureUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole,
            this.leaseDAO,
            this.leaseCache
          );
          break;
        case LeaseStatus.TERMINATED:
        case LeaseStatus.CANCELLED:
        case LeaseStatus.EXPIRED:
          result = await handleClosedStatusUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole,
            this.leaseDAO,
            this.leaseCache
          );
          break;
        case LeaseStatus.ACTIVE:
          result = await handleActiveUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole,
            this.leaseDAO,
            this.profileDAO,
            this.leaseCache
          );
          break;
        case LeaseStatus.DRAFT:
          result = await handleDraftUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            this.leaseDAO,
            this.profileDAO,
            this.leaseCache
          );
          break;
        default:
          throw new ValidationRequestError({
            message: `Cannot update lease with status: ${lease.status}`,
          });
      }

      // If there's a note to add, append it now after main update
      // if (noteToAdd && result?.success) {
      //   await this.leaseDAO.update(
      //     { luid, cuid, deletedAt: null },
      //     {
      //       $push: { internalNotes: noteToAdd }
      //     }
      //   );

      //   // Refetch the lease to include the new note in response
      //   const updatedLease = await this.leaseDAO.findOne({
      //     filter: { luid, cuid, deletedAt: null }
      //   });

      //   if (result.data && updatedLease) {
      //     result.data = updatedLease;
      //   }
      // }

      return result
        ? result
        : { success: false, message: 'No updates were made to the lease.', data: null };
    } catch (error: any) {
      this.log.error('Error updating lease:', error);
      throw error;
    }
  }

  /**
   * Delegate to LeaseSignatureService
   */
  async sendLeaseForSignature(cxt: IRequestContext): Promise<ISuccessReturnData> {
    return this.leaseSignatureService.sendLeaseForSignature(cxt);
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

    // Only DRAFT and CANCELLED leases can be deleted
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

    const deleted = await lease.softDelete(new Types.ObjectId(userId));
    if (!deleted) {
      throw new BadRequestError({ message: 'Failed to delete lease' });
    }

    // Invalidate lease cache
    await this.leaseCache.invalidateLease(cuid, leaseId);
    await this.leaseCache.invalidateLeaseLists(cuid);

    return {
      success: true,
      data: true,
      message: 'Lease deleted successfully',
    };
  }

  /**
   * Terminate an active lease
   */
  async terminateLease(
    cuid: string,
    luid: string,
    terminationData: {
      terminationDate: Date;
      terminationReason: string;
      moveOutDate?: Date;
      notes?: string;
    },
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentUser = ctx.currentuser!;

    const lease = await this.leaseDAO.findFirst(
      { luid, cuid, deletedAt: null },
      { populate: ['tenantId', 'property.id'] }
    );

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }

    if (lease.status !== LeaseStatus.ACTIVE) {
      throw new ValidationRequestError({
        message: `Cannot terminate ${lease.status} lease`,
        errorInfo: {
          status: [`Only ACTIVE leases can be terminated. Current status: ${lease.status}`],
        },
      });
    }

    const terminationDate = new Date(terminationData.terminationDate);

    const { warnings } = validateLeaseTermination(
      lease,
      terminationDate,
      terminationData.terminationReason
    );

    this.log.info(`Terminating lease ${luid}`, {
      terminationDate,
      reason: terminationData.terminationReason,
      warnings,
    });

    const currentUserProfile = await this.profileDAO.findFirst(
      { user: new Types.ObjectId(currentUser.sub) },
      { select: 'personalInfo.firstName personalInfo.lastName' }
    );

    const userName = currentUserProfile
      ? `${currentUserProfile.personalInfo?.firstName || ''} ${currentUserProfile.personalInfo?.lastName || ''}`.trim()
      : currentUser.email || 'Unknown User';

    const terminatedLease = await this.leaseDAO.terminateLease(
      cuid,
      lease._id.toString(),
      {
        terminationDate,
        terminationReason: terminationData.terminationReason,
        moveOutDate: terminationData.moveOutDate,
        notes: terminationData.notes,
      },
      {
        userId: currentUser.sub,
        name: userName,
      }
    );

    if (!terminatedLease) {
      throw new BadRequestError({ message: 'Failed to terminate lease' });
    }

    await this.leaseCache.invalidateLease(cuid, luid);
    await this.leaseCache.invalidateLeaseLists(cuid);

    this.emitterService.emit(EventTypes.LEASE_TERMINATED, {
      leaseId: terminatedLease._id.toString(),
      luid: terminatedLease.luid,
      cuid,
      tenantId: terminatedLease.tenantId.toString(),
      propertyId: terminatedLease.property.id.toString(),
      propertyUnitId: terminatedLease.property.unitId?.toString(),
      terminationDate,
      terminationReason: terminationData.terminationReason,
      moveOutDate: terminationData.moveOutDate,
      terminatedBy: currentUser.sub,
    });

    try {
      const tenantProfile = await this.profileDAO.findFirst(
        { user: new Types.ObjectId(lease.tenantId) },
        { populate: 'user' }
      );

      if (tenantProfile && tenantProfile.user) {
        const tenantUser =
          typeof tenantProfile.user === 'object' ? (tenantProfile.user as any) : null;
        if (tenantUser && tenantUser.email) {
          const property = lease.property as any;
          const tenantName =
            `${tenantProfile.personalInfo?.firstName || ''} ${tenantProfile.personalInfo?.lastName || ''}`.trim() ||
            'Tenant';

          await this.mailerService.sendMail(
            {
              to: tenantUser.email,
              subject: 'Lease Termination Notice',
              data: {
                tenantName,
                leaseNumber: lease.leaseNumber,
                propertyAddress: property?.id?.address?.fullAddress || property?.id?.name || 'N/A',
                unitNumber: property?.unitId?.unitNumber || null,
                terminationDate: terminationDate.toISOString(),
                moveOutDate:
                  terminationData.moveOutDate?.toISOString() || terminationDate.toISOString(),
                terminationReason: terminationData.terminationReason,
                notes: terminationData.notes || null,
                leaseUrl: lease.leaseDocuments?.[0]?.url || '',
                propertyManagerEmail: envVariables.EMAIL.APP_EMAIL_ADDRESS,
                propertyManagerPhone: property?.id?.contactPhone || 'N/A',
              },
            },
            MailType.LEASE_TERMINATED
          );

          this.log.info(`Termination email sent to tenant ${tenantUser.email}`);
        } else {
          this.log.warn('Tenant email not found for termination email', {
            leaseId: lease._id,
            tenantId: lease.tenantId,
          });
        }
      } else {
        this.log.warn('Tenant profile not found for termination email', {
          leaseId: lease._id,
          tenantId: lease.tenantId,
        });
      }
    } catch (error) {
      this.log.error('Failed to send termination email:', error);
      // Don't fail the whole operation if email fails
    }

    return {
      success: true,
      data: terminatedLease,
      message: 'Lease terminated successfully',
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

  async activateLease(
    cuid: string,
    luid: string,
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    const currentUser = ctx.currentuser!;

    const lease = await fetchLeaseByLuid(this.leaseDAO, luid, cuid, {
      populate: ['tenantId', 'property.id'],
    });

    if (lease.status === LeaseStatus.ACTIVE) {
      throw new ValidationRequestError({
        message: 'Lease is already active',
        errorInfo: {
          status: ['This lease is already active. No action needed.'],
        },
      });
    }

    if (
      lease.status === LeaseStatus.TERMINATED ||
      lease.status === LeaseStatus.CANCELLED ||
      lease.status === LeaseStatus.EXPIRED
    ) {
      throw new ValidationRequestError({
        message: `Cannot activate ${lease.status} lease`,
        errorInfo: {
          status: [
            `Cannot activate a lease with status: ${lease.status}. Only DRAFT or PENDING_SIGNATURE leases can be activated.`,
          ],
        },
      });
    }

    enforceLeaseApprovalRequirement(lease, 'activate');
    validateLeaseReadyForActivation(lease);

    const activatedLease = await this.leaseDAO.update(
      { _id: lease._id },
      {
        status: LeaseStatus.ACTIVE,
        activatedAt: new Date(),
        activatedBy: currentUser.sub,
        updatedAt: new Date(),
      }
    );

    if (!activatedLease) {
      throw new BadRequestError({ message: 'Failed to activate lease' });
    }

    await this.leaseCache.invalidateLease(cuid, luid);
    await this.leaseCache.invalidateLeaseLists(cuid);

    // This triggers all existing listeners: PropertyService, PropertyUnitService, ProfileService, NotificationService
    this.emitterService.emit(EventTypes.LEASE_ESIGNATURE_COMPLETED, {
      leaseId: activatedLease._id.toString(),
      luid: activatedLease.luid,
      cuid: activatedLease.cuid,
      tenantId: activatedLease.tenantId.toString(),
      propertyId: activatedLease.property.id.toString(),
      propertyUnitId: activatedLease.property.unitId?.toString(),
      propertyManagerId: activatedLease.createdBy.toString(),
      documentId: '', // manual activation - no e-signature document
      signers: [], // manual activation - no e-signature signers
      completedAt: new Date(),
    });

    return {
      success: true,
      data: activatedLease,
      message: 'Lease activated successfully',
    };
  }

  async uploadLeaseDocument(
    cuid: string,
    leaseId: string,
    file: any,
    uploadedBy: string
  ): IPromiseReturnedData<ILeaseDocument> {
    return this.leaseDocumentService.uploadLeaseDocument(cuid, leaseId, file, uploadedBy);
  }

  async getLeaseDocumentUrl(cuid: string, leaseId: string): IPromiseReturnedData<string> {
    return this.leaseDocumentService.getLeaseDocumentUrl(cuid, leaseId);
  }

  async removeLeaseDocument(
    cuid: string,
    leaseId: string,
    userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    return this.leaseDocumentService.removeLeaseDocument(cuid, leaseId, userId);
  }

  /**
   * Delegate to LeaseSignatureService
   */
  async markAsManualySigned(
    cuid: string,
    leaseId: string,
    signedBy: any[],
    userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    return this.leaseSignatureService.markAsManualySigned(cuid, leaseId, signedBy, userId);
  }

  /**
   * Delegate to LeaseSignatureService
   */
  async cancelSignature(
    cuid: string,
    leaseId: string,
    userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    return this.leaseSignatureService.cancelSignature(cuid, leaseId, userId);
  }

  /**
   * Delegate to LeaseSignatureService
   */
  async getSignatureDetails(cuid: string, leaseId: string): IPromiseReturnedData<any> {
    return this.leaseSignatureService.getSignatureDetails(cuid, leaseId);
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
    return this.leaseDocumentService.updateLeaseDocuments(leaseId, uploadResults, userId);
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
    this.emitterService.on(
      EventTypes.PDF_GENERATION_REQUESTED,
      this.handlePdfGenerationRequest.bind(this)
    );
    this.emitterService.on(
      EventTypes.PDF_GENERATED,
      this.handlePdfGeneratedForESignature.bind(this)
    );

    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_COMPLETED,
      this.handleLeaseActivatedEmail.bind(this)
    );
  }

  private handlePdfGenerationRequest = async (
    payload: PdfGenerationRequestedPayload
  ): Promise<void> => {
    try {
      const { jobId, resource, templateType, cuid, senderInfo } = payload;

      this.log.info('Handling PDF generation request', { jobId, resourceId: resource.resourceId });

      // Store senderInfo for later use when upload completes
      if (senderInfo) {
        this.leaseDocumentService.storePendingSenderInfo(resource.resourceId, senderInfo);
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
        this.leaseDocumentService.clearPendingSenderInfo(resource.resourceId);
      } else if (!result.success) {
        this.emitterService.emit(EventTypes.PDF_GENERATION_FAILED, {
          jobId,
          resourceId: resource.resourceId,
          error: result.error || 'PDF generation failed',
        });
        // Clean up stored senderInfo
        this.leaseDocumentService.clearPendingSenderInfo(resource.resourceId);
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
      this.leaseDocumentService.clearPendingSenderInfo(payload.resource.resourceId);
    }
  };

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

      const eSignatureQueue = this.queueFactory.getQueue('eSignatureQueue') as ESignatureQueue;
      await eSignatureQueue.addToESignatureRequestQueue({
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

  private async markLeaseDocumentsAsFailed(leaseId: string, errorMessage: string): Promise<void> {
    return this.leaseDocumentService.markLeaseDocumentsAsFailed(leaseId, errorMessage);
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
      leaseData.property.id.toString(),
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
        id: leaseData.property.id.toString(),
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

  /**
   * Handle lease activation email sending
   * Triggered by LEASE_ESIGNATURE_COMPLETED event (both e-signature and manual activation)
   */
  private async handleLeaseActivatedEmail(payload: {
    leaseId: string;
    luid: string;
    cuid: string;
  }): Promise<void> {
    try {
      const { leaseId, luid, cuid } = payload;
      const lease = await this.leaseDAO.findFirst(
        {
          _id: new Types.ObjectId(leaseId),
          cuid,
          deletedAt: null,
        },
        {
          populate: [{ path: 'property.id' }, { path: 'property.unitId' }],
        }
      );

      if (!lease) {
        this.log.warn('Lease not found for activation email', { leaseId, cuid });
        return;
      }

      const tenantProfile = await this.profileDAO.findFirst(
        { user: new Types.ObjectId(lease.tenantId) },
        { populate: 'user' }
      );

      if (!tenantProfile || !tenantProfile.user) {
        this.log.warn('Tenant profile not found for activation email', {
          leaseId,
          tenantId: lease.tenantId,
        });
        return;
      }

      const tenantUser =
        typeof tenantProfile.user === 'object' ? (tenantProfile.user as any) : null;
      if (!tenantUser || !tenantUser.email) {
        this.log.warn('Tenant email not found for activation email', {
          leaseId,
          tenantId: lease.tenantId,
        });
        return;
      }

      const property = lease.property as any;
      const tenantName =
        `${tenantProfile.personalInfo?.firstName || ''} ${tenantProfile.personalInfo?.lastName || ''}`.trim() ||
        'Tenant';

      // Send activation email
      await this.mailerService.sendMail(
        {
          to: tenantUser.email,
          subject: 'Your Lease is Now Active!',
          data: {
            tenantName,
            leaseNumber: lease.leaseNumber,
            propertyAddress: property?.id?.address?.fullAddress || property?.id?.name || 'N/A',
            unitNumber: property?.unitId?.unitNumber || null,
            startDate: lease.duration.startDate.toISOString(),
            endDate: lease.duration.endDate.toISOString(),
            monthlyRent: MoneyUtils.formatCurrency(lease.fees.monthlyRent, lease.fees.currency),
            firstPaymentDate: lease.duration.startDate.toLocaleDateString(),
            securityDepositInfo: lease.fees.securityDeposit
              ? MoneyUtils.formatCurrency(lease.fees.securityDeposit, lease.fees.currency)
              : 'N/A',
            leaseUrl: lease.leaseDocuments?.[0]?.url || '',
            propertyManagerEmail: envVariables.EMAIL.APP_EMAIL_ADDRESS,
            propertyManagerPhone: property?.id?.contactPhone || 'N/A',
          },
        },
        MailType.LEASE_ACTIVATED
      );

      this.log.info(`Lease activation email sent successfully to ${tenantUser.email}`, {
        leaseId,
        luid,
      });
    } catch (error) {
      this.log.error('Failed to send lease activation email', {
        error: error instanceof Error ? error.message : 'Unknown error',
        payload,
      });
      // Don't fail the whole operation if email fails
    }
  }

  /**
   * Delegate to LeaseSignatureService
   */
  async handleESignatureWebhook(
    eventType: string,
    documentId: string,
    data: any,
    processedData?: ProcessedWebhookData
  ): Promise<void> {
    return this.leaseSignatureService.handleESignatureWebhook(
      eventType,
      documentId,
      data,
      processedData
    );
  }

  /**
   * Delegate to LeaseSignatureService
   */
  async revokeLease(leaseId: string, reason: string): Promise<void> {
    return this.leaseSignatureService.revokeLease(leaseId, reason);
  }

  /**
   * Process expiring leases and send notifications to tenants
   * Sends at 30, 14, and 7 days before expiry (only once per threshold)
   */
  async processExpiringLeases(): Promise<void> {
    const expiryThresholds = LEASE_CONSTANTS.EXPIRY_THRESHOLDS;
    this.log.info('Starting processExpiringLeases cron job');

    try {
      for (const threshold of expiryThresholds) {
        this.log.info(`Checking for leases expiring in ${threshold.days} days`);

        const startDate = dayjs()
          .add(threshold.days - 1, 'days')
          .startOf('day')
          .toDate();
        const endDate = dayjs()
          .add(threshold.days + 1, 'days')
          .endOf('day')
          .toDate();

        const leases = await this.leaseDAO.list(
          {
            status: LeaseStatus.ACTIVE,
            'duration.endDate': {
              $gte: startDate,
              $lte: endDate,
            },
            deletedAt: null,
          },
          {
            populate: ['tenantInfo', 'propertyInfo', 'propertyUnitInfo'],
          }
        );

        this.log.info(`Found ${leases.items.length} leases expiring in ~${threshold.days} days`);

        for (const lease of leases.items) {
          try {
            // Check if expiry notice already sent for this threshold
            const alreadySent = await this.notificationService.hasLeaseExpiryNoticeBeenSent(
              lease._id,
              threshold.name,
              NotificationTypeEnum.LEASE
            );

            if (alreadySent) {
              this.log.info(`Skipping lease ${lease.luid} - ${threshold.name} already sent`);
              continue;
            }

            await this.notifyLeaseExpiry(lease, threshold.days, threshold.name);

            this.log.info(
              `Sent ${threshold.name} for lease ${lease.luid} (${threshold.days} days remaining)`
            );
          } catch (error) {
            this.log.error(`Failed to send expiry notice for lease ${lease.luid}:`, error);
          }
        }
      }

      this.log.info('Completed processExpiringLeases cron job');
    } catch (error) {
      this.log.error('Error in processExpiringLeases cron job:', error);
      throw error;
    }
  }

  /**
   * Notify tenant and property manager about lease expiry (email + in-app)
   */
  private async notifyLeaseExpiry(
    lease: ILeaseDocument,
    daysRemaining: number,
    leaseExpiryThreshold: string
  ): Promise<void> {
    const emailData = await this.buildEmailData(lease, daysRemaining, leaseExpiryThreshold);

    try {
      const emailQueue = this.queueFactory.getQueue('emailQueue');
      emailQueue.addJobToQueue(JOB_NAME.LEASE_ENDING_SOON_JOB, {
        emailType: MailType.LEASE_ENDING_SOON,
        subject: lease.renewalOptions?.autoRenew
          ? `Your Lease is Auto-Renewing in ${daysRemaining} Days`
          : `Lease Expiring in ${daysRemaining} Days`,
        to: lease.tenantInfo?.email,
        data: emailData,
        client: {
          cuid: lease.cuid,
        },
      });
    } catch (error) {
      this.log.error(`Failed to queue expiry email to tenant for lease ${lease.luid}:`, error);
    }

    // Create in-app notification for tenant
    try {
      await this.notificationService.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
        type: NotificationTypeEnum.LEASE,
        recipientType: RecipientTypeEnum.INDIVIDUAL,
        recipient: lease.tenantId.toString(),
        priority:
          daysRemaining <= 7 ? NotificationPriorityEnum.HIGH : NotificationPriorityEnum.MEDIUM,
        title: lease.renewalOptions?.autoRenew
          ? `Lease Auto-Renewing in ${daysRemaining} Days`
          : `Lease Expiring in ${daysRemaining} Days`,
        message: lease.renewalOptions?.autoRenew
          ? `Your lease at ${lease.property.address} will automatically renew on ${dayjs(lease.duration.endDate).format('MMM DD, YYYY')}`
          : `Your lease at ${lease.property.address} expires on ${dayjs(lease.duration.endDate).format('MMM DD, YYYY')}. Please contact us to discuss renewal or move-out.`,
        metadata: {
          leaseId: lease._id,
          leaseExpiryThreshold,
          daysThreshold: daysRemaining,
          isAutoRenewing: lease.renewalOptions?.autoRenew || false,
          endDate: lease.duration.endDate,
        },
        actionUrl: `${envVariables.FRONTEND.URL}/leases/${lease.cuid}/${lease.luid}`,
        cuid: lease.cuid,
      });
    } catch (error) {
      this.log.error(
        `Failed to create in-app notification for tenant for lease ${lease.luid}:`,
        error
      );
    }

    // Notify property manager
    try {
      const propertyInfo = (lease as any).propertyInfo;
      const propertyUnitInfo = (lease as any).propertyUnitInfo;
      let managedById = propertyUnitInfo?.managedBy || propertyInfo?.managedBy;

      if (!managedById) {
        const client = await this.clientDAO.findFirst(
          { cuid: lease.cuid },
          { populate: ['accountAdmin'] }
        );
        managedById = client?.accountAdmin;
      }

      if (managedById) {
        const propertyManagerId =
          typeof managedById === 'object'
            ? managedById._id?.toString() || managedById.toString()
            : managedById.toString();

        await this.notificationService.createNotification(lease.cuid, NotificationTypeEnum.LEASE, {
          type: NotificationTypeEnum.LEASE,
          recipientType: RecipientTypeEnum.INDIVIDUAL,
          recipient: propertyManagerId,
          priority:
            daysRemaining <= 7 ? NotificationPriorityEnum.MEDIUM : NotificationPriorityEnum.LOW,
          title: 'Lease Expiring Soon',
          message: `Tenant ${lease.tenantInfo?.fullname} lease (${lease.leaseNumber}) expires in ${daysRemaining} days`,
          metadata: {
            leaseId: lease._id,
            leaseExpiryThreshold,
            daysThreshold: daysRemaining,
            tenantName: lease.tenantInfo?.fullname,
          },
          actionUrl: `${envVariables.FRONTEND.URL}/leases/${lease.cuid}/${lease.luid}/`,
          cuid: lease.cuid,
        });
      }
    } catch (error) {
      this.log.error(`Failed to notify property manager for lease ${lease.luid}:`, error);
    }
  }

  /**
   * Build email template data for lease expiry notification
   */
  private async buildEmailData(
    lease: ILeaseDocument,
    daysRemaining: number,
    leaseExpiryThreshold?: string
  ): Promise<Record<string, any>> {
    const noticePeriod = lease.renewalOptions?.noticePeriodDays || 30;
    const noticeDeadline = dayjs(lease.duration.endDate).subtract(noticePeriod, 'days').toDate();
    const responseDeadline = dayjs().add(14, 'days').toDate();
    let propertyManager: IUserBasicInfo | null = null;

    if (lease.property.id && !lease.property.unitId) {
      const property = await this.propertyDAO.findFirst({
        _id: new Types.ObjectId(lease.property.id),
      });

      if (!property) {
        this.log.warn('Property not found when building email data', {
          propertyId: lease.property.id,
        });
        return {
          message: 'Unable to build email data: Property not found',
          success: false,
          data: null,
        };
      }

      if (property && property.managedBy) {
        propertyManager = await this.profileDAO.getUserBasicInfo(
          property.managedBy.toString(),
          lease.cuid
        );
      }
    }

    if (lease.property.unitId && !propertyManager) {
      const pUnit = await this.propertyUnitDAO.findFirst({
        _id: new Types.ObjectId(lease.property.unitId),
      });

      if (!pUnit) {
        this.log.warn('Property not found when building email data', {
          propertyId: lease.property.unitId,
        });
        return {
          message: 'Unable to build email data: Property Unit not found',
          success: false,
          data: null,
        };
      }
      propertyManager = await this.profileDAO.getUserBasicInfo(
        pUnit.managedBy.toString(),
        lease.cuid
      );
    }

    return {
      tenantName: lease.tenantInfo?.fullname,
      propertyAddress: lease.property.address,
      leaseNumber: lease.leaseNumber,
      unitNumber: lease.property.unitNumber,
      endDate: lease.duration.endDate,
      daysRemaining,

      // Expiry threshold info (e.g., '30_day_notice', '14_day_notice', '7_day_notice')
      leaseExpiryThreshold,

      // Auto-renewal info
      isAutoRenewing: lease.renewalOptions?.autoRenew || false,
      renewalTermMonths: lease.renewalOptions?.renewalTermMonths || 12,

      // Actions & deadlines
      noticePeriod,
      noticeDeadline,
      responseDeadline,

      // Property manager info
      propertyManagerName: propertyManager?.fullName,
      propertyManagerEmail: propertyManager?.email,
      propertyManagerPhone: propertyManager?.phone,

      // URLs
      renewalUrl: `${envVariables.FRONTEND.URL}/leases/${lease.luid}/lease_renewal_confirmation`,

      // Optional
      monthToMonthAvailable: false,
      monthToMonthTerms: null,
      renewalTerms: lease.renewalOptions?.autoRenew
        ? `Your lease will automatically renew for ${lease.renewalOptions.renewalTermMonths || 12} months at the current rate.`
        : null,
      officeHours: 'Monday-Friday, 9am-5pm',
    };
  }

  /**
   * Define cron jobs for lease service
   */
  getCronJobs(): ICronJob[] {
    return [
      ...this.leaseRenewalService.getCronJobs(this.sendLeaseForSignature.bind(this)),
      {
        name: 'process-expiring-leases',
        schedule: '0 9 * * *', // Daily at 9 AM UTC
        handler: this.processExpiringLeases.bind(this),
        enabled: true,
        service: 'LeaseService',
        description: 'Process expiring leases and send notifications at 30/14/7 day thresholds',
        timeout: 600000, // 10 minutes
      },
      {
        name: 'mark-expired-leases',
        schedule: '0 1 * * *', // Daily at 1 AM UTC
        handler: this.markExpiredLeases.bind(this),
        enabled: true,
        service: 'LeaseService',
        description: 'Mark leases as expired 7+ days past end date with smart renewal handling',
        timeout: 300000,
      },
    ];
  }

  /**
   * Alias for processExpiringLeases (backward compatibility)
   */
  async sendExpiryNotices(): Promise<void> {
    return this.processExpiringLeases();
  }

  /**
   * Delegation methods for LeaseRenewalService
   */
  async getRenewalFormData(cxt: IRequestContext, luid: string): Promise<ISuccessReturnData<any>> {
    return this.leaseRenewalService.getRenewalFormData(cxt, luid);
  }

  async createDraftLeaseRenewal(
    cuid: string,
    luid: string,
    renewalData: Partial<ILeaseFormData>,
    ctx: IRequestContext | null = null
  ): IPromiseReturnedData<ILeaseDocument> {
    return this.leaseRenewalService.createDraftLeaseRenewal(
      cuid,
      luid,
      renewalData,
      ctx,
      this.validateLeaseData.bind(this)
    );
  }

  async processAutoRenewals(): Promise<void> {
    return this.leaseRenewalService.processAutoRenewals();
  }

  async autoSendRenewalsForSignature(): Promise<void> {
    return this.leaseRenewalService.autoSendRenewalsForSignature(
      this.sendLeaseForSignature.bind(this)
    );
  }

  async approveRenewalForSignature(
    cuid: string,
    luid: string,
    renewalData: Partial<ILeaseFormData>,
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument | null> {
    return this.leaseRenewalService.approveRenewalForSignature(
      cuid,
      luid,
      renewalData,
      ctx,
      this.validateLeaseData.bind(this)
    );
  }

  async renewLease(
    cuid: string,
    luid: string,
    renewalData: Partial<ILeaseFormData>,
    ctx: IRequestContext
  ): IPromiseReturnedData<ILeaseDocument> {
    return this.leaseRenewalService.renewLease(
      cuid,
      luid,
      renewalData,
      ctx,
      this.validateLeaseData.bind(this)
    );
  }

  async markExpiredLeases(): Promise<void> {
    this.log.info('Starting expired lease marking');

    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const gracePeriodDate = dayjs(today)
        .subtract(LEASE_CONSTANTS.GRACE_PERIOD_DAYS, 'days')
        .toDate();

      // Find active leases MORE THAN 7 days past their end date
      const expiredLeases = await this.leaseDAO.list(
        {
          status: LeaseStatus.ACTIVE,
          'duration.endDate': { $lt: gracePeriodDate },
          deletedAt: null,
        },
        {
          populate: ['tenantInfo', 'propertyInfo', 'propertyUnitInfo'],
        }
      );

      this.log.info(`Found ${expiredLeases.items.length} leases 7+ days past end date`);

      let completedCount = 0;
      let expiredCount = 0;
      let errorCount = 0;

      for (const lease of expiredLeases.items) {
        try {
          const daysPastExpiry = Math.ceil(
            (today.getTime() - lease.duration.endDate.getTime()) / (1000 * 60 * 60 * 24)
          );

          this.log.info(`Processing lease ${lease.luid} (${daysPastExpiry} days past end date)`);

          // Check for renewal
          const renewal = await this.leaseDAO.findFirst(
            {
              previousLeaseId: lease._id,
              deletedAt: null,
            },
            {
              sort: { createdAt: -1 },
            }
          );

          // CASE 1: Renewal is fully active
          if (renewal && renewal.status === 'active') {
            this.log.info(
              `Lease ${lease.luid} has active renewal ${renewal.luid} - marking completed`
            );

            await this.leaseDAO.updateById(lease._id.toString(), {
              status: 'completed',
              completedAt: today,
              $push: {
                lastModifiedBy: {
                  action: 'completed',
                  userId: 'system',
                  name: 'System - Renewal Active',
                  date: today,
                },
              },
            });

            await this.notificationService.notifyLeaseLifecycleEvent({
              eventType: 'completed',
              lease: {
                luid: lease.luid,
                leaseNumber: lease.leaseNumber,
                cuid: lease.cuid,
                tenantId: lease.tenantId.toString(),
                propertyAddress: lease.property?.address || 'Property',
                endDate: lease.duration.endDate,
              },
              recipients: {
                propertyManager: lease.propertyInfo?.managedBy?.toString(),
                createdBy: lease.createdBy?.toString(),
              },
              metadata: {
                renewalId: renewal.luid,
                daysPastExpiry,
                seamlessTransition: true,
              },
            });

            completedCount++;
          }
          // CASE 2: Renewal exists but NOT active
          else if (renewal && renewal.status !== 'active') {
            this.log.info(
              `Lease ${lease.luid} expired with renewal ${renewal.luid} in ${renewal.status} - marking expired`
            );

            await this.leaseDAO.updateById(lease._id.toString(), {
              status: 'expired',
              $push: {
                lastModifiedBy: {
                  action: 'expired',
                  userId: 'system',
                  name: 'System - Renewal Not Completed',
                  date: today,
                },
              },
            });

            // Release property unit
            if (lease.property?.unitId) {
              await this.propertyUnitDAO.updateById(lease.property.unitId.toString(), {
                status: PropertyUnitStatusEnum.AVAILABLE,
                currentTenant: null,
                currentLease: null,
              });
            }

            if (!lease.property?.unitId) {
              await this.propertyDAO.updateById(lease.property.id.toString(), {
                occupancyStatus: 'vacant',
              });
            }

            await this.notificationService.notifyLeaseLifecycleEvent({
              eventType: 'renewal_incomplete',
              lease: {
                luid: lease.luid,
                leaseNumber: lease.leaseNumber,
                cuid: lease.cuid,
                tenantId: lease.tenantId.toString(),
                propertyAddress: lease.property?.address || 'Property',
                endDate: lease.duration.endDate,
              },
              recipients: {
                propertyManager: lease.propertyInfo?.managedBy?.toString(),
                createdBy: lease.createdBy?.toString(),
              },
              metadata: {
                renewalId: renewal.luid,
                renewalStatus: renewal.status,
                daysPastExpiry,
                actionRequired: true,
              },
            });

            expiredCount++;
          }
          // CASE 3: No renewal exists
          else {
            this.log.info(`Lease ${lease.luid} expired with no renewal - marking expired`);

            await this.leaseDAO.updateById(lease._id.toString(), {
              status: 'expired',
              $push: {
                lastModifiedBy: {
                  action: 'expired',
                  userId: 'system',
                  name: 'System - No Renewal',
                  date: today,
                },
              },
            });

            // Release property unit
            if (lease.property?.unitId) {
              await this.propertyUnitDAO.updateById(lease.property.unitId.toString(), {
                status: PropertyUnitStatusEnum.AVAILABLE,
                currentTenant: null,
                currentLease: null,
              });
            }

            if (!lease.property?.unitId) {
              await this.propertyDAO.updateById(lease.property.id.toString(), {
                occupancyStatus: 'vacant',
              });
            }

            await this.notificationService.notifyLeaseLifecycleEvent({
              eventType: 'expired',
              lease: {
                luid: lease.luid,
                leaseNumber: lease.leaseNumber,
                cuid: lease.cuid,
                tenantId: lease.tenantId.toString(),
                propertyAddress: lease.property?.address || 'Property',
                endDate: lease.duration.endDate,
              },
              recipients: {
                propertyManager: lease.propertyInfo?.managedBy?.toString(),
                createdBy: lease.createdBy?.toString(),
              },
              metadata: {
                daysPastExpiry,
                noRenewal: true,
              },
            });

            expiredCount++;
          }
        } catch (error: any) {
          errorCount++;
          this.log.error(`Failed to process expired lease ${lease.luid}`, {
            error: error.message,
            stack: error.stack,
          });

          if (lease.createdBy) {
            await this.notificationService.notifySystemError({
              cuid: lease.cuid,
              recipientIds: [lease.createdBy.toString()],
              errorType: 'expired_lease_processing_failed',
              resourceType: 'lease',
              resourceIdentifier: lease.leaseNumber,
              errorMessage: error.message,
              metadata: {
                leaseId: lease.luid,
              },
            });
          }
        }
      }

      this.log.info('Expired lease marking completed', {
        total: expiredLeases.items.length,
        completed: completedCount,
        expired: expiredCount,
        errors: errorCount,
      });
    } catch (error: any) {
      this.log.error('Error in markExpiredLeases cron job', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Cleanup event listeners
   */
  cleanupEventListeners(): void {
    this.leaseDocumentService.cleanupEventListeners();
    this.leaseSignatureService.cleanupEventListeners();
    this.log.info('Lease service event listeners removed');
  }
}
