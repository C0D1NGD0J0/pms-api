import { IClientDocument } from '@interfaces/client.interface';
import { IProfileDocument } from '@interfaces/profile.interface';
import { computeProfileCompletion, IAccountSetupData } from '@utils/profileCompletion';

const makeProfile = (overrides: Record<string, any> = {}): IProfileDocument =>
  ({
    personalInfo: {
      phoneNumber: '4165551234',
      location: 'Toronto, Canada',
      avatar: { url: 'https://custom.com/avatar.jpg' },
      dob: new Date('1990-01-01'),
    },
    policies: {
      tos: { accepted: true, acceptedOn: new Date() },
      privacy: { accepted: true, acceptedOn: new Date() },
      marketing: { accepted: false },
    },
    settings: {},
    ...overrides,
  }) as any;

const makeClient = (overrides: Record<string, any> = {}): IClientDocument =>
  ({
    accountType: { category: 'business', isEnterpriseAccount: false },
    isVerified: true,
    ...overrides,
  }) as any;

const makeAccountData = (overrides: Partial<IAccountSetupData> = {}): IAccountSetupData => ({
  subscriptionActive: true,
  propertyCount: 3,
  unitCount: 10,
  hasPaymentProcessor: true,
  payoutsEnabled: true,
  tenantCount: 5,
  leaseCount: 4,
  ...overrides,
});

describe('computeProfileCompletion — account setup sections', () => {
  it('should NOT include setup sections without accountData', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), ['super-admin']);
    expect(result.sections.find((s) => s.key === 'accountSetup')).toBeUndefined();
    expect(result.sections.find((s) => s.key === 'tenantSetup')).toBeUndefined();
  });

  it('should NOT include setup sections for non-admin roles', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['staff'],
      makeAccountData()
    );
    expect(result.sections.find((s) => s.key === 'accountSetup')).toBeUndefined();
  });

  it('should include the setup sections for super-admin with accountData', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData()
    );
    expect(result.sections.map((s) => s.key)).toEqual(['core', 'accountSetup', 'tenantSetup']);
  });

  it('should keep the checklist short: 9 steps, 12 with a business profile', () => {
    const countSteps = (isEnterpriseAccount: boolean) =>
      computeProfileCompletion(
        makeProfile(),
        makeClient({ accountType: { category: 'business', isEnterpriseAccount } }),
        ['super-admin'],
        makeAccountData()
      ).sections.reduce((total, s) => total + s.totalFields, 0);

    expect(countSteps(false)).toBe(9);
    expect(countSteps(true)).toBe(12);
  });

  it('should mark all fields filled when account is fully set up', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['admin'],
      makeAccountData()
    );
    const setup = result.sections.find((s) => s.key === 'accountSetup')!;
    expect(setup.completedFields).toBe(setup.totalFields);
  });

  it('should mark property as incomplete when propertyCount is 0', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData({ propertyCount: 0 })
    );
    const field = result.sections
      .find((s) => s.key === 'accountSetup')!
      .fields.find((f) => f.key === 'property');
    expect(field!.filled).toBe(false);
  });

  it('should list identity verification in account setup, right after the subscription', () => {
    const fields = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['admin'],
      makeAccountData()
    )
      .sections.find((s) => s.key === 'accountSetup')!
      .fields.map((f) => f.key);
    expect(fields.slice(0, 2)).toEqual(['subscription', 'identityVerification']);
  });

  it('should mark identity verification incomplete until the account is verified', () => {
    const fieldFor = (isVerified: boolean) =>
      computeProfileCompletion(
        makeProfile(),
        makeClient({ isVerified }),
        ['super-admin'],
        makeAccountData()
      )
        .sections.find((s) => s.key === 'accountSetup')!
        .fields.find((f) => f.key === 'identityVerification')!;

    expect(fieldFor(false).filled).toBe(false);
    expect(fieldFor(true).filled).toBe(true);
  });

  it('should mark payments done only once processing and payouts are both set up', () => {
    const paymentsFilled = (data: Partial<IAccountSetupData>) =>
      computeProfileCompletion(makeProfile(), makeClient(), ['super-admin'], makeAccountData(data))
        .sections.find((s) => s.key === 'accountSetup')!
        .fields.find((f) => f.key === 'payments')!.filled;

    expect(paymentsFilled({})).toBe(true);
    expect(paymentsFilled({ payoutsEnabled: false })).toBe(false);
    expect(paymentsFilled({ hasPaymentProcessor: false })).toBe(false);
  });

  it('should include incomplete setup fields in missingFields', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData({ propertyCount: 0, leaseCount: 0 })
    );
    expect(result.missingFields).toContain('Add your first property');
    expect(result.missingFields).toContain('Create a lease');
  });

  it('should reduce overall percent when setup sections are incomplete', () => {
    const complete = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData()
    );
    const incomplete = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData({
        propertyCount: 0,
        unitCount: 0,
        tenantCount: 0,
        leaseCount: 0,
        hasPaymentProcessor: false,
        payoutsEnabled: false,
        subscriptionActive: false,
      })
    );
    expect(incomplete.percent).toBeLessThan(complete.percent);
  });
});
