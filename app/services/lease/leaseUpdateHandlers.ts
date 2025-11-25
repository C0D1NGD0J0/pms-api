import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { BadRequestError } from '@shared/customErrors';
import { ICurrentUser } from '@interfaces/user.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { ISuccessReturnData, IRequestContext } from '@interfaces/utils.interface';
import { ILeaseDocument, ILeaseFormData, LeaseStatus } from '@interfaces/lease.interface';
import {
  PROPERTY_APPROVAL_ROLES,
  convertUserRoleToEnum,
  createSafeMongoUpdate,
} from '@utils/index';

import { sanitizeUpdateData } from './leaseTransformers';
import {
  hasSignatureInvalidatingChanges,
  validateAllowedFields,
  hasHighImpactChanges,
} from './leaseHelpers';

interface LeaseDAOInterface {
  update: (filter: any, update: any, options?: any) => Promise<ILeaseDocument | null>;
}

interface LeaseCacheInterface {
  invalidateLease: (cuid: string, luid: string) => Promise<ISuccessReturnData>;
}

interface ProfileDAOInterface {
  findFirst: (filter: any, options?: any) => Promise<IProfileDocument | null>;
}

/**
 * Handle update for DRAFT lease
 * Extracted from LeaseService to reduce file size
 */
export const handleDraftUpdate = async (
  cxt: IRequestContext,
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  currentUser: ICurrentUser,
  leaseDAO: LeaseDAOInterface,
  profileDAO: ProfileDAOInterface,
  leaseCache: LeaseCacheInterface
): Promise<ISuccessReturnData<any>> => {
  validateAllowedFields(updateData, LeaseStatus.DRAFT);

  const userRole = convertUserRoleToEnum(currentUser.client.role);
  const isApprovalRole = PROPERTY_APPROVAL_ROLES.includes(userRole);
  const hasHighImpact = hasHighImpactChanges(updateData);

  let updatedLease: ILeaseDocument;
  let requiresApproval = false;

  if (isApprovalRole) {
    // Admin/Manager: Direct update without approval
    updatedLease = await applyDirectUpdate(lease, updateData, currentUser.sub, leaseDAO);
  } else {
    // Staff: Check if high-impact changes require approval
    if (hasHighImpact) {
      updatedLease = await storePendingChanges(
        lease,
        updateData,
        currentUser,
        leaseDAO,
        profileDAO
      );
      requiresApproval = true;
    } else {
      updatedLease = await applyDirectUpdate(lease, updateData, currentUser.sub, leaseDAO);
    }
  }

  const { cuid } = cxt.request.params;
  await leaseCache.invalidateLease(cuid, lease.luid);

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
};

/**
 * Handle update for PENDING_SIGNATURE lease
 * Extracted from LeaseService to reduce file size
 */
export const handlePendingSignatureUpdate = async (
  cxt: IRequestContext,
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  currentUser: ICurrentUser,
  isApprovalRole: boolean,
  leaseDAO: LeaseDAOInterface,
  leaseCache: LeaseCacheInterface
): Promise<ISuccessReturnData<any>> => {
  if (!isApprovalRole) {
    throw new BadRequestError({
      message: 'Only administrators can modify leases pending signature',
    });
  }

  const hasSignatureInvalidating = hasSignatureInvalidatingChanges(updateData);
  if (hasSignatureInvalidating) {
    throw new BadRequestError({
      message: 'Cannot modify lease fields that invalidate signatures while pending signature',
    });
  }

  const updatedLease = await applyDirectUpdate(lease, updateData, currentUser.sub, leaseDAO);

  const { cuid } = cxt.request.params;
  await leaseCache.invalidateLease(cuid, lease.luid);

  return {
    success: true,
    message: t('lease.updatedSuccessfully'),
    data: { lease: updatedLease },
  };
};

/**
 * Handle update for ACTIVE lease
 * Extracted from LeaseService to reduce file size
 */
export const handleActiveUpdate = async (
  cxt: IRequestContext,
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  currentUser: ICurrentUser,
  isApprovalRole: boolean,
  leaseDAO: LeaseDAOInterface,
  profileDAO: ProfileDAOInterface,
  leaseCache: LeaseCacheInterface
): Promise<ISuccessReturnData<any>> => {
  const hasHighImpact = hasHighImpactChanges(updateData);
  let updatedLease: ILeaseDocument;
  let requiresApproval = false;

  if (isApprovalRole) {
    if (lease.pendingChanges && lease.pendingChanges.updatedBy !== currentUser.sub) {
      updatedLease = await applyDirectUpdateWithOverride(
        lease,
        updateData,
        currentUser.sub,
        leaseDAO
      );
    } else {
      updatedLease = await applyDirectUpdate(lease, updateData, currentUser.sub, leaseDAO);
    }
  } else {
    if (lease.pendingChanges && lease.pendingChanges.updatedBy !== currentUser.sub) {
      throw new BadRequestError({
        message: 'Another staff member has pending changes for this lease',
      });
    }

    if (hasHighImpact) {
      updatedLease = await storePendingChanges(
        lease,
        updateData,
        currentUser,
        leaseDAO,
        profileDAO
      );
      requiresApproval = true;
    } else {
      updatedLease = await applyDirectUpdate(lease, updateData, currentUser.sub, leaseDAO);
    }
  }

  const { cuid } = cxt.request.params;
  await leaseCache.invalidateLease(cuid, lease.luid);

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
};

/**
 * Handle update for closed status leases (TERMINATED, CANCELLED, EXPIRED)
 * Extracted from LeaseService to reduce file size
 */
export const handleClosedStatusUpdate = async (
  cxt: IRequestContext,
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  currentUser: ICurrentUser,
  isApprovalRole: boolean,
  leaseDAO: LeaseDAOInterface,
  leaseCache: LeaseCacheInterface
): Promise<ISuccessReturnData<any>> => {
  if (!isApprovalRole) {
    throw new BadRequestError({
      message: `Cannot update lease with status: ${lease.status}. Contact an administrator.`,
    });
  }

  const updatedLease = await applyDirectUpdate(lease, updateData, currentUser.sub, leaseDAO);

  const { cuid } = cxt.request.params;
  await leaseCache.invalidateLease(cuid, lease.luid);

  return {
    success: true,
    message: t('lease.updatedSuccessfully'),
    data: { lease: updatedLease },
  };
};

/**
 * Apply direct update to lease without approval workflow
 * Extracted from LeaseService to reduce file size
 */
export const applyDirectUpdate = async (
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  userId: string,
  leaseDAO: LeaseDAOInterface
): Promise<ILeaseDocument> => {
  // Sanitize empty strings and null values for nested ObjectId fields
  const sanitizedData = sanitizeUpdateData(updateData);

  // Use safe mongo update to prevent nested object overwrites
  const safeUpdateData = createSafeMongoUpdate(sanitizedData);

  const modificationEvent = {
    type: 'modified',
    date: new Date(),
    performedBy: userId,
    changes: Object.keys(sanitizedData),
  };

  const updated = await leaseDAO.update(
    { _id: new Types.ObjectId(lease._id) },
    {
      $set: {
        ...safeUpdateData,
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
};

/**
 * Apply direct update with override of pending changes
 * Used when admin overrides staff pending changes
 * Extracted from LeaseService to reduce file size
 */
export const applyDirectUpdateWithOverride = async (
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  userId: string,
  leaseDAO: LeaseDAOInterface
): Promise<ILeaseDocument> => {
  // Admin overriding staff pending changes
  const overriddenUserId = lease.pendingChanges?.updatedBy;

  // Sanitize empty strings and null values for nested ObjectId fields
  const sanitizedData = sanitizeUpdateData(updateData);

  // Use safe mongo update to prevent nested object overwrites
  const safeUpdateData = createSafeMongoUpdate(sanitizedData);

  const modificationEvent = {
    type: 'modified',
    date: new Date(),
    performedBy: userId,
    changes: Object.keys(sanitizedData),
  };

  const updated = await leaseDAO.update(
    { _id: lease._id },
    {
      $set: {
        ...safeUpdateData,
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
  console.log(
    `Admin ${userId} overrode pending changes from ${overriddenUserId} for lease ${lease.luid}`
  );

  return updated;
};

/**
 * Store pending changes for approval workflow
 * Used when staff makes high-impact changes
 * Extracted from LeaseService to reduce file size
 */
export const storePendingChanges = async (
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  currentUser: ICurrentUser,
  leaseDAO: LeaseDAOInterface,
  profileDAO: ProfileDAOInterface
): Promise<ILeaseDocument> => {
  const profileData = await profileDAO.findFirst(
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

  const updated = await leaseDAO.update(
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
};
