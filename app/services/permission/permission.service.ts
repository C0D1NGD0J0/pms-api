import bunyan from 'bunyan';
import { createLogger } from '@utils/index';
import { ICurrentUser } from '@interfaces/user.interface';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { IUserRoleType, RoleHelpers, ROLES } from '@shared/constants/roles.constants';
import {
  PermissionResource,
  IPermissionConfig,
  IPermissionResult,
  IPermissionCheck,
  PermissionAction,
  PermissionScope,
} from '@interfaces/utils.interface';

import permissionConfig from './permissions.json';

export class PermissionService {
  private readonly log: bunyan;
  private readonly permissionConfig: IPermissionConfig;

  constructor() {
    this.log = createLogger('PermissionService');

    try {
      this.permissionConfig = permissionConfig as unknown as IPermissionConfig;
    } catch (error) {
      this.log.error('Failed to initialize PermissionService:', error);
      throw error;
    }
  }

  async checkPermission(permissionCheck: IPermissionCheck): Promise<IPermissionResult> {
    try {
      const { role, resource, action, scope, context } = permissionCheck;

      // Use business logic for all permission checks
      // This handles both CRUD and custom actions (send, revoke, settings, etc.)
      return this.evaluateBusinessSpecificPermission(
        role,
        resource.toString(),
        action,
        scope || PermissionScope.ANY,
        context
      );
    } catch (error) {
      this.log.error('Error checking permission:', error);
      return {
        granted: false,
        reason: 'Error evaluating permission',
      };
    }
  }

  /**
   * Handle business-specific permission scopes (assigned, available, mine)
   */
  private evaluateBusinessSpecificPermission(
    role: string,
    resource: string,
    action: string,
    scope: string,
    context?: IPermissionCheck['context']
  ): IPermissionResult {
    const requiredPermission = `${action}:${scope}`;

    // First check if the role has this specific permission
    if (!this.hasPermissionWithInheritance(role, resource, requiredPermission)) {
      return {
        granted: false,
        reason: `Role '${role}' does not have permission '${requiredPermission}' on resource '${resource}'`,
      };
    }

    // Permission exists, now validate scope-specific business rules
    switch (scope) {
      case PermissionScope.AVAILABLE:
        return this.validateAvailableScope(action);

      case PermissionScope.ASSIGNED:
        return this.validateAssignedScope(role, resource, action, context);

      case PermissionScope.MINE:
        return this.validateMineScope(context);

      case PermissionScope.ANY:
        return this.validateAnyScope(context);

      default:
        this.log.warn(`Unknown permission scope: ${scope}`);
        return {
          granted: false,
          reason: `Unsupported permission scope: ${scope}`,
        };
    }
  }

  private hasPermissionWithInheritance(
    role: string,
    resource: string,
    permission: string
  ): boolean {
    const visited = new Set<string>();

    const checkRole = (currentRole: string): boolean => {
      if (visited.has(currentRole)) {
        return false; // Avoid circular dependencies
      }
      visited.add(currentRole);

      const roleConfig = this.permissionConfig.roles[currentRole];
      if (!roleConfig) {
        return false;
      }

      // Check direct permissions
      const rolePermissions = roleConfig[resource];
      if (Array.isArray(rolePermissions) && rolePermissions.includes(permission)) {
        return true;
      }

      // Check inherited permissions
      if (roleConfig.$extend) {
        for (const inheritedRole of roleConfig.$extend) {
          if (checkRole(inheritedRole)) {
            return true;
          }
        }
      }

      return false;
    };

    return checkRole(role);
  }

  async checkUserPermission(
    currentUser: ICurrentUser,
    resource: PermissionResource,
    action: string,
    resourceData?: any
  ): Promise<IPermissionResult> {
    const userRole = currentUser.client.role;
    const userId = currentUser.sub;
    const clientId = currentUser.client.cuid;

    let scope = PermissionScope.ANY;
    let context: IPermissionCheck['context'] = {
      clientId,
      userId,
    };

    // USER resource where ownership matters (users editing their own profile)
    if (resource === PermissionResource.USER && resourceData) {
      // Handle both cases: full user object or just an ID
      const resourceId = resourceData._id || resourceData.uid || resourceData;
      const resourceOwnerId = resourceData._id || resourceData.id || resourceData;

      scope = resourceId.toString() === userId ? PermissionScope.MINE : PermissionScope.ANY;

      // Add resource context for better permission checking
      context = {
        ...context,
        resourceId: resourceId.toString(),
        resourceOwnerId: resourceOwnerId.toString(),
      };
    }

    // CLIENT resource - always use MINE scope since users can only access their own client
    if (resource === PermissionResource.CLIENT) {
      scope = PermissionScope.MINE;
    }

    const permissionCheckData = {
      role: userRole,
      resource,
      action,
      scope,
      context,
    };

    const result = await this.checkPermission(permissionCheckData);
    return result;
  }

  getRolePermissions(role: IUserRoleType): Record<string, string[]> {
    try {
      const roleConfig = this.permissionConfig.roles[role];
      if (!roleConfig) {
        return {};
      }

      const permissions: Record<string, string[]> = {};

      // Extract permissions directly from permissions.json (exclude $extend and departments)
      Object.entries(roleConfig).forEach(([resource, perms]) => {
        if (resource !== '$extend' && resource !== 'departments') {
          permissions[resource] = perms as string[];
        }
      });

      return permissions;
    } catch (error) {
      this.log.error(`Error getting role permissions for ${role}:`, error);
      return {};
    }
  }

  /**
   * Get department-specific permissions for a role
   * @param role - The user's role
   * @param department - The user's department
   * @returns Permission object for the department or empty object if not found
   */
  private getDepartmentPermissions(
    role: string,
    department: EmployeeDepartment
  ): Record<string, string[]> {
    try {
      const roleConfig = this.permissionConfig.roles[role];
      if (!roleConfig) {
        this.log.debug(`No role config found for role: ${role}`);
        return {};
      }

      // Access departments explicitly from the config
      const departments = (roleConfig as any).departments;
      if (!departments || typeof departments !== 'object') {
        this.log.debug(`No departments config found for role: ${role}`);
        return {};
      }

      const deptPerms = departments[department];
      if (!deptPerms || typeof deptPerms !== 'object') {
        this.log.debug(`No permissions found for ${role}:${department}`);
        return {};
      }

      return deptPerms as Record<string, string[]>;
    } catch (error) {
      this.log.error(`Error getting department permissions for ${role}:${department}`, error);
      return {};
    }
  }

  getAvailableResources(): string[] {
    return Object.keys(this.permissionConfig.resources);
  }

  getResourceActions(resource: string): string[] {
    return this.permissionConfig.resources[resource]?.actions || [];
  }

  getAvailableScopes(): string[] {
    return Object.keys(this.permissionConfig.scopes);
  }

  isValidPermission(permission: string): boolean {
    const [action, scope] = permission.split(':');
    if (!action) return false;
    if (scope && !this.getAvailableScopes().includes(scope)) {
      return false;
    }
    return true;
  }

  /**
   * Validate assigned scope permissions with resource-specific logic
   */
  private validateAssignedScope(
    role: string,
    resource: string,
    action: string,
    context?: IPermissionCheck['context']
  ): IPermissionResult {
    if (!context?.userId) {
      return {
        granted: false,
        reason: 'User context required for assigned scope validation',
      };
    }

    // If no assignedUsers is provided, we can't validate assignment
    if (!context.assignedUsers || context.assignedUsers.length === 0) {
      this.log.warn('Assigned scope check requested but no assignedUsers provided');
      return {
        granted: true, // Allow for now, but log warning
        reason: 'Assigned scope permission granted (no assignment validation possible)',
      };
    }

    // Check if user is in the assigned users list
    if (context.assignedUsers.includes(context.userId)) {
      return {
        granted: true,
        reason: 'User is assigned to this resource',
      };
    }

    // Resource-specific assignment validation (fallback for complex logic)
    switch (resource) {
      case PermissionResource.MAINTENANCE:
        return this.validateMaintenanceAssignment(role, action, context);

      case PermissionResource.PROPERTY:
        return this.validatePropertyAssignment(role, action, context);

      case PermissionResource.PAYMENT:
        return this.validatePaymentAssignment(role, action, context);

      case PermissionResource.LEASE:
        return this.validateLeaseAssignment(role, action, context);

      default:
        return {
          granted: false,
          reason: `User ${context.userId} is not assigned to this ${resource}`,
        };
    }
  }

  /**
   * Validate available scope permissions (typically read-only)
   */
  private validateAvailableScope(action: string): IPermissionResult {
    if (!['read', 'list'].includes(action)) {
      return {
        granted: false,
        reason: 'Available scope only supports read/list actions',
      };
    }
    return {
      granted: true,
      reason: 'Available scope read permission granted',
    };
  }

  /**
   * Validate mine scope permissions (user owns the resource)
   */
  private validateMineScope(context?: IPermissionCheck['context']): IPermissionResult {
    if (!context?.userId) {
      return {
        granted: false,
        reason: 'User context required for ownership validation',
      };
    }

    // If no resourceOwnerId is provided, we can't validate ownership
    if (!context.resourceOwnerId) {
      this.log.warn('Mine scope check requested but no resourceOwnerId provided');
      return {
        granted: true, // Allow for now, but log warning
        reason: 'Mine scope permission granted (no ownership validation possible)',
      };
    }

    // Check if user owns the resource
    if (context.resourceOwnerId === context.userId) {
      return {
        granted: true,
        reason: 'User owns the resource',
      };
    }

    return {
      granted: false,
      reason: `User ${context.userId} does not own resource owned by ${context.resourceOwnerId}`,
    };
  }

  /**
   * Validate any scope permissions (client-wide access)
   */
  private validateAnyScope(context?: IPermissionCheck['context']): IPermissionResult {
    if (!context?.clientId) {
      return {
        granted: false,
        reason: 'Client context required for any scope validation',
      };
    }
    return {
      granted: true,
      reason: 'Any scope permission granted',
    };
  }

  /**
   * Validate property assignment for different roles
   */
  private validatePropertyAssignment(
    role: string,
    action: string,
    context: IPermissionCheck['context']
  ): IPermissionResult {
    if (!context) {
      return { granted: false, reason: 'Context required for assignment validation' };
    }
    const { userId, resourceOwnerId, assignedUsers } = context;

    switch (role) {
      case ROLES.MANAGER:
        // Managers can access properties they created or manage
        if (resourceOwnerId === userId || assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Manager has access to managed property' };
        }
        break;

      case ROLES.VENDOR:
        // Vendors can access properties with active maintenance assignments
        if (assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Vendor has maintenance assignments for property' };
        }
        break;

      case ROLES.STAFF:
        // Staff can access properties assigned to them
        if (assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Staff has access to assigned property' };
        }
        break;
    }

    return {
      granted: false,
      reason: `${role} does not have assigned access to this property`,
    };
  }

  /**
   * Validate maintenance assignment for different roles
   */
  private validateMaintenanceAssignment(
    role: string,
    action: string,
    context: IPermissionCheck['context']
  ): IPermissionResult {
    if (!context) {
      return { granted: false, reason: 'Context required for assignment validation' };
    }
    const { userId, resourceOwnerId, assignedUsers } = context;

    switch (role) {
      case ROLES.MANAGER:
        // Managers can access maintenance for properties they manage
        if (resourceOwnerId === userId || assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Manager has access to property maintenance' };
        }
        break;

      case ROLES.VENDOR:
        // Vendors can access maintenance requests assigned to them
        if (assignedUsers?.includes(userId)) {
          return { granted: true, reason: `${role} assigned to maintenance request` };
        }
        break;

      case ROLES.STAFF:
        // Staff can access maintenance requests assigned to them
        if (assignedUsers?.includes(userId)) {
          return { granted: true, reason: `${role} assigned to maintenance request` };
        }
        break;
    }

    return {
      granted: false,
      reason: `${role} does not have assigned access to this maintenance request`,
    };
  }

  /**
   * Validate lease assignment for different roles
   */
  private validateLeaseAssignment(
    role: string,
    action: string,
    context: IPermissionCheck['context']
  ): IPermissionResult {
    if (!context) {
      return { granted: false, reason: 'Context required for assignment validation' };
    }
    const { userId, resourceOwnerId, assignedUsers } = context;

    switch (role) {
      case ROLES.MANAGER:
        // Managers can access leases for properties they manage or leases they created
        if (resourceOwnerId === userId || assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Manager has access to managed lease' };
        }
        break;

      case ROLES.TENANT:
        // Tenants can access their own leases
        if (resourceOwnerId === userId) {
          return { granted: true, reason: 'Tenant accessing own lease' };
        }
        break;

      case ROLES.STAFF:
        // Staff can access leases for properties assigned to them
        if (assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Staff has access to assigned lease' };
        }
        break;
    }

    return {
      granted: false,
      reason: `${role} does not have assigned access to this lease`,
    };
  }

  /**
   * Validate payment assignment for different roles
   */
  private validatePaymentAssignment(
    role: string,
    action: string,
    context: IPermissionCheck['context']
  ): IPermissionResult {
    if (!context) {
      return { granted: false, reason: 'Context required for assignment validation' };
    }
    const { userId, resourceOwnerId, assignedUsers } = context;

    switch (role) {
      case ROLES.MANAGER:
        // Managers can access payments for leases/properties they manage
        if (assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Manager has access to managed property payments' };
        }
        break;

      case ROLES.TENANT:
        // Tenants can access their own payments
        if (resourceOwnerId === userId) {
          return { granted: true, reason: 'Tenant accessing own payments' };
        }
        break;

      case ROLES.STAFF:
        // Staff can access payments for assigned properties
        if (assignedUsers?.includes(userId)) {
          return { granted: true, reason: 'Staff has access to assigned property payments' };
        }
        break;
    }

    return {
      granted: false,
      reason: `${role} does not have assigned access to this payment`,
    };
  }

  getPermissionConfig(): IPermissionConfig {
    return this.permissionConfig;
  }

  /**
   * Generic method to check if user can access a resource
   * Simplified version that uses permissions.json and basic business rules
   */
  async canAccessResource(
    currentUser: ICurrentUser,
    resource: PermissionResource,
    action: PermissionAction | string,
    resourceData: any
  ): Promise<boolean> {
    try {
      const activeConnection = currentUser.clients?.find(
        (c: any) => c.cuid === currentUser.client.cuid
      );

      if (!activeConnection?.isConnected) {
        this.log.debug('User not connected to client');
        return false;
      }

      // Check user permissions via checkUserPermission
      const result = await this.checkUserPermission(currentUser, resource, action, resourceData);
      return result?.granted || false;
    } catch (error) {
      this.log.error(`Error checking access for resource ${resource}:`, error);
      return false;
    }
  }

  /**
   * Batch check multiple access permissions for a resource
   * Returns an object with all common permission checks
   *
   * @example
   * const access = await permissionService.getResourceAccess(currentUser, PermissionResource.PROPERTY, property);
   * if (access.canRead) { ... }
   * if (access.canUpdate) { ... }
   * if (access.canDelete) { ... }
   */
  async getResourceAccess(
    currentUser: ICurrentUser,
    resource: PermissionResource,
    resourceData: any
  ): Promise<{
    canRead: boolean;
    canCreate: boolean;
    canUpdate: boolean;
    canDelete: boolean;
    canList: boolean;
  }> {
    const [canRead, canCreate, canUpdate, canDelete, canList] = await Promise.all([
      this.canAccessResource(currentUser, resource, PermissionAction.READ, resourceData),
      this.canAccessResource(currentUser, resource, PermissionAction.CREATE, resourceData),
      this.canAccessResource(currentUser, resource, PermissionAction.UPDATE, resourceData),
      this.canAccessResource(currentUser, resource, PermissionAction.DELETE, resourceData),
      this.canAccessResource(currentUser, resource, PermissionAction.LIST, resourceData),
    ]);

    return {
      canRead,
      canCreate,
      canUpdate,
      canDelete,
      canList,
    };
  }

  /**
   * Get effective permissions for a user based on role and department
   * Centralizes logic for role inheritance and department overrides
   */
  private getEffectivePermissions(
    role: IUserRoleType,
    department?: EmployeeDepartment
  ): Record<string, string[]> {
    // Admin/Manager: Use base role permissions (no department override)
    if (RoleHelpers.isManagementRole(role)) {
      return this.getRolePermissions(role);
    }

    // Staff with department: Use department permissions if found
    if (role === ROLES.STAFF && department) {
      const deptPermissions = this.getDepartmentPermissions(role, department);
      if (deptPermissions && Object.keys(deptPermissions).length > 0) {
        return deptPermissions;
      }
      this.log.warn(
        `No department permissions found for ${role}:${department}, using base role permissions`
      );
    }

    // Staff without department: warn user (will use base role permissions below)
    if (role === ROLES.STAFF && !department) {
      this.log.warn(
        '⚠️  Staff user has no department assigned. Using base role permissions (restricted access).'
      );
    }

    // Return base role permissions from permissions.json
    return this.getRolePermissions(role);
  }

  /**
   * Update user permissions in ICurrentUser object
   * Applies department-specific permissions for employee roles if department is assigned
   */
  async populateUserPermissions(currentUser: ICurrentUser): Promise<ICurrentUser> {
    try {
      const role = currentUser.client.role;
      const department = currentUser.employeeInfo?.department;

      // Get effective permissions based on role and department
      const rolePermissions = this.getEffectivePermissions(role, department);

      const permissions: string[] = [];

      // create both backend format (action:scope) and frontend format (resource:action)
      Object.entries(rolePermissions).forEach(([resource, resourcePermissions]) => {
        resourcePermissions.forEach((permission: string) => {
          permissions.push(permission);
          const [action, scope] = permission.split(':');
          if (action && resource) {
            permissions.push(`${resource}:${action}`);

            // also add scoped format if scope exists: "property:read:any", "property:update:mine"
            if (scope) {
              permissions.push(`${resource}:${action}:${scope}`);
            }
          }
        });
      });

      currentUser.permissions = [...new Set(permissions)]; // remove duplicates

      return currentUser;
    } catch (error) {
      this.log.error('Error populating user permissions:', error);
      return currentUser;
    }
  }
}
