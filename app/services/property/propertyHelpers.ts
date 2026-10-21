import { t } from '@shared/languages';
import { LeaseDAO, UserDAO } from '@dao/index';
import { type QueryFilter, Types } from 'mongoose';
import { ICurrentUser } from '@interfaces/user.interface';
import type { MediaUploadService } from '@services/mediaUpload';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import type { PermissionService } from '@services/permission/permission.service';
import { IPropertyDocument, IPendingChanges } from '@interfaces/property.interface';
import { PermissionResource, PermissionAction, PermissionScope } from '@interfaces/utils.interface';
import {
  IMMUTABLE_PROPERTY_FIELDS_WITH_LEASE_HISTORY,
  PROPERTY_APPROVAL_ROLES,
  convertUserRoleToEnum,
  PROPERTY_STAFF_ROLES,
  MoneyUtils,
} from '@utils/index';

/**
 * Drops media entries that only describe a file uploaded in this request
 * (e.g. { documentType } for a multipart document). Those files are attached by
 * the upload worker once stored, so persisting the descriptor would leave an
 * empty media entry behind.
 */
export const withoutPendingUploads = <T extends { url?: string; externalUrl?: string }>(
  media: T[]
): T[] => media.filter((item) => item.url || item.externalUrl);

/**
 * Soft-delete (or hard-delete) the assets for any images / documents that an
 * applied property update removed. Only media arrays present in `applied` are
 * compared — an absent array means that list wasn't touched.
 */
export const cleanUpRemovedPropertyMedia = async (
  mediaUploadService: MediaUploadService,
  previous: Pick<IPropertyDocument, 'images' | 'documents'>,
  applied: Partial<Pick<IPropertyDocument, 'images' | 'documents'>>,
  actorId: string,
  hardDelete = false
): Promise<void> => {
  const tasks: Promise<void>[] = [];
  if (applied.images !== undefined) {
    tasks.push(
      mediaUploadService.handleMediaDeletion(
        (previous.images || []) as any[],
        applied.images as any[],
        actorId,
        hardDelete
      )
    );
  }
  if (applied.documents !== undefined) {
    tasks.push(
      mediaUploadService.handleMediaDeletion(
        (previous.documents || []) as any[],
        applied.documents as any[],
        actorId,
        hardDelete
      )
    );
  }
  await Promise.all(tasks);
};

/**
 * The property-access rule shared by property lists and property detail: null when
 * the user holds `property list:any`, otherwise only properties they're assigned to or manage.
 */
export const getAccessiblePropertyFilter = async (
  permissionService: PermissionService,
  currentuser: ICurrentUser
): Promise<QueryFilter<IPropertyDocument> | null> => {
  const { granted } = await permissionService.checkUserPermission(
    currentuser,
    PermissionResource.PROPERTY,
    PermissionAction.LIST
  );
  // A staff grant can be narrower (list:assigned) and still be granted
  const staffScope = permissionService.resolveStaffScope(
    currentuser,
    PermissionResource.PROPERTY,
    PermissionAction.LIST
  );
  if (granted && (!staffScope || staffScope === PermissionScope.ANY)) return null;

  return getAssignedPropertyFilter(currentuser.sub);
};

/** Properties the user is assigned to or manages. */
export const getAssignedPropertyFilter = (userId: string): QueryFilter<IPropertyDocument> => {
  const id = new Types.ObjectId(userId);
  return { $or: [{ assignedStaff: id }, { managedBy: id }] };
};

/** Throws `message` unless every id is a user connected to the client (with one of `roles`). */
export const assertConnectedEmployees = async (
  userDAO: UserDAO,
  cuid: string,
  userIds: string[],
  message: string,
  roles?: readonly string[]
): Promise<void> => {
  const uniqueIds = [...new Set(userIds)];
  if (uniqueIds.length === 0) return;

  const connectedCount = await userDAO.countDocuments({
    _id: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) },
    deletedAt: null,
    cuids: {
      $elemMatch: { cuid, isConnected: true, ...(roles && { roles: { $in: [...roles] } }) },
    },
  });
  if (connectedCount !== uniqueIds.length) throw new BadRequestError({ message });
};

/**
 * Maps public user uids to internal ObjectIds, keeping only users connected to the client
 * (with one of `roles`). Uids that are unknown or belong to another client are left out.
 */
export const getUserIdsByUid = async (
  userDAO: UserDAO,
  cuid: string,
  uids: string[],
  roles?: readonly string[]
): Promise<Map<string, Types.ObjectId>> => {
  const uniqueUids = [...new Set(uids.filter(Boolean))];
  const idsByUid = new Map<string, Types.ObjectId>();
  if (uniqueUids.length === 0) return idsByUid;

  const users = await userDAO.list(
    {
      uid: { $in: uniqueUids },
      deletedAt: null,
      cuids: {
        $elemMatch: { cuid, isConnected: true, ...(roles && { roles: { $in: [...roles] } }) },
      },
    },
    { projection: 'uid', limit: uniqueUids.length }
  );
  for (const user of users.items) idsByUid.set(user.uid, user._id as Types.ObjectId);
  return idsByUid;
};

/**
 * Resolves public user uids to their internal ObjectIds. Throws `message` unless every uid is a
 * user connected to the client (with one of `roles`), so a uid from another client is rejected.
 */
export const resolveConnectedUserIds = async (
  userDAO: UserDAO,
  cuid: string,
  uids: string[],
  message: string,
  roles?: readonly string[]
): Promise<Map<string, Types.ObjectId>> => {
  const idsByUid = await getUserIdsByUid(userDAO, cuid, uids, roles);
  if (idsByUid.size !== new Set(uids.filter(Boolean)).size) {
    throw new BadRequestError({ message });
  }
  return idsByUid;
};

/** Resolves one user uid to its ObjectId — see resolveConnectedUserIds. */
export const resolveConnectedUserId = async (
  userDAO: UserDAO,
  cuid: string,
  uid: string,
  message: string,
  roles?: readonly string[]
): Promise<Types.ObjectId> => {
  const idsByUid = await resolveConnectedUserIds(userDAO, cuid, [uid], message, roles);
  return idsByUid.get(uid)!;
};

/** Maps user ObjectIds to their public uids for responses; unknown ids are left out. */
export const getUidsByUserId = async (
  userDAO: UserDAO,
  userIds: Array<Types.ObjectId | string | null | undefined>
): Promise<Map<string, string>> => {
  const uniqueIds = [...new Set(userIds.filter(Boolean).map(String))].filter((id) =>
    Types.ObjectId.isValid(id)
  );
  const uidsById = new Map<string, string>();
  if (uniqueIds.length === 0) return uidsById;

  const users = await userDAO.list(
    { _id: { $in: uniqueIds.map((id) => new Types.ObjectId(id)) } },
    { projection: 'uid', limit: uniqueIds.length }
  );
  for (const user of users.items) uidsById.set(user._id.toString(), user.uid);
  return uidsById;
};

export const pendingMediaItems = (
  pendingMedia?: IPendingChanges['pendingMedia'] | null
): Array<{ key?: string; url: string }> => [
  ...(pendingMedia?.images ?? []),
  ...(pendingMedia?.documents ?? []),
];

/**
 * Get the original requester ID from approval details
 */
export const getOriginalRequesterId = (approvalDetails?: any[]): string | undefined => {
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
  property: { pendingChanges?: unknown }
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
  // displayName and pendingMedia describe the submission, not property fields
  const {
    updatedBy,
    updatedAt,
    displayName: _displayName,
    pendingMedia,
    ...changes
  } = pendingChanges;

  const formattedChanges = { ...changes };
  if (formattedChanges.fees) {
    formattedChanges.fees = MoneyUtils.formatMoneyDisplay(formattedChanges.fees);
  }

  const updatedFields = Object.keys(changes);
  const pendingMediaPreview = buildPendingMediaPreview(pendingMedia);
  const summaryParts = [
    ...(updatedFields.length ? [generateChangesSummary(updatedFields)] : []),
    ...(pendingMediaPreview
      ? [`${pendingMediaPreview.images.length + pendingMediaPreview.documents.length} new file(s)`]
      : []),
  ];

  return {
    updatedFields,
    updatedAt,
    updatedBy,
    summary: summaryParts.length ? summaryParts.join('; ') : generateChangesSummary([]),
    changes: formattedChanges,
    ...(pendingMediaPreview && { pendingMedia: pendingMediaPreview }),
  };
};

/** Copies of the files a staff edit attached, so URL signing leaves pendingChanges untouched. */
const buildPendingMediaPreview = (pendingMedia?: IPendingChanges['pendingMedia'] | null) => {
  if (!pendingMediaItems(pendingMedia).length) return undefined;

  return {
    images: (pendingMedia?.images ?? []).map((image) => ({
      _id: image._id,
      key: image.key,
      url: image.url,
      filename: image.filename,
      uploadedAt: image.uploadedAt,
    })),
    documents: (pendingMedia?.documents ?? []).map((document) => ({
      _id: document._id,
      key: document.key,
      url: document.url,
      documentName: document.documentName,
      documentType: document.documentType,
      uploadedAt: document.uploadedAt,
    })),
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

export const canViewInspections = (department?: EmployeeDepartment): boolean =>
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
