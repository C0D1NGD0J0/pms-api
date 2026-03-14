import { ROLES } from '@shared/constants/roles.constants';
import { IClientDocument } from '@interfaces/client.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { computeProfileCompletion } from '@utils/profileCompletion';

// ── Minimal stubs ─────────────────────────────────────────────────────────────

function makeClient(overrides: Partial<IClientDocument> = {}): IClientDocument {
  return {
    accountType: { isEnterpriseAccount: false },
    ...overrides,
  } as unknown as IClientDocument;
}

function makeProfile(overrides: Partial<IProfileDocument> = {}): IProfileDocument {
  return {
    personalInfo: {},
    policies: {},
    ...overrides,
  } as unknown as IProfileDocument;
}

// ── Core section ──────────────────────────────────────────────────────────────

describe('computeProfileCompletion — core section', () => {
  it('returns 0% and 5 missing fields when all core fields are empty', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.ADMIN]);

    expect(result.percent).toBe(0);
    expect(result.sections).toHaveLength(1);
    expect(result.sections[0].key).toBe('core');
    expect(result.sections[0].completedFields).toBe(0);
    expect(result.sections[0].totalFields).toBe(5);
    expect(result.missingFields).toHaveLength(5);
  });

  it('returns 100% when all core fields are filled', () => {
    const profile = makeProfile({
      personalInfo: {
        phoneNumber: '+1234567890',
        avatar: { url: 'https://cdn.example.com/avatar.jpg' },
        location: 'Lagos, NG',
        dob: new Date('1990-01-01'),
      } as any,
      policies: { tos: { accepted: true } } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.ADMIN]);

    expect(result.percent).toBe(100);
    expect(result.missingFields).toHaveLength(0);
  });

  it('counts lorempixel URL as missing avatar (not a custom upload)', () => {
    const profile = makeProfile({
      personalInfo: {
        avatar: { url: 'https://lorempixel.com/200/200' },
      } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.ADMIN]);
    const avatarField = result.sections[0].fields.find((f) => f.key === 'avatar');

    expect(avatarField?.filled).toBe(false);
  });

  it('counts a real S3 URL as filled avatar', () => {
    const profile = makeProfile({
      personalInfo: {
        avatar: { url: 'https://s3.amazonaws.com/bucket/avatar.jpg' },
      } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.ADMIN]);
    const avatarField = result.sections[0].fields.find((f) => f.key === 'avatar');

    expect(avatarField?.filled).toBe(true);
  });

  it('counts TOS as missing when not accepted', () => {
    const profile = makeProfile({
      policies: { tos: { accepted: false } } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.ADMIN]);
    const tosField = result.sections[0].fields.find((f) => f.key === 'tos');

    expect(tosField?.filled).toBe(false);
  });

  it('missingFields contains the human-readable labels of unfilled fields', () => {
    const profile = makeProfile({
      personalInfo: { phoneNumber: '+1234567890' } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.ADMIN]);

    expect(result.missingFields).toContain('Profile photo');
    expect(result.missingFields).toContain('Location');
    expect(result.missingFields).toContain('Date of birth');
    expect(result.missingFields).toContain('Terms of service');
    expect(result.missingFields).not.toContain('Phone number');
  });
});

// ── Staff section ─────────────────────────────────────────────────────────────

describe('computeProfileCompletion — staff section', () => {
  it('adds employee section only for STAFF role', () => {
    const withStaff = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.STAFF]);
    const withoutStaff = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.ADMIN]);

    expect(withStaff.sections.map((s) => s.key)).toContain('employee');
    expect(withoutStaff.sections.map((s) => s.key)).not.toContain('employee');
  });

  it('employee section scores correctly when filled', () => {
    const profile = makeProfile({
      employeeInfo: {
        department: 'Engineering',
        jobTitle: 'Senior Engineer',
        startDate: new Date('2022-01-01'),
      } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.STAFF]);
    const empSection = result.sections.find((s) => s.key === 'employee')!;

    expect(empSection.completedFields).toBe(3);
    expect(empSection.totalFields).toBe(3);
    expect(empSection.percent).toBe(100);
  });

  it('employee section missing fields appear in root missingFields', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.STAFF]);

    expect(result.missingFields).toContain('Department');
    expect(result.missingFields).toContain('Job title');
    expect(result.missingFields).toContain('Start date');
  });
});

// ── Tenant section ────────────────────────────────────────────────────────────

describe('computeProfileCompletion — tenant section', () => {
  it('adds tenant section only for TENANT role', () => {
    const withTenant = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.TENANT]);
    const withoutTenant = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.ADMIN]);

    expect(withTenant.sections.map((s) => s.key)).toContain('tenant');
    expect(withoutTenant.sections.map((s) => s.key)).not.toContain('tenant');
  });

  it('tenant section scores correctly when all fields filled', () => {
    const profile = makeProfile({
      tenantInfo: {
        emergencyContact: {
          name: 'Jane Doe',
          phone: '+1234567890',
          relationship: 'Spouse',
        },
        employerInfo: [{ employer: 'Acme Corp' }],
      } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.TENANT]);
    const tenantSection = result.sections.find((s) => s.key === 'tenant')!;

    expect(tenantSection.completedFields).toBe(4);
    expect(tenantSection.percent).toBe(100);
  });

  it('empty employerInfo array counts as missing', () => {
    const profile = makeProfile({
      tenantInfo: { employerInfo: [] } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.TENANT]);
    const empField = result.sections
      .find((s) => s.key === 'tenant')!
      .fields.find((f) => f.key === 'employer')!;

    expect(empField.filled).toBe(false);
  });
});

// ── Enterprise section ────────────────────────────────────────────────────────

describe('computeProfileCompletion — enterprise section', () => {
  const enterpriseClient = makeClient({
    accountType: { isEnterpriseAccount: true },
    companyProfile: {} as any,
  });

  it('adds enterprise section for SUPER_ADMIN on enterprise account', () => {
    const result = computeProfileCompletion(makeProfile(), enterpriseClient, [ROLES.SUPER_ADMIN]);
    expect(result.sections.map((s) => s.key)).toContain('enterprise');
  });

  it('adds enterprise section for ADMIN on enterprise account', () => {
    const result = computeProfileCompletion(makeProfile(), enterpriseClient, [ROLES.ADMIN]);
    expect(result.sections.map((s) => s.key)).toContain('enterprise');
  });

  it('does NOT add enterprise section for STAFF on enterprise account', () => {
    const result = computeProfileCompletion(makeProfile(), enterpriseClient, [ROLES.STAFF]);
    expect(result.sections.map((s) => s.key)).not.toContain('enterprise');
  });

  it('does NOT add enterprise section for TENANT on enterprise account', () => {
    const result = computeProfileCompletion(makeProfile(), enterpriseClient, [ROLES.TENANT]);
    expect(result.sections.map((s) => s.key)).not.toContain('enterprise');
  });

  it('does NOT add enterprise section for ADMIN on non-enterprise account', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.ADMIN]);
    expect(result.sections.map((s) => s.key)).not.toContain('enterprise');
  });

  it('enterprise section scores correctly when all fields filled', () => {
    const client = makeClient({
      accountType: { isEnterpriseAccount: true },
      companyProfile: {
        legalEntityName: 'Acme Ltd',
        companyEmail: 'info@acme.com',
        companyAddress: '1 Main St',
        companyPhone: '+1234567890',
        website: 'https://acme.com',
        registrationNumber: 'REG123',
      } as any,
    });

    const result = computeProfileCompletion(makeProfile(), client, [ROLES.SUPER_ADMIN]);
    const entSection = result.sections.find((s) => s.key === 'enterprise')!;

    expect(entSection.completedFields).toBe(6);
    expect(entSection.percent).toBe(100);
  });
});

// ── Overall percent ───────────────────────────────────────────────────────────

describe('computeProfileCompletion — overall percent', () => {
  it('overall percent is weighted across all active sections', () => {
    // Core: 1/5 filled (phone only)
    // Employee: 0/3 filled
    const profile = makeProfile({
      personalInfo: { phoneNumber: '+1234567890' } as any,
    });

    const result = computeProfileCompletion(profile, makeClient(), [ROLES.STAFF]);

    // 1 out of 8 total = 12.5 → round → 13%
    expect(result.percent).toBe(13);
  });

  it('returns 0 when no fields are filled', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.ADMIN]);
    expect(result.percent).toBe(0);
  });

  it('no identification section exists (handled by Stripe)', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.ADMIN]);
    expect(result.sections.map((s) => s.key)).not.toContain('identification');
  });

  it('bio and headline are not scored (optional fields)', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), [ROLES.ADMIN]);
    const allFieldKeys = result.sections.flatMap((s) => s.fields.map((f) => f.key));

    expect(allFieldKeys).not.toContain('bio');
    expect(allFieldKeys).not.toContain('headline');
  });
});
