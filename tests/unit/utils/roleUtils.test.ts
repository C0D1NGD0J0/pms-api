import { Types } from 'mongoose';
import { preventTenantConflict } from '@utils/index';
import { ForbiddenError } from '@shared/customErrors';
import {
  resolveHighestRole,
  ROLE_PRIORITY,
  ROLES,
  IUserRole,
  ROLE_GROUPS,
  RoleHelpers,
} from '@shared/constants/roles.constants';

describe('resolveHighestRole', () => {
  it('returns the single role when the array has one entry', () => {
    expect(resolveHighestRole(['staff'])).toBe('staff');
  });

  it('returns super-admin when present alongside other roles', () => {
    expect(resolveHighestRole(['tenant', 'staff', 'super-admin'])).toBe('super-admin');
  });

  it('returns the higher role when insertion order is low-then-high', () => {
    // tenant inserted first, staff second — staff must win
    expect(resolveHighestRole(['tenant', 'staff'])).toBe('staff');
  });

  it('returns the higher role when insertion order is high-then-low', () => {
    expect(resolveHighestRole(['staff', 'tenant'])).toBe('staff');
  });

  it('returns admin over manager and staff', () => {
    expect(resolveHighestRole(['manager', 'admin', 'staff'])).toBe('admin');
  });

  it('returns vendor when it is the only role', () => {
    expect(resolveHighestRole(['vendor'])).toBe('vendor');
  });

  it('ROLE_PRIORITY order matches expected hierarchy', () => {
    expect(ROLE_PRIORITY.indexOf('super-admin')).toBeLessThan(ROLE_PRIORITY.indexOf('admin'));
    expect(ROLE_PRIORITY.indexOf('admin')).toBeLessThan(ROLE_PRIORITY.indexOf('manager'));
    expect(ROLE_PRIORITY.indexOf('manager')).toBeLessThan(ROLE_PRIORITY.indexOf('staff'));
    expect(ROLE_PRIORITY.indexOf('staff')).toBeLessThan(ROLE_PRIORITY.indexOf('tenant'));
    expect(ROLE_PRIORITY.indexOf('tenant')).toBeLessThan(ROLE_PRIORITY.indexOf('vendor'));
  });

  it('root-admin is at index 0 (highest priority)', () => {
    expect(ROLE_PRIORITY[0]).toBe('root-admin');
  });

  it('returns root-admin when present alongside admin', () => {
    expect(resolveHighestRole(['root-admin', 'admin'])).toBe('root-admin');
  });

  it('returns root-admin when present alongside super-admin', () => {
    expect(resolveHighestRole(['super-admin', 'root-admin'])).toBe('root-admin');
  });
});

describe('IUserRole enum and ROLES constants', () => {
  it('IUserRole.ROOT_ADMIN equals "root-admin"', () => {
    expect(IUserRole.ROOT_ADMIN).toBe('root-admin');
  });

  it('ROLES.ROOT_ADMIN equals "root-admin"', () => {
    expect(ROLES.ROOT_ADMIN).toBe('root-admin');
  });
});

describe('ROLE_GROUPS', () => {
  it('BILLING_ROLES includes ROOT_ADMIN', () => {
    expect(ROLE_GROUPS.BILLING_ROLES).toContain('root-admin');
  });

  it('BILLING_ROLES includes SUPER_ADMIN', () => {
    expect(ROLE_GROUPS.BILLING_ROLES).toContain('super-admin');
  });
});

describe('RoleHelpers', () => {
  it('isValidRole returns true for root-admin', () => {
    expect(RoleHelpers.isValidRole('root-admin')).toBe(true);
  });

  it('isValidRole returns false for an unknown role', () => {
    expect(RoleHelpers.isValidRole('made-up-role')).toBe(false);
  });

  it('getAllRoles includes root-admin', () => {
    expect(RoleHelpers.getAllRoles()).toContain('root-admin');
  });
});

describe('preventTenantConflict', () => {
  const userId = new Types.ObjectId().toString();
  const tenantId = new Types.ObjectId(userId);
  const otherId = new Types.ObjectId();

  it('throws ForbiddenError when the requesting user IS the tenant', () => {
    expect(() => preventTenantConflict(userId, tenantId)).toThrow(ForbiddenError);
  });

  it('throws with default message when no custom message supplied', () => {
    expect(() => preventTenantConflict(userId, tenantId)).toThrow(
      'You cannot modify a record where you are the tenant.'
    );
  });

  it('throws with custom message when supplied', () => {
    expect(() => preventTenantConflict(userId, tenantId, 'Custom message')).toThrow(
      'Custom message'
    );
  });

  it('does NOT throw when the requesting user is NOT the tenant', () => {
    expect(() => preventTenantConflict(userId, otherId)).not.toThrow();
  });

  it('does NOT throw when tenantId is null', () => {
    expect(() => preventTenantConflict(userId, null)).not.toThrow();
  });

  it('does NOT throw when tenantId is undefined', () => {
    expect(() => preventTenantConflict(userId, undefined)).not.toThrow();
  });

  it('compares correctly when tenantId is a plain string', () => {
    expect(() => preventTenantConflict(userId, userId)).toThrow(ForbiddenError);
    expect(() => preventTenantConflict(userId, otherId.toString())).not.toThrow();
  });
});
