import { Types } from 'mongoose';
import { t } from '@shared/languages';
import { MediaUploadService } from '@services/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { IUserRole } from '@shared/constants/roles.constants';
import { IProfileDocument } from '@interfaces/profile.interface';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, LeaseDAO } from '@dao/index';
import { ISuccessReturnData, IRequestContext } from '@interfaces/utils.interface';
import { IPropertyUnitDocument, IPropertyDocument, IProfileWithUser } from '@interfaces/index';
import {
  ValidationRequestError,
  InvalidRequestError,
  BadRequestError,
  ForbiddenError,
} from '@shared/customErrors';
import {
  ILeaseESignatureStatusEnum,
  ILeasePreviewRequest,
  ILeaseDocument,
  ILeaseFormData,
  LeaseStatus,
} from '@interfaces/lease.interface';
import {
  SIGNATURE_INVALIDATING_LEASE_FIELDS,
  EDITABLE_FIELDS_BY_LEASE_STATUS,
  HIGH_IMPACT_LEASE_FIELDS,
  PROPERTY_APPROVAL_ROLES,
  IMMUTABLE_LEASE_FIELDS,
  convertUserRoleToEnum,
  createSafeMongoUpdate,
  PROPERTY_STAFF_ROLES,
  MoneyUtils,
} from '@utils/index';

// ====================================================================
// SECTION 1: FIELD VALIDATION
// ====================================================================

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
 * Validate lease status transitions
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

// ====================================================================
// SECTION 2: PERMISSION & RESOURCE VALIDATION
// ====================================================================

interface LeaseDAOInterface {
  update: (filter: any, update: any, options?: any) => Promise<ILeaseDocument | null>;
}

interface LeaseCacheInterface {
  invalidateLease: (cuid: string, luid: string) => Promise<ISuccessReturnData>;
}

interface ProfileDAOInterface {
  findFirst: (filter: any, options?: any) => Promise<IProfileDocument | null>;
}

export async function validateLeasePdfExists(
  lease: ILeaseDocument,
  mediaUploadService: MediaUploadService
): Promise<Buffer> {
  const leasePDF = lease.leaseDocuments?.find(
    (doc) => doc.documentType === 'lease_agreement' && doc.status === 'active'
  );

  if (!leasePDF || !leasePDF.key) {
    throw new ValidationRequestError({
      message: 'Lease PDF must be uploaded before sending for signature',
    });
  }

  const pdfBuffer = await mediaUploadService.downloadFileAsBuffer(leasePDF.key);
  if (!pdfBuffer) {
    throw new ValidationRequestError({
      message: 'Lease PDF must be generated before sending for signature',
    });
  }

  return pdfBuffer;
}

export function validateLeaseReadyForSignature(lease: ILeaseDocument): void {
  // Check lease status
  if (![LeaseStatus.PENDING_SIGNATURE, LeaseStatus.DRAFT].includes(lease.status)) {
    throw new ValidationRequestError({
      message: 'Lease must be in DRAFT or PENDING_SIGNATURE state to send for signature',
    });
  }

  // Check if already sent
  if (
    lease.eSignature?.status === ILeaseESignatureStatusEnum.SENT &&
    lease.eSignature?.envelopeId
  ) {
    throw new ValidationRequestError({
      message: 'Lease has already been sent for signatures',
    });
  }
}

export function validateResourceAvailable(
  resource: IPropertyDocument | IPropertyUnitDocument,
  resourceType: 'property' | 'unit'
): void {
  if (resource.status !== 'available') {
    throw new BadRequestError({
      message: `Cannot send lease for signatures, as the selected ${resourceType} is not available.`,
    });
  }
}

export function validateUserRole(
  user: any,
  allowedRoles: readonly string[],
  operation: string = 'perform this action'
): void {
  const userRole = convertUserRoleToEnum(user.client.role);
  if (!allowedRoles.includes(userRole)) {
    throw new ForbiddenError({ message: `You are not authorized to ${operation}.` });
  }
}

export function validateLeaseNotPendingSignature(lease: ILeaseDocument): void {
  if (lease.status === LeaseStatus.PENDING_SIGNATURE) {
    throw new ValidationRequestError({
      message: 'Cannot edit lease while pending signature. Withdraw it first.',
    });
  }
}

export function validateLeasePermissions(user: any, operation: string = 'update leases'): void {
  validateUserRole(user, [...PROPERTY_STAFF_ROLES, ...PROPERTY_APPROVAL_ROLES], operation);
}

// ====================================================================
// SECTION 3: UPDATE HANDLERS
// ====================================================================

export function validatePropertyApprovalRole(user: any): void {
  validateUserRole(user, PROPERTY_APPROVAL_ROLES, 'perform this action');
}

export function validatePropertyAvailable(property: IPropertyDocument): void {
  validateResourceAvailable(property, 'property');
}

export function validatePropertyUnitAvailable(unit: IPropertyUnitDocument): void {
  validateResourceAvailable(unit, 'unit');
}

/**
 * Handle update for DRAFT lease
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
 */
export const applyDirectUpdateWithOverride = async (
  lease: ILeaseDocument,
  updateData: Partial<ILeaseFormData>,
  userId: string,
  leaseDAO: LeaseDAOInterface
): Promise<ILeaseDocument> => {
  const sanitizedData = sanitizeUpdateData(updateData);
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

  return updated;
};

/**
 * Store pending changes for approval workflow
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

// ====================================================================
// SECTION 4: TRANSFORMERS
// ====================================================================

/**
 * Filter lease data based on user role
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

// ====================================================================
// SECTION 5: DATA FETCHERS
// ====================================================================

/**
 * Fetch property manager with populated user and validate email exists
 */
export async function fetchPropertyManagerWithUser(
  profileDAO: ProfileDAO,
  managedById: Types.ObjectId | string
): Promise<IProfileWithUser> {
  const propertyManager = await profileDAO.findFirst(
    { user: new Types.ObjectId(managedById) },
    { populate: 'user' }
  );

  if (!propertyManager || !propertyManager.user) {
    throw new BadRequestError({ message: 'Property manager information not found' });
  }

  const pmUser = typeof propertyManager.user === 'object' ? propertyManager.user : null;
  if (!pmUser || !(pmUser as any)?.email) {
    throw new BadRequestError({ message: 'Property manager email not found' });
  }

  return propertyManager as unknown as IProfileWithUser;
}

/**
 * Fetch property with owner/authorization and validate management authorization
 */
export async function fetchPropertyWithAuthorization(
  propertyDAO: PropertyDAO,
  propertyId: string,
  cuid: string,
  options?: { populate?: any[] }
): Promise<IPropertyDocument> {
  const property = await propertyDAO.findFirst(
    { _id: new Types.ObjectId(propertyId), cuid, deletedAt: null },
    { select: '+owner +authorization', ...options }
  );

  if (!property) {
    throw new BadRequestError({ message: 'Property not found' });
  }

  if (!property.isManagementAuthorized()) {
    throw new BadRequestError({
      message: 'Property has not been authorized for management.',
    });
  }

  return property;
}

/**
 * Fetch tenant with populated user and validate email exists
 */
export async function fetchTenantWithUser(
  profileDAO: ProfileDAO,
  tenantId: Types.ObjectId | string
): Promise<IProfileWithUser> {
  const tenant = await profileDAO.findFirst(
    { user: new Types.ObjectId(tenantId) },
    { populate: 'user' }
  );

  if (!tenant || !tenant.user) {
    throw new BadRequestError({ message: 'Tenant information not found' });
  }

  const tenantUser = typeof tenant.user === 'object' ? tenant.user : null;
  if (!tenantUser || !(tenantUser as any).email) {
    throw new BadRequestError({ message: 'Tenant email not found' });
  }

  return tenant as unknown as IProfileWithUser;
}

/**
 * Fetch and validate property unit exists
 */
export async function fetchPropertyUnit(
  propertyUnitDAO: PropertyUnitDAO,
  unitId: string,
  propertyId?: Types.ObjectId,
  cuid?: string
): Promise<IPropertyUnitDocument> {
  const query: any = { _id: unitId };
  if (propertyId) query.propertyId = propertyId;
  if (cuid) query.cuid = cuid;

  const unit = await propertyUnitDAO.findFirst(query);

  if (!unit) {
    throw new BadRequestError({
      message: 'Property unit not found, unable to proceed with sending lease for signature.',
    });
  }

  return unit;
}

/**
 * Fetch lease by LUID and CUID with optional population
 */
export async function fetchLeaseByLuid(
  leaseDAO: LeaseDAO,
  luid: string,
  cuid: string,
  options?: { populate?: string[] }
): Promise<ILeaseDocument> {
  const lease = await leaseDAO.findFirst({ luid, cuid, deletedAt: null }, options);

  if (!lease) {
    throw new BadRequestError({ message: t('lease.errors.leaseNotFound') });
  }

  return lease;
}

// ====================================================================
// SECTION 6: CALCULATIONS & HELPERS
// ====================================================================

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
