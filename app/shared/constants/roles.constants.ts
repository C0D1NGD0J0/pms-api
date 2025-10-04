/**
 * Centralized role constants for the PMS application
 *
 * This file serves as the single source of truth for all role definitions
 * throughout the application. All hardcoded role strings should be replaced
 * with references to these constants.
 */

/**
 * User role enumeration
 * Defines all available user roles in the system
 */
export enum IUserRole {
  MANAGER = 'manager',
  TENANT = 'tenant',
  VENDOR = 'vendor',
  ADMIN = 'admin',
  STAFF = 'staff',
}

/**
 * Role constants object for easier access and usage
 * Provides the same values as IUserRole enum but in object format
 */
export const ROLES = {
  ADMIN: 'admin',
  MANAGER: 'manager',
  STAFF: 'staff',
  TENANT: 'tenant',
  VENDOR: 'vendor',
} as const;

/**
 * Type definition for user roles (maintained for backward compatibility)
 */
export type IUserRoleType = 'admin' | 'tenant' | 'manager' | 'staff' | 'landlord' | 'vendor';

/**
 * Type definition for role values
 * Ensures type safety when using role constants
 */
export type RoleType = (typeof ROLES)[keyof typeof ROLES];

/**
 * Common role groupings for business logic
 */
export const ROLE_GROUPS = {
  EMPLOYEE_ROLES: [ROLES.ADMIN, ROLES.MANAGER, ROLES.STAFF],
  MANAGEMENT_ROLES: [ROLES.ADMIN, ROLES.MANAGER],
  PROPERTY_APPROVAL_ROLES: [ROLES.ADMIN, ROLES.MANAGER],
  PROPERTY_STAFF_ROLES: [ROLES.STAFF],
  EXTERNAL_ROLES: [ROLES.TENANT, ROLES.VENDOR],
} as const;

/**
 * Helper functions for role operations
 */
export const RoleHelpers = {
  /**
   * Check if a role is an employee role
   */
  isEmployeeRole: (role: string): boolean => {
    return ROLE_GROUPS.EMPLOYEE_ROLES.includes(role as any);
  },

  /**
   * Check if a role is a management role
   */
  isManagementRole: (role: string): boolean => {
    return ROLE_GROUPS.MANAGEMENT_ROLES.includes(role as any);
  },

  /**
   * Check if a role can approve properties
   */
  canApproveProperty: (role: string): boolean => {
    return ROLE_GROUPS.PROPERTY_APPROVAL_ROLES.includes(role as any);
  },

  /**
   * Check if a role is an external role (tenant/vendor)
   */
  isExternalRole: (role: string): boolean => {
    return ROLE_GROUPS.EXTERNAL_ROLES.includes(role as any);
  },

  /**
   * Get all role values as array
   */
  getAllRoles: (): string[] => {
    return Object.values(ROLES);
  },

  /**
   * Validate if a string is a valid role
   */
  isValidRole: (role: string): role is RoleType => {
    return Object.values(ROLES).includes(role as RoleType);
  },
};

/**
 * Role validation arrays for validation schemas
 */
export const ROLE_VALIDATION = {
  ALL_ROLES: Object.values(ROLES) as [string, ...string[]],
  EMPLOYEE_ROLES: [...ROLE_GROUPS.EMPLOYEE_ROLES] as [string, ...string[]],
  MANAGEMENT_ROLES: [...ROLE_GROUPS.MANAGEMENT_ROLES] as [string, ...string[]],
  EXTERNAL_ROLES: [...ROLE_GROUPS.EXTERNAL_ROLES] as [string, ...string[]],
} as const;

export default ROLES;
