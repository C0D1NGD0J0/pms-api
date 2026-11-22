import dayjs from 'dayjs';
import { Types } from 'mongoose';
import { IUserRole } from '@shared/constants/roles.constants';
import { ValidationRequestError } from '@shared/customErrors';
import { ILeaseESignatureStatusEnum, LeaseStatus } from '@interfaces/lease.interface';
import { LIFECYCLE_MANAGED_LEASE_FIELDS, IMMUTABLE_LEASE_FIELDS } from '@utils/constants';
import {
  assignUploadedLeaseDocumentTypes,
  hasSignatureInvalidatingChanges,
  calculateNextAnnualPaymentDate,
  generatePendingChangesPreview,
  calculateFinancialSummary,
  assertAnnualRentAvailable,
  calculateRenewalMetadata,
  calculateNextPaymentDate,
  findActiveLeaseAgreement,
  validateLeaseTermination,
  validateAnnualLeaseTerm,
  applyRentFrequencyRules,
  rejectRestrictedFields,
  buildManualSignatures,
  filterDocumentsByRole,
  validateAllowedFields,
  hasHighImpactChanges,
  sanitizeUpdateData,
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

  it('uses the same 30-day default for the renewal window and the stored notice period', () => {
    const lease: any = {
      status: LeaseStatus.ACTIVE,
      duration: { endDate: new Date(Date.now() + 45 * 24 * 60 * 60 * 1000) },
      renewalOptions: { autoRenew: false },
    };

    const metadata = calculateRenewalMetadata(lease, true)!;

    expect(metadata.renewalWindowDays).toBe(30);
    expect(metadata.renewalFormData!.renewalOptions.noticePeriodDays).toBe(30);
    expect(metadata.isEligible).toBe(false); // 45 days out: window not open yet
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

describe("validateLeaseTermination — 'today' is the account's day", () => {
  // 9 PM in Toronto on Nov 1 — already Nov 2 in UTC
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-11-02T01:00:00Z'));
  });
  afterEach(() => jest.useRealTimers());

  const lease = {
    duration: {
      startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-12-31T00:00:00Z'),
    },
    renewalOptions: { noticePeriodDays: 30 },
  } as any;

  const pastDateError = (timeZone: string) => {
    try {
      // Emergency waives the notice period, so only the past-date rule applies
      validateLeaseTermination(lease, new Date('2026-11-01T00:00:00Z'), 'emergency', timeZone);
    } catch (error) {
      return ((error as ValidationRequestError).errorInfo?.terminationDate ?? []).some((m) =>
        m.includes('cannot be in the past')
      );
    }
    return false;
  };

  it("accepts terminating today in the account's timezone", () => {
    expect(pastDateError('America/Toronto')).toBe(false);
  });

  it('treats the same day as past for an account on UTC', () => {
    expect(pastDateError('UTC')).toBe(true);
  });
});

describe('validateLeaseTermination — reports every failing rule', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

  const lease = {
    duration: { startDate: daysFromNow(-10), endDate: daysFromNow(355) },
    renewalOptions: { noticePeriodDays: 30 },
  } as any;

  const termDateErrors = (terminationDate: Date): string[] => {
    try {
      validateLeaseTermination(lease, terminationDate);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationRequestError);
      return (error as ValidationRequestError).errorInfo?.terminationDate ?? [];
    }
    return [];
  };

  it('lists the past-date, notice and minimum-duration errors together', () => {
    const errors = termDateErrors(daysFromNow(-5));

    expect(errors).toHaveLength(3);
    expect(errors[0]).toMatch(/cannot be in the past/);
    expect(errors[1]).toMatch(/Minimum 30-day notice/);
    expect(errors[2]).toMatch(/active for at least 30 days/);
  });

  it('passes a date that meets every rule', () => {
    expect(termDateErrors(daysFromNow(60))).toEqual([]);
  });
});

describe('sanitizeUpdateData', () => {
  it("clears an empty unitId without changing the caller's object", () => {
    const update: any = { property: { id: 'PROPERTY0001', unitId: '' }, fees: { rentAmount: 1 } };

    const sanitized: any = sanitizeUpdateData(update);

    expect(sanitized.property).toEqual({ id: 'PROPERTY0001', unitId: undefined });
    expect(update.property.unitId).toBe('');
  });

  it('leaves nested objects for the caller to convert with createSafeMongoUpdate', () => {
    const sanitized: any = sanitizeUpdateData({ fees: { rentAmount: 1 } } as any);

    expect(sanitized).toEqual({ fees: { rentAmount: 1 } });
  });
});

describe('applyRentFrequencyRules', () => {
  const errorFields = (fn: () => void): string[] => {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationRequestError);
      return Object.keys((error as ValidationRequestError).errorInfo ?? {});
    }
    return [];
  };

  it('leaves monthly fees untouched', () => {
    const fees: any = { rentAmount: 150000, lateFeeType: 'percentage' };
    applyRentFrequencyRules(fees);
    expect(fees).toEqual({ rentAmount: 150000, lateFeeType: 'percentage' });
  });

  it('drops an annual rent of 0 sent with a monthly lease (forms send it)', () => {
    const fees: any = { paymentFrequency: 'monthly', annualRentAmount: 0, rentAmount: 150000 };
    applyRentFrequencyRules(fees);
    expect(fees).toEqual({ paymentFrequency: 'monthly', rentAmount: 150000 });
  });

  it('sets the monthly rent to annual / 12 for an annual lease', () => {
    const fees: any = { paymentFrequency: 'annual', annualRentAmount: 120000000, rentAmount: 1 };
    applyRentFrequencyRules(fees);
    expect(fees.rentAmount).toBe(10000000);
  });

  it('requires the annual rent on an annual lease', () => {
    expect(errorFields(() => applyRentFrequencyRules({ paymentFrequency: 'annual' }))).toEqual([
      'fees.annualRentAmount',
    ]);
  });

  it('rejects a percentage late fee on an annual lease, including one already stored', () => {
    expect(
      errorFields(() =>
        applyRentFrequencyRules({
          paymentFrequency: 'annual',
          annualRentAmount: 100,
          lateFeeType: 'percentage',
        })
      )
    ).toEqual(['fees.lateFeeType']);

    // An update that only changes the amount still sees the stored percentage fee
    expect(
      errorFields(() =>
        applyRentFrequencyRules(
          { annualRentAmount: 200 },
          { fees: { paymentFrequency: 'annual', lateFeeType: 'percentage' } }
        )
      )
    ).toEqual(['fees.lateFeeType']);
  });

  it('uses the stored annual rent when an update leaves it out', () => {
    const fees: any = { securityDeposit: 0 };
    applyRentFrequencyRules(fees, {
      fees: { paymentFrequency: 'annual', annualRentAmount: 2400 },
    });
    expect(fees.rentAmount).toBe(200);
  });

  it('does not let an active lease change how often rent is paid', () => {
    expect(
      errorFields(() =>
        applyRentFrequencyRules(
          { paymentFrequency: 'annual', annualRentAmount: 1200 },
          { fees: { paymentFrequency: 'monthly' }, status: LeaseStatus.ACTIVE }
        )
      )
    ).toEqual(['fees.paymentFrequency']);

    // A draft can still switch
    const fees: any = { paymentFrequency: 'annual', annualRentAmount: 1200 };
    applyRentFrequencyRules(fees, { fees: {}, status: LeaseStatus.DRAFT });
    expect(fees.rentAmount).toBe(100);
  });
});

describe('annual leases — financial summary and next payment date', () => {
  afterEach(() => jest.useRealTimers());

  const annualLease = (overrides: Record<string, any> = {}) =>
    ({
      fees: {
        paymentFrequency: 'annual',
        annualRentAmount: 120000000,
        rentAmount: 10000000,
        securityDeposit: 5000000,
        rentDueDay: 1,
        currency: 'NGN',
        acceptedPaymentMethod: 'bank-transfer',
        paymentInstructions: 'GTBank USD 0123456789',
      },
      duration: { startDate: new Date('2026-03-15'), endDate: new Date('2028-03-14') },
      petPolicy: null,
      ...overrides,
    }) as any;

  it('shows the whole first lease-year as the first payment, with no pro-ration', () => {
    const summary = calculateFinancialSummary(annualLease());
    expect(summary.paymentFrequency).toBe('annual');
    expect(summary.annualRentAmountRaw).toBe(120000000);
    expect(summary.firstPaymentAmount).toBe(120000000);
    expect(summary.paymentInstructions).toBe('GTBank USD 0123456789');
  });

  it('keeps the monthly summary unchanged for monthly leases', () => {
    const summary = calculateFinancialSummary(
      annualLease({
        fees: { rentAmount: 150000, securityDeposit: 0, rentDueDay: 1, currency: 'CAD' },
        duration: { startDate: new Date('2026-03-01'), endDate: new Date('2027-02-28') },
      })
    );
    expect(summary.paymentFrequency).toBe('monthly');
    expect(summary.annualRentAmountRaw).toBeUndefined();
    expect(summary.firstPaymentAmount).toBe(150000);
  });

  it('is due on the start day, then on the next anniversary', () => {
    jest.useFakeTimers({ now: new Date(2026, 2, 15, 9) }); // the start day
    expect(dayjs(calculateNextAnnualPaymentDate(annualLease())).format('YYYY-MM-DD')).toBe(
      '2026-03-15'
    );

    jest.setSystemTime(new Date(2026, 9, 7, 9)); // between anniversaries
    expect(dayjs(calculateNextAnnualPaymentDate(annualLease())).format('YYYY-MM-DD')).toBe(
      '2027-03-15'
    );
  });

  it('has no next payment once the next anniversary falls after the lease end', () => {
    jest.useFakeTimers({ now: new Date(2027, 5, 1, 9) }); // next anniversary 2028-03-15
    expect(calculateNextAnnualPaymentDate(annualLease())).toBeNull();
  });
});

describe('validateAnnualLeaseTerm', () => {
  const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`); // how date-only fields are stored
  const errorsFor = (lease: Parameters<typeof validateAnnualLeaseTerm>[0]) => {
    try {
      validateAnnualLeaseTerm(lease);
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationRequestError);
      return (error as ValidationRequestError).errorInfo ?? {};
    }
    return {};
  };

  it('ignores leases paid monthly', () => {
    expect(
      errorsFor({
        paymentFrequency: 'monthly',
        type: 'month_to_month',
        startDate: day('2026-11-01'),
        endDate: day('2026-12-01'),
      })
    ).toEqual({});
  });

  it('accepts a full year, ending the day before the anniversary', () => {
    expect(
      errorsFor({
        paymentFrequency: 'annual',
        type: 'fixed_term',
        startDate: day('2026-11-01'),
        endDate: day('2027-10-31'),
      })
    ).toEqual({});
  });

  it('rejects a term a day short of 12 months', () => {
    expect(
      errorsFor({
        paymentFrequency: 'annual',
        type: 'fixed_term',
        startDate: day('2026-11-01'),
        endDate: day('2027-10-30'),
      })
    ).toHaveProperty(['duration.endDate']);
  });

  it('treats Feb 28 as the anniversary of a Feb 29 start, like the lease form', () => {
    const lease = { paymentFrequency: 'annual', type: 'fixed_term', startDate: day('2028-02-29') };
    expect(errorsFor({ ...lease, endDate: day('2029-02-27') })).toEqual({});
    expect(errorsFor({ ...lease, endDate: day('2029-02-26') })).toHaveProperty([
      'duration.endDate',
    ]);
  });

  it('rejects month-to-month', () => {
    expect(
      errorsFor({
        paymentFrequency: 'annual',
        type: 'month_to_month',
        startDate: day('2026-11-01'),
        endDate: day('2027-11-01'),
      })
    ).toHaveProperty('type');
  });
});

describe('assertAnnualRentAvailable', () => {
  const nigeria = { country: 'Nigeria' };
  const canada = { country: 'Canada' };

  it('allows rent paid yearly for a Nigerian property', () => {
    expect(() => assertAnnualRentAvailable('annual', nigeria)).not.toThrow();
  });

  it('rejects switching a Canadian lease to yearly, keyed to the frequency field', () => {
    try {
      assertAnnualRentAvailable('annual', canada, 'monthly');
      throw new Error('expected a rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationRequestError);
      expect((error as ValidationRequestError).errorInfo).toHaveProperty(['fees.paymentFrequency']);
    }
  });

  it('leaves a lease already paid yearly alone, wherever it is', () => {
    expect(() => assertAnnualRentAvailable('annual', canada, 'annual')).not.toThrow();
  });

  it('ignores monthly rent', () => {
    expect(() => assertAnnualRentAvailable('monthly', canada)).not.toThrow();
  });
});
