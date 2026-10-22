import { ROLES } from '@shared/constants/roles.constants';
import { PermissionService } from '@services/permission/permission.service';
import { PermissionResource, PermissionScope } from '@interfaces/utils.interface';

const USER_ID = '507f1f77bcf86cd799439011';
const OTHER_USER_ID = '507f1f77bcf86cd799439022';

describe('PermissionService — :mine/:assigned without a record to check', () => {
  const permissionService = new PermissionService();
  const baseContext = { clientId: 'CUID', userId: USER_ID };

  describe(':mine', () => {
    it('grants a held :mine permission when there is no record yet (create)', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.MANAGER,
        resource: PermissionResource.PROPERTY,
        action: 'create',
        scope: PermissionScope.MINE,
        context: baseContext,
      });

      expect(result.granted).toBe(true);
    });

    it('denies when the record is owned by someone else', async () => {
      const result = await permissionService.checkPermission({
        role: ROLES.MANAGER,
        resource: PermissionResource.PROPERTY,
        action: 'delete',
        scope: PermissionScope.MINE,
        context: { ...baseContext, resourceOwnerId: OTHER_USER_ID },
      });

      expect(result.granted).toBe(false);
    });
  });

  describe(':assigned', () => {
    const maintenanceStaff = {
      role: ROLES.STAFF,
      department: 'maintenance',
      resource: PermissionResource.MAINTENANCE,
      scope: PermissionScope.ASSIGNED,
    };

    it('grants a held :assigned list when assignees are unknown (the service scopes results)', async () => {
      const result = await permissionService.checkPermission({
        ...maintenanceStaff,
        action: 'list',
        context: baseContext,
      });

      expect(result.granted).toBe(true);
    });

    it('denies a write when the record is assigned to someone else', async () => {
      const result = await permissionService.checkPermission({
        ...maintenanceStaff,
        action: 'update',
        context: { ...baseContext, assignedUsers: [OTHER_USER_ID] },
      });

      expect(result.granted).toBe(false);
    });

    it('grants a write when the caller is among the assignees', async () => {
      const result = await permissionService.checkPermission({
        ...maintenanceStaff,
        action: 'update',
        context: { ...baseContext, assignedUsers: [USER_ID] },
      });

      expect(result.granted).toBe(true);
    });
  });
});
