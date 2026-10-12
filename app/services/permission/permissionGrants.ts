import { IPermissionConfig, IRoleConfig } from '@interfaces/utils.interface';

import permissionsJson from './permissions.json';

export const permissionConfig = permissionsJson as unknown as IPermissionConfig;

type GrantSet = Record<string, string[]>;

const NON_GRANT_KEYS = ['$extend', 'departments'];

/**
 * The grants a role holds directly (inheritance via $extend is resolved by the caller).
 * A staff department's grants REPLACE the base staff grants; staff without a department,
 * or with a department that has no grants configured (e.g. 'other'), keep the base grants.
 */
export function resolveGrantSet(
  roleConfig: IRoleConfig | undefined,
  department?: string
): GrantSet {
  if (!roleConfig) return {};

  const departmentGrants = department ? roleConfig.departments?.[department] : undefined;
  if (departmentGrants && Object.keys(departmentGrants).length > 0) {
    return departmentGrants;
  }

  return Object.fromEntries(
    Object.entries(roleConfig).filter(
      ([key, value]) => !NON_GRANT_KEYS.includes(key) && Array.isArray(value)
    )
  ) as GrantSet;
}

export function getStaffGrantSet(department?: string | null): GrantSet {
  return resolveGrantSet(permissionConfig.roles.staff, department ?? undefined);
}
