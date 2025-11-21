import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import sanitizeHtml from 'sanitize-html';
import { LeaseCache } from '@caching/index';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { ICurrentUser } from '@interfaces/user.interface';
import { IUserRole } from '@shared/constants/roles.constants';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';
import { InvitationDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import { IPropertyDocument, IProfileWithUser, OwnershipType } from '@interfaces/index';
import {
  UploadCompletedPayload,
  UploadFailedPayload,
  EventTypes,
} from '@interfaces/events.interface';
import {
  EventEmitterService,
  NotificationService,
  InvitationService,
  AssetService,
} from '@services/index';
import {
  ValidationRequestError,
  InvalidRequestError,
  BadRequestError,
  ForbiddenError,
} from '@shared/customErrors';
import {
  PROPERTY_APPROVAL_ROLES,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  createLogger,
  MoneyUtils,
} from '@utils/index';
import {
  ILeasePreviewRequest,
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
  hasSignatureInvalidatingChanges,
  calculateFinancialSummary,
  mapPropertyTypeToTemplate,
  validateImmutableFields,
  validateAllowedFields,
  filterDocumentsByRole,
  constructActivityFeed,
  hasHighImpactChanges,
  getUserPermissions,
  buildLeaseTimeline,
} from './leaseHelpers';

interface IConstructor {
  notificationService: NotificationService;
  invitationService: InvitationService;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  invitationDAO: InvitationDAO;
  assetService: AssetService;
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
  private readonly assetService: AssetService;
  private readonly invitationDAO: InvitationDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;
  private readonly invitationService: InvitationService;
  private readonly notificationService: NotificationService;

  constructor({
    notificationService,
    invitationService,
    emitterService,
    invitationDAO,
    propertyUnitDAO,
    clientDAO,
    assetService,
    propertyDAO,
    profileDAO,
    leaseDAO,
    userDAO,
    leaseCache,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.assetService = assetService;
    this.leaseCache = leaseCache;
    this.invitationDAO = invitationDAO;
    this.invitationService = invitationService;
    this.emitterService = emitterService;
    this.propertyUnitDAO = propertyUnitDAO;
    this.log = createLogger('LeaseService');
    this.notificationService = notificationService;

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

      const filteredLease = this.filterLeaseByRole(lease, cxt.currentuser!.sub, userRole);
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
      response.documents = filterDocumentsByRole(lease.leaseDocument || [], userRole);
      response.activity = constructActivityFeed(lease);
      response.timeline = buildLeaseTimeline(lease);
      response.permissions = getUserPermissions(lease, cxt.currentuser!);
      response.financialSummary = calculateFinancialSummary(lease);

      const pendingChangesPreview = this.generatePendingChangesPreview(lease, cxt.currentuser!);
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

  private filterLeaseByRole(
    lease: ILeaseDocument,
    userId: string,
    role: IUserRole
  ): Partial<ILeaseDocument> {
    const baseLease: any = {
      _id: lease._id,
      leaseNumber: lease.leaseNumber,
      status: lease.status,
      type: lease.type,
      duration: lease.duration,
      fees: lease.fees,
      luid: lease.luid,
      property: lease.property,
      signingMethod: lease.signingMethod,
      signedDate: lease.signedDate,
      renewalOptions: lease.renewalOptions,
      petPolicy: lease.petPolicy,
      coTenants: lease.coTenants,
      utilitiesIncluded: lease.utilitiesIncluded,
      legalTerms: lease.legalTerms,
      createdAt: lease.createdAt,
      updatedAt: lease.updatedAt,
    };

    if (role === IUserRole.TENANT) {
      return baseLease;
    }

    if (role === IUserRole.ADMIN || role === IUserRole.MANAGER || role === IUserRole.STAFF) {
      return {
        ...baseLease,
        internalNotes: lease.internalNotes,
        approvalStatus: lease.approvalStatus,
        approvalDetails: lease.approvalDetails,
        pendingChanges: lease.pendingChanges,
        terminationReason: lease.terminationReason,
        createdBy: lease.createdBy,
        lastModifiedBy: lease.lastModifiedBy,
        eSignature: lease.eSignature,
        signatures: lease.signatures,
      };
    }

    return baseLease;
  }

  private shouldShowPendingChanges(currentUser: ICurrentUser, lease: ILeaseDocument): boolean {
    if (!lease.pendingChanges) {
      return false;
    }

    const userRole = currentUser.client.role;

    if (PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      return true;
    }

    if (PROPERTY_STAFF_ROLES.includes(convertUserRoleToEnum(userRole))) {
      const pendingChanges = lease.pendingChanges as any;
      return pendingChanges.updatedBy?.toString() === currentUser.sub;
    }

    return false;
  }

  private generatePendingChangesPreview(lease: ILeaseDocument, currentUser: ICurrentUser): any {
    if (!lease.pendingChanges || !this.shouldShowPendingChanges(currentUser, lease)) {
      return undefined;
    }

    const pendingChanges = lease.pendingChanges as any;
    const { updatedBy, updatedAt, displayName, ...changes } = pendingChanges;

    const formattedChanges = { ...changes };
    if (formattedChanges.fees) {
      formattedChanges.fees = MoneyUtils.formatMoneyDisplay(formattedChanges.fees);
    }

    const updatedFields = Object.keys(changes);
    const summary = this.generateChangesSummary(updatedFields);

    return {
      updatedFields,
      updatedAt,
      updatedBy,
      displayName,
      summary,
      changes: formattedChanges,
    };
  }

  private generateChangesSummary(updatedFields: string[]): string {
    if (updatedFields.length === 0) return 'No changes';

    const fieldNames = updatedFields.map((field) => {
      return field
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (str) => str.toUpperCase())
        .replace(/\./g, ' > ');
    });

    if (fieldNames.length === 1) {
      return `Modified ${fieldNames[0]}`;
    } else if (fieldNames.length === 2) {
      return `Modified ${fieldNames[0]} and ${fieldNames[1]}`;
    } else {
      const lastField = fieldNames.pop();
      return `Modified ${fieldNames.join(', ')}, and ${lastField}`;
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
          return await this.handlePendingSignatureUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole
          );
        case LeaseStatus.TERMINATED:
        case LeaseStatus.CANCELLED:
        case LeaseStatus.EXPIRED:
          return await this.handleClosedStatusUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole
          );
        case LeaseStatus.ACTIVE: {
          return await this.handleActiveUpdate(
            cxt,
            lease,
            cleanUpdateData,
            currentUser,
            isApprovalRole
          );
        }
        case LeaseStatus.DRAFT:
          return await this.handleDraftUpdate(cxt, lease, cleanUpdateData, currentUser);
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

  private async handleDraftUpdate(
    cxt: IRequestContext,
    lease: ILeaseDocument,
    updateData: Partial<ILeaseFormData>,
    currentUser: ICurrentUser
  ): Promise<ISuccessReturnData<any>> {
    validateAllowedFields(updateData, LeaseStatus.DRAFT);

    const userRole = convertUserRoleToEnum(currentUser.client.role);
    const isApprovalRole = PROPERTY_APPROVAL_ROLES.includes(userRole);
    const hasHighImpact = hasHighImpactChanges(updateData);

    let updatedLease: ILeaseDocument;
    let requiresApproval = false;

    if (isApprovalRole) {
      // Admin/Manager: Direct update without approval
      updatedLease = await this.applyDirectUpdate(lease, updateData, currentUser.sub);
    } else {
      // Staff: Check if high-impact changes require approval
      if (hasHighImpact) {
        updatedLease = await this.storePendingChanges(lease, updateData, currentUser);
        requiresApproval = true;
      } else {
        updatedLease = await this.applyDirectUpdate(lease, updateData, currentUser.sub);
      }
    }

    const { cuid } = cxt.request.params;
    await this.leaseCache.invalidateLease(cuid, lease.luid);

    return {
      success: true,
      message: requiresApproval
        ? t('lease.updateSubmittedForApproval')
        : t('lease.updatedSuccessfully'),
      data: {
        lease: updatedLease,
        requiresApproval,
        ...(requiresApproval && { pendingChanges: updatedLease.pendingChanges }),
      },
    };
  }

  private async handlePendingSignatureUpdate(
    cxt: IRequestContext,
    lease: ILeaseDocument,
    updateData: Partial<ILeaseFormData>,
    currentUser: ICurrentUser,
    isApprovalRole: boolean
  ): Promise<ISuccessReturnData<any>> {
    if (!isApprovalRole) {
      throw new ForbiddenError({
        message: 'Only administrators can modify leases pending signature',
      });
    }

    const hasSignatureInvalidating = hasSignatureInvalidatingChanges(updateData);
    if (hasSignatureInvalidating) {
      throw new ValidationRequestError({
        message: 'Cannot modify lease fields that invalidate signatures while pending signature',
        errorInfo: {
          status: ['Changes require canceling current signature process first'],
        },
      });
    }

    const updatedLease = await this.applyDirectUpdate(lease, updateData, currentUser.sub);

    const { cuid } = cxt.request.params;
    await this.leaseCache.invalidateLease(cuid, lease.luid);

    return {
      success: true,
      message: t('lease.updatedSuccessfully'),
      data: { lease: updatedLease },
    };
  }

  private async handleActiveUpdate(
    cxt: IRequestContext,
    lease: ILeaseDocument,
    updateData: Partial<ILeaseFormData>,
    currentUser: ICurrentUser,
    isApprovalRole: boolean
  ): Promise<ISuccessReturnData<any>> {
    const hasHighImpact = hasHighImpactChanges(updateData);
    let updatedLease: ILeaseDocument;
    let requiresApproval = false;

    if (isApprovalRole) {
      if (lease.pendingChanges && lease.pendingChanges.updatedBy !== currentUser.sub) {
        updatedLease = await this.applyDirectUpdateWithOverride(lease, updateData, currentUser.sub);
      } else {
        updatedLease = await this.applyDirectUpdate(lease, updateData, currentUser.sub);
      }
    } else {
      if (lease.pendingChanges && lease.pendingChanges.updatedBy !== currentUser.sub) {
        throw new ValidationRequestError({
          message: 'Another staff member has pending changes for this lease',
          errorInfo: {
            requestedBy: [lease.pendingChanges.updatedBy?.toString()],
            requestedAt: [lease.pendingChanges.updatedAt.toISOString()],
          },
        });
      }

      if (hasHighImpact) {
        updatedLease = await this.storePendingChanges(lease, updateData, currentUser);
        requiresApproval = true;
      } else {
        updatedLease = await this.applyDirectUpdate(lease, updateData, currentUser.sub);
      }
    }

    const { cuid } = cxt.request.params;
    await this.leaseCache.invalidateLease(cuid, lease.luid);

    return {
      success: true,
      message: requiresApproval
        ? t('lease.updateSubmittedForApproval')
        : t('lease.updatedSuccessfully'),
      data: {
        lease: updatedLease,
        requiresApproval,
        ...(requiresApproval && { pendingChanges: updatedLease.pendingChanges }),
      },
    };
  }

  private async handleClosedStatusUpdate(
    cxt: IRequestContext,
    lease: ILeaseDocument,
    updateData: Partial<ILeaseFormData>,
    currentUser: ICurrentUser,
    isApprovalRole: boolean
  ): Promise<ISuccessReturnData<any>> {
    if (!isApprovalRole) {
      throw new ForbiddenError({
        message: `Cannot update lease with status: ${lease.status}. Contact an administrator.`,
      });
    }

    const updatedLease = await this.applyDirectUpdate(lease, updateData, currentUser.sub);

    const { cuid } = cxt.request.params;
    await this.leaseCache.invalidateLease(cuid, lease.luid);

    return {
      success: true,
      message: t('lease.updatedSuccessfully'),
      data: { lease: updatedLease },
    };
  }

  /**
   * Sanitize update data by converting empty strings to undefined for optional ObjectId fields
   * This prevents MongoDB from trying to cast empty strings to ObjectId
   * Setting to undefined allows Mongoose to unset the field in the database
   */
  private sanitizeUpdateData(updateData: Partial<ILeaseFormData>): Partial<ILeaseFormData> {
    const sanitized = { ...updateData };

    // Handle property.unitId - convert empty string to undefined to explicitly unset it
    if (sanitized.property?.unitId === '' || sanitized.property?.unitId === null) {
      sanitized.property.unitId = undefined;
    }

    return sanitized;
  }

  private async applyDirectUpdate(
    lease: ILeaseDocument,
    updateData: Partial<ILeaseFormData>,
    userId: string
  ): Promise<ILeaseDocument> {
    // Sanitize empty strings and null values for nested ObjectId fields
    const sanitizedData = this.sanitizeUpdateData(updateData);

    const modificationEvent = {
      type: 'modified',
      date: new Date(),
      performedBy: userId,
      changes: Object.keys(sanitizedData),
    };

    const updated = await this.leaseDAO.update(
      { _id: new Types.ObjectId(lease._id) },
      {
        $set: {
          ...sanitizedData,
          updatedAt: new Date(),
          updatedBy: userId,
        },
        $push: { modifications: modificationEvent },
      },
      { new: true }
    );

    if (!updated) {
      throw new BadRequestError({ message: 'Failed to update lease' });
    }

    return updated;
  }

  private async applyDirectUpdateWithOverride(
    lease: ILeaseDocument,
    updateData: Partial<ILeaseFormData>,
    userId: string
  ): Promise<ILeaseDocument> {
    // Admin overriding staff pending changes
    const overriddenUserId = lease.pendingChanges?.updatedBy;

    // Sanitize empty strings and null values for nested ObjectId fields
    const sanitizedData = this.sanitizeUpdateData(updateData);

    const modificationEvent = {
      type: 'modified',
      date: new Date(),
      performedBy: userId,
      changes: Object.keys(sanitizedData),
    };

    const updated = await this.leaseDAO.update(
      { _id: lease._id },
      {
        $set: {
          ...sanitizedData,
          updatedAt: new Date(),
          updatedBy: userId,
        },
        $push: { modifications: modificationEvent },
      },
      { new: true }
    );

    if (!updated) {
      throw new BadRequestError({ message: 'Failed to update lease' });
    }

    // TODO: Notify the original staff member that their pending changes were overridden
    // This will be handled by NotificationService.notifyLeaseUpdate() later
    this.log.info(
      `Admin ${userId} overrode pending changes from ${overriddenUserId} for lease ${lease.luid}`
    );

    return updated;
  }

  private async storePendingChanges(
    lease: ILeaseDocument,
    updateData: Partial<ILeaseFormData>,
    currentUser: ICurrentUser
  ): Promise<ILeaseDocument> {
    const profileData = await this.profileDAO.findFirst(
      { user: currentUser.sub },
      { select: 'personalInfo.firstName personalInfo.lastName' }
    );

    const displayName = profileData
      ? `${profileData.personalInfo?.firstName} ${profileData.personalInfo?.lastName}`.trim()
      : 'Unknown User';

    const pendingChanges = {
      ...updateData,
      updatedBy: currentUser.sub,
      updatedAt: new Date(),
      displayName,
    };

    const updated = await this.leaseDAO.update(
      { _id: lease._id },
      {
        $set: {
          pendingChanges,
          updatedAt: new Date(),
          updatedBy: currentUser.sub,
        },
      },
      { new: true }
    );

    if (!updated) {
      throw new BadRequestError({ message: 'Failed to store pending changes' });
    }

    return updated;
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

    this.enforceLeaseApprovalRequirement(lease, 'activate');

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

  async sendLeaseForSignature(
    cuid: string,
    leaseId: string,
    _signers: any[],
    provider: string,
    _userId: string
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Sending lease ${leaseId} for signature via ${provider}`);

    const lease = await this.leaseDAO.findFirst({
      luid: leaseId,
      cuid,
      deletedAt: null,
    });

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }

    this.enforceLeaseApprovalRequirement(lease, 'send for signature');

    throw new Error('sendLeaseForSignature not yet implemented');
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

  async generateLeasePDF(
    cuid: string,
    leaseId: string,
    _userId: string
  ): IPromiseReturnedData<any> {
    this.log.info(`Generating PDF for lease ${leaseId}`);
    throw new Error('generateLeasePDF not yet implemented');
  }

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

    const previewData: ILeasePreviewRequest = {
      templateType: mapPropertyTypeToTemplate(property.propertyType),
      leaseNumber: lease.leaseNumber,
      currentDate: new Date().toISOString(),
      jurisdiction: property.address.country || property.address.city || 'State/Province',
      signedDate: lease.signedDate?.toISOString(),

      tenantName: lease.tenantInfo?.fullname || 'Tenant Name',
      tenantEmail: lease.tenantInfo?.email || '',
      tenantPhone: lease.tenantInfo?.phoneNumber || '',

      coTenants: lease.coTenants?.map((ct) => ({
        name: ct.name,
        email: ct.email,
        phone: ct.phone,
        occupation: ct.occupation,
      })),

      propertyAddress: property.address
        ? `${property.address.street}, ${property.address.city}, ${property.address.state} ${property.address.postCode || ''}`
        : '',

      leaseType: lease.type,
      startDate: lease.duration.startDate,
      endDate: lease.duration.endDate,
      monthlyRent: lease.fees.monthlyRent,
      securityDeposit: lease.fees.securityDeposit,
      rentDueDay: lease.fees.rentDueDay,
      currency: lease.fees.currency,

      petPolicy: lease.petPolicy,
      renewalOptions: lease.renewalOptions,
      legalTerms: lease.legalTerms,
      utilitiesIncluded: lease.utilitiesIncluded,

      signingMethod: lease.signingMethod,

      ...landlordInfo,
      propertyName: property.name,
      propertyType: property.propertyType,
    } as any;

    return previewData;
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

    const lease = await this.leaseDAO.findFirst({
      luid: leaseId,
      deletedAt: null,
    });

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

    this.log.info('Lease service event listeners initialized');
  }

  private async markLeaseDocumentsAsFailed(leaseId: string, errorMessage: string): Promise<void> {
    this.log.warn('Marking lease documents as failed', {
      leaseId,
      errorMessage,
    });

    await this.leaseDAO.updateLeaseDocumentStatus(leaseId, 'failed', errorMessage);
  }

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

  private validateStatusTransition(currentStatus: LeaseStatus, newStatus: LeaseStatus): void {
    const allowedTransitions: Record<LeaseStatus, LeaseStatus[]> = {
      [LeaseStatus.DRAFT]: [
        LeaseStatus.PENDING_SIGNATURE,
        LeaseStatus.ACTIVE,
        LeaseStatus.CANCELLED,
      ],
      [LeaseStatus.PENDING_SIGNATURE]: [LeaseStatus.ACTIVE, LeaseStatus.CANCELLED],
      [LeaseStatus.ACTIVE]: [LeaseStatus.TERMINATED, LeaseStatus.EXPIRED],
      [LeaseStatus.EXPIRED]: [],
      [LeaseStatus.TERMINATED]: [],
      [LeaseStatus.CANCELLED]: [],
    };

    if (currentStatus === newStatus) {
      return;
    }

    const allowed = allowedTransitions[currentStatus] || [];
    if (!allowed.includes(newStatus)) {
      throw new ValidationRequestError({
        message: `Invalid status transition from '${currentStatus}' to '${newStatus}'`,
        errorInfo: {
          status: [
            `Cannot transition from ${currentStatus} to ${newStatus}. Allowed transitions: ${allowed.join(', ') || 'none (terminal state)'}`,
          ],
        },
      });
    }

    this.log.info('Status transition validated', {
      from: currentStatus,
      to: newStatus,
    });
  }

  private validateLeaseUpdate(lease: ILeaseDocument, updateData: Partial<ILeaseFormData>): void {
    if (lease.status !== LeaseStatus.ACTIVE) {
      return;
    }

    const immutableFields = [
      'tenantId',
      'property.id',
      'property.unitId',
      'duration.startDate',
      'duration.endDate',
      'fees.monthlyRent',
      'fees.securityDeposit',
      'fees.currency',
      'type',
    ];

    const attemptedChanges = Object.keys(updateData);
    const blockedChanges: string[] = [];

    attemptedChanges.forEach((field) => {
      const isBlocked = immutableFields.some((immutable) => {
        return field === immutable || field.startsWith(immutable + '.');
      });

      if (isBlocked) {
        blockedChanges.push(field);
      }
    });

    if (blockedChanges.length > 0) {
      throw new ValidationRequestError({
        message: 'Cannot modify immutable fields on active lease',
        errorInfo: {
          fields: [
            `The following fields cannot be modified on an ACTIVE lease: ${blockedChanges.join(', ')}. These fields are locked to maintain lease integrity.`,
          ],
        },
      });
    }

    this.log.info('Lease update validation passed for active lease', {
      leaseId: lease.luid,
      fieldsToUpdate: attemptedChanges,
    });
  }

  private enforceLeaseApprovalRequirement(lease: ILeaseDocument, operation: string): void {
    if (lease.approvalStatus !== 'approved') {
      const statusMessage =
        lease.approvalStatus === 'pending'
          ? 'This lease is pending approval'
          : lease.approvalStatus === 'rejected'
            ? 'This lease has been rejected'
            : 'This lease is in draft status';

      throw new InvalidRequestError({
        message: `Cannot ${operation}. ${statusMessage}. Only approved leases can ${operation}.`,
      });
    }

    this.log.info(`Lease approval requirement satisfied for ${operation}`, {
      leaseId: lease.luid,
      approvalStatus: lease.approvalStatus,
    });
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

  cleanupEventListeners(): void {
    this.emitterService.off(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted);
    this.emitterService.off(EventTypes.UPLOAD_FAILED, this.handleUploadFailed);

    this.log.info('Lease service event listeners removed');
  }
}
