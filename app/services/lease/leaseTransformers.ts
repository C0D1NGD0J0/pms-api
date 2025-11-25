import { ICurrentUser } from '@interfaces/user.interface';
import { IUserRole } from '@shared/constants/roles.constants';
import { ILeaseDocument, ILeaseFormData } from '@interfaces/lease.interface';
import {
  PROPERTY_APPROVAL_ROLES,
  createSafeMongoUpdate,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  MoneyUtils,
} from '@utils/index';

/**
 * Filter lease data based on user role
 * Extracted from LeaseService to reduce file size
 */
export const filterLeaseByRole = (
  lease: ILeaseDocument,
  userId: string,
  role: IUserRole
): Partial<ILeaseDocument> => {
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
};

/**
 * Sanitize update data by converting empty strings to undefined for optional ObjectId fields
 * and returns a safe mongo update object e.g. { 'property.unitId': 101 }
 * This prevents MongoDB from trying to cast empty strings to ObjectId
 * Setting to undefined allows Mongoose to unset the field in the database
 */
export const sanitizeUpdateData = (
  updateData: Partial<ILeaseFormData>
): Partial<ILeaseFormData> => {
  const sanitized = { ...updateData };

  // Handle property.unitId - convert empty string to undefined to explicitly unset it
  if (sanitized.property?.unitId === '' || sanitized.property?.unitId === null) {
    sanitized.property.unitId = undefined;
  }

  return createSafeMongoUpdate(sanitized);
};

/**
 * Generate a summary of changes made to a lease
 * Extracted from LeaseService to reduce file size
 */
export const generateChangesSummary = (updatedFields: string[]): string => {
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
};

/**
 * Generate preview of pending changes for a lease
 * Extracted from LeaseService to reduce file size
 */
export const generatePendingChangesPreview = (
  lease: ILeaseDocument,
  currentUser: ICurrentUser
): any => {
  if (!lease.pendingChanges || !shouldShowPendingChanges(currentUser, lease)) {
    return undefined;
  }

  const pendingChanges = lease.pendingChanges as any;
  const { updatedBy, updatedAt, displayName, ...changes } = pendingChanges;

  const formattedChanges = { ...changes };
  if (formattedChanges.fees) {
    formattedChanges.fees = MoneyUtils.formatMoneyDisplay(formattedChanges.fees);
  }

  const updatedFields = Object.keys(changes);
  const summary = generateChangesSummary(updatedFields);

  return {
    updatedFields,
    updatedAt,
    updatedBy,
    displayName,
    summary,
    changes: formattedChanges,
  };
};

/**
 * Determine if pending changes should be shown to the current user
 * Extracted from LeaseService to reduce file size
 */
export const shouldShowPendingChanges = (
  currentUser: ICurrentUser,
  lease: ILeaseDocument
): boolean => {
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
};
