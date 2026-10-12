import { InvitationValidations } from '@shared/validations/InvitationValidation';

const baseInvitation = {
  inviteeEmail: 'invitee@example.com',
  role: 'staff',
  personalInfo: { firstName: 'Jane', lastName: 'Doe' },
  status: 'draft',
};

const topLevelRoleInfo = {
  employeeInfo: {
    department: 'operations',
    jobTitle: 'Leasing Agent',
    startDate: '2026-11-01T00:00:00.000Z',
  },
  vendorInfo: {
    companyName: 'Fix It Co',
    insuranceInfo: { provider: 'Acme', expirationDate: '2027-01-01T00:00:00.000Z' },
  },
  tenantInfo: {
    employerInfo: { companyName: 'Acme Corp', monthlyIncome: 5000 },
    emergencyContact: { name: 'John Doe', phone: '4165551234' },
  },
};

describe('InvitationValidations — fields the invite form sends', () => {
  describe.each([
    ['sendInvitation', InvitationValidations.sendInvitation],
    ['updateInvitation', InvitationValidations.updateInvitation],
  ])('%s', (_name, schema) => {
    it('keeps top-level employeeInfo, vendorInfo and tenantInfo', async () => {
      const parsed = await schema.parseAsync({ ...baseInvitation, ...topLevelRoleInfo });

      expect(parsed.employeeInfo).toEqual({
        department: 'operations',
        jobTitle: 'Leasing Agent',
        startDate: new Date('2026-11-01T00:00:00.000Z'),
      });
      expect(parsed.vendorInfo?.companyName).toBe('Fix It Co');
      expect(parsed.tenantInfo?.employerInfo).toEqual([
        { companyName: 'Acme Corp', monthlyIncome: 5000 },
      ]);
    });

    it('still strips keys the schema does not declare', async () => {
      const parsed = await schema.parseAsync({
        ...baseInvitation,
        isAdmin: true,
        employeeInfo: { jobTitle: 'Agent', salary: 1_000_000 },
      });

      expect(parsed).not.toHaveProperty('isAdmin');
      expect(parsed.employeeInfo).toEqual({ jobTitle: 'Agent' });
    });

    it('rejects an invalid start date', async () => {
      const result = await schema.safeParseAsync({
        ...baseInvitation,
        employeeInfo: { startDate: 'not-a-date' },
      });

      expect(result.success).toBe(false);
      expect(result.success ? [] : result.error.issues.map((issue) => issue.message)).toContain(
        'Please provide a valid start date'
      );
    });
  });
});

describe('InvitationValidations — vendor serviceAreas', () => {
  it('keeps vendorInfo.serviceAreas (the Vendor model field) and drops a singular serviceArea', async () => {
    const parsed = await InvitationValidations.sendInvitation.parseAsync({
      ...baseInvitation,
      role: 'vendor',
      vendorInfo: {
        companyName: 'Fix It Co',
        serviceAreas: { maxDistance: 25 },
        serviceArea: { maxDistance: 50 },
      },
    });

    expect(parsed.vendorInfo?.serviceAreas).toEqual({ maxDistance: 25 });
    expect(parsed.vendorInfo).not.toHaveProperty('serviceArea');
  });

  it('rejects a maxDistance the Vendor model does not allow', async () => {
    const result = await InvitationValidations.sendInvitation.safeParseAsync({
      ...baseInvitation,
      role: 'vendor',
      vendorInfo: { companyName: 'Fix It Co', serviceAreas: { maxDistance: 30 } },
    });

    expect(result.success).toBe(false);
  });
});

describe('InvitationValidations.acceptInvitation', () => {
  const acceptBody = {
    password: 'Password1',
    confirmPassword: 'Password1',
    termsAccepted: true,
    newsletterOptIn: true,
  };

  it('keeps termsAccepted and newsletterOptIn for the profile policies', async () => {
    const parsed = await InvitationValidations.acceptInvitation.parseAsync(acceptBody);

    expect(parsed.termsAccepted).toBe(true);
    expect(parsed.newsletterOptIn).toBe(true);
  });

  it('requires the terms to be accepted', async () => {
    const result = await InvitationValidations.acceptInvitation.safeParseAsync({
      ...acceptBody,
      termsAccepted: false,
    });

    expect(result.success).toBe(false);
  });

  it('drops a token in the body (the controller uses the URL token)', async () => {
    const parsed = await InvitationValidations.acceptInvitation.parseAsync({
      ...acceptBody,
      token: 'body-token',
    });

    expect(parsed).not.toHaveProperty('token');
  });
});

describe('InvitationValidations.cuidAndIuid', () => {
  it('keeps cuid so updateInvitation can read it from the validated params', async () => {
    const parsed = await InvitationValidations.cuidAndIuid.parseAsync({
      cuid: 'CLIENT123456',
      iuid: 'inv-ABCDEFGHIJ',
    });

    expect(parsed).toEqual({ cuid: 'CLIENT123456', iuid: 'inv-ABCDEFGHIJ' });
  });
});
