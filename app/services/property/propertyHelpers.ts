import { t } from '@shared/languages';
import { ICurrentUser } from '@interfaces/user.interface';
import { ValidationRequestError } from '@shared/customErrors';
import { IPropertyDocument } from '@interfaces/property.interface';
import {
  PROPERTY_APPROVAL_ROLES,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  MoneyUtils,
} from '@utils/index';

/**
 * Get the original requester ID from approval details
 */
export const getOriginalRequesterId = (approvalDetails: any[]): string | undefined => {
  if (!Array.isArray(approvalDetails) || approvalDetails.length === 0) {
    return undefined;
  }

  // Find the first 'created' action which contains the original requester
  const createdEntry = approvalDetails.find((entry) => entry.action === 'created');
  return createdEntry?.actor?.toString();
};

/**
 * Check if pending changes should be shown to the current user
 */
export const shouldShowPendingChanges = (
  currentUser: ICurrentUser,
  property: IPropertyDocument
): boolean => {
  if (!property.pendingChanges) {
    return false;
  }

  const userRole = currentUser.client.role;

  // Admin/managers can see all pending changes
  if (PROPERTY_APPROVAL_ROLES.includes(convertUserRoleToEnum(userRole))) {
    return true;
  }

  // Staff can only see their own pending changes
  if (PROPERTY_STAFF_ROLES.includes(convertUserRoleToEnum(userRole))) {
    const pendingChanges = property.pendingChanges as any;
    return pendingChanges.updatedBy?.toString() === currentUser.sub;
  }

  return false;
};

/**
 * Generate a summary string for changed fields
 */
export const generateChangesSummary = (updatedFields: string[]): string => {
  if (updatedFields.length === 0) return 'No changes';

  const fieldNames = updatedFields.map((field) => {
    // Convert camelCase and nested fields to readable names
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
 * Generate a preview of pending changes
 */
export const generatePendingChangesPreview = (
  property: IPropertyDocument,
  currentUser: ICurrentUser
): any => {
  if (!property.pendingChanges || !shouldShowPendingChanges(currentUser, property)) {
    return undefined;
  }

  const pendingChanges = property.pendingChanges as any;
  const { updatedBy, updatedAt, ...changes } = pendingChanges;

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
    summary,
    changes: formattedChanges,
  };
};

/**
 * Validate occupancy status changes
 */
export const validateOccupancyStatusChange = (
  existingProperty: IPropertyDocument,
  updateData: Partial<IPropertyDocument>
): void => {
  const errors: string[] = [];

  if (
    updateData.occupancyStatus === 'occupied' &&
    existingProperty.occupancyStatus !== 'occupied'
  ) {
    // Check if rental amount is set
    const hasRentalAmount = existingProperty.fees?.rentalAmount || updateData.fees?.rentalAmount;
    if (!hasRentalAmount) {
      errors.push('Occupied properties must have a rental amount');
    }
  }

  if (updateData.occupancyStatus === 'partially_occupied') {
    const maxAllowedUnits = updateData.maxAllowedUnits || existingProperty.maxAllowedUnits || 1;
    if (maxAllowedUnits <= 1) {
      errors.push('Single-unit properties cannot be partially occupied');
    }
  }

  if (errors.length > 0) {
    throw new ValidationRequestError({
      message: t('property.errors.occupancyValidationFailed'),
      errorInfo: { occupancyStatus: errors },
    });
  }
};
