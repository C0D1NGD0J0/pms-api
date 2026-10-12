import { ICurrentUser } from '@interfaces/user.interface';
import { ROLES } from '@shared/constants/roles.constants';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { PermissionService } from '@services/permission/permission.service';
import { PermissionResource, PermissionScope } from '@interfaces/utils.interface';

const permissionService = new PermissionService();
const config = permissionService.getPermissionConfig();
const DEPARTMENTS = Object.keys(config.roles.staff.departments ?? {});

const hasGrant = (resource: string, permission: string, department?: string): boolean =>
  (permissionService as any).hasPermissionWithInheritance(
    ROLES.STAFF,
    resource,
    permission,
    department
  );

const effectiveGrants = (department?: string): Record<string, string[]> =>
  (permissionService as any).getEffectivePermissions(ROLES.STAFF, department);

const staffUser = (department?: string): ICurrentUser =>
  ({
    sub: 'staff-sub',
    uid: 'staff-uid',
    permissions: [],
    clients: [{ cuid: 'client-1', isConnected: true }],
    client: { cuid: 'client-1', role: ROLES.STAFF },
    employeeInfo: department ? { department } : undefined,
  }) as unknown as ICurrentUser;

const canDo = async (department: string | undefined, resource: string, action: string) =>
  (
    await permissionService.checkUserPermission(
      staffUser(department),
      resource as PermissionResource,
      action
    )
  ).granted;

describe('staff department grants replace base staff grants', () => {
  describe.each(DEPARTMENTS)('%s department — API check matches the UI permission list', (dept) => {
    it('agrees on every resource:action:scope', () => {
      const effective = effectiveGrants(dept);
      const mismatches: string[] = [];

      for (const [resource, { actions, scopes }] of Object.entries(config.resources)) {
        const granted = effective[resource] ?? [];
        for (const action of actions) {
          for (const scope of scopes) {
            const permission = `${action}:${scope}`;
            const expected =
              granted.includes(permission) ||
              (scope === PermissionScope.MINE && granted.includes(`${action}:any`));
            if (hasGrant(resource, permission, dept) !== expected) {
              mismatches.push(`${resource}:${permission}`);
            }
          }
        }
      }

      expect(mismatches).toEqual([]);
    });

    it('gives every department its own user record (read/update/delete mine)', () => {
      for (const action of ['read', 'update', 'delete']) {
        expect(hasGrant('user', `${action}:mine`, dept)).toBe(true);
      }
    });
  });

  it('uses the department grants only (no base staff grants leak in)', () => {
    expect(hasGrant('lease', 'read:any', EmployeeDepartment.SECURITY)).toBe(false);
    expect(hasGrant('payment', 'list:any', EmployeeDepartment.MAINTENANCE)).toBe(false);
    expect(hasGrant('guest_pass', 'read:any', EmployeeDepartment.ACCOUNTING)).toBe(false);
  });

  it('keeps base staff grants for staff without a department', () => {
    expect(hasGrant('lease', 'read:any')).toBe(true);
    expect(effectiveGrants(undefined)).toEqual(permissionService.getRolePermissions(ROLES.STAFF));
  });

  it("keeps base staff grants for an unknown department (e.g. the UI's 'other')", () => {
    expect(hasGrant('lease', 'read:any', EmployeeDepartment.OTHER)).toBe(true);
    expect(effectiveGrants(EmployeeDepartment.OTHER)).toEqual(
      permissionService.getRolePermissions(ROLES.STAFF)
    );
  });

  it('gives the new department grants', () => {
    expect(hasGrant('property', 'read:any', EmployeeDepartment.ACCOUNTING)).toBe(true);
    expect(hasGrant('property', 'list:any', EmployeeDepartment.ACCOUNTING)).toBe(true);
    expect(hasGrant('property', 'list:assigned', EmployeeDepartment.MAINTENANCE)).toBe(true);
    for (const dept of ['operations', 'maintenance', 'management']) {
      expect(hasGrant('vendor', 'read:any', dept)).toBe(true);
      expect(hasGrant('vendor', 'list:any', dept)).toBe(true);
    }
    expect(hasGrant('maintenance', 'create:assigned', EmployeeDepartment.MAINTENANCE)).toBe(false);
  });
});

describe('checkUserPermission — staff scope fallback (any → assigned → mine)', () => {
  it('lets maintenance staff reach list/read routes they hold only :assigned for', async () => {
    expect(await canDo('maintenance', 'maintenance', 'list')).toBe(true);
    expect(await canDo('maintenance', 'maintenance', 'read')).toBe(true);
    expect(await canDo('maintenance', 'property', 'list')).toBe(true);
    expect(await canDo('maintenance', 'property', 'read')).toBe(true);
  });

  it('denies maintenance staff on actions they hold no scope for', async () => {
    expect(await canDo('maintenance', 'maintenance', 'create')).toBe(false);
    expect(await canDo('maintenance', 'maintenance', 'stats')).toBe(false);
    expect(await canDo('maintenance', 'payment', 'list')).toBe(false);
  });

  it('does not open write routes through an unverifiable :assigned grant', async () => {
    expect(await canDo('maintenance', 'maintenance', 'update')).toBe(false);
    expect(await canDo('operations', 'property', 'update')).toBe(false);
    expect(await canDo('operations', 'lease', 'update')).toBe(false);
  });

  it('denies security staff lease, payment and expense reads', async () => {
    for (const resource of ['lease', 'payment', 'expense']) {
      expect(await canDo('security', resource, 'read')).toBe(false);
      expect(await canDo('security', resource, 'list')).toBe(false);
    }
    expect(await canDo('security', 'property', 'list')).toBe(true);
    expect(await canDo('security', 'guest_pass', 'read')).toBe(true);
  });

  it('gives guest-pass access to the security department only, scoped to :assigned', async () => {
    expect(hasGrant('guest_pass', 'read:any', EmployeeDepartment.SECURITY)).toBe(false);
    for (const action of ['read', 'list', 'update']) {
      expect(hasGrant('guest_pass', `${action}:assigned`, EmployeeDepartment.SECURITY)).toBe(true);
      // guest-pass services scope writes to the assignment themselves
      expect(await canDo('security', 'guest_pass', action)).toBe(true);
    }
    expect(await canDo('security', 'guest_pass', 'delete')).toBe(false);
    expect(await canDo('security', 'guest_pass', 'create')).toBe(false);

    for (const department of [undefined, 'other', ...DEPARTMENTS.filter((d) => d !== 'security')]) {
      for (const action of ['read', 'list', 'update']) {
        expect(await canDo(department, 'guest_pass', action)).toBe(false);
      }
    }
  });

  it('keeps :any checks for departments that hold :any', async () => {
    expect(await canDo('accounting', 'payment', 'create')).toBe(true);
    expect(await canDo('management', 'maintenance', 'stats')).toBe(true);
  });
});
