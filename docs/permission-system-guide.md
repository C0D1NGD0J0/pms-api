# Permission System & Role-Based Access Control Guide

This document explains the comprehensive permission system and role-based access control (RBAC) implementation in the Property Management System API.

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Roles and Hierarchy](#roles-and-hierarchy)
4. [Resources and Actions](#resources-and-actions)
5. [Permission Scopes](#permission-scopes)
6. [Permission Configuration](#permission-configuration)
7. [Permission Checking Flow](#permission-checking-flow)
8. [Middleware System](#middleware-system)
9. [Usage Examples](#usage-examples)
10. [Troubleshooting](#troubleshooting)

## Overview

The permission system is built on a flexible role-based access control (RBAC) model that combines:
- **Hierarchical roles** with inheritance
- **Resource-based permissions** for different system entities
- **Scope-based access control** (any, mine, assigned, available)
- **Dual-layer permission checking** (AccessControl + Business Logic)

## Architecture

The permission system consists of several key components:

```
┌─────────────────────────────────────────────────────────────┐
│                    Permission System                        │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  permissions.   │  │  PermissionServ │  |  Middleware     │ │
│  │  json           │  │                 │  │  Functions      │ │
│  │  (Config)       │  │  (Logic)        │  │  (Enforcement)  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│                                                                │
│  ┌─────────────────┐  ┌─────────────────┐                      │
│  │  AccessControl  │  │  Business Logic │                      │
│  │  (CRUD Actions) │  │  (Custom Actions)│                      │
│  └─────────────────┘  └─────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

## Roles and Hierarchy

### Role Hierarchy

The system uses a hierarchical role structure with inheritance:

```
admin (extends manager)
├── manager (extends staff)
    ├── staff (extends tenant)
        ├── tenant (base role)
        └── vendor (parallel to tenant)
```

### Role Definitions

#### **Admin**
- **Inherits**: All manager permissions
- **Additional Powers**:
  - Remove users from system
  - Assign roles to users
  - Manage client settings
  - Full invitation management

#### **Manager**
- **Inherits**: All staff permissions
- **Additional Powers**:
  - Create/delete properties
  - Create/delete maintenance requests
  - Create/delete leases
  - Send/revoke invitations

#### **Staff**
- **Inherits**: All tenant permissions
- **Additional Powers**:
  - Read any property
  - Update assigned properties
  - List all users
  - Manage assigned maintenance/leases
  - View all payments and reports

#### **Tenant**
- **Base Role**:
  - Read available properties
  - Manage own profile
  - Create/manage own maintenance requests
  - View own leases and payments

#### **Vendor**
- **Parallel Role**:
  - Read assigned properties
  - Update assigned maintenance requests
  - View assigned leases and payments

## Resources and Actions

### Available Resources

| Resource | Description |
|----------|-------------|
| `property` | Property management operations |
| `user` | User management operations |
| `invitation` | Invitation management operations |
| `client` | Company account operations |
| `maintenance` | Maintenance request operations |
| `lease` | Lease agreement operations |
| `payment` | Payment and billing operations |
| `report` | Report generation operations |

### Available Actions

| Action | Description |
|--------|-------------|
| `create` | Create new resource |
| `read` | View resource details |
| `update` | Modify existing resource |
| `delete` | Remove resource |
| `list` | View multiple resources |
| `send` | Send invitations |
| `revoke` | Revoke invitations |
| `resend` | Resend invitations |
| `stats` | View statistics |
| `invite` | Invite users |
| `remove` | Remove users |
| `assign_roles` | Assign roles to users |
| `settings` | Manage settings |
| `manage_users` | Manage users |

## Permission Scopes

Scopes define the breadth of access for each permission:

### **ANY** (`any`)
- **Description**: Can perform action on any resource within their company
- **Use Case**: Admin/Manager operations across all resources
- **Example**: Admin can read any property in the company

### **MINE** (`mine`)
- **Description**: Can perform action only on resources they own/created
- **Use Case**: Personal resource management
- **Example**: Tenant can update their own profile

### **ASSIGNED** (`assigned`)
- **Description**: Can perform action only on resources assigned to them
- **Use Case**: Staff working on assigned tasks
- **Example**: Staff can update maintenance requests assigned to them

### **AVAILABLE** (`available`)
- **Description**: Can view publicly available resources (read-only)
- **Use Case**: Browsing available properties
- **Example**: Tenant can view available properties for rent

## Permission Configuration

### Configuration Structure

```json
{
  "roles": {
    "admin": {
      "$extend": ["manager"],
      "user": ["remove:any", "assign_roles:any"],
      "client": ["settings:any", "manage_users:any"]
    }
  },
  "resources": {
    "property": {
      "actions": ["create", "read", "update", "delete", "list"],
      "scopes": ["any", "mine", "assigned", "available"]
    }
  },
  "scopes": {
    "any": { "description": "Can perform action on any resource within their company" }
  }
}
```

### Permission Format

Permissions are defined as `action:scope` pairs:
- `create:any` - Can create any resource
- `read:mine` - Can read only own resources
- `update:assigned` - Can update assigned resources

## Permission Checking Flow

The permission system uses a dual-layer approach:

```
┌─────────────────────────────────────────────────────────────┐
│                 Permission Check Request                    │
│                                                             │
│  Role: admin                                                │
│  Resource: invitation                                       │
│  Action: send                                               │
│  Scope: any                                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    Layer 1: AccessControl                  │
│                                                             │
│  ✓ Handles: create, read, update, delete                   │
│  ✗ Fails: send, revoke, resend (custom actions)           │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 Layer 2: Business Logic                    │
│                                                             │
│  ✓ Handles: All custom actions                             │
│  ✓ Checks: permissions.json directly                       │
│  ✓ Supports: Role inheritance                              │
└─────────────────────────────────────────────────────────────┘
```

### Step-by-Step Process

1. **Route Protection**: Middleware checks if user has required permission
2. **User Context**: Extract user role and client information
3. **Scope Determination**: Determine appropriate scope based on resource type
4. **AccessControl Check**: Try standard CRUD operations first
5. **Business Logic Fallback**: Handle custom actions and scopes
6. **Role Inheritance**: Check parent roles if direct permission not found
7. **Decision**: Grant or deny access based on results

## Middleware System

### Core Middleware Functions

#### `requirePermission(resource, action)`
Checks if user has specific permission for a resource/action combination.

```typescript
router.post(
  '/:cid/send_invite',
  isAuthenticated,
  requirePermission(PermissionResource.INVITATION, PermissionAction.SEND),
  controller.sendInvitation
);
```

#### `requireAnyPermission(permissions[])`
Checks if user has ANY of the specified permissions (OR logic).

```typescript
requireAnyPermission([
  { resource: PermissionResource.USER, action: PermissionAction.ASSIGN_ROLES },
  { resource: PermissionResource.CLIENT, action: PermissionAction.MANAGE_USERS }
])
```

#### `requireAllPermissions(permissions[])`
Checks if user has ALL specified permissions (AND logic).

```typescript
requireAllPermissions([
  { resource: PermissionResource.PROPERTY, action: PermissionAction.READ },
  { resource: PermissionResource.PROPERTY, action: PermissionAction.UPDATE }
])
```

#### `requireUserManagement()`
Specialized middleware for user management operations.

```typescript
router.post('/users/:uid/assign-role', requireUserManagement(), controller.assignRole);
```

## Usage Examples

### Example 1: Basic Permission Check

```typescript
// Route with permission check
router.post(
  '/:cid/properties',
  isAuthenticated,
  requirePermission(PermissionResource.PROPERTY, PermissionAction.CREATE),
  controller.createProperty
);
```

### Example 2: Custom Permission Logic

```typescript
// Service method checking permissions
async createProperty(userId: string, propertyData: any) {
  const user = await this.getCurrentUser(userId);

  const hasPermission = await this.permissionService.checkUserPermission(
    user,
    PermissionResource.PROPERTY,
    PermissionAction.CREATE
  );

  if (!hasPermission.granted) {
    throw new ForbiddenError('Insufficient permissions');
  }

  // Proceed with creation
}
```

### Example 3: Role-Based Resource Access

```typescript
// Different access levels based on role
async getProperties(userId: string) {
  const user = await this.getCurrentUser(userId);

  switch (user.client.role) {
    case 'admin':
    case 'manager':
      // Can see all properties
      return this.propertyDAO.findAll({ clientId: user.client.csub });

    case 'staff':
      // Can see assigned properties
      return this.propertyDAO.findAssigned({ userId });

    case 'tenant':
      // Can see available properties
      return this.propertyDAO.findAvailable({ clientId: user.client.csub });

    default:
      throw new ForbiddenError('No access to properties');
  }
}
```

## Troubleshooting

### Common Issues

#### 1. "Insufficient permissions" Error
**Cause**: User doesn't have required permission for the action
**Solution**:
- Check user's role in `currentUser.client.role`
- Verify permission exists in `permissions.json`
- Ensure proper scope is being used

#### 2. Custom Actions Not Working
**Cause**: AccessControl doesn't handle custom actions, needs business logic fallback
**Solution**:
- Ensure all scopes have fallback in `checkPermission` method
- Verify custom action is defined in `permissions.json`

#### 3. Role Inheritance Not Working
**Cause**: Role extension configuration or inheritance logic issue
**Solution**:
- Check `$extend` configuration in `permissions.json`
- Verify `hasPermissionWithInheritance` method is working

#### 4. Client Context Issues
**Cause**: User trying to access resources from different client
**Solution**:
- Ensure `clientId` parameter matches `currentUser.client.csub`
- Check middleware validates client context

### Debug Steps

1. **Check User Role**: `console.log(currentUser.client.role)`
2. **Check Permission Config**: Verify permission exists in `permissions.json`
3. **Check Scope**: Ensure correct scope is being used
4. **Check Client Context**: Verify user has access to the client
5. **Check Middleware**: Ensure proper middleware is applied to route

### Permission Testing

```typescript
// Test permission checking
const permissionService = new PermissionService();

const result = await permissionService.checkPermission({
  role: 'admin',
  resource: 'invitation',
  action: 'send',
  scope: 'any'
});

console.log(result); // { granted: true, reason: "..." }
```

## Best Practices

1. **Use Specific Scopes**: Choose the most restrictive scope possible
2. **Validate Client Context**: Always verify user has access to the client
3. **Handle Custom Actions**: Ensure business logic fallback covers all custom actions
4. **Test Role Inheritance**: Verify permissions work correctly across role hierarchy
5. **Log Permission Checks**: Use logging to debug permission issues
6. **Consistent Naming**: Use consistent resource and action names across the system

This permission system provides a robust, flexible foundation for securing your Property Management System API while maintaining clear separation of concerns and extensibility.
