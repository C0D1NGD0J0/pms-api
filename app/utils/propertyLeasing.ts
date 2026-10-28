import { IUserRole } from '@shared/constants/roles.constants';
import { PROPERTY_VERIFICATION_ROLES } from '@utils/constants';
import { VerificationStatusEnum, OwnershipType } from '@interfaces/property.interface';

/** The fields the checks read — `authorization` and `verificationGracePeriod` are select: false. */
export interface LeasingCheckFields {
  authorization?: { isActive?: boolean; expiresAt?: Date | string | null } | null;
  verificationGracePeriod?: { expiresAt?: Date | string | null } | null;
  owner?: { type?: string } | null;
  verificationStatus?: string;
  approvalStatus?: string;
}

/**
 * Why a property can't be leased yet. Shared by the property model's leasing checks, the lease
 * guards (create, renew, sign, activate) and the lease form's property picker, so imported and
 * form-created properties are held to the same ownership rules.
 */
export type PropertyLeasingBlock =
  | 'not_approved'
  | 'management_not_authorized'
  | 'ownership_unverified';

export const LEASING_CHECK_SELECT = '+owner +authorization +verificationGracePeriod';

/** Company-owned properties need no agreement; others need an active, unexpired one. */
export const isManagementAuthorizedFor = (property: LeasingCheckFields): boolean => {
  if (property.owner?.type === OwnershipType.COMPANY_OWNED) return true;
  const authorization = property.authorization;
  if (!authorization?.isActive) return false;
  return !authorization.expiresAt || new Date(authorization.expiresAt) >= new Date();
};

/** Verified by an admin, or inside an active grace period. */
export const isVerifiedForLeasingFor = (property: LeasingCheckFields): boolean => {
  if (property.verificationStatus === VerificationStatusEnum.VERIFIED) return true;
  const expiresAt = property.verificationGracePeriod?.expiresAt;
  return !!expiresAt && new Date(expiresAt) > new Date();
};

/**
 * The first rule the property fails, or null when it can be leased.
 * `requireManagementAuth: false` is for signing and activation: an external owner without a
 * management agreement signs the lease directly, so only approval and verification apply there.
 */
export const getPropertyLeasingBlock = (
  property: LeasingCheckFields,
  options: { requireManagementAuth?: boolean } = {}
): PropertyLeasingBlock | null => {
  const { requireManagementAuth = true } = options;
  // Older properties predate approval and have no approvalStatus
  if (property.approvalStatus && property.approvalStatus !== 'approved') return 'not_approved';
  if (requireManagementAuth && !isManagementAuthorizedFor(property)) {
    return 'management_not_authorized';
  }
  if (!isVerifiedForLeasingFor(property)) return 'ownership_unverified';
  return null;
};

export const AUTO_VERIFIED_NOTE =
  'Auto-verified: company-owned property added by an admin or manager';

/**
 * A company-owned property added by someone who could verify it anyway (super-admin, admin,
 * manager) starts verified. Externally owned properties, and ones added by staff or imported,
 * still wait for an ownership review.
 */
export const shouldAutoVerifyOnCreate = (
  ownerType: string | undefined,
  creatorRole: IUserRole
): boolean =>
  ownerType === OwnershipType.COMPANY_OWNED && PROPERTY_VERIFICATION_ROLES.includes(creatorRole);

/** i18n key for each block, under `lease.errors`. */
export const PROPERTY_LEASING_BLOCK_MESSAGE_KEYS: Record<PropertyLeasingBlock, string> = {
  not_approved: 'lease.errors.propertyNotApproved',
  management_not_authorized: 'lease.errors.managementNotAuthorized',
  ownership_unverified: 'lease.errors.ownershipUnverified',
};
