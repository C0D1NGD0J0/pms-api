import { Types } from 'mongoose';
import { CurrentUser } from '@utils/currentUserRole';
import { ICurrentUser } from '@interfaces/user.interface';
import { IUserRoleType } from '@shared/constants/roles.constants';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeUser(overrides: Partial<ICurrentUser> = {}): ICurrentUser {
  return {
    sub: new Types.ObjectId().toString(),
    uid: 'uid-test',
    email: 'test@example.com',
    fullname: 'Test User',
    displayName: 'Test User',
    avatarUrl: '',
    isActive: true,
    permissions: [],
    preferences: {},
    clients: [],
    clientEntitlements: {} as any,
    client: {
      cuid: 'CLIENT001',
      displayname: 'Test Client',
      role: 'staff' as IUserRoleType,
      isVerified: true,
    },
    ...overrides,
  } as ICurrentUser;
}

/** Shorthand: build a vendor user with optional client overrides */
function makeVendor(
  clientOverrides: Partial<ICurrentUser['client']> = {},
  vendorInfo?: ICurrentUser['vendorInfo']
): ICurrentUser {
  return makeUser({
    client: {
      cuid: 'CLIENT001',
      displayname: 'Test Client',
      role: 'vendor' as IUserRoleType,
      isVerified: true,
      ...clientOverrides,
    },
    vendorInfo,
  });
}

// ===========================================================================
// isVendor
// ===========================================================================

describe('CurrentUser.isVendor', () => {
  it('returns true when role is vendor', () => {
    expect(CurrentUser.isVendor(makeVendor())).toBe(true);
  });

  it('returns false when role is admin', () => {
    expect(
      CurrentUser.isVendor(
        makeUser({ client: { cuid: 'C1', displayname: 'x', role: 'admin', isVerified: true } })
      )
    ).toBe(false);
  });

  it('returns false when role is tenant', () => {
    expect(
      CurrentUser.isVendor(
        makeUser({ client: { cuid: 'C1', displayname: 'x', role: 'tenant', isVerified: true } })
      )
    ).toBe(false);
  });
});

// ===========================================================================
// isPrimaryVendor
// ===========================================================================

describe('CurrentUser.isPrimaryVendor', () => {
  it('returns true when vendor has no linkedVendorUid and no vendorInfo flag', () => {
    const user = makeVendor({ linkedVendorUid: undefined });
    expect(CurrentUser.isPrimaryVendor(user)).toBe(true);
  });

  it('returns true when vendorInfo.isPrimaryVendor is explicitly true', () => {
    const user = makeVendor({}, { isPrimaryVendor: true });
    expect(CurrentUser.isPrimaryVendor(user)).toBe(true);
  });

  it('returns false when vendorInfo.isPrimaryVendor is false (even without linkedVendorUid)', () => {
    // The flag explicitly says not primary — respects the flag over absence of linkedVendorUid
    const user = makeVendor({ linkedVendorUid: undefined }, { isPrimaryVendor: false });
    expect(CurrentUser.isPrimaryVendor(user)).toBe(false);
  });

  it('returns false when linkedVendorUid is set and no vendorInfo flag', () => {
    const user = makeVendor({ linkedVendorUid: 'SOMEUID' });
    expect(CurrentUser.isPrimaryVendor(user)).toBe(false);
  });

  it('returns false for a non-vendor role', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'admin', isVerified: true },
    });
    expect(CurrentUser.isPrimaryVendor(user)).toBe(false);
  });
});

// ===========================================================================
// isVendorTeamMember
// ===========================================================================

describe('CurrentUser.isVendorTeamMember', () => {
  it('returns true when client.linkedVendorUid is set (CSV bulk-invite path)', () => {
    const user = makeVendor({ linkedVendorUid: 'GNTM8EMXMA2Z' });
    expect(CurrentUser.isVendorTeamMember(user)).toBe(true);
  });

  it('returns true when vendorInfo.isLinkedAccount is true and linkedVendorUid is absent (single-invite path)', () => {
    const user = makeVendor({ linkedVendorUid: undefined }, { isLinkedAccount: true });
    expect(CurrentUser.isVendorTeamMember(user)).toBe(true);
  });

  it('returns false for primary vendor (no linkedVendorUid, isPrimaryVendor=true)', () => {
    const user = makeVendor(
      { linkedVendorUid: undefined },
      { isPrimaryVendor: true, isLinkedAccount: false }
    );
    expect(CurrentUser.isVendorTeamMember(user)).toBe(false);
  });

  it('returns false when role is not vendor', () => {
    const user = makeUser({
      client: {
        cuid: 'C1',
        displayname: 'x',
        role: 'staff',
        isVerified: true,
        linkedVendorUid: 'SOMEUID',
      },
    });
    expect(CurrentUser.isVendorTeamMember(user)).toBe(false);
  });

  it('returns false when both linkedVendorUid and isLinkedAccount are absent/falsy', () => {
    const user = makeVendor({ linkedVendorUid: undefined }, { isLinkedAccount: false });
    expect(CurrentUser.isVendorTeamMember(user)).toBe(false);
  });
});

// ===========================================================================
// isVendorTeamMemberOf
// ===========================================================================

describe('CurrentUser.isVendorTeamMemberOf', () => {
  const vuid = 'GNTM8EMXMA2Z';
  const primaryUserId = new Types.ObjectId().toHexString();

  it('matches when linkedVendorUid === vuid (CSV invite path)', () => {
    const user = makeVendor({ linkedVendorUid: vuid });
    expect(CurrentUser.isVendorTeamMemberOf(user, vuid)).toBe(true);
  });

  it('matches when linkedVendorUid === primaryAccountHolderUserId (single-invite path, 24-hex ObjectId string)', () => {
    const user = makeVendor({ linkedVendorUid: primaryUserId });
    expect(CurrentUser.isVendorTeamMemberOf(user, vuid, primaryUserId)).toBe(true);
  });

  it('returns false when neither vuid nor primaryUserId matches linkedVendorUid', () => {
    const user = makeVendor({ linkedVendorUid: 'COMPLETELY_DIFFERENT' });
    expect(CurrentUser.isVendorTeamMemberOf(user, vuid, primaryUserId)).toBe(false);
  });

  it('returns false when the user is not a team member at all (primary vendor)', () => {
    const user = makeVendor({ linkedVendorUid: undefined }, { isPrimaryVendor: true });
    expect(CurrentUser.isVendorTeamMemberOf(user, vuid, primaryUserId)).toBe(false);
  });

  it('returns false when user is not a vendor role', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'admin', isVerified: true },
    });
    expect(CurrentUser.isVendorTeamMemberOf(user, vuid, primaryUserId)).toBe(false);
  });

  it('returns false when primaryAccountHolderUserId is not provided and linkedVendorUid does not match vuid', () => {
    const user = makeVendor({ linkedVendorUid: 'SOME_OTHER_UID' });
    expect(CurrentUser.isVendorTeamMemberOf(user, vuid)).toBe(false);
  });

  it('matches when linkedVendorUid === vuid even without primaryAccountHolderUserId arg', () => {
    const user = makeVendor({ linkedVendorUid: vuid });
    expect(CurrentUser.isVendorTeamMemberOf(user, vuid)).toBe(true);
  });
});

// ===========================================================================
// isStaff
// ===========================================================================

describe('CurrentUser.isStaff', () => {
  it.each(['super-admin', 'admin', 'manager', 'staff'] as IUserRoleType[])(
    'returns true for role %s',
    (role) => {
      const user = makeUser({ client: { cuid: 'C1', displayname: 'x', role, isVerified: true } });
      expect(CurrentUser.isStaff(user)).toBe(true);
    }
  );

  it.each(['tenant', 'vendor'] as IUserRoleType[])('returns false for role %s', (role) => {
    const user = makeUser({ client: { cuid: 'C1', displayname: 'x', role, isVerified: true } });
    expect(CurrentUser.isStaff(user)).toBe(false);
  });
});

// ===========================================================================
// isPM
// ===========================================================================

describe('CurrentUser.isPM', () => {
  it('returns true for admin', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'admin', isVerified: true },
    });
    expect(CurrentUser.isPM(user)).toBe(true);
  });

  it('returns true for manager', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'manager', isVerified: true },
    });
    expect(CurrentUser.isPM(user)).toBe(true);
  });

  it('returns false for staff', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'staff', isVerified: true },
    });
    expect(CurrentUser.isPM(user)).toBe(false);
  });

  it('returns false for tenant', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'tenant', isVerified: true },
    });
    expect(CurrentUser.isPM(user)).toBe(false);
  });
});

// ===========================================================================
// isTenant
// ===========================================================================

describe('CurrentUser.isTenant', () => {
  it('returns true for tenant', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'tenant', isVerified: true },
    });
    expect(CurrentUser.isTenant(user)).toBe(true);
  });

  it('returns false for vendor', () => {
    expect(CurrentUser.isTenant(makeVendor())).toBe(false);
  });
});

// ===========================================================================
// isAdmin / isManager / isSuperAdmin
// ===========================================================================

describe('CurrentUser role single-checks', () => {
  it('isAdmin returns true only for admin', () => {
    const admin = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'admin', isVerified: true },
    });
    const manager = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'manager', isVerified: true },
    });
    expect(CurrentUser.isAdmin(admin)).toBe(true);
    expect(CurrentUser.isAdmin(manager)).toBe(false);
  });

  it('isManager returns true only for manager', () => {
    const manager = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'manager', isVerified: true },
    });
    const staff = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'staff', isVerified: true },
    });
    expect(CurrentUser.isManager(manager)).toBe(true);
    expect(CurrentUser.isManager(staff)).toBe(false);
  });

  it('isSuperAdmin returns true only for super-admin', () => {
    const superAdmin = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'super-admin', isVerified: true },
    });
    const admin = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'admin', isVerified: true },
    });
    expect(CurrentUser.isSuperAdmin(superAdmin)).toBe(true);
    expect(CurrentUser.isSuperAdmin(admin)).toBe(false);
  });
});

// ===========================================================================
// isManagement
// ===========================================================================

describe('CurrentUser.isManagement', () => {
  it.each(['super-admin', 'admin', 'manager'] as IUserRoleType[])('returns true for %s', (role) => {
    const user = makeUser({ client: { cuid: 'C1', displayname: 'x', role, isVerified: true } });
    expect(CurrentUser.isManagement(user)).toBe(true);
  });

  it.each(['staff', 'tenant', 'vendor'] as IUserRoleType[])('returns false for %s', (role) => {
    const user = makeUser({ client: { cuid: 'C1', displayname: 'x', role, isVerified: true } });
    expect(CurrentUser.isManagement(user)).toBe(false);
  });
});

// ===========================================================================
// isExternal
// ===========================================================================

describe('CurrentUser.isExternal', () => {
  it('returns true for tenant', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'tenant', isVerified: true },
    });
    expect(CurrentUser.isExternal(user)).toBe(true);
  });

  it('returns true for vendor', () => {
    expect(CurrentUser.isExternal(makeVendor())).toBe(true);
  });

  it('returns false for admin', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'admin', isVerified: true },
    });
    expect(CurrentUser.isExternal(user)).toBe(false);
  });

  it('returns false for staff', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'staff', isVerified: true },
    });
    expect(CurrentUser.isExternal(user)).toBe(false);
  });
});

// ===========================================================================
// hasRole
// ===========================================================================

describe('CurrentUser.hasRole', () => {
  it('returns true when the role matches exactly', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'manager', isVerified: true },
    });
    expect(CurrentUser.hasRole(user, 'manager' as any)).toBe(true);
  });

  it('returns false when the role does not match', () => {
    const user = makeUser({
      client: { cuid: 'C1', displayname: 'x', role: 'staff', isVerified: true },
    });
    expect(CurrentUser.hasRole(user, 'admin' as any)).toBe(false);
  });
});
