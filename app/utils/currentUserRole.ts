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
   * A vendor team member — linked to a vendor organisation but not its owner.
   * `linkedVendorUid` holds the organisation's vuid (e.g. "GNTM8EMXMA2Z").
   */
  isVendorTeamMember(u: ICurrentUser): boolean {
    return (
      u.client.role === ROLES.VENDOR &&
      !!(u.client.linkedVendorUid || u.vendorInfo?.isLinkedAccount)
    );
  },

  /** True if the user is a team member of the vendor organisation `vuid`. */
  isVendorTeamMemberOf(u: ICurrentUser, vuid: string): boolean {
    return CurrentUser.isVendorTeamMember(u) && u.client.linkedVendorUid === vuid;
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
