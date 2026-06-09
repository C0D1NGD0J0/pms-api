import { ICurrentUser } from '@interfaces/user.interface';
import ROLES, { ROLE_GROUPS, IUserRole } from '@shared/constants/roles.constants';

/** Centralized role and identity predicates for the authenticated user. */
export const CurrentUser = {
  // ── Vendor checks ──────────────────────────────────────────────────────────

  /** Any user with the vendor role (primary OR team member). */
  isVendor(u: ICurrentUser): boolean {
    return u.client.role === ROLES.VENDOR;
  },

  /**
   * The primary account holder for a vendor organisation.
   * No linkedVendorUid means they were the originally invited vendor owner.
   * Prefers the vendorInfo flag; falls back to absence of linkedVendorUid.
   */
  isPrimaryVendor(u: ICurrentUser): boolean {
    return (
      u.client.role === ROLES.VENDOR && (u.vendorInfo?.isPrimaryVendor ?? !u.client.linkedVendorUid)
    );
  },

  /**
   * A vendor team member — linked to a primary account but not the owner.
   *
   * `linkedVendorUid` is stored in two formats depending on the invitation path:
   *   - CSV bulk invite: the vendor's vuid  (e.g. "GNTM8EMXMA2Z")
   *   - Single invite: the primary vendor's User._id as a 24-hex string
   *
   * Either format means the user is a team member, so we check for presence.
   */
  isVendorTeamMember(u: ICurrentUser): boolean {
    return (
      u.client.role === ROLES.VENDOR &&
      !!(u.client.linkedVendorUid || u.vendorInfo?.isLinkedAccount)
    );
  },

  /**
   * True if the user is a team member for a *specific* vendor org.
   *
   * @param vuid - The vendor's short vuid (matches CSV invite path)
   * @param primaryAccountHolderUserId - The primary vendor's User._id string (matches single-invite path)
   */
  isVendorTeamMemberOf(
    u: ICurrentUser,
    vuid: string,
    primaryAccountHolderUserId?: string
  ): boolean {
    if (!CurrentUser.isVendorTeamMember(u)) return false;
    const linked = u.client.linkedVendorUid;
    return (
      linked === vuid || (!!primaryAccountHolderUserId && linked === primaryAccountHolderUserId)
    );
  },

  // ── PM-side checks ─────────────────────────────────────────────────────────

  /** Admin, manager, or staff (any PM-side employee). */
  isStaff(u: ICurrentUser): boolean {
    return ROLE_GROUPS.EMPLOYEE_ROLES.includes(u.client.role as any);
  },

  /** Admin or manager (can approve/reject). */
  isPM(u: ICurrentUser): boolean {
    return [ROLES.ADMIN as string, ROLES.MANAGER].includes(u.client.role);
  },

  isAdmin(u: ICurrentUser): boolean {
    return u.client.role === ROLES.ADMIN;
  },

  isManager(u: ICurrentUser): boolean {
    return u.client.role === ROLES.MANAGER;
  },

  isSuperAdmin(u: ICurrentUser): boolean {
    return u.client.role === ROLES.SUPER_ADMIN;
  },

  /** Any PM-side management role (super-admin, admin, manager). */
  isManagement(u: ICurrentUser): boolean {
    return ROLE_GROUPS.MANAGEMENT_ROLES.includes(u.client.role as any);
  },

  // ── Tenant ─────────────────────────────────────────────────────────────────

  isTenant(u: ICurrentUser): boolean {
    return u.client.role === ROLES.TENANT;
  },

  // ── Generic ────────────────────────────────────────────────────────────────

  /** Vendor or tenant (external portal users). */
  isExternal(u: ICurrentUser): boolean {
    return ROLE_GROUPS.EXTERNAL_ROLES.includes(u.client.role as any);
  },

  hasRole(u: ICurrentUser, role: IUserRole): boolean {
    return u.client.role === role;
  },
};
