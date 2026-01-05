import Logger from 'bunyan';
import { t } from '@shared/languages';
import { PropertyDAO } from '@dao/index';
import { FilterQuery, Types } from 'mongoose';
import { PropertyCache } from '@caching/index';
import { createSafeMongoUpdate } from '@utils/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { NotificationService } from '@services/notification';
import { IPropertyDocument } from '@interfaces/property.interface';
import { InvalidRequestError, BadRequestError, NotFoundError } from '@shared/customErrors';
import { PROPERTY_APPROVAL_ROLES, convertUserRoleToEnum, createLogger } from '@utils/index';
import { ISuccessReturnData, IPaginationQuery, IPaginateResult } from '@interfaces/utils.interface';

import { getOriginalRequesterId } from './propertyHelpers';

interface IConstructor {
  notificationService: NotificationService;
  propertyCache: PropertyCache;
  propertyDAO: PropertyDAO;
}

export class PropertyApprovalService {
  private readonly log: Logger;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyCache: PropertyCache;
  private readonly notificationService: NotificationService;

  constructor({ propertyDAO, propertyCache, notificationService }: IConstructor) {
    this.propertyDAO = propertyDAO;
    this.propertyCache = propertyCache;
    this.notificationService = notificationService;
    this.log = createLogger('PropertyApprovalService');
  }

  async getPendingApprovals(
    cuid: string,
    currentuser: ICurrentUser,
    pagination: IPaginationQuery
  ): Promise<ISuccessReturnData<{ items: IPropertyDocument[]; pagination?: IPaginateResult }>> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to view pending approvals.',
      });
    }

    const filter: FilterQuery<IPropertyDocument> = {
      cuid,
      deletedAt: null,
      approvalStatus: 'pending',
    };

    const opts: IPaginationQuery = {
      page: pagination.page || 1,
      limit: Math.max(1, Math.min(pagination.limit || 10, 100)),
      sort: pagination.sort || '-createdAt',
      sortBy: pagination.sortBy || 'createdAt',
      skip: ((pagination.page || 1) - 1) * (pagination.limit || 10),
    };

    const properties = await this.propertyDAO.getPropertiesByClientId(cuid, filter, opts);

    return {
      success: true,
      data: {
        items: properties.items,
        pagination: properties.pagination,
      },
      message: 'Pending approvals retrieved successfully',
    };
  }

  async approveProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    notes?: string
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to approve properties.',
      });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cuid,
      deletedAt: null,
    });

    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    if (property.approvalStatus === 'approved' && !property.pendingChanges) {
      throw new InvalidRequestError({
        message: 'Property is already approved and has no pending changes.',
      });
    }

    const approvalEntry = {
      action: 'approved' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      ...(notes && { notes }),
    };

    const updateData: any = {
      approvalStatus: 'approved',
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    // Defensive check: Ensure approvalDetails is an array before $push
    if (!property.approvalDetails || !Array.isArray(property.approvalDetails)) {
      this.log.warn('Fixing approvalDetails type mismatch - initializing as empty array', {
        propertyId: property.id,
        pid: property.pid,
        currentType: property.approvalDetails ? typeof property.approvalDetails : 'undefined',
        wasArray: Array.isArray(property.approvalDetails),
      });
      updateData.approvalDetails = [approvalEntry];
    } else {
      updateData.$push = { approvalDetails: approvalEntry };
    }

    if (property.pendingChanges) {
      const safeChanges = createSafeMongoUpdate(property.pendingChanges);

      updateData.$set = {
        ...safeChanges,
        pendingChanges: null,
        approvalStatus: 'approved',
        lastModifiedBy: new Types.ObjectId(currentuser.sub),
      };

      this.log.info('Applying pending changes during approval with safe updates', {
        propertyId: property.id,
        pendingChanges: Object.keys(property.pendingChanges),
        safeUpdateFields: Object.keys(safeChanges),
      });
    }

    const updatedProperty = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      updateData
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to approve property.' });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Property approved', {
      propertyId: property.id,
      approvedBy: currentuser.sub,
      hadPendingChanges: !!property.pendingChanges,
    });

    try {
      const originalRequesterId =
        property.pendingChanges?.updatedBy?.toString() ||
        getOriginalRequesterId(
          Array.isArray(property.approvalDetails) ? property.approvalDetails : []
        );

      if (originalRequesterId) {
        await this.notificationService.notifyApprovalDecision(
          {
            resourceId: updatedProperty.id,
            resourceUid: updatedProperty.pid,
            resourceName: updatedProperty.name || property.name || 'Unknown Property',
          },
          currentuser.sub,
          cuid,
          'approved',
          originalRequesterId,
          notes,
          {
            address: updatedProperty.address?.fullAddress,
            hadPendingChanges: !!property.pendingChanges,
          }
        );
      }
    } catch (notificationError) {
      this.log.error('Failed to send approval notification', {
        error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
        propertyId: updatedProperty.pid,
        approverId: currentuser.sub,
      });
    }

    return {
      success: true,
      data: updatedProperty,
      message: property.pendingChanges
        ? 'Property changes approved and applied successfully'
        : 'Property approved successfully',
    };
  }

  async rejectProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError({ message: 'Rejection reason is required.' });
    }

    // Check if user has permission
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to reject properties.',
      });
    }

    const property = await this.propertyDAO.findFirst({
      pid,
      cuid,
      deletedAt: null,
    });

    if (!property) {
      throw new NotFoundError({ message: t('property.errors.notFound') });
    }

    // Create new rejection entry for the array
    const rejectionEntry = {
      action: 'rejected' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      rejectionReason: reason.trim(),
    };

    // Determine the appropriate status after rejection
    const updateData: any = {
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    if (!property.approvalDetails || !Array.isArray(property.approvalDetails)) {
      updateData.approvalDetails = [rejectionEntry];
    } else {
      updateData.$push = { approvalDetails: rejectionEntry };
    }

    // If property has pending changes, clear them and keep status as approved (using old data)
    if (property.pendingChanges) {
      updateData.pendingChanges = null;
      // Keep approvalStatus as 'approved' since we're keeping the old approved data
    } else {
      // If no pending changes, this is a new property being rejected
      updateData.approvalStatus = 'rejected';
    }

    const updatedProperty = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      { $set: updateData }
    );

    if (!updatedProperty) {
      throw new BadRequestError({ message: 'Unable to reject property.' });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);
    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Property rejected', {
      propertyId: property.id,
      rejectedBy: currentuser.sub,
      reason,
      hadPendingChanges: !!property.pendingChanges,
    });

    try {
      const originalRequesterId =
        property.pendingChanges?.updatedBy?.toString() ||
        getOriginalRequesterId(
          Array.isArray(property.approvalDetails) ? property.approvalDetails : []
        );

      if (originalRequesterId) {
        await this.notificationService.notifyApprovalDecision(
          {
            resourceId: updatedProperty.id,
            resourceUid: updatedProperty.pid,
            resourceName: updatedProperty.name || property.name || 'Unknown Property',
          },
          currentuser.sub,
          cuid,
          'rejected',
          originalRequesterId,
          reason.trim(),
          {
            address: updatedProperty.address?.fullAddress || property.address?.fullAddress,
            hadPendingChanges: !!property.pendingChanges,
          }
        );
      }
    } catch (notificationError) {
      this.log.error('Failed to send rejection notification', {
        error: notificationError instanceof Error ? notificationError.message : 'Unknown error',
        propertyId: updatedProperty.pid,
        rejectorId: currentuser.sub,
      });
    }

    return {
      success: true,
      data: updatedProperty,
      message: property.pendingChanges
        ? 'Property changes rejected. Original data preserved.'
        : 'Property rejected',
    };
  }

  async bulkApproveProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to bulk approve properties.',
      });
    }

    if (!propertyIds || propertyIds.length === 0) {
      throw new BadRequestError({ message: 'Property IDs are required.' });
    }

    const updateData = {
      approvalStatus: 'approved',
      'approvalDetails.approvedBy': new Types.ObjectId(currentuser.sub),
      'approvalDetails.approvedAt': new Date(),
      'approvalDetails.requiresReapproval': false,
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    const result = await this.propertyDAO.updateMany(
      {
        pid: { $in: propertyIds },
        cuid,
        deletedAt: null,
        approvalStatus: 'pending',
      },
      { $set: updateData }
    );

    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Properties bulk approved', {
      count: result.modifiedCount,
      approvedBy: currentuser.sub,
    });

    return {
      success: true,
      data: { approved: result.modifiedCount, total: propertyIds.length },
      message: `${result.modifiedCount} properties approved successfully`,
    };
  }

  async bulkRejectProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError({ message: 'Rejection reason is required.' });
    }

    // Check if user has permission
    const userRole = currentuser.client.role;
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
      throw new InvalidRequestError({
        message: 'You are not authorized to bulk reject properties.',
      });
    }

    if (!propertyIds || propertyIds.length === 0) {
      throw new BadRequestError({ message: 'Property IDs are required.' });
    }

    const updateData = {
      approvalStatus: 'rejected',
      'approvalDetails.rejectedBy': new Types.ObjectId(currentuser.sub),
      'approvalDetails.rejectedAt': new Date(),
      'approvalDetails.rejectionReason': reason.trim(),
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
    };

    const result = await this.propertyDAO.updateMany(
      {
        pid: { $in: propertyIds },
        cuid,
        deletedAt: null,
        approvalStatus: 'pending',
      },
      { $set: updateData }
    );

    await this.propertyCache.invalidatePropertyLists(cuid);

    this.log.info('Properties bulk rejected', {
      count: result.modifiedCount,
      rejectedBy: currentuser.sub,
      reason,
    });

    return {
      success: true,
      data: { rejected: result.modifiedCount, total: propertyIds.length },
      message: `${result.modifiedCount} properties rejected`,
    };
  }
}
