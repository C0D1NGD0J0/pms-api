import bunyan from 'bunyan';
import { createLogger } from '@utils/index';
import { AccessControl } from 'accesscontrol';
import permissionConfig from '@shared/permissions/permissions.json';
import { IUserRoleType, ICurrentUser } from '@interfaces/user.interface';
import {
  IPermissionConfig,
  IPermissionResult,
  IPermissionCheck,
  PermissionScope,
} from '@interfaces/utils.interface';

export class PermissionService {
  private readonly log: bunyan;
  private readonly permissionConfig: IPermissionConfig;
  private readonly accessControl: AccessControl;

  constructor() {
    this.log = createLogger('PermissionService');

    try {
      this.permissionConfig = permissionConfig as IPermissionConfig;
      this.accessControl = new AccessControl();
      this.initializePermissions();
      this.log.info('PermissionService initialized successfully');
    } catch (error) {
      this.log.error('Failed to initialize PermissionService:', error);
      throw error;
    }
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

    this.log.info('AccessControl permissions initialized successfully');
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
                grant.createAny(resource);
                this.log.warn(`Unknown action: ${action}, using createAny for ${resource}`);
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
                grant.createOwn(resource);
                this.log.warn(`Unknown action: ${action}, using createOwn for ${resource}`);
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

  /**
   * Check if a user has permission to perform an action on a resource
   */
  async checkPermission(permissionCheck: IPermissionCheck): Promise<IPermissionResult> {
    try {
      const { role, resource, action, scope, context } = permissionCheck;

      // Use AccessControl for standard scopes (any, mine/own)
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
              // For custom actions, fall back to business logic
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
              // For custom actions, fall back to business logic
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

      // Handle business-specific scopes (assigned, available) with custom logic
      if (scope === PermissionScope.ASSIGNED || scope === PermissionScope.AVAILABLE) {
        return this.evaluateBusinessSpecificPermission(role, resource, action, scope, context);
      }

      return {
        granted: false,
        reason: 'Permission denied',
      };
    } catch (error) {
      this.log.error('Error checking permission:', error);
      return {
        granted: false,
        reason: 'Error evaluating permission',
      };
    }
  }

  /**
   * Handle business-specific permission scopes (assigned, available)
   */
  private evaluateBusinessSpecificPermission(
    role: string,
    resource: string,
    action: string,
    scope: string,
    context?: IPermissionCheck['context']
  ): IPermissionResult {
    // Get user's role permissions for the resource from our config
    const roleConfig = this.permissionConfig.roles[role];
    if (!roleConfig) {
      return { granted: false, reason: 'Role not found' };
    }

    const rolePermissions = roleConfig[resource] || [];
    const requiredPermission = `${action}:${scope}`;

    if (rolePermissions.includes(requiredPermission)) {
      // Additional validation for assigned scope
      if (scope === PermissionScope.ASSIGNED && context) {
        // This would be implemented based on business logic
        // For now, we'll assume it's valid if the permission exists
        return { granted: true, reason: 'Business-specific permission granted' };
      }

      return { granted: true, reason: 'Business-specific permission granted' };
    }

    return { granted: false, reason: 'Business-specific permission denied' };
  }

  /**
   * Check permission for current user - primarily role-based within client context
   */
  async checkUserPermission(
    currentUser: ICurrentUser,
    resource: string,
    action: string,
    resourceData?: any
  ): Promise<IPermissionResult> {
    const userRole = currentUser.client.role;
    const userId = currentUser.sub;
    const clientId = currentUser.client.csub;

    // Determine scope based on context and resource type
    let scope = PermissionScope.ANY;

    // Special case: USER resource where ownership matters (users editing their own profile)
    if (resource === 'USER' && resourceData && resourceData._id) {
      scope = resourceData._id.toString() === userId ? PermissionScope.MINE : PermissionScope.ANY;
    }

    // Use AccessControl-integrated permission checking
    return this.checkPermission({
      role: userRole,
      resource,
      action,
      scope,
      context: {
        clientId,
        userId,
      },
    });
  }

  /**
   * Get all permissions for a role (using AccessControl)
   */
  getRolePermissions(role: IUserRoleType): Record<string, string[]> {
    try {
      // Use AccessControl to get granted permissions for the role
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

      // Also include business-specific permissions from config
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

  /**
   * Get all available resources
   */
  getAvailableResources(): string[] {
    return Object.keys(this.permissionConfig.resources);
  }

  /**
   * Get all available actions for a resource
   */
  getResourceActions(resource: string): string[] {
    return this.permissionConfig.resources[resource]?.actions || [];
  }

  /**
   * Get all available scopes
   */
  getAvailableScopes(): string[] {
    return Object.keys(this.permissionConfig.scopes);
  }

  /**
   * Validate if a permission string is valid
   */
  isValidPermission(permission: string): boolean {
    const [action, scope] = permission.split(':');

    if (!action) return false;

    // Check if scope is valid (if provided)
    if (scope && !this.getAvailableScopes().includes(scope)) {
      return false;
    }

    return true;
  }

  /**
   * Get permission configuration
   */
  getPermissionConfig(): IPermissionConfig {
    return this.permissionConfig;
  }

  /**
   * Update user permissions in ICurrentUser object
   */
  async populateUserPermissions(currentUser: ICurrentUser): Promise<ICurrentUser> {
    try {
      const rolePermissions = this.getRolePermissions(currentUser.client.role);
      const permissions: string[] = [];

      // Flatten all permissions for the user's role
      Object.values(rolePermissions).forEach((resourcePermissions) => {
        permissions.push(...resourcePermissions);
      });

      // Update the user's permissions array
      currentUser.permissions = [...new Set(permissions)]; // Remove duplicates

      return currentUser;
    } catch (error) {
      this.log.error('Error populating user permissions:', error);
      return currentUser;
    }
  }
}
