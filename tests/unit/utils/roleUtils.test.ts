import { Types } from 'mongoose';
import { ForbiddenError } from '@shared/customErrors';
import { preventTenantConflict } from '@shared/middlewares';
import { resolveHighestRole, ROLE_PRIORITY } from '@shared/constants/roles.constants';

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
    expect(() => preventTenantConflict(userId, tenantId, 'Custom message')).toThrow('Custom message');
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
