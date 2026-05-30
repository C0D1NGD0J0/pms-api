import { Types } from 'mongoose';
import { ForbiddenError } from '@shared/customErrors';
import { ICurrentUser } from '@interfaces/user.interface';
import { ROLE_GROUPS } from '@shared/constants/roles.constants';

/**
 * Asserts that the current user either owns the record or holds a bypass role.
 *
 * By default, MANAGEMENT_ROLES (super-admin, admin, manager) bypass the check.
 * Pass a custom `bypassRoles` array to change which roles are exempt.
 *
 * @example
 *   // Tenant must own the SR; management roles pass through
 *   assertRecordOwnership(currentuser, request.tenantId, {
 *     errorMessage: t('maintenance.errors.notYourRequest'),
 *   });
 *
 *   // User can only update their own email; management roles may update any
 *   assertRecordOwnership(currentuser, targetUserId, {
 *     bypassRoles: ROLE_GROUPS.MANAGEMENT_ROLES,
 *     errorMessage: 'You can only update your own account information.',
 *   });
 */
export function assertRecordOwnership(
  currentuser: ICurrentUser,
  ownerId: string | Types.ObjectId | null | undefined,
  options?: {
    bypassRoles?: readonly string[];
    errorMessage?: string;
  }
): void {
  const bypassRoles = options?.bypassRoles ?? ROLE_GROUPS.MANAGEMENT_ROLES;
  if ((bypassRoles as string[]).includes(currentuser.client.role)) return;

  if (!ownerId || ownerId.toString() !== currentuser.sub) {
    throw new ForbiddenError({
      message: options?.errorMessage ?? 'You do not have permission to modify this record.',
    });
  }
}

/**
 * Asserts that the current user holds a management role (super-admin, admin, or manager).
 * Use this for operations where no per-record ownership applies but the action
 * must be restricted to PM-side management only.
 *
 * @example
 *   assertManagementRole(currentuser, 'Only managers can approve property changes.');
 */
export function assertManagementRole(currentuser: ICurrentUser, errorMessage?: string): void {
  if (!ROLE_GROUPS.MANAGEMENT_ROLES.includes(currentuser.client.role as any)) {
    throw new ForbiddenError({
      message: errorMessage ?? 'This action requires a management role.',
    });
  }
}
