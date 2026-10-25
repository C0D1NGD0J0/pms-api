import { Types } from 'mongoose';
import { IUserRole } from '@shared/constants/roles.constants';
import { ValidationRequestError } from '@shared/customErrors';
import { ILeaseESignatureStatusEnum, LeaseStatus } from '@interfaces/lease.interface';
import { LIFECYCLE_MANAGED_LEASE_FIELDS, IMMUTABLE_LEASE_FIELDS } from '@utils/constants';
import {
  assignUploadedLeaseDocumentTypes,
  hasSignatureInvalidatingChanges,
  generatePendingChangesPreview,
  calculateRenewalMetadata,
  calculateNextPaymentDate,
  findActiveLeaseAgreement,
  rejectRestrictedFields,
  buildManualSignatures,
  filterDocumentsByRole,
  validateAllowedFields,
  hasHighImpactChanges,
  findActiveLeasePDF,
  hasLeaseBeenSigned,
} from '@services/lease/leaseHelpers';

describe('Lease Helpers', () => {
  describe('rejectRestrictedFields', () => {
    const rejectImmutable = (data: object) =>
      rejectRestrictedFields(data, IMMUTABLE_LEASE_FIELDS, 'lease.errors.immutableFields');
    const rejectLifecycle = (data: object) =>
      rejectRestrictedFields(
        data,
        LIFECYCLE_MANAGED_LEASE_FIELDS,
        'lease.errors.lifecycleManagedFields'
      );

    it('should pass for ordinary editable fields', () => {
      expect(() => rejectImmutable({ internalNotes: [] })).not.toThrow();
      expect(() => rejectLifecycle({ fees: { rentAmount: 1000 } })).not.toThrow();
    });

    it('should throw for immutable field updates', () => {
      expect(() => rejectImmutable({ tenantId: 'new-id' })).toThrow(ValidationRequestError);
    });

    it.each(['status', 'approvalStatus', 'eSignature', 'signatures', 'signedDate'])(
      'should reject lifecycle-managed %s regardless of lease status',
      (field) => {
        expect(() => rejectLifecycle({ [field]: 'x' })).toThrow(ValidationRequestError);
      }
    );
  });

  describe('validateAllowedFields', () => {
    it('should allow all fields for DRAFT status', () => {
      expect(() =>
        validateAllowedFields({ fees: { rentAmount: 1000 } } as any, LeaseStatus.DRAFT)
      ).not.toThrow();
    });

    it('should reject disallowed fields for ACTIVE status', () => {
      expect(() =>
        validateAllowedFields({ fees: { rentAmount: 1000 } } as any, LeaseStatus.ACTIVE)
      ).toThrow(ValidationRequestError);
    });

    it('should allow internalNotes for ACTIVE status', () => {
      expect(() => validateAllowedFields({ internalNotes: [] }, LeaseStatus.ACTIVE)).not.toThrow();
    });
  });

  describe('hasHighImpactChanges', () => {
    it('should return true for property changes', () => {
      expect(hasHighImpactChanges({ property: { id: 'prop-123' } } as any)).toBe(true);
    });

    it('should return true for fees changes', () => {
      expect(hasHighImpactChanges({ fees: { rentAmount: 1500 } } as any)).toBe(true);
    });

    it('should return false for low-impact changes', () => {
      expect(hasHighImpactChanges({ internalNotes: [] } as any)).toBe(false);
    });
  });

  describe('hasSignatureInvalidatingChanges', () => {
    it('should return true for fees changes', () => {
      expect(hasSignatureInvalidatingChanges({ fees: { rentAmount: 1500 } } as any)).toBe(true);
    });

    it('should return true for duration changes', () => {
      expect(hasSignatureInvalidatingChanges({ duration: { monthCount: 24 } } as any)).toBe(true);
    });

    it('should return false for property changes', () => {
      expect(hasSignatureInvalidatingChanges({ property: { id: 'prop' } } as any)).toBe(false);
    });
  });
});

describe('calculateNextPaymentDate — due day clamped to the month length', () => {
  const longAgo = new Date('2025-01-01T00:00:00Z');

  afterEach(() => {
    jest.useRealTimers();
  });

  const nextDueFrom = (today: string, rentDueDay: number) => {
    jest.useFakeTimers().setSystemTime(new Date(today));
    return calculateNextPaymentDate(rentDueDay, longAgo);
  };

  it('uses the last day of a 30-day month for a due day of 31 (no roll into next month)', () => {
    const next = nextDueFrom('2026-04-10T12:00:00', 31)!;
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 3, 30]);
  });

  it('uses Feb 28 for a due day of 30 in a non-leap year', () => {
    const next = nextDueFrom('2027-02-05T12:00:00', 30)!;
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2027, 1, 28]);
  });

  it('clamps the following month too once this month’s due date has passed', () => {
    // Jan 31 has passed on Jan 31 itself → next is Feb 28, not Mar 3
    const next = nextDueFrom('2027-01-31T12:00:00', 31)!;
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2027, 1, 28]);
  });

  it('keeps ordinary due days unchanged', () => {
    const next = nextDueFrom('2026-04-10T12:00:00', 15)!;
    expect([next.getFullYear(), next.getMonth(), next.getDate()]).toEqual([2026, 3, 15]);
  });
});

describe('calculateRenewalMetadata — renewal form money in major units', () => {
  it('returns fees and pet fees in major units for the renewal form', () => {
    const lease: any = {
      status: LeaseStatus.ACTIVE,
      duration: { endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
      fees: {
        rentAmount: 150000,
        securityDeposit: 75050,
        lateFeeAmount: 2500,
        currency: 'CAD',
        rentDueDay: 1,
      },
      petPolicy: { allowed: true, deposit: 30000, monthlyFee: 4500, maxPets: 2 },
      renewalOptions: { autoRenew: false },
    };

    const formData = calculateRenewalMetadata(lease, true)!.renewalFormData!;

    expect(formData.fees).toEqual(
      expect.objectContaining({ rentAmount: 1500, securityDeposit: 750.5, lateFeeAmount: 25 })
    );
    expect(formData.petPolicy).toEqual({ allowed: true, deposit: 300, monthlyFee: 45, maxPets: 2 });
  });

  it('names the property and unit by pid and puid, never by ObjectId', () => {
    const lease: any = {
      status: LeaseStatus.ACTIVE,
      duration: { endDate: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000) },
      tenantId: '507f1f77bcf86cd799439013',
      propertyInfo: { id: '507f1f77bcf86cd799439011', pid: 'PROPERTY0001', address: '1 Main St' },
      propertyUnitInfo: { id: '507f1f77bcf86cd799439012', puid: 'UNIT00000001' },
      tenantInfo: { _id: '507f1f77bcf86cd799439014', fullname: 'Ada Lovelace' },
    };

    const formData = calculateRenewalMetadata(lease, true)!.renewalFormData!;

    expect(formData.property).toEqual({
      pid: 'PROPERTY0001',
      puid: 'UNIT00000001',
      address: '1 Main St',
    });
    expect(formData.tenant).toEqual({ fullname: 'Ada Lovelace' });
  });
});

describe('generatePendingChangesPreview — pet fees', () => {
  it('formats staged pet fees (cents) for display like the fees', () => {
    const lease: any = {
      pendingChanges: {
        updatedBy: 'staff-id',
        petPolicy: { allowed: true, deposit: 25000, monthlyFee: 5000 },
      },
    };
    const admin: any = { sub: 'admin-id', client: { role: 'admin' } };

    const preview = generatePendingChangesPreview(lease, admin);

    expect(preview.changes.petPolicy).toEqual({
      allowed: true,
      deposit: '250.00',
      monthlyFee: '50.00',
    });
  });
});

describe('hasLeaseBeenSigned — uploaded lease document type', () => {
  const unsigned = { status: LeaseStatus.DRAFT } as any;

  it.each([
    LeaseStatus.DRAFT,
    LeaseStatus.READY_FOR_SIGNATURE,
    LeaseStatus.PENDING_SIGNATURE,
    LeaseStatus.DRAFT_RENEWAL,
    LeaseStatus.CANCELLED,
  ])('is false for an unsigned %s lease', (status) => {
    expect(hasLeaseBeenSigned({ status } as any)).toBe(false);
  });

  it.each([LeaseStatus.ACTIVE, LeaseStatus.EXPIRED, LeaseStatus.TERMINATED, LeaseStatus.COMPLETED])(
    'is true once the lease reached %s',
    (status) => {
      expect(hasLeaseBeenSigned({ status } as any)).toBe(true);
    }
  );

  it('is true when signedDate is set (manual signing)', () => {
    expect(hasLeaseBeenSigned({ ...unsigned, signedDate: new Date() })).toBe(true);
  });

  it('is true when the e-signature completed', () => {
    expect(
      hasLeaseBeenSigned({
        ...unsigned,
        eSignature: { status: ILeaseESignatureStatusEnum.SIGNED },
      })
    ).toBe(true);
  });

  it('is false for a sent or declined e-signature on a draft lease', () => {
    expect(
      hasLeaseBeenSigned({ ...unsigned, eSignature: { status: ILeaseESignatureStatusEnum.SENT } })
    ).toBe(false);
    expect(
      hasLeaseBeenSigned({
        ...unsigned,
        eSignature: { status: ILeaseESignatureStatusEnum.DECLINED },
      })
    ).toBe(false);
  });

  it('types untyped uploads as lease_agreement before signing', () => {
    expect(
      assignUploadedLeaseDocumentTypes(unsigned, [{ key: 'a' } as { documentType?: string }])
    ).toEqual([{ key: 'a', documentType: 'lease_agreement' }]);
  });

  it('stamps untyped uploads and keeps an explicit type (generated agreement PDF)', () => {
    const signed = { status: LeaseStatus.ACTIVE } as any;
    const typed = assignUploadedLeaseDocumentTypes(signed, [
      { key: 'a' },
      { key: 'b', documentType: 'lease_agreement' },
    ]);

    expect(typed).toEqual([
      { key: 'a', documentType: 'other' },
      { key: 'b', documentType: 'lease_agreement' },
    ]);
  });
});

describe('lease contract documents — signed copy vs agreement', () => {
  const agreement = { key: 'agreement', documentType: 'lease_agreement', status: 'active' };
  const signedLease = { key: 'signed', documentType: 'signed_lease', status: 'active' };
  const oldSigned = { key: 'old-signed', documentType: 'signed_lease', status: 'inactive' };

  it('findActiveLeasePDF prefers the active signed copy, else the agreement', () => {
    expect(findActiveLeasePDF({ leaseDocuments: [agreement, signedLease] } as any)?.key).toBe(
      'signed'
    );
    expect(findActiveLeasePDF({ leaseDocuments: [agreement, oldSigned] } as any)?.key).toBe(
      'agreement'
    );
  });

  it('findActiveLeaseAgreement only returns the agreement (the document sent for signing)', () => {
    expect(findActiveLeaseAgreement({ leaseDocuments: [signedLease, agreement] } as any)?.key).toBe(
      'agreement'
    );
    expect(findActiveLeaseAgreement({ leaseDocuments: [signedLease] } as any)).toBeUndefined();
  });

  it('filterDocumentsByRole shows tenants only current documents, staff every version', () => {
    const documents = [agreement, signedLease, oldSigned, { key: 'gone', status: 'deleted' }];

    expect(filterDocumentsByRole(documents, IUserRole.TENANT).map((doc) => doc.key)).toEqual([
      'agreement',
      'signed',
    ]);
    expect(filterDocumentsByRole(documents, IUserRole.SUPER_ADMIN)).toHaveLength(4);
    expect(filterDocumentsByRole(documents, IUserRole.MANAGER)).toHaveLength(4);
  });
});

describe('buildManualSignatures', () => {
  const tenantId = new Types.ObjectId();
  const managerId = new Types.ObjectId().toString();
  const signedAt = new Date('2026-01-15');

  it('adds a tenant signature when no tenant signer is listed', () => {
    const signatures = buildManualSignatures({ tenantId }, [], managerId, signedAt);

    expect(signatures).toEqual([
      expect.objectContaining({ role: 'tenant', signatureMethod: 'manual', signedAt }),
    ]);
    expect(signatures[0].userId?.toString()).toBe(tenantId.toString());
  });

  it('links tenant and manager signers to their accounts, others by name/email only', () => {
    const signatures = buildManualSignatures(
      { tenantId: { _id: tenantId } as any },
      [
        { name: 'Tia', email: 'tia@test.com', role: 'tenant' },
        { name: 'Mia', email: 'mia@test.com', role: 'property_manager' },
        { name: 'Lou', email: 'lou@test.com', role: 'landlord' },
      ],
      managerId,
      signedAt
    );

    expect(signatures).toHaveLength(3);
    expect(signatures[0].userId?.toString()).toBe(tenantId.toString());
    expect(signatures[1].userId?.toString()).toBe(managerId);
    expect(signatures[2].userId).toBeUndefined();
    expect(signatures[2].landlordInfo).toEqual({ name: 'Lou', email: 'lou@test.com' });
  });
});
