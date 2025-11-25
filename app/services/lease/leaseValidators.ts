import { ValidationRequestError, InvalidRequestError } from '@shared/customErrors';
import { ILeaseDocument, ILeaseFormData, LeaseStatus } from '@interfaces/lease.interface';

/**
 * Validate lease status transitions
 * Extracted from LeaseService to reduce file size
 */
export const validateStatusTransition = (
  currentStatus: LeaseStatus,
  newStatus: LeaseStatus
): void => {
  const allowedTransitions: Record<LeaseStatus, LeaseStatus[]> = {
    [LeaseStatus.DRAFT]: [LeaseStatus.PENDING_SIGNATURE, LeaseStatus.ACTIVE, LeaseStatus.CANCELLED],
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
};

/**
 * Validate lease update against business rules
 * Extracted from LeaseService to reduce file size
 */
export const validateLeaseUpdate = (
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>
): void => {
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
};

/**
 * Enforce approval requirement for certain operations
 * Extracted from LeaseService to reduce file size
 */
export const enforceLeaseApprovalRequirement = (lease: ILeaseDocument, operation: string): void => {
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
};
