import Logger from 'bunyan';
import { t } from '@shared/languages';
import { PropertyCache } from '@caching/index';
import { type QueryFilter, Types } from 'mongoose';
import { createSafeMongoUpdate } from '@utils/index';
import { PropertyUnitDAO, PropertyDAO } from '@dao/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { NotificationService } from '@services/notification';
import type { MediaUploadService } from '@services/mediaUpload';
import { IPropertyDocument } from '@interfaces/property.interface';
import { IPropertyUnitDocument } from '@interfaces/propertyUnit.interface';
import { InvalidRequestError, BadRequestError, NotFoundError } from '@shared/customErrors';
import { PROPERTY_APPROVAL_ROLES, convertUserRoleToEnum, createLogger } from '@utils/index';
import { ISuccessReturnData, IPaginationQuery, IPaginateResult } from '@interfaces/utils.interface';

import {
  cleanUpRemovedPropertyMedia,
  getOriginalRequesterId,
  pendingMediaItems,
} from './propertyHelpers';

const BULK_DECISION_CONCURRENCY = 5;

interface IConstructor {
  notificationService: NotificationService;
  mediaUploadService: MediaUploadService;
  propertyUnitDAO: PropertyUnitDAO;
  propertyCache: PropertyCache;
  propertyDAO: PropertyDAO;
}

export class PropertyApprovalService {
  private readonly log: Logger;
  private readonly propertyDAO: PropertyDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly propertyCache: PropertyCache;
  private readonly notificationService: NotificationService;
  private readonly mediaUploadService: MediaUploadService;

  constructor({
    propertyDAO,
    propertyCache,
    propertyUnitDAO,
    notificationService,
    mediaUploadService,
  }: IConstructor) {
    this.mediaUploadService = mediaUploadService;
    this.propertyDAO = propertyDAO;
    this.propertyUnitDAO = propertyUnitDAO;
    this.propertyCache = propertyCache;
    this.notificationService = notificationService;
    this.log = createLogger('PropertyApprovalService');
  }

  async getPendingApprovals(
    cuid: string,
    currentuser: ICurrentUser,
    pagination: IPaginationQuery
  ): Promise<
    ISuccessReturnData<{
      items: IPropertyDocument[];
      pagination?: IPaginateResult;
      pendingUnits: IPropertyUnitDocument[];
    }>
  > {
    this.assertApprover(currentuser);

    const filter: QueryFilter<IPropertyDocument> = {
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

    // Staff edits to existing units wait for approval too; listed alongside the properties
    const [properties, pendingUnits] = await Promise.all([
      this.propertyDAO.getPropertiesByClientId(cuid, filter, opts),
      this.propertyUnitDAO.findPendingUnitChanges(cuid),
    ]);

    return {
      success: true,
      data: {
        items: properties.items,
        pagination: properties.pagination,
        pendingUnits,
      },
      message: t('common.success.retrieved', { resource: 'Pending approvals' }),
    };
  }

  async approveProperty(
    cuid: string,
    pid: string,
    currentuser: ICurrentUser,
    notes?: string
  ): Promise<ISuccessReturnData> {
    this.assertApprover(currentuser);
    const property = await this.propertyDAO.findFirst(
      { pid, cuid, deletedAt: null },
      { select: '+owner' }
    );
    const result = await this.applyApproval(cuid, pid, property, currentuser, notes);
    await this.propertyCache.invalidatePropertyLists(cuid);
    return result;
  }

  private async applyApproval(
    cuid: string,
    pid: string,
    property: IPropertyDocument | null | undefined,
    currentuser: ICurrentUser,
    notes?: string
  ): Promise<ISuccessReturnData> {
    if (!property) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Property' }) });
    }

    if (property.approvalStatus === 'approved' && !property.pendingChanges) {
      throw new InvalidRequestError({
        message: 'Property is already approved and has no pending changes.',
      });
    }

    const updatedProperty = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      this.buildApprovalUpdate(property, currentuser, notes)
    );

    if (!updatedProperty) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'approve property' }),
      });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);

    // Approved staff edits can remove images/documents — clean up their assets
    // now that the change is applied. Logged, not thrown: approval succeeded.
    if (property.pendingChanges) {
      try {
        await cleanUpRemovedPropertyMedia(
          this.mediaUploadService,
          property,
          property.pendingChanges as any,
          currentuser.sub
        );
      } catch (error) {
        this.log.error('Failed to clean up media removed by approved changes', { pid, error });
      }
    }

    this.log.info('Property approved', {
      propertyId: property.id,
      approvedBy: currentuser.sub,
      hadPendingChanges: !!property.pendingChanges,
    });

    try {
      const originalRequesterId =
        property.pendingChanges?.updatedBy?.toString() ||
        getOriginalRequesterId(property.approvalDetails);

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
      throw new BadRequestError({
        message: t('common.errors.required', { field: 'Rejection reason' }),
      });
    }

    this.assertApprover(currentuser);
    const property = await this.propertyDAO.findFirst({ pid, cuid, deletedAt: null });
    const result = await this.applyRejection(cuid, pid, property, currentuser, reason);
    await this.propertyCache.invalidatePropertyLists(cuid);
    return result;
  }

  private async applyRejection(
    cuid: string,
    pid: string,
    property: IPropertyDocument | null | undefined,
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    if (!property) {
      throw new NotFoundError({ message: t('common.errors.notFound', { resource: 'Property' }) });
    }

    // Without this, rejecting a live approved property would mark it 'rejected'
    if (!property.pendingChanges && property.approvalStatus !== 'pending') {
      throw new InvalidRequestError({
        message: 'Property has no pending submission or changes to reject.',
      });
    }

    const updatedProperty = await this.propertyDAO.update(
      { pid, cuid, deletedAt: null },
      this.buildRejectionUpdate(property, currentuser, reason)
    );

    if (!updatedProperty) {
      throw new BadRequestError({
        message: t('common.errors.operationFailed', { action: 'reject property' }),
      });
    }

    await this.propertyCache.invalidateProperty(cuid, property.id);

    const discardedMedia = pendingMediaItems(property.pendingChanges?.pendingMedia);
    if (discardedMedia.length) {
      try {
        await this.mediaUploadService.removeUploadedFiles(discardedMedia, { deleteAssets: true });
      } catch (error) {
        this.log.error('Failed to delete files from rejected pending changes', { pid, error });
      }
    }

    this.log.info('Property rejected', {
      propertyId: property.id,
      rejectedBy: currentuser.sub,
      reason,
      hadPendingChanges: !!property.pendingChanges,
    });

    try {
      const originalRequesterId =
        property.pendingChanges?.updatedBy?.toString() ||
        getOriginalRequesterId(property.approvalDetails);

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

  private buildApprovalUpdate(
    property: IPropertyDocument,
    currentuser: ICurrentUser,
    notes?: string
  ): Record<string, any> {
    const pendingMedia = property.pendingChanges?.pendingMedia;
    const approvalEntry = {
      action: 'approved' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      ...(notes && { notes }),
    };

    const updateData: any = {
      approvalStatus: 'approved',
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
      $push: { approvalDetails: approvalEntry },
    };

    if (property.pendingChanges) {
      const { pendingMedia: _pendingMedia, ...fieldChanges } = property.pendingChanges;
      const safeChanges = createSafeMongoUpdate(fieldChanges);

      updateData.$set = {
        ...safeChanges,
        pendingChanges: null,
        approvalStatus: 'approved',
        lastModifiedBy: new Types.ObjectId(currentuser.sub),
      };

      // Attach the files the edit uploaded. An edited list in the same change set replaces
      // the stored one, so the new files go after it; otherwise they are appended.
      for (const field of ['images', 'documents'] as const) {
        const uploaded = (pendingMedia?.[field] ?? []) as any[];
        if (!uploaded.length) continue;

        if (fieldChanges[field] !== undefined) {
          updateData.$set[field] = [...((fieldChanges[field] as any[]) ?? []), ...uploaded];
        } else {
          updateData.$push = { ...(updateData.$push || {}), [field]: { $each: uploaded } };
        }
      }

      // Preserve ownership history when owner changes via approval
      if (property.pendingChanges.owner && property.owner) {
        updateData.$push = {
          ...((updateData as any).$push || {}),
          ownershipHistory: {
            owner: property.owner,
            effectiveFrom: property.createdAt || new Date(),
            effectiveTo: new Date(),
            transferNote: 'Ownership updated via approval',
            recordedBy: new Types.ObjectId(currentuser.sub),
            recordedAt: new Date(),
          },
        };
      }

      this.log.info('Applying pending changes during approval with safe updates', {
        propertyId: property.id,
        pendingChanges: Object.keys(property.pendingChanges),
        safeUpdateFields: Object.keys(safeChanges),
        pendingMediaCount: pendingMediaItems(pendingMedia).length,
      });
    }

    return updateData;
  }

  private buildRejectionUpdate(
    property: IPropertyDocument,
    currentuser: ICurrentUser,
    reason: string
  ): Record<string, any> {
    const rejectionEntry = {
      action: 'rejected' as const,
      actor: new Types.ObjectId(currentuser.sub),
      timestamp: new Date(),
      rejectionReason: reason.trim(),
    };

    const updateData: any = {
      lastModifiedBy: new Types.ObjectId(currentuser.sub),
      $push: { approvalDetails: rejectionEntry },
    };

    // If property has pending changes, clear them; the live data is still the approved version.
    // Staff submissions set approvalStatus to 'pending', so it must be reset explicitly.
    if (property.pendingChanges) {
      updateData.pendingChanges = null;
      updateData.approvalStatus = 'approved';
    } else {
      // If no pending changes, this is a new property being rejected
      updateData.approvalStatus = 'rejected';
    }

    return updateData;
  }

  async bulkApproveProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser
  ): Promise<ISuccessReturnData> {
    this.assertApprover(currentuser);
    if (!propertyIds || propertyIds.length === 0) {
      throw new BadRequestError({
        message: t('common.errors.required', { field: 'Property IDs' }),
      });
    }

    const { succeeded, failed } = await this.applyToEach(
      cuid,
      propertyIds,
      '+owner',
      (pid, property) => this.applyApproval(cuid, pid, property, currentuser)
    );

    this.log.info('Properties bulk approved', {
      approved: succeeded,
      failed: failed.length,
      approvedBy: currentuser.sub,
    });

    return {
      success: true,
      data: { approved: succeeded, total: propertyIds.length, failed },
      message: `${succeeded} properties approved successfully`,
    };
  }

  async bulkRejectProperties(
    cuid: string,
    propertyIds: string[],
    currentuser: ICurrentUser,
    reason: string
  ): Promise<ISuccessReturnData> {
    if (!reason || reason.trim().length === 0) {
      throw new BadRequestError({
        message: t('common.errors.required', { field: 'Rejection reason' }),
      });
    }

    this.assertApprover(currentuser);
    if (!propertyIds || propertyIds.length === 0) {
      throw new BadRequestError({
        message: t('common.errors.required', { field: 'Property IDs' }),
      });
    }

    const { succeeded, failed } = await this.applyToEach(
      cuid,
      propertyIds,
      undefined,
      (pid, property) => this.applyRejection(cuid, pid, property, currentuser, reason)
    );

    this.log.info('Properties bulk rejected', {
      rejected: succeeded,
      failed: failed.length,
      rejectedBy: currentuser.sub,
      reason,
    });

    return {
      success: true,
      data: { rejected: succeeded, total: propertyIds.length, failed },
      message: `${succeeded} properties rejected`,
    };
  }

  private assertApprover(currentuser: ICurrentUser): void {
    if (!PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(currentuser.client.role))) {
      throw new InvalidRequestError({ message: t('common.errors.insufficientPermissions') });
    }
  }

  private async applyToEach(
    cuid: string,
    propertyIds: string[],
    select: string | undefined,
    decide: (pid: string, property?: IPropertyDocument) => Promise<ISuccessReturnData>
  ): Promise<{ succeeded: number; failed: Array<{ pid: string; error: string }> }> {
    const pids = [...new Set(propertyIds)];
    const { items } = await this.propertyDAO.list(
      { cuid, pid: { $in: pids }, deletedAt: null },
      { limit: pids.length, ...(select && { projection: select }) }
    );
    const propertiesByPid = new Map(items.map((property) => [property.pid, property]));

    let succeeded = 0;
    const failed: Array<{ pid: string; error: string }> = [];
    for (let i = 0; i < pids.length; i += BULK_DECISION_CONCURRENCY) {
      const chunk = pids.slice(i, i + BULK_DECISION_CONCURRENCY);
      const outcomes = await Promise.allSettled(
        chunk.map((pid) => decide(pid, propertiesByPid.get(pid)))
      );
      outcomes.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') {
          succeeded++;
        } else {
          const { reason } = outcome;
          failed.push({
            pid: chunk[index],
            error: reason instanceof Error ? reason.message : 'Unknown error',
          });
        }
      });
    }

    await this.propertyCache.invalidatePropertyLists(cuid);
    return { succeeded, failed };
  }
}
