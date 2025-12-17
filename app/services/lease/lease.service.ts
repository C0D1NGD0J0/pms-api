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
  PROPERTY_APPROVAL_ROLES,
  determineTemplateType,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  createLogger,
  MoneyUtils,
} from '@utils/index';
import {
  PdfGenerationRequestedPayload,
  UploadCompletedPayload,
  UploadFailedPayload,
  PdfGeneratedPayload,
  EventTypes,
} from '@interfaces/events.interface';
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
  LeaseESignatureFailedPayload,
  LeaseESignatureSentPayload,
  ILeaseESignatureStatusEnum,
  ILeaseFilterOptions,
  ILeaseDocument,
  ILeaseFormData,
  SigningMethod,
  LeaseStatus,
} from '@interfaces/lease.interface';

import { LeaseTemplateService } from './leaseTemplateService';
import {
  enforceLeaseApprovalRequirement,
  validateLeaseReadyForActivation,
  validateLeaseReadyForSignature,
  generatePendingChangesPreview,
  fetchPropertyManagerWithUser,
  handlePendingSignatureUpdate,
  validateResourceAvailable,
  calculateFinancialSummary,
  validateLeaseTermination,
  handleClosedStatusUpdate,
  validateImmutableFields,
  constructActivityFeed,
  filterDocumentsByRole,
  fetchTenantWithUser,
  handleActiveUpdate,
  buildLeaseTimeline,
  getUserPermissions,
  filterLeaseByRole,
  fetchPropertyUnit,
  handleDraftUpdate,
  validateUserRole,
  fetchLeaseByLuid,
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
  queueFactory: QueueFactory;
  mailerService: MailService;
  userService: UserService;
  propertyDAO: PropertyDAO;
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
  private readonly pendingSenderInfo: Map<string, { email: string; name: string }>;

  constructor({
    notificationService,
    pdfGeneratorService,
    mediaUploadService,
    invitationService,
    emitterService,
    invitationDAO,
    propertyUnitDAO,
    boldSignService,
    queueFactory,
    propertyDAO,
    profileDAO,
    clientDAO,
    mailerService,
    userService,
    leaseDAO,
    userDAO,
    leaseCache,
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
    this.pendingSenderInfo = new Map();
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
      throw new BadRequestError({ message: 'Client not found' });
    }

    const lease = await fetchLeaseByLuid(this.leaseDAO, luid, cuid);
    validateLeaseReadyForSignature(lease);
    if (lease.signingMethod !== 'electronic') {
      throw new BadRequestError({
        message: 'Lease must be set to electronic signing method to use e-signature',
      });
    }

    await fetchTenantWithUser(this.profileDAO, lease.tenantId);

    const property = await this.propertyDAO.findFirst({ _id: lease.property.id, deletedAt: null });
    if (!property) {
      throw new BadRequestError({ message: 'Property not found' });
    }
    validateResourceAvailable(property, 'property');
    if (lease.property.unitId) {
      const propertyUnit = await fetchPropertyUnit(
        this.propertyUnitDAO,
        lease.property.unitId as string
      );
      validateResourceAvailable(propertyUnit, 'unit');
    }

    if (property.managedBy) {
      await fetchPropertyManagerWithUser(this.profileDAO, property.managedBy);
    }

    let senderInfo: { email: string; name: string } = {
      email: envVariables.BOLDSIGN.DEFAULT_SENDER_EMAIL,
      name: envVariables.BOLDSIGN.DEFAULT_SENDER_NAME,
    };
    if (
      client.accountType?.isEnterpriseAccount &&
      client.companyProfile?.companyEmail &&
      client.companyProfile?.legalEntityName
    ) {
      senderInfo = {
        email: client.companyProfile.companyEmail,
        name: client.companyProfile.legalEntityName,
      };
    }

    const leasePDF = lease.leaseDocuments?.find(
      (doc) => doc.documentType === 'lease_agreement' && doc.status === 'active'
    );
    if (!leasePDF || !leasePDF.key) {
      const pdfGeneratorQueue = this.queueFactory.getQueue('pdfGeneratorQueue') as PdfQueue;
      await pdfGeneratorQueue.addToPdfQueue({
        resource: {
          resourceId: lease._id.toString(),
          resourceName: 'lease',
          actorId: cxt.currentuser?.sub || 'system',
          resourceType: 'document',
          fieldName: 'leaseDocument',
        },
        cuid,
        templateType: lease.property.propertyType || 'residential-single-family',
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

    this.emitterService.on(
      EventTypes.PDF_GENERATION_REQUESTED,
      this.handlePdfGenerationRequest.bind(this)
    );
    this.emitterService.on(
      EventTypes.PDF_GENERATED,
      this.handlePdfGeneratedForESignature.bind(this)
    );

    this.emitterService.on(EventTypes.LEASE_ESIGNATURE_SENT, this.handleESignatureSent.bind(this));
    this.emitterService.on(
      EventTypes.LEASE_ESIGNATURE_FAILED,
      this.handleESignatureFailed.bind(this)
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

      // Only re-queue if lease status is DRAFT or PENDING and signingMethod is electronic
      if (lease.signingMethod !== 'electronic' || !['pending', 'draft'].includes(lease.status)) {
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
            'eSignature.status': 'failed',
            'eSignature.error': error,
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
          result = await this.leaseDAO.update(lease._id, {
            'eSignature.status': ILeaseESignatureStatusEnum.VOIDED,
            'eSignature.errorMessage': data?.errorMessage || 'Send failed',
            'eSignature.failedAt': new Date(),
            status: LeaseStatus.DRAFT,
            updatedAt: new Date(),
          });
          break;

        case 'Completed':
          result = await this.leaseDAO.update(
            { _id: lease._id },
            {
              'eSignature.status': ILeaseESignatureStatusEnum.COMPLETED,
              'eSignature.completedAt': new Date(data?.completedDate || Date.now()),
              status: LeaseStatus.ACTIVE,
              updatedAt: new Date(),
            }
          );

          this.emitterService.emit(EventTypes.LEASE_ESIGNATURE_COMPLETED, {
            leaseId: lease._id.toString(),
            luid: lease.luid,
            cuid: lease.cuid,
            tenantId: lease.tenantId.toString(),
            propertyId: lease.property.id.toString(),
            propertyUnitId: lease.property.unitId?.toString(),
            propertyManagerId: lease.createdBy.toString(),
            documentId,
            completedAt: new Date(data?.completedDate || Date.now()),
            signers: data?.signers || [],
          });
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
          result = await this.leaseDAO.update(lease._id, {
            'eSignature.status': ILeaseESignatureStatusEnum.DRAFT,
            status: LeaseStatus.DRAFT,
            updatedAt: new Date(),
          });
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

          if (!signerId && lease.property?.id) {
            const property = await this.propertyDAO.findFirst({ _id: lease.property.id });
            if (property?.managedBy) {
              const pm = await this.profileDAO.findFirst(
                { user: property.managedBy },
                { populate: 'user' }
              );
              const pmUser = pm?.user && typeof pm.user === 'object' ? (pm.user as any) : null;
              if (pmUser?.email === recentSigner.email) {
                signerId = property.managedBy as Types.ObjectId;
                signerRole = 'property_manager';
              }
            }
          }

          const signatureEntry: any = {
            role: signerRole,
            signatureMethod: 'electronic',
            signedAt: recentSigner.signedAt,
            ...(signerId ? { userId: signerId } : {}),
            ...(coTenantInfo ? { coTenantInfo } : {}),
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

  async revokeLease(leaseId: string, reason: string): Promise<void> {
    try {
      const lease = await this.leaseDAO.findFirst({ luid: leaseId });
      if (!lease) {
        throw new Error('Lease not found');
      }
      await this.boldSignService.revokeDocument(lease.eSignature?.envelopeId ?? '', reason);
      this.log.info('Lease revoked successfully', { leaseId, reason });
    } catch (error: any) {
      this.log.error('Error revoking lease', { leaseId, error: error.message });
      throw error;
    }
  }

  // CRON JOBS
  // getCronJobs(): ICronJob[] {
  //   return [
  //     {
  //       name: 'process-auto-renewals',
  //       schedule: '0 0 * * *', // daily at midnight UTC
  //       handler: this.processAutoRenewals.bind(this),
  //       enabled: true,
  //       service: 'LeaseService',
  //       description: 'Process automatic lease renewals for leases ending soon',
  //       timeout: 600000, // 10 minutes
  //     },
  //     {
  //       name: 'send-expiry-notices',
  //       schedule: '0 9 * * *', // daily at 9 AM UTC
  //       handler: this.sendExpiryNotices.bind(this),
  //       enabled: true,
  //       service: 'LeaseService',
  //       description: 'Send expiry notices to tenants with leases ending in 30/60/90 days',
  //       timeout: 600000, // 10 minutes
  //     },
  //     {
  //       name: 'mark-expired-leases',
  //       schedule: '0 1 * * *', // daily at 1 AM UTC
  //       handler: this.markExpiredLeases.bind(this),
  //       enabled: true,
  //       service: 'LeaseService',
  //       description: 'Mark leases as expired when end date has passed',
  //       timeout: 300000, // 5 minutes
  //     },
  //   ];
  // }
  getCronJobs(): ICronJob[] {
    return [
      // {
      //   name: 'process-auto-renewals',
      //   schedule: '*/2 * * * *', // Every 2 minutes for testing
      //   handler: this.processAutoRenewals.bind(this),
      //   enabled: true,
      //   service: 'LeaseService',
      //   description: 'Process automatic lease renewals for leases ending soon',
      //   timeout: 600000,
      // },
      // {
      //   name: 'send-expiry-notices',
      //   schedule: '*/2 * * * *', // Every 2 minutes for testing
      //   handler: this.sendExpiryNotices.bind(this),
      //   enabled: true,
      //   service: 'LeaseService',
      //   description: 'Send expiry notices to tenants with leases ending in 30/60/90 days',
      //   timeout: 600000,
      // },
      // {
      //   name: 'mark-expired-leases',
      //   schedule: '*/2 * * * *', // Every 2 minutes for testing
      //   handler: this.markExpiredLeases.bind(this),
      //   enabled: true,
      //   service: 'LeaseService',
      //   description: 'Mark leases as expired when end date has passed',
      //   timeout: 300000,
      // },
    ];
  }

  /**
   * Create a renewal lease from an existing lease
   * Creates a new lease with draft_renewal status that requires admin approval
   */
  async renewLease(
    cuid: string,
    luid: string,
    renewalData: Partial<ILeaseFormData>,
    ctx: IRequestContext | null = null
  ): IPromiseReturnedData<ILeaseDocument> {
    const userId = ctx?.currentuser.sub.toString() || 'system';
    const userName = ctx?.currentuser?.fullname || 'System';
    const userRole = ctx ? convertUserRoleToEnum(ctx.currentuser!.client.role) : null;

    const isSystemCall = !ctx;

    const existingLease = await this.leaseDAO.findFirst(
      { luid, cuid, deletedAt: null },
      {
        populate: ['tenantInfo', 'propertyInfo', 'propertyUnitInfo'],
      }
    );

    if (!existingLease) {
      throw new InvalidRequestError({
        message: t('lease.errors.notFound'),
      });
    }

    if (!['active'].includes(existingLease.status)) {
      throw new BadRequestError({
        message: 'Only active or recently expired leases can be renewed',
      });
    }

    const existingRenewal = await this.leaseDAO.findFirst({
      previousLeaseId: existingLease._id,
      cuid,
      deletedAt: null,
      status: { $in: ['draft_renewal', 'pending_signature', 'active'] },
    });

    if (existingRenewal) {
      if (isSystemCall) {
        // for system calls (cron jobs), just return existing
        return { data: existingRenewal, success: true };
      }
      throw new BadRequestError({
        message: 'A renewal already exists for this lease',
      });
    }

    const renewalTermMonths =
      renewalData.renewalOptions?.renewalTermMonths ||
      existingLease.renewalOptions?.renewalTermMonths ||
      12;
    const defaultStartDate = dayjs(existingLease.duration.endDate).add(1, 'day').toDate();
    const defaultEndDate = dayjs(defaultStartDate).add(renewalTermMonths, 'month').toDate();

    const cleanLease = existingLease.toObject();
    delete cleanLease._id;
    delete cleanLease.luid;
    delete cleanLease.createdAt;
    delete cleanLease.updatedAt;
    delete cleanLease.__v;

    const newLeaseData = {
      ...cleanLease,
      previousLeaseId: existingLease._id,
      status: LeaseStatus.DRAFT_RENEWAL,
      approvalStatus:
        isSystemCall && existingLease.renewalOptions?.autoRenew ? 'pending' : 'approved',
      duration: renewalData.duration || {
        startDate: defaultStartDate,
        endDate: defaultEndDate,
        moveInDate: defaultStartDate,
      },

      fees: {
        ...existingLease.fees,
        ...renewalData.fees,
      },

      renewalOptions: renewalData.renewalOptions || existingLease.renewalOptions,
      utilitiesIncluded: renewalData.utilitiesIncluded || existingLease.utilitiesIncluded,
      petPolicy: renewalData.petPolicy || existingLease.petPolicy,
      coTenants: renewalData.coTenants || existingLease.coTenants,
      legalTerms: renewalData.legalTerms || existingLease.legalTerms,

      // Copy existing notes and append new renewal note if provided
      internalNotes: [
        ...(existingLease.internalNotes || []),
        ...(renewalData.internalNotes
          ? [
              {
                note: renewalData.internalNotes,
                author: userName,
                authorId: userId,
                timestamp: new Date(),
              },
            ]
          : []),
      ],

      signatures: [],
      eSignature: undefined,
      signedDate: undefined,

      createdBy: userId,
      lastModifiedBy: [
        {
          action: 'created',
          userId,
          name: userName,
          date: new Date(),
        },
      ],
      approvalDetails: [
        {
          action: 'created',
          timestamp: new Date(),
          actor: isSystemCall ? 'system' : userId,
          notes: isSystemCall ? 'Auto-renewal created by system' : 'Manual renewal created',
        },
      ],
      pendingChanges: null,
      cuid,
    };

    // For system-generated renewals, automatically approve if configured
    const autoApprove = !ctx && existingLease.renewalOptions?.autoRenew;
    if (autoApprove) {
      newLeaseData.approvalStatus = 'approved';
      newLeaseData.approvalDetails.push({
        action: 'approved',
        actor: 'system',
        timestamp: new Date(),
        notes: 'Auto-approved due to auto-renewal configuration',
      });
    }

    const renewalLease = await this.leaseDAO.insert(newLeaseData);
    this.log.info(`Created renewal lease: ${renewalLease.luid} from lease: ${luid}`);

    this.emitterService.emit(EventTypes.LEASE_RENEWED, {
      originalLeaseId: existingLease.luid,
      renewalLeaseId: renewalLease.luid,
      status: 'draft_renewal',
      approvalStatus: renewalLease.approvalStatus || 'pending',
      startDate: renewalLease.duration.startDate,
      endDate: renewalLease.duration.endDate,
      monthlyRent: renewalLease.fees.monthlyRent,
      tenantId: existingLease.tenantId.toString(),
      propertyId: existingLease.property.id.toString(),
      propertyUnitId: existingLease.property.unitId?.toString(),
      cuid,
    });

    // Send in-app notification if manual renewal needs approval
    if (renewalLease.approvalStatus === 'pending') {
      try {
        if (isSystemCall) {
          // System renewal - notify the property manager/owner who created the original lease
          if (existingLease.createdBy) {
            await this.notificationService.createNotification(cuid, NotificationTypeEnum.LEASE, {
              type: NotificationTypeEnum.LEASE,
              cuid,
              recipient: existingLease.createdBy.toString(),
              recipientType: RecipientTypeEnum.INDIVIDUAL,
              priority: NotificationPriorityEnum.HIGH,
              title: 'Lease Renewal Pending Approval',
              message: `Auto-renewal created for lease ${existingLease.leaseNumber} and requires your approval`,
              metadata: {
                leaseId: renewalLease.luid,
                originalLeaseId: existingLease.luid,
                renewalStartDate: renewalLease.duration.startDate,
                renewalEndDate: renewalLease.duration.endDate,
                monthlyRent: renewalLease.fees.monthlyRent,
                isAutoRenewal: true,
                actionRequired: true,
                actionType: 'approve_renewal',
              },
            });
          }
        } else if (userRole === IUserRole.STAFF) {
          // Staff created renewal - find and notify their supervisor
          const supervisorId = await this.userService.getUserSupervisor(userId, cuid);

          if (supervisorId) {
            // Notify supervisor
            await this.notificationService.createNotification(cuid, NotificationTypeEnum.LEASE, {
              type: NotificationTypeEnum.LEASE,
              cuid,
              recipient: supervisorId,
              recipientType: RecipientTypeEnum.INDIVIDUAL,
              priority: NotificationPriorityEnum.HIGH,
              title: 'Lease Renewal Pending Approval',
              message: `${userName} created a renewal for lease ${existingLease.leaseNumber} that requires your approval`,
              metadata: {
                leaseId: renewalLease.luid,
                originalLeaseId: existingLease.luid,
                renewalStartDate: renewalLease.duration.startDate,
                renewalEndDate: renewalLease.duration.endDate,
                monthlyRent: renewalLease.fees.monthlyRent,
                createdBy: userId,
                createdByName: userName,
                actionRequired: true,
                actionType: 'approve_renewal',
              },
            });

            // Confirmation to staff
            await this.notificationService.createNotification(cuid, NotificationTypeEnum.LEASE, {
              type: NotificationTypeEnum.LEASE,
              cuid,
              recipient: userId,
              recipientType: RecipientTypeEnum.INDIVIDUAL,
              priority: NotificationPriorityEnum.LOW,
              title: 'Lease Renewal Submitted',
              message: `Your renewal for lease ${existingLease.leaseNumber} has been submitted for approval`,
              metadata: {
                leaseId: renewalLease.luid,
                originalLeaseId: existingLease.luid,
                submittedTo: supervisorId,
              },
            });
          } else {
            // No supervisor found - log warning
            this.log.warn('Staff member has no supervisor assigned for renewal approval', {
              userId,
              userName,
              leaseId: renewalLease.luid,
              cuid,
            });
          }
        }
        // Manager/Admin renewals don't need approval notifications (they can approve immediately)
      } catch (error) {
        this.log.error('Failed to send renewal notifications', { error, leaseId: luid });
        // Don't fail the renewal if notification fails
      }
    }

    return { data: renewalLease, success: true };
  }

  /**
   * Cleanup event listeners
   */
  cleanupEventListeners(): void {
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.emitterService.off(EventTypes.UPLOAD_FAILED, this.handleUploadFailed);
    this.emitterService.off(EventTypes.LEASE_ESIGNATURE_SENT, this.handleESignatureSent);
    this.emitterService.off(EventTypes.LEASE_ESIGNATURE_FAILED, this.handleESignatureFailed);
    this.log.info('Lease service event listeners removed');
  }
}
