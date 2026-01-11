import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { disconnectTestDatabase, setupTestDatabase, clearTestDatabase } from '@tests/helpers';
import { PermissionResource, PermissionAction, PermissionScope } from '@interfaces/utils.interface';

describe('PermissionService Integration Tests', () => {
  let permissionService: PermissionService;

  beforeAll(async () => {
    await setupTestDatabase();
    permissionService = new PermissionService();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('populateUserPermissions', () => {
    it('should populate admin permissions correctly', async () => {
      const adminUser: ICurrentUser = {
        sub: 'admin-123',
        uid: 'admin-uid',
        email: 'admin@test.com',
        fullname: 'Admin User',
        displayName: 'Admin User',
        avatarUrl: '',
        isActive: true,
        permissions: [],
        clients: [],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.ADMIN,
        },
        preferences: {},
      } as ICurrentUser;

      const result = await permissionService.populateUserPermissions(adminUser);

      expect(result.permissions).toBeDefined();
      expect(result.permissions.length).toBeGreaterThan(0);
      // Admin should have delete:any permission for properties
      expect(result.permissions).toContain('delete:any');
      expect(result.permissions).toContain('property:delete:any');
    });

    it('should populate manager permissions correctly', async () => {
      const managerUser: ICurrentUser = {
        sub: 'manager-123',
        uid: 'manager-uid',
        email: 'manager@test.com',
        fullname: 'Manager User',
        displayName: 'Manager User',
        avatarUrl: '',
        isActive: true,
        permissions: [],
        clients: [],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.MANAGER,
        },
        preferences: {},
      } as ICurrentUser;

      const result = await permissionService.populateUserPermissions(managerUser);

      expect(result.permissions).toBeDefined();
      // Manager should have property create:mine permission
      expect(result.permissions).toContain('create:mine');
      expect(result.permissions).toContain('property:create:mine');
    });

    it('should apply accounting department permissions for staff', async () => {
      const accountingStaff: ICurrentUser = {
        sub: 'staff-123',
        uid: 'staff-uid',
        email: 'accounting@test.com',
        fullname: 'Accounting Staff',
        displayName: 'Accounting Staff',
        avatarUrl: '',
        isActive: true,
        permissions: [],
        clients: [],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.STAFF,
        },
        employeeInfo: {
          department: EmployeeDepartment.ACCOUNTING,
          jobTitle: 'Accountant',
        },
        preferences: {},
      } as ICurrentUser;

      const result = await permissionService.populateUserPermissions(accountingStaff);

      expect(result.permissions).toBeDefined();
      // Accounting staff should have payment create permissions
      expect(result.permissions).toContain('payment:create:any');
      expect(result.permissions).toContain('payment:update:any');
      expect(result.permissions).toContain('report:create:any');
    });

    it('should apply maintenance department permissions for staff', async () => {
      const maintenanceStaff: ICurrentUser = {
        sub: 'staff-456',
        uid: 'staff-uid',
        email: 'maintenance@test.com',
        fullname: 'Maintenance Staff',
        displayName: 'Maintenance Staff',
        avatarUrl: '',
        isActive: true,
        permissions: [],
        clients: [],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.STAFF,
        },
        employeeInfo: {
          department: EmployeeDepartment.MAINTENANCE,
          jobTitle: 'Maintenance Tech',
        },
        preferences: {},
      } as ICurrentUser;

      const result = await permissionService.populateUserPermissions(maintenanceStaff);

      expect(result.permissions).toBeDefined();
      // Maintenance staff should have assigned maintenance permissions
      expect(result.permissions).toContain('maintenance:create:assigned');
      expect(result.permissions).toContain('maintenance:update:assigned');
      expect(result.permissions).toContain('property:read:assigned');
    });

    it('should use base staff permissions when no department assigned', async () => {
      const staffNoDept: ICurrentUser = {
        sub: 'staff-789',
        uid: 'staff-uid',
        email: 'staff@test.com',
        fullname: 'Staff User',
        displayName: 'Staff User',
        avatarUrl: '',
        isActive: true,
        permissions: [],
        clients: [],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.STAFF,
        },
        preferences: {},
      } as ICurrentUser;

      const result = await permissionService.populateUserPermissions(staffNoDept);

      expect(result.permissions).toBeDefined();
      // Should have base staff permissions (read access)
      expect(result.permissions).toContain('property:read:any');
      expect(result.permissions).toContain('tenant:read:any');
      // But NOT create/update permissions
      expect(result.permissions).not.toContain('payment:create:any');
      expect(result.permissions).not.toContain('property:create:any');
    });

    it('should populate tenant permissions correctly', async () => {
      const tenantUser: ICurrentUser = {
        sub: 'tenant-123',
        uid: 'tenant-uid',
        email: 'tenant@test.com',
        fullname: 'Tenant User',
        displayName: 'Tenant User',
        avatarUrl: '',
        isActive: true,
        permissions: [],
        clients: [],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.TENANT,
        },
        preferences: {},
      } as ICurrentUser;

      const result = await permissionService.populateUserPermissions(tenantUser);

      expect(result.permissions).toBeDefined();
      // Tenant should only have mine scope
      expect(result.permissions).toContain('property:read:mine');
      expect(result.permissions).toContain('maintenance:create:mine');
      expect(result.permissions).toContain('payment:create:mine');
      // Should NOT have any scope
      expect(result.permissions).not.toContain('property:read:any');
    });

    it('should populate vendor permissions correctly', async () => {
      const vendorUser: ICurrentUser = {
        sub: 'vendor-123',
        uid: 'vendor-uid',
        email: 'vendor@test.com',
        fullname: 'Vendor User',
        displayName: 'Vendor User',
        avatarUrl: '',
        isActive: true,
        permissions: [],
        clients: [],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.VENDOR,
        },
        preferences: {},
      } as ICurrentUser;

      const result = await permissionService.populateUserPermissions(vendorUser);

      expect(result.permissions).toBeDefined();
      // Vendor should only have assigned scope
      expect(result.permissions).toContain('property:read:assigned');
      expect(result.permissions).toContain('maintenance:update:assigned');
      // Should NOT have any or mine scope
      expect(result.permissions).not.toContain('property:read:any');
      expect(result.permissions).not.toContain('property:read:mine');
    });
  });

  describe('checkPermission', () => {
    it('should grant permission with ANY scope to admin', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.ADMIN,
        resource: PermissionResource.PROPERTY,
        action: PermissionAction.DELETE,
        scope: PermissionScope.ANY,
        context: {
          userId: 'admin-123',
          clientId: 'test-cuid',
        },
      });

      expect(result.granted).toBe(true);
    });

    it('should grant permission with MINE scope when user owns resource', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.MANAGER,
        resource: PermissionResource.PROPERTY,
        action: PermissionAction.DELETE,
        scope: PermissionScope.MINE,
        context: {
          userId: 'manager-123',
          clientId: 'test-cuid',
          resourceOwnerId: 'manager-123', // User owns the resource
        },
      });

      expect(result.granted).toBe(true);
    });

    it('should deny permission with MINE scope when user does not own resource', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.MANAGER,
        resource: PermissionResource.PROPERTY,
        action: PermissionAction.DELETE,
        scope: PermissionScope.MINE,
        context: {
          userId: 'manager-123',
          clientId: 'test-cuid',
          resourceOwnerId: 'other-user-456', // Different owner
        },
      });

      expect(result.granted).toBe(false);
      expect(result.reason).toContain('does not own resource');
    });

    it('should grant permission with ASSIGNED scope when user is assigned', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.VENDOR,
        resource: PermissionResource.MAINTENANCE,
        action: PermissionAction.UPDATE,
        scope: PermissionScope.ASSIGNED,
        context: {
          userId: 'vendor-123',
          clientId: 'test-cuid',
          assignedUsers: ['vendor-123', 'other-vendor'], // User is assigned
        },
      });

      expect(result.granted).toBe(true);
    });

    it('should deny permission with ASSIGNED scope when user is not assigned', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.VENDOR,
        resource: PermissionResource.MAINTENANCE,
        action: PermissionAction.UPDATE,
        scope: PermissionScope.ASSIGNED,
        context: {
          userId: 'vendor-123',
          clientId: 'test-cuid',
          assignedUsers: ['other-vendor'], // User NOT assigned
        },
      });

      expect(result.granted).toBe(false);
      expect(result.reason).toContain('does not have assigned access');
    });

    it('should deny permission when role does not have the permission', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.TENANT,
        resource: PermissionResource.PROPERTY,
        action: PermissionAction.DELETE,
        scope: PermissionScope.ANY,
        context: {
          userId: 'tenant-123',
          clientId: 'test-cuid',
        },
      });

      expect(result.granted).toBe(false);
      expect(result.reason).toContain('does not have permission');
    });
  });

  describe('checkUserPermission', () => {
    it('should grant admin access to any property', async () => {
      const adminUser: ICurrentUser = {
        sub: 'admin-123',
        uid: 'admin-uid',
        email: 'admin@test.com',
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.ADMIN,
        },
        permissions: [],
      } as ICurrentUser;

      const property = {
        _id: 'prop-123',
        cuid: 'test-cuid',
        createdBy: 'other-user',
      };

      const result = await permissionService.checkUserPermission(
        adminUser,
        PermissionResource.PROPERTY,
        PermissionAction.DELETE,
        property
      );

      expect(result.granted).toBe(true);
    });

    it('should deny manager delete on property they do not own', async () => {
      const managerUser: ICurrentUser = {
        sub: 'manager-123',
        uid: 'manager-uid',
        email: 'manager@test.com',
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.MANAGER,
        },
        permissions: [],
      } as ICurrentUser;

      const property = {
        _id: 'prop-123',
        cuid: 'test-cuid',
        createdBy: 'other-manager', // Different owner
      };

      const result = await permissionService.checkUserPermission(
        managerUser,
        PermissionResource.PROPERTY,
        PermissionAction.DELETE,
        property
      );

      expect(result.granted).toBe(false);
    });

    it('should grant admin delete on any property', async () => {
      const adminUser: ICurrentUser = {
        sub: 'admin-123',
        uid: 'admin-uid',
        email: 'admin@test.com',
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.ADMIN,
        },
        permissions: [],
      } as ICurrentUser;

      const property = {
        _id: 'prop-123',
        cuid: 'test-cuid',
        createdBy: 'other-user', // Admin can delete any property
      };

      const result = await permissionService.checkUserPermission(
        adminUser,
        PermissionResource.PROPERTY,
        PermissionAction.DELETE,
        property
      );

      expect(result.granted).toBe(true);
    });

    it('should deny tenant access to property they are not assigned to', async () => {
      const tenantUser: ICurrentUser = {
        sub: 'tenant-123',
        uid: 'tenant-uid',
        email: 'tenant@test.com',
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.TENANT,
        },
        permissions: [],
      } as ICurrentUser;

      const property = {
        _id: 'prop-456',
        cuid: 'test-cuid',
        tenants: ['other-tenant'], // Different tenant
      };

      const result = await permissionService.checkUserPermission(
        tenantUser,
        PermissionResource.PROPERTY,
        PermissionAction.READ,
        property
      );

      expect(result.granted).toBe(false);
    });
  });

  describe('canAccessResource', () => {
    it('should return true when permission is granted', async () => {
      const adminUser: ICurrentUser = {
        sub: 'admin-123',
        uid: 'admin-uid',
        email: 'admin@test.com',
        clients: [{ cuid: 'test-cuid', isConnected: true } as any],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.ADMIN,
        },
        permissions: [],
      } as ICurrentUser;

      const property = { _id: 'prop-123', cuid: 'test-cuid' };

      const canAccess = await permissionService.canAccessResource(
        adminUser,
        PermissionResource.PROPERTY,
        PermissionAction.DELETE,
        property
      );

      expect(canAccess).toBe(true);
    });

    it('should return false when permission is denied', async () => {
      const tenantUser: ICurrentUser = {
        sub: 'tenant-123',
        uid: 'tenant-uid',
        email: 'tenant@test.com',
        clients: [{ cuid: 'test-cuid', isConnected: true } as any],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.TENANT,
        },
        permissions: [],
      } as ICurrentUser;

      const property = { _id: 'prop-123', cuid: 'test-cuid' };

      const canAccess = await permissionService.canAccessResource(
        tenantUser,
        PermissionResource.PROPERTY,
        PermissionAction.DELETE,
        property
      );

      expect(canAccess).toBe(false);
    });

    it('should return false when user is not connected to client', async () => {
      const disconnectedUser: ICurrentUser = {
        sub: 'user-123',
        uid: 'user-uid',
        email: 'user@test.com',
        clients: [{ cuid: 'test-cuid', isConnected: false } as any],
        client: {
          cuid: 'test-cuid',
          displayname: 'Test Company',
          role: ROLES.ADMIN,
        },
        permissions: [],
      } as ICurrentUser;

      const property = { _id: 'prop-123', cuid: 'test-cuid' };

      const canAccess = await permissionService.canAccessResource(
        disconnectedUser,
        PermissionResource.PROPERTY,
        PermissionAction.READ,
        property
      );

      expect(canAccess).toBe(false);
    });
  });

  describe('getRolePermissions', () => {
    it('should return admin permissions', () => {
      const perms = permissionService.getRolePermissions(ROLES.ADMIN);

      expect(perms).toBeDefined();
      expect(Object.keys(perms).length).toBeGreaterThan(0);
      expect(perms.property).toContain('delete:any');
    });

    it('should return manager permissions', () => {
      const perms = permissionService.getRolePermissions(ROLES.MANAGER);

      expect(perms).toBeDefined();
      expect(perms.property).toContain('create:mine');
      expect(perms.tenant).toContain('create:any');
    });

    it('should return staff base permissions', () => {
      const perms = permissionService.getRolePermissions(ROLES.STAFF);

      expect(perms).toBeDefined();
      expect(perms.property).toContain('read:any');
      expect(perms.tenant).toContain('read:any');
    });

    it('should return tenant permissions', () => {
      const perms = permissionService.getRolePermissions(ROLES.TENANT);

      expect(perms).toBeDefined();
      expect(perms.property).toContain('read:mine');
      expect(perms.maintenance).toContain('create:mine');
    });

    it('should return vendor permissions', () => {
      const perms = permissionService.getRolePermissions(ROLES.VENDOR);

      expect(perms).toBeDefined();
      expect(perms.property).toContain('read:assigned');
      expect(perms.maintenance).toContain('update:assigned');
    });
  });

  describe('getAvailableResources', () => {
    it('should return list of all available resources', () => {
      const resources = permissionService.getAvailableResources();

      expect(resources).toBeDefined();
      expect(Array.isArray(resources)).toBe(true);
      expect(resources).toContain('property');
      expect(resources).toContain('user');
      expect(resources).toContain('lease');
      expect(resources).toContain('payment');
    });
  });

  describe('getResourceActions', () => {
    it('should return actions for property resource', () => {
      const actions = permissionService.getResourceActions('property');

      expect(actions).toBeDefined();
      expect(Array.isArray(actions)).toBe(true);
      expect(actions).toContain('create');
      expect(actions).toContain('read');
      expect(actions).toContain('update');
      expect(actions).toContain('delete');
      expect(actions).toContain('list');
    });

    it('should return actions for user resource', () => {
      const actions = permissionService.getResourceActions('user');

      expect(actions).toBeDefined();
      expect(actions).toContain('read');
      expect(actions).toContain('update');
      expect(actions).toContain('remove');
    });
  });
});
