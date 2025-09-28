import bunyan from 'bunyan';
import { createLogger } from '@utils/index';
import { AccessControl } from 'accesscontrol';
import { ICurrentUser } from '@interfaces/user.interface';
import { IVendorDocument } from '@interfaces/vendor.interface';
import { IPropertyDocument } from '@interfaces/property.interface';
import permissionConfig from '@shared/permissions/permissions.json';
import { IUserRoleType, ROLES } from '@shared/constants/roles.constants';
import {
  PermissionResource,
  IPermissionConfig,
  IPermissionResult,
  IPermissionCheck,
  PermissionAction,
  PermissionScope,
} from '@interfaces/utils.interface';

import {
  MaintenanceAccessStrategy,
  InvitationAccessStrategy,
  ResourceAccessStrategy,
  PropertyAccessStrategy,
  PaymentAccessStrategy,
  ClientAccessStrategy,
  VendorAccessStrategy,
  LeaseAccessStrategy,
  UserAccessStrategy,
} from './resourceAccessStrategies';

export class PermissionService {
  private readonly log: bunyan;
  private readonly permissionConfig: IPermissionConfig;
  private readonly accessControl: AccessControl;
  private resourceStrategies: Map<PermissionResource, ResourceAccessStrategy>;

  constructor() {
    this.log = createLogger('PermissionService');

    try {
      this.permissionConfig = permissionConfig as IPermissionConfig;
      this.accessControl = new AccessControl();
      this.initializePermissions();
      this.initializeResourceStrategies();
      this.log.debug('PermissionService initialized successfully');
    } catch (error) {
      this.log.error('Failed to initialize PermissionService:', error);
      throw error;
    }
  }

  private initializeResourceStrategies(): void {
    this.resourceStrategies = new Map([
      [PermissionResource.MAINTENANCE, new MaintenanceAccessStrategy()],
      [PermissionResource.INVITATION, new InvitationAccessStrategy()],
      [PermissionResource.PROPERTY, new PropertyAccessStrategy()],
      [PermissionResource.PAYMENT, new PaymentAccessStrategy()],
      [PermissionResource.VENDOR, new VendorAccessStrategy()],
      [PermissionResource.CLIENT, new ClientAccessStrategy()],
      [PermissionResource.LEASE, new LeaseAccessStrategy()],
      [PermissionResource.USER, new UserAccessStrategy()],
    ]);
    this.log.debug('Resource access strategies initialized');
  }

  private initializePermissions(): void {
    const roles = this.permissionConfig.roles;

    // create all roles and their direct permissions (no inheritance)
    Object.entries(roles).forEach(([roleName, roleConfig]) => {
      this.processRolePermissions(roleName, roleConfig);
    });

    // handle role inheritance after all roles are defined
    Object.entries(roles).forEach(([roleName, roleConfig]) => {
      if (roleConfig.$extend) {
        roleConfig.$extend.forEach((baseRole: string) => {
          try {
            this.accessControl.extendRole(roleName, baseRole);
          } catch (error) {
            this.log.warn(`Failed to extend role ${roleName} with ${baseRole}:`, error);
          }
        });
      }
    });

    this.log.debug('AccessControl permissions initialized successfully');
  }

  private processRolePermissions(roleName: string, roleConfig: any): void {
    Object.entries(roleConfig).forEach(([resource, permissions]) => {
      if (resource === '$extend') return; // Skip inheritance config

      (permissions as string[]).forEach((permission: string) => {
        const [action, scope] = permission.split(':');

        // convert scope to AccessControl possession
        const possession = scope === 'mine' ? 'own' : 'any';
        // grant specific permission using AccessControl
        try {
          const grant = this.accessControl.grant(roleName);

          if (possession === 'any') {
            switch (action) {
              case 'create':
                grant.createAny(resource);
                break;
              case 'delete':
                grant.deleteAny(resource);
                break;
              case 'update':
                grant.updateAny(resource);
                break;
              case 'read':
                grant.readAny(resource);
                break;
              default:
                // Skip unknown actions - they'll be handled by business logic fallback
                // this.log.debug(
                //   `Skipping unknown action: ${action} for ${resource} - will use business logic fallback`
                // );
                break;
            }
          } else if (possession === 'own') {
            switch (action) {
              case 'create':
                grant.createOwn(resource);
                break;
              case 'delete':
                grant.deleteOwn(resource);
                break;
              case 'update':
                grant.updateOwn(resource);
                break;
              case 'read':
                grant.readOwn(resource);
                break;
              default:
                // Custom actions (send, revoke, settings, etc.) are not handled by AccessControl
                // They will be processed by business logic in evaluateBusinessSpecificPermission
                this.log.debug(
                  `Custom action '${action}' for '${resource}' will be handled by business logic`
                );
                break;
            }
          }
        } catch (error) {
          this.log.warn(
            `Failed to grant ${action}:${possession} on ${resource} for role ${roleName}:`,
            error
          );
        }
      });
    });
  }

  async checkPermission(permissionCheck: IPermissionCheck): Promise<IPermissionResult> {
    try {
      const { role, resource, action, scope, context } = permissionCheck;
      try {
        const query = this.accessControl.can(role);
        let permission;

        if (scope === PermissionScope.ANY) {
          switch (action) {
            case 'create':
              permission = query.createAny(resource);
              break;
            case 'delete':
              permission = query.deleteAny(resource);
              break;
            case 'update':
              permission = query.updateAny(resource);
              break;
            case 'read':
              permission = query.readAny(resource);
              break;
            default:
              // Custom actions (send, revoke, settings, etc.) are not standard CRUD operations
              // Set permission to null to ensure fallback to business logic
              permission = null;
              this.log.debug(
                `Custom action '${action}' with scope 'any' for '${resource}' - using business logic`
              );
              break;
          }
        } else if (scope === PermissionScope.MINE) {
          switch (action) {
            case 'create':
              permission = query.createOwn(resource);
              break;
            case 'delete':
              permission = query.deleteOwn(resource);
              break;
            case 'update':
              permission = query.updateOwn(resource);
              break;
            case 'read':
              permission = query.readOwn(resource);
              break;
            default:
              // Custom actions (send, revoke, settings, etc.) are not standard CRUD operations
              // Set permission to null to ensure fallback to business logic
              permission = null;
              this.log.debug(
                `Custom action '${action}' with scope 'mine' for '${resource}' - using business logic`
              );
              break;
          }
        }

        if (permission && permission.granted) {
          return {
            granted: true,
            reason: `Permission granted by AccessControl${scope === PermissionScope.MINE ? ' (own)' : ''}`,
            attributes: permission.attributes,
          };
        }
      } catch (error) {
        this.log.warn(
          `AccessControl check failed for ${role}:${action}:${scope} on ${resource}:`,
          error
        );
      }

      // Always fall back to business logic when AccessControl doesn't grant permission
      // This handles custom actions like "send", "revoke", etc. that aren't standard CRUD operations
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
      const rolePermissions = roleConfig[resource] || [];
      if (rolePermissions.includes(permission)) {
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
      const grants = this.accessControl.getGrants();
      const roleGrants = grants[role] || {};

      const permissions: Record<string, string[]> = {};

      Object.entries(roleGrants).forEach(([resource, actions]: [string, any]) => {
        permissions[resource] = [];
        Object.entries(actions).forEach(([action, attributes]: [string, any]) => {
          if (attributes['*:any']) {
            permissions[resource].push(`${action}:any`);
          }
          if (attributes['*:own']) {
            permissions[resource].push(`${action}:mine`);
          }
        });
      });

      const roleConfig = this.permissionConfig.roles[role];
      if (roleConfig) {
        Object.entries(roleConfig).forEach(([resource, perms]) => {
          if (resource !== '$extend') {
            if (!permissions[resource]) {
              permissions[resource] = [];
            }
            perms.forEach((perm: string) => {
              if (!permissions[resource].includes(perm)) {
                permissions[resource].push(perm);
              }
            });
          }
        });
      }

      return permissions;
    } catch (error) {
      this.log.error(`Error getting role permissions for ${role}:`, error);
      return this.permissionConfig.roles[role] || {};
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
   * This replaces all the individual canUserAccessX methods
   */
  canAccessResource(
    currentUser: ICurrentUser,
    resource: PermissionResource,
    action: PermissionAction | string,
    resourceData: any
  ): boolean {
    try {
      const activeConnection = currentUser.clients?.find(
        (c: any) => c.cuid === currentUser.client.cuid
      );

      if (!activeConnection?.isConnected) {
        this.log.debug('User not connected to client');
        return false;
      }

      const strategy = this.resourceStrategies.get(resource);
      if (!strategy) {
        this.log.warn(`No access strategy defined for resource: ${resource}`);
        return false;
      }

      return strategy.canAccess(currentUser, action, resourceData);
    } catch (error) {
      this.log.error(`Error checking access for resource ${resource}:`, error);
      return false;
    }
  }

  // Backward compatibility methods - these now delegate to the generic method
  canUserAccessUser(currentUser: ICurrentUser, targetUser: any): boolean {
    return this.canAccessResource(
      currentUser,
      PermissionResource.USER,
      PermissionAction.READ,
      targetUser
    );
  }

  canUserAccessProperty(currentUser: ICurrentUser, property: IPropertyDocument): boolean {
    return this.canAccessResource(
      currentUser,
      PermissionResource.PROPERTY,
      PermissionAction.READ,
      property
    );
  }

  canUserModifyProperty(currentUser: ICurrentUser, property: IPropertyDocument): boolean {
    return this.canAccessResource(
      currentUser,
      PermissionResource.PROPERTY,
      PermissionAction.UPDATE,
      property
    );
  }

  canUserDeleteProperty(currentUser: ICurrentUser, property: IPropertyDocument): boolean {
    return this.canAccessResource(
      currentUser,
      PermissionResource.PROPERTY,
      PermissionAction.DELETE,
      property
    );
  }

  canUserAccessMaintenance(currentUser: ICurrentUser, maintenance: any): boolean {
    return this.canAccessResource(
      currentUser,
      PermissionResource.MAINTENANCE,
      PermissionAction.READ,
      maintenance
    );
  }

  canUserAccessLease(currentUser: ICurrentUser, lease: any): boolean {
    return this.canAccessResource(
      currentUser,
      PermissionResource.LEASE,
      PermissionAction.READ,
      lease
    );
  }

  canUserAccessVendors(currentUser: ICurrentUser, vendor: IVendorDocument): boolean {
    return this.canAccessResource(
      currentUser,
      PermissionResource.VENDOR,
      PermissionAction.READ,
      vendor
    );
  }

  /**
   * Update user permissions in ICurrentUser object
   */
  async populateUserPermissions(currentUser: ICurrentUser): Promise<ICurrentUser> {
    try {
      const rolePermissions = this.getRolePermissions(currentUser.client.role);
      const permissions: string[] = [];

      // Create both backend format (action:scope) and frontend format (resource:action)
      Object.entries(rolePermissions).forEach(([resource, resourcePermissions]) => {
        resourcePermissions.forEach((permission: string) => {
          // Add backend format (existing)
          permissions.push(permission);

          // Add frontend format for compatibility
          const [action, scope] = permission.split(':');
          if (action && resource) {
            // Add flat permission format for frontend: "property:read", "user:create", etc.
            permissions.push(`${resource}:${action}`);

            // Also add scoped format if scope exists: "property:read:any", "property:update:mine"
            if (scope) {
              permissions.push(`${resource}:${action}:${scope}`);
            }
          }
        });
      });

      currentUser.permissions = [...new Set(permissions)]; // Remove duplicates

      return currentUser;
    } catch (error) {
      this.log.error('Error populating user permissions:', error);
      return currentUser;
    }
  }
}
