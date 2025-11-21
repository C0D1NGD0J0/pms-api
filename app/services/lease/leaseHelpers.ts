import { ValidationRequestError } from '@shared/customErrors';
import { ILeaseFormData, LeaseStatus } from '@interfaces/lease.interface';
import {
  SIGNATURE_INVALIDATING_LEASE_FIELDS,
  EDITABLE_FIELDS_BY_LEASE_STATUS,
  HIGH_IMPACT_LEASE_FIELDS,
  IMMUTABLE_LEASE_FIELDS,
} from '@utils/constants';

export const validateImmutableFields = (updateData: Partial<ILeaseFormData>): void => {
  const updateFields = Object.keys(updateData);
  const immutableFieldsAttempted = updateFields.filter((field) =>
    IMMUTABLE_LEASE_FIELDS.includes(field)
  );

  if (immutableFieldsAttempted.length > 0) {
    throw new ValidationRequestError({
      message: 'Cannot modify immutable fields',
      errorInfo: {
        fields: immutableFieldsAttempted.map(
          (f) => `Field '${f}' cannot be modified after creation`
        ),
      },
    });
  }
};

export const validateAllowedFields = (
  updateData: Partial<ILeaseFormData>,
  leaseStatus: LeaseStatus
): void => {
  const allowedFields = EDITABLE_FIELDS_BY_LEASE_STATUS[leaseStatus] || [];

  if (allowedFields.includes('*')) {
    return; // All fields allowed
  }

  const updateFields = Object.keys(updateData);
  const disallowedFields = updateFields.filter((field) => !allowedFields.includes(field));

  if (disallowedFields.length > 0) {
    throw new ValidationRequestError({
      message: `Cannot modify fields when lease status is '${leaseStatus}'`,
      errorInfo: {
        fields: disallowedFields.map(
          (f) => `Field '${f}' cannot be modified when lease status is '${leaseStatus}'`
        ),
      },
    });
  }
};

/**
 * Validates both immutable fields and status-specific allowed fields
 */
export const validateUpdatableFields = (
  updateData: Partial<ILeaseFormData>,
  leaseStatus: LeaseStatus
): void => {
  validateImmutableFields(updateData);
  validateAllowedFields(updateData, leaseStatus);
};

/**
 * Check if update contains high-impact fields requiring approval
 */
export const hasHighImpactChanges = (updateData: Partial<ILeaseFormData>): boolean => {
  return hasFieldsInList(updateData, HIGH_IMPACT_LEASE_FIELDS);
};

/**
 * Check if update contains fields that invalidate signatures
 */
export const hasSignatureInvalidatingChanges = (updateData: Partial<ILeaseFormData>): boolean => {
  return hasFieldsInList(updateData, SIGNATURE_INVALIDATING_LEASE_FIELDS);
};

/**
 * Check if any fields in data match the provided field list
 */
export const hasFieldsInList = (data: Partial<ILeaseFormData>, fieldList: string[]): boolean => {
  return Object.keys(data).some((field) => fieldList.includes(field));
};
