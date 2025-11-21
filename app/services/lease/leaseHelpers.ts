import { ValidationRequestError } from '@shared/customErrors';
import { IUserRole } from '@shared/constants/roles.constants';
import {
  ILeasePreviewRequest,
  ILeaseDocument,
  ILeaseFormData,
  LeaseStatus,
} from '@interfaces/lease.interface';
import {
  SIGNATURE_INVALIDATING_LEASE_FIELDS,
  EDITABLE_FIELDS_BY_LEASE_STATUS,
  HIGH_IMPACT_LEASE_FIELDS,
  IMMUTABLE_LEASE_FIELDS,
  convertUserRoleToEnum,
  MoneyUtils,
} from '@utils/index';

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

/**
 * Calculate financial summary for a lease
 */
export const calculateFinancialSummary = (lease: ILeaseDocument): any => {
  const totalMonthlyRent = (lease as any).totalMonthlyFees || lease.fees.monthlyRent;
  const petMonthlyFee = lease.petPolicy?.monthlyFee || 0;
  const securityDeposit = lease.fees.securityDeposit;

  const now = new Date();
  const startDate = new Date(lease.duration.startDate);
  const monthsElapsed = Math.max(
    0,
    Math.floor((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24 * 30))
  );

  return {
    monthlyRent: MoneyUtils.formatCurrency(totalMonthlyRent, lease.fees.currency || 'USD'),
    monthlyRentRaw: totalMonthlyRent,
    petFee:
      petMonthlyFee > 0
        ? MoneyUtils.formatCurrency(petMonthlyFee, lease.fees.currency || 'USD')
        : undefined,
    petFeeRaw: petMonthlyFee,
    securityDeposit: MoneyUtils.formatCurrency(securityDeposit, lease.fees.currency || 'USD'),
    securityDepositRaw: securityDeposit,
    currency: lease.fees.currency || 'USD',
    rentDueDay: lease.fees.rentDueDay,
    lateFeeAmount: lease.fees.lateFeeAmount,
    lateFeeDays: lease.fees.lateFeeDays,
    lateFeeType: lease.fees.lateFeeType,
    acceptedPaymentMethod: lease.fees.acceptedPaymentMethod,
    totalExpected: totalMonthlyRent * monthsElapsed,
    totalPaid: 0,
    totalOwed: 0,
    lastPaymentDate: null,
    nextPaymentDate: calculateNextPaymentDate(lease.fees.rentDueDay),
  };
};

/**
 * Calculate next payment date based on rent due day
 */
export const calculateNextPaymentDate = (rentDueDay: number): Date => {
  const now = new Date();
  const nextPayment = new Date(now.getFullYear(), now.getMonth(), rentDueDay);

  if (nextPayment < now) {
    nextPayment.setMonth(nextPayment.getMonth() + 1);
  }

  return nextPayment;
};

/**
 * Get user permissions for a lease based on role
 */
export const getUserPermissions = (lease: ILeaseDocument, user: any): any => {
  const role = convertUserRoleToEnum(user.client.role);

  const isAdmin = role === IUserRole.ADMIN;
  const isManager = role === IUserRole.MANAGER;
  const isStaff = role === IUserRole.STAFF;

  return {
    canEdit: isAdmin || isManager,
    canDelete: isAdmin,
    canTerminate: isAdmin || isManager,
    canActivate: isAdmin || isManager,
    canDownload: true,
    canViewDocuments: true,
    canUploadDocuments: isAdmin || isManager || isStaff,
    canViewActivity: isAdmin || isManager || isStaff,
    canViewFinancials: true,
    canManageSignatures: isAdmin || isManager,
    canGeneratePDF: true,
  };
};

export const buildLeaseTimeline = (lease: ILeaseDocument): any => {
  const now = new Date();
  const startDate = new Date(lease.duration.startDate);
  const endDate = new Date(lease.duration.endDate);

  const daysRemaining = Math.max(
    0,
    Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  );
  const daysElapsed = Math.max(
    0,
    Math.ceil((now.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
  );

  return {
    created: lease.createdAt,
    signed: lease.signedDate,
    startDate: lease.duration.startDate,
    endDate: lease.duration.endDate,
    moveInDate: lease.duration.moveInDate,
    daysRemaining,
    daysElapsed,
    isActive: lease.status === LeaseStatus.ACTIVE,
    isExpiringSoon: daysRemaining > 0 && daysRemaining <= 60,
    progress: (daysElapsed / (daysElapsed + daysRemaining)) * 100,
  };
};

export const filterDocumentsByRole = (documents: any[], role: IUserRole): any[] => {
  if (role === IUserRole.ADMIN || role === IUserRole.MANAGER || role === IUserRole.STAFF) {
    return documents;
  }

  return documents.filter((doc) => !doc.isInternal);
};

export const constructActivityFeed = (lease: ILeaseDocument): any[] => {
  const activities: any[] = [];

  activities.push({
    type: 'created',
    description: 'Lease created',
    timestamp: lease.createdAt,
    user: lease.createdBy,
  });

  if (lease.lastModifiedBy && lease.lastModifiedBy.length > 0) {
    lease.lastModifiedBy.forEach((mod) => {
      activities.push({
        type: mod.action,
        description: `Lease ${mod.action}`,
        timestamp: mod.date,
        user: mod.userId,
        userName: mod.name,
      });
    });
  }

  if (lease.approvalDetails && lease.approvalDetails.length > 0) {
    lease.approvalDetails.forEach((approval) => {
      const description =
        approval.action === 'rejected' && approval.rejectionReason
          ? `Lease ${approval.action}: ${approval.rejectionReason}`
          : `Lease ${approval.action}`;

      activities.push({
        type: approval.action,
        description,
        timestamp: approval.timestamp,
        user: approval.actor,
        notes: approval.notes,
        rejectionReason: approval.rejectionReason,
        metadata: approval.metadata,
      });
    });
  }

  if (lease.signatures && lease.signatures.length > 0) {
    lease.signatures.forEach((signature) => {
      activities.push({
        type: 'signed',
        description: `Lease signed by ${signature.role}`,
        timestamp: signature.signedAt,
        user: signature.userId,
        role: signature.role,
        signatureMethod: signature.signatureMethod,
      });
    });
  }

  if (lease.signedDate && (!lease.signatures || lease.signatures.length === 0)) {
    activities.push({
      type: 'signed',
      description: 'Lease signed by all parties',
      timestamp: lease.signedDate,
    });
  }

  if (lease.status === LeaseStatus.TERMINATED && lease.duration.terminationDate) {
    activities.push({
      type: 'terminated',
      description: lease.terminationReason
        ? `Lease terminated: ${lease.terminationReason}`
        : 'Lease terminated',
      timestamp: lease.duration.terminationDate,
    });
  }

  return activities.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
};

export const mapPropertyTypeToTemplate = (
  propertyType: string
): ILeasePreviewRequest['templateType'] => {
  const mapping: Record<string, ILeasePreviewRequest['templateType']> = {
    single_family: 'residential-single-family',
    apartment: 'residential-apartment',
    condo: 'residential-apartment',
    townhouse: 'residential-single-family',
    office: 'commercial-office',
    retail: 'commercial-retail',
    short_term: 'short-term-rental',
  };
  return mapping[propertyType] || 'residential-single-family';
};
