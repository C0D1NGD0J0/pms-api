import Logger from 'bunyan';
import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';
import { InvitationDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import { EventEmitterService, NotificationService, AssetService } from '@services/index';
import { ValidationRequestError, InvalidRequestError, BadRequestError } from '@shared/customErrors';
import {
  UploadCompletedPayload,
  UploadFailedPayload,
  EventTypes,
} from '@interfaces/events.interface';
import {
  ILeaseFilterOptions,
  ILeaseDocument,
  ILeaseFormData,
  LeaseStatus,
} from '@interfaces/lease.interface';
import {
  PROPERTY_APPROVAL_ROLES,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  createLogger,
  MoneyUtils,
} from '@utils/index';
import {
  ListResultWithPagination,
  IPromiseReturnedData,
  ISuccessReturnData,
  IRequestContext,
  ResourceContext,
  UploadResult,
} from '@interfaces/utils.interface';

interface IConstructor {
  notificationService: NotificationService;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  invitationDAO: InvitationDAO;
  assetService: AssetService;
  propertyDAO: PropertyDAO;
  profileDAO: ProfileDAO;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class LeaseService {
  private readonly notificationService: NotificationService;
  private readonly log: Logger;
  private readonly userDAO: UserDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly clientDAO: ClientDAO;
  private readonly profileDAO: ProfileDAO;
  private readonly propertyDAO: PropertyDAO;
  private readonly assetService: AssetService;
  private readonly invitationDAO: InvitationDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly emitterService: EventEmitterService;

  constructor({
    notificationService,
    emitterService,
    invitationDAO,
    propertyUnitDAO,
    clientDAO,
    assetService,
    propertyDAO,
    profileDAO,
    leaseDAO,
    userDAO,
  }: IConstructor) {
    this.userDAO = userDAO;
    this.leaseDAO = leaseDAO;
    this.clientDAO = clientDAO;
    this.profileDAO = profileDAO;
    this.propertyDAO = propertyDAO;
    this.assetService = assetService;
    this.invitationDAO = invitationDAO;
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
    this.log.info(`Creating lease for client ${cuid}`);

    if (!cuid) {
      throw new BadRequestError({ message: t('property.errors.clientIdRequired') });
    }

    const client = await this.clientDAO.getClientByCuid(cuid);
    if (!client) {
      this.log.error(`Client with cuid ${cuid} not found`);
      throw new BadRequestError({ message: t('common.errors.clientNotFound') });
    }

    // Validate all lease data (including property, unit, tenant, dates, fees)
    const { hasErrors, errors, tenantInfo, propertyInfo } = await this.validateLeaseData(
      cuid,
      data
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
      //admin/manager - auto-approve
      approvalStatus = 'approved';
      approvalDetails.push({
        action: 'created',
        actor: currentuser.sub,
        timestamp: new Date(),
        notes: 'Auto-approved by admin/manager',
      });
      message = 'Lease created and approved successfully';
    } else if (PROPERTY_STAFF_ROLES.includes(userRoleEnum)) {
      // staff - pending approval
      approvalStatus = 'pending';
      approvalDetails.push({
        action: 'created',
        actor: currentuser.sub,
        timestamp: new Date(),
      });
    }

    const session = await this.leaseDAO.startSession();
    const result = await this.leaseDAO.withTransaction(session, async (session) => {
      const parsedLeaseData = {
        ...data,
        cuid,
        tenantId: tenantInfo.tenantId,
        createdBy: currentuser.sub,
        fees: MoneyUtils.parseLeaseFees(data.fees),
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
      };

      const lease = await this.leaseDAO.createLease(cuid, parsedLeaseData, session);

      // Log if using invitation as temporary tenant
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
    return { success: true, data: result.lease, message };
  }

  async getFilteredLeases(
    cuid: string,
    filters: ILeaseFilterOptions,
    _options: any
  ): ListResultWithPagination<ILeaseDocument> {
    this.log.info(`Getting filtered leases for client ${cuid}`, { filters });
    throw new Error('getFilteredLeases not yet implemented');
  }

  async updateLease(
    cuid: string,
    leaseId: string,
    _updateData: Partial<ILeaseFormData>
  ): IPromiseReturnedData<ILeaseDocument> {
    this.log.info(`Updating lease ${leaseId} for client ${cuid}`);
    throw new Error('updateLease not yet implemented');
  }

  async deleteLease(cuid: string, leaseId: string, userId: string): IPromiseReturnedData<boolean> {
    this.log.info(`Deleting lease ${leaseId} for client ${cuid}`);

    // Get the lease
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

    // Enforce approval requirement before activation
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

    // Get the lease first
    const lease = await this.leaseDAO.findFirst({
      luid: leaseId,
      cuid,
      deletedAt: null,
    });

    if (!lease) {
      throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
    }

    // Enforce approval requirement
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

  async previewLeaseHTML(cuid: string, leaseId: string): IPromiseReturnedData<string> {
    this.log.info(`Previewing HTML for lease ${leaseId}`);
    throw new Error('previewLeaseHTML not yet implemented');
  }

  async downloadLeasePDF(cuid: string, leaseId: string): IPromiseReturnedData<any> {
    this.log.info(`Downloading PDF for lease ${leaseId}`);
    throw new Error('downloadLeasePDF not yet implemented');
  }

  async getExpiringLeases(
    cuid: string,
    daysThreshold: number = 30
  ): IPromiseReturnedData<ILeaseDocument[]> {
    this.log.info(`Getting leases expiring within ${daysThreshold} days for client ${cuid}`);
    throw new Error('getExpiringLeases not yet implemented');
  }

  async getLeaseStats(cuid: string, filters?: any): IPromiseReturnedData<any> {
    this.log.info(`Getting lease statistics for client ${cuid}`, { filters });
    throw new Error('getLeaseStats not yet implemented');
  }

  async exportLeases(cuid: string, format: string, filters?: any): IPromiseReturnedData<any> {
    this.log.info(`Exporting leases for client ${cuid} as ${format}`, { filters });
    throw new Error('exportLeases not yet implemented');
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

    // Apply pending changes if they exist
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

    // Send notification to staff who created the lease
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

    return {
      success: true,
      data: updatedLease,
      message: 'Lease rejected',
    };
  }

  /**
   * Bulk approve leases
   */
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

    return {
      success: true,
      data: { modifiedCount: result.modifiedCount },
      message: `${result.modifiedCount} lease(s) approved successfully`,
    };
  }

  /**
   * Bulk reject leases
   */
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

    return {
      success: true,
      data: { modifiedCount: result.modifiedCount },
      message: `${result.modifiedCount} lease(s) rejected`,
    };
  }

  /**
   * Setup event listeners for upload completion and failures
   */
  private setupEventListeners(): void {
    this.emitterService.on(EventTypes.UPLOAD_COMPLETED, this.handleUploadCompleted.bind(this));
    this.emitterService.on(EventTypes.UPLOAD_FAILED, this.handleUploadFailed.bind(this));

    this.log.info('Lease service event listeners initialized');
  }

  /**
   * Mark lease documents as failed with error message
   */
  private async markLeaseDocumentsAsFailed(leaseId: string, errorMessage: string): Promise<void> {
    this.log.warn('Marking lease documents as failed', {
      leaseId,
      errorMessage,
    });

    await this.leaseDAO.updateLeaseDocumentStatus(leaseId, 'failed', errorMessage);
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
    leaseData: ILeaseFormData
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

    // tenant validation - support both ID and email lookup
    if (leaseData.tenantInfo.id) {
      // tenant ID provided (existing user)
      const user = await this.userDAO.getUserById(leaseData.tenantInfo.id);

      if (!user) {
        if (!validationErrors['tenantInfo.id']) validationErrors['tenantInfo.id'] = [];
        validationErrors['tenantInfo.id'].push(t('lease.errors.tenantNotFound'));
      } else {
        // verify tenant has 'tenant' role for this client
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
    } else if (leaseData.tenantInfo.email) {
      // email is provided instead of id, so we search invitation
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
          if (!validationErrors['tenantInfo.email']) validationErrors['tenantInfo.email'] = [];
          validationErrors['tenantInfo.email'].push(
            `No tenant record found for '${leaseData.tenantInfo.email}'`
          );
        } else if (invitation.status === 'accepted') {
          // Invitation accepted - use user ID
          const user = await this.userDAO.getActiveUserByEmail(leaseData.tenantInfo.email);
          if (!user) {
            if (!validationErrors['tenantInfo.email']) validationErrors['tenantInfo.email'] = [];
            validationErrors['tenantInfo.email'].push(
              'Invitation accepted but user account not found'
            );
          } else {
            tenantInfo = {
              tenantId: user._id,
              useInvitationIdAsTenantId: false,
            };
          }
        } else if (['pending', 'draft', 'sent'].includes(invitation.status)) {
          // use invitation ID as temporary tenant!
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

    // Validate property exists and check unitId requirement for multi-unit properties
    const property = await this.propertyDAO.findFirst({
      _id: new Types.ObjectId(leaseData.property.id),
      cuid,
      approvalStatus: 'approved',
      deletedAt: null,
    });

    let unit = null;

    if (!property) {
      if (!validationErrors['property.id']) validationErrors['property.id'] = [];
      validationErrors['property.id'].push(t('property.errors.notFound'));
    } else {
      // Check if property type requires unit specification
      const isMultiUnit = PropertyTypeManager.supportsMultipleUnits(property.propertyType);

      if (isMultiUnit) {
        if (!leaseData.property.unitId) {
          if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
          validationErrors['property.unitId'].push(
            `Unit ID is required for ${property.propertyType} properties`
          );
        } else {
          // Validate unit exists, belongs to property, and is available
          unit = await this.propertyUnitDAO.findFirst({
            _id: leaseData.property.unitId,
            propertyId: property._id,
            cuid,
          });

          if (!unit) {
            if (!validationErrors['property.unitId']) validationErrors['property.unitId'] = [];
            validationErrors['property.unitId'].push(
              'Unit not found or does not belong to this property'
            );
          } else {
            // Check unit availability
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
        address: property?.address.fullAddress || '',
        propertyType: property?.propertyType,
        name: property?.name,
        unitNumber: unit?.unitNumber,
        specifications: property
          ? {
              totalArea: unit?.specifications?.totalArea || property.specifications?.totalArea,
              bedrooms: unit?.specifications?.bedrooms || property.specifications?.bedrooms,
              bathrooms: unit?.specifications?.bathrooms || property.specifications?.bathrooms,
              parkingSpaces: property.specifications?.parkingSpaces,
              floors: property.specifications?.floors,
            }
          : undefined,
      },
    };
  }

  /**
   * Validate status transition is allowed
   * @param currentStatus - Current lease status
   * @param newStatus - Desired new status
   * @throws ValidationRequestError if transition is not allowed
   */
  private validateStatusTransition(currentStatus: LeaseStatus, newStatus: LeaseStatus): void {
    // Define allowed transitions
    const allowedTransitions: Record<LeaseStatus, LeaseStatus[]> = {
      [LeaseStatus.DRAFT]: [
        LeaseStatus.PENDING_SIGNATURE,
        LeaseStatus.ACTIVE,
        LeaseStatus.CANCELLED,
      ],
      [LeaseStatus.PENDING_SIGNATURE]: [LeaseStatus.ACTIVE, LeaseStatus.CANCELLED],
      [LeaseStatus.ACTIVE]: [LeaseStatus.TERMINATED, LeaseStatus.EXPIRED],
      [LeaseStatus.EXPIRED]: [], // Terminal state
      [LeaseStatus.TERMINATED]: [], // Terminal state
      [LeaseStatus.CANCELLED]: [], // Terminal state
    };

    // If status is not changing, allow it
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

  /**
   * Validate lease update - prevent changes to immutable fields on active leases
   * @param lease - Current lease document
   * @param updateData - Proposed update data
   * @throws ValidationRequestError if trying to modify immutable fields
   */
  private validateLeaseUpdate(lease: ILeaseDocument, updateData: Partial<ILeaseFormData>): void {
    // Only enforce field locking for ACTIVE leases
    if (lease.status !== LeaseStatus.ACTIVE) {
      return;
    }

    // Define fields that cannot be modified on ACTIVE leases
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
      // Check if this field or any parent field is immutable
      const isBlocked = immutableFields.some((immutable) => {
        // Check exact match or nested field match
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

  /**
   * Enforce lease approval requirement for sensitive operations
   * @param lease - The lease document to check
   * @param operation - The operation being attempted (for error messaging)
   * @throws InvalidRequestError if lease is not approved
   */
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

  /**
   * Handle upload completed event for lease documents
   */
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

  /**
   * Handle upload failed event for lease documents
   */
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
