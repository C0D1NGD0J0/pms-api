import { getPropertyLeasingBlock } from '@utils/propertyLeasing';

const day = 24 * 60 * 60 * 1000;
const leasable = {
  approvalStatus: 'approved',
  verificationStatus: 'verified',
  owner: { type: 'company_owned' },
};

describe('getPropertyLeasingBlock', () => {
  it('passes an approved, verified, company-owned property', () => {
    expect(getPropertyLeasingBlock(leasable)).toBeNull();
  });

  it('treats a property with no approvalStatus (older data) as approved', () => {
    expect(getPropertyLeasingBlock({ ...leasable, approvalStatus: undefined })).toBeNull();
  });

  it('reports the first failed rule: approval, then management authorization, then verification', () => {
    expect(
      getPropertyLeasingBlock({
        approvalStatus: 'pending',
        verificationStatus: 'unverified',
        owner: { type: 'external_owner' },
      })
    ).toBe('not_approved');
    expect(
      getPropertyLeasingBlock({
        ...leasable,
        verificationStatus: 'unverified',
        owner: { type: 'external_owner' },
      })
    ).toBe('management_not_authorized');
    expect(getPropertyLeasingBlock({ ...leasable, verificationStatus: 'unverified' })).toBe(
      'ownership_unverified'
    );
  });

  it('accepts an active grace period in place of verification, but not an expired one', () => {
    const unverified = { ...leasable, verificationStatus: 'unverified' };
    expect(
      getPropertyLeasingBlock({
        ...unverified,
        verificationGracePeriod: { expiresAt: new Date(Date.now() + day) },
      })
    ).toBeNull();
    expect(
      getPropertyLeasingBlock({
        ...unverified,
        verificationGracePeriod: { expiresAt: new Date(Date.now() - day) },
      })
    ).toBe('ownership_unverified');
  });

  it('needs an active, unexpired agreement for external and self-owned properties', () => {
    for (const type of ['external_owner', 'self_owned']) {
      const owned = { ...leasable, owner: { type } };
      expect(getPropertyLeasingBlock({ ...owned, authorization: { isActive: true } })).toBeNull();
      expect(getPropertyLeasingBlock({ ...owned, authorization: { isActive: false } })).toBe(
        'management_not_authorized'
      );
      expect(
        getPropertyLeasingBlock({
          ...owned,
          authorization: { isActive: true, expiresAt: new Date(Date.now() - day) },
        })
      ).toBe('management_not_authorized');
    }
  });

  it('skips the agreement rule for signing and activation, where the owner signs directly', () => {
    const external = { ...leasable, owner: { type: 'external_owner' } };
    expect(getPropertyLeasingBlock(external, { requireManagementAuth: false })).toBeNull();
    expect(
      getPropertyLeasingBlock(
        { ...external, verificationStatus: 'unverified' },
        { requireManagementAuth: false }
      )
    ).toBe('ownership_unverified');
  });
});
