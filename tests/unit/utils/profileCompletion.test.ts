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
    ...overrides,
  }) as any;

const makeAccountData = (overrides: Partial<IAccountSetupData> = {}): IAccountSetupData => ({
  subscriptionActive: true,
  propertyCount: 3,
  unitCount: 10,
  hasPaymentProcessor: true,
  payoutsEnabled: true,
  staffCount: 2,
  vendorCount: 1,
  tenantCount: 5,
  tenantHasPaymentMethod: true,
  leaseCount: 4,
  ...overrides,
});

describe('computeProfileCompletion — account setup sections', () => {
  it('should NOT include setup sections without accountData', () => {
    const result = computeProfileCompletion(makeProfile(), makeClient(), ['super-admin']);
    expect(result.sections.find((s) => s.key === 'accountSetup')).toBeUndefined();
    expect(result.sections.find((s) => s.key === 'teamSetup')).toBeUndefined();
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

  it('should include all 3 setup sections for super-admin with accountData', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData()
    );
    expect(result.sections.find((s) => s.key === 'accountSetup')).toBeDefined();
    expect(result.sections.find((s) => s.key === 'teamSetup')).toBeDefined();
    expect(result.sections.find((s) => s.key === 'tenantSetup')).toBeDefined();
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

  it('should mark payoutBank as incomplete when payoutsEnabled is false', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData({ payoutsEnabled: false })
    );
    const field = result.sections
      .find((s) => s.key === 'accountSetup')!
      .fields.find((f) => f.key === 'payoutBank');
    expect(field!.filled).toBe(false);
  });

  it('should mark staff/vendor as incomplete when counts are 0', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData({ staffCount: 0, vendorCount: 0 })
    );
    const team = result.sections.find((s) => s.key === 'teamSetup')!;
    expect(team.fields.find((f) => f.key === 'staff')!.filled).toBe(false);
    expect(team.fields.find((f) => f.key === 'vendor')!.filled).toBe(false);
    expect(team.completedFields).toBe(0);
  });

  it('should mark tenantPayment as incomplete when no tenant has payment method', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData({ tenantHasPaymentMethod: false })
    );
    const field = result.sections
      .find((s) => s.key === 'tenantSetup')!
      .fields.find((f) => f.key === 'tenantPayment');
    expect(field!.filled).toBe(false);
  });

  it('should include incomplete setup fields in missingFields', () => {
    const result = computeProfileCompletion(
      makeProfile(),
      makeClient(),
      ['super-admin'],
      makeAccountData({ propertyCount: 0, leaseCount: 0, vendorCount: 0 })
    );
    expect(result.missingFields).toContain('Add your first property');
    expect(result.missingFields).toContain('Create a lease');
    expect(result.missingFields).toContain('Connect a vendor');
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
        staffCount: 0,
        vendorCount: 0,
        tenantCount: 0,
        leaseCount: 0,
        tenantHasPaymentMethod: false,
        hasPaymentProcessor: false,
        payoutsEnabled: false,
        subscriptionActive: false,
      })
    );
    expect(incomplete.percent).toBeLessThan(complete.percent);
  });
});
