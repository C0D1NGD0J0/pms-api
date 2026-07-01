import { t } from '@shared/languages';
import { LeaseDAO } from '@dao/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { ValidationRequestError } from '@shared/customErrors';
import { IPropertyDocument } from '@interfaces/property.interface';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import {
  IMMUTABLE_PROPERTY_FIELDS_WITH_LEASE_HISTORY,
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
 * Departments that should NOT see financial data (fees, financialDetails, metrics).
 * Derived from frontend tab visibility rules.
 */
const FINANCIAL_RESTRICTED_DEPTS = [EmployeeDepartment.SECURITY, EmployeeDepartment.MAINTENANCE];
const DOCUMENTS_ALLOWED_DEPTS = [EmployeeDepartment.OPERATIONS, EmployeeDepartment.MANAGEMENT];

/**
 * Filter property fields based on the requesting user's department.
 * Security: only access/patrol-relevant info.
 * Maintenance: property + unit info, no financials/documents.
 * Accounting: property + financials, no maintenance/documents.
 * Operations/Management: full access.
 */
export const filterPropertyByDepartment = (
  property: IPropertyDocument,
  department?: EmployeeDepartment
): Partial<IPropertyDocument> => {
  if (!department) return property;

  if (department === EmployeeDepartment.SECURITY) {
    return {
      _id: property._id,
      pid: property.pid,
      name: property.name,
      propertyType: property.propertyType,
      operationalStatus: property.operationalStatus,
      occupancyStatus: property.occupancyStatus,
      address: property.address,
      computedLocation: property.computedLocation,
      specifications: property.specifications,
      communityAmenities: property.communityAmenities,
      interiorAmenities: property.interiorAmenities,
      utilities: property.utilities,
      images: property.images,
      maxAllowedUnits: property.maxAllowedUnits,
      ...((property as any).unitInfo && { unitInfo: (property as any).unitInfo }),
      assignedStaff: property.assignedStaff,
      yearBuilt: property.yearBuilt,
      managedBy: property.managedBy,
      cuid: property.cuid,
      createdAt: property.createdAt,
      updatedAt: property.updatedAt,
    };
  }

  const propertyObj = property.toObject ? property.toObject() : { ...property };

  // Strip financials for maintenance
  if (FINANCIAL_RESTRICTED_DEPTS.includes(department)) {
    delete propertyObj.fees;
    delete propertyObj.financialDetails;
  }

  // Strip documents for non-operations/management
  if (!DOCUMENTS_ALLOWED_DEPTS.includes(department)) {
    delete propertyObj.documents;
  }

  return propertyObj;
};

export const isFinancialRestricted = (department?: EmployeeDepartment): boolean =>
  !!department && FINANCIAL_RESTRICTED_DEPTS.includes(department);

export const canViewDocuments = (department?: EmployeeDepartment): boolean =>
  !department || DOCUMENTS_ALLOWED_DEPTS.includes(department);

export const canViewMaintenance = (department?: EmployeeDepartment): boolean =>
  !department ||
  [
    EmployeeDepartment.MAINTENANCE,
    EmployeeDepartment.OPERATIONS,
    EmployeeDepartment.MANAGEMENT,
  ].includes(department);

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
    const hasRentalAmount = existingProperty.fees?.rentAmount || updateData.fees?.rentAmount;
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

/**
 * Throws if any update fields are structurally immutable due to non-draft lease history.
 * Applies to ALL roles — no admin bypass — because these fields appear on legal lease documents.
 *
 * Early-exits with no DB call when the payload contains no locked fields.
 */
export const validatePropertyLeaseImmutableFields = async (
  property: IPropertyDocument,
  cuid: string,
  updateData: Partial<IPropertyDocument>,
  leaseDAO: LeaseDAO
): Promise<void> => {
  const lockedFieldsAttempted = Object.keys(updateData).filter((f) =>
    (IMMUTABLE_PROPERTY_FIELDS_WITH_LEASE_HISTORY as readonly string[]).includes(f)
  );

  if (lockedFieldsAttempted.length === 0) return;

  const hasLeaseHistory = await leaseDAO.hasNonDraftLeaseForProperty(property._id.toString(), cuid);

  if (hasLeaseHistory) {
    throw new ValidationRequestError({
      message: 'Cannot modify structural fields on a property with active or historical leases',
      errorInfo: {
        fields: lockedFieldsAttempted.map(
          (f) => `'${f}' is locked — this property has or has had a non-draft lease`
        ),
      },
    });
  }
};
