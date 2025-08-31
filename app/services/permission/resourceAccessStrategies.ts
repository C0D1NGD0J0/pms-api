import { ICurrentUser } from '@interfaces/user.interface';
import { PermissionAction } from '@interfaces/utils.interface';
import { IVendorDocument } from '@interfaces/vendor.interface';

export interface IResourceAccessConfig {
  [action: string]: {
    [role: string]: IAccessRule | undefined;
    default?: IAccessRule;
  } & {
    default?: IAccessRule;
  };
}

// Types for access rules
export type IAccessRule = (currentUser: ICurrentUser, resource: any, context?: any) => boolean;

// Base strategy class
export abstract class ResourceAccessStrategy {
  protected accessRules: IResourceAccessConfig;

  constructor(rules: IResourceAccessConfig) {
    this.accessRules = rules;
  }

  canAccess(currentUser: ICurrentUser, action: PermissionAction | string, resource: any): boolean {
    const actionRules = this.accessRules[action];
    if (!actionRules) return false;

    const role = currentUser.client.role;

    // Check role-specific rule first
    if (actionRules[role]) {
      return actionRules[role](currentUser, resource);
    }

    // Fall back to default rule if exists
    if (actionRules.default) {
      return actionRules.default(currentUser, resource);
    }

    return false;
  }
}

// User resource strategy
export class UserAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.READ]: {
        admin: () => true, // Admins can read all users
        manager: (user, target) => {
          // Managers can read users who report to them or themselves
          return (
            user.sub === target._id?.toString() ||
            target.profile?.employeeInfo?.reportsTo?.toString() === user.sub
          );
        },
        vendor: (user, target) => {
          // Vendors can read users with matching linkedVendorUid or themselves
          if (user.sub === target._id?.toString()) return true;

          const connection = target.cuids?.find(
            (c: any) =>
              c.cuid === user.client.cuid && c.linkedVendorUid === user.client.linkedVendorUid
          );
          return !!connection;
        },
        tenant: (user, target) => {
          // Tenants can only read themselves
          return user.sub === target._id?.toString();
        },
        staff: (user, target) => {
          (void user, target);
          // Staff can read themselves
          // return user.sub === target._id?.toString();
          return true;
        },
        default: (user, target) => {
          return user.sub === target._id?.toString();
        },
      },
      [PermissionAction.UPDATE]: {
        admin: () => true,
        manager: (user, target) => {
          return (
            user.sub === target._id?.toString() ||
            target.profile?.employeeInfo?.reportsTo?.toString() === user.sub
          );
        },
        default: (user, target) => {
          return user.sub === target._id?.toString();
        },
      },
      [PermissionAction.DELETE]: {
        admin: () => true,
        default: () => false,
      },
      [PermissionAction.CREATE]: {
        admin: () => true,
        manager: () => true,
        default: () => false,
      },
      [PermissionAction.LIST]: {
        admin: () => true,
        manager: () => true,
        staff: () => true, // Staff can list users (but filtered results)
        vendor: () => true, // Vendors can list users (but filtered results)
        tenant: () => false, // Tenants cannot list other users
        default: () => false,
      },
    });
  }
}

// Property resource strategy
export class PropertyAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.READ]: {
        // Everyone in the same client can read properties
        default: (user, property) => {
          return property.cuid === user.client.cuid;
        },
      },
      [PermissionAction.LIST]: {
        // Everyone in the same client can list properties
        default: () => true,
      },
      [PermissionAction.CREATE]: {
        admin: () => true,
        manager: () => true,
        default: () => false,
      },
      [PermissionAction.UPDATE]: {
        admin: () => true,
        manager: (user, property) => {
          // Managers can update properties they created or manage
          return (
            property.createdBy?.toString() === user.sub ||
            property.managedBy?.toString() === user.sub
          );
        },
        staff: (user, property) => {
          // Staff can update if specifically assigned
          return property.managedBy?.toString() === user.sub;
        },
        default: () => false,
      },
      [PermissionAction.DELETE]: {
        admin: () => true,
        manager: (user, property) => {
          // Managers can only delete properties they created
          return property.createdBy?.toString() === user.sub;
        },
        default: () => false,
      },
    });
  }
}

// Maintenance resource strategy
export class MaintenanceAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.READ]: {
        admin: () => true,
        manager: () => true,
        vendor: (user, maintenance) => {
          // Vendors can read maintenance requests assigned to them
          return maintenance.assignedTo?.toString() === user.sub;
        },
        tenant: (user, maintenance) => {
          // Tenants can read maintenance requests they created
          return maintenance.createdBy?.toString() === user.sub;
        },
        default: () => false,
      },
      [PermissionAction.CREATE]: {
        admin: () => true,
        manager: () => true,
        tenant: () => true, // Tenants can create maintenance requests
        default: () => false,
      },
      [PermissionAction.UPDATE]: {
        admin: () => true,
        manager: () => true,
        vendor: (user, maintenance) => {
          // Vendors can update maintenance requests assigned to them
          return maintenance.assignedTo?.toString() === user.sub;
        },
        default: () => false,
      },
      [PermissionAction.DELETE]: {
        admin: () => true,
        manager: () => true,
        default: () => false,
      },
    });
  }
}

// Invitation resource strategy
export class InvitationAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.CREATE]: {
        admin: () => true,
        manager: () => true,
        default: () => false,
      },
      [PermissionAction.READ]: {
        admin: () => true,
        manager: () => true,
        default: (user, invitation) => {
          // Users can read invitations sent to them
          return invitation.email === user.email;
        },
      },
      [PermissionAction.REVOKE]: {
        admin: () => true,
        manager: (user, invitation) => {
          // Managers can revoke invitations they created
          return invitation.createdBy?.toString() === user.sub;
        },
        default: () => false,
      },
      [PermissionAction.RESEND]: {
        admin: () => true,
        manager: (user, invitation) => {
          // Managers can resend invitations they created
          return invitation.createdBy?.toString() === user.sub;
        },
        default: () => false,
      },
    });
  }
}

// Vendor resource strategy
export class VendorAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.READ]: {
        admin: () => true,
        manager: () => true,
        default: (user: ICurrentUser, _vendor: IVendorDocument) => {
          const notAllowedRoles = ['vendor'];
          if (notAllowedRoles.includes(user.client.role)) {
            return false;
          }
          return true;
        },
      },
      [PermissionAction.UPDATE]: {
        admin: () => true,
        default: () => false,
      },
      [PermissionAction.LIST]: {
        admin: () => true,
        manager: () => true,
        default: (user: ICurrentUser, _vendor: IVendorDocument) => {
          const notAllowedRoles = ['vendor'];
          if (notAllowedRoles.includes(user.client.role)) {
            return false;
          }
          return true;
        },
      },
    });
  }
}

// Lease resource strategy
export class LeaseAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.READ]: {
        admin: () => true,
        manager: () => true,
        tenant: (user, lease) => {
          // Tenants can read their own leases
          return lease.tenantId?.toString() === user.sub;
        },
        default: () => false,
      },
      [PermissionAction.CREATE]: {
        admin: () => true,
        manager: () => true,
        default: () => false,
      },
      [PermissionAction.UPDATE]: {
        admin: () => true,
        manager: (user, lease) => {
          // Managers can update leases they manage
          return lease.managedBy?.toString() === user.sub;
        },
        default: () => false,
      },
      [PermissionAction.DELETE]: {
        admin: () => true,
        default: () => false,
      },
    });
  }
}

// Payment resource strategy
export class PaymentAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.READ]: {
        admin: () => true,
        manager: () => true,
        tenant: (user, payment) => {
          // Tenants can read their own payments
          return payment.tenantId?.toString() === user.sub;
        },
        default: () => false,
      },
      [PermissionAction.CREATE]: {
        admin: () => true,
        manager: () => true,
        tenant: () => true, // Tenants can make payments
        default: () => false,
      },
      [PermissionAction.UPDATE]: {
        admin: () => true,
        manager: () => true,
        default: () => false,
      },
      [PermissionAction.DELETE]: {
        admin: () => true,
        default: () => false,
      },
    });
  }
}

// Client resource strategy
export class ClientAccessStrategy extends ResourceAccessStrategy {
  constructor() {
    super({
      [PermissionAction.READ]: {
        // Users can read their own client info
        default: (user, client) => {
          return client.cuid === user.client.cuid;
        },
      },
      [PermissionAction.UPDATE]: {
        admin: () => true,
        default: () => false,
      },
      [PermissionAction.SETTINGS]: {
        admin: () => true,
        manager: () => true,
        default: () => false,
      },
    });
  }
}
