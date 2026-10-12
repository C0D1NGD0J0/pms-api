import { UpdateTenantProfileSchema } from '@shared/validations/ClientValidation/schemas';

describe('UpdateTenantProfileSchema', () => {
  it('keeps the profile personalInfo fields the tenant edit form sends', async () => {
    const parsed = await UpdateTenantProfileSchema.parseAsync({
      personalInfo: {
        firstName: 'Jane',
        displayName: 'Jane D',
        headline: 'Quiet tenant',
        bio: 'Loves gardening',
        location: 'Toronto',
        dob: '1990-05-01',
        avatar: { url: 'https://cdn.example.com/a.png', filename: 'a.png', key: 'avatars/a.png' },
      },
    });

    expect(parsed.personalInfo).toEqual({
      firstName: 'Jane',
      displayName: 'Jane D',
      headline: 'Quiet tenant',
      bio: 'Loves gardening',
      location: 'Toronto',
      dob: new Date('1990-05-01'),
      avatar: { url: 'https://cdn.example.com/a.png', filename: 'a.png', key: 'avatars/a.png' },
    });
  });

  it('still strips undeclared personalInfo keys', async () => {
    const parsed = await UpdateTenantProfileSchema.parseAsync({
      personalInfo: { firstName: 'Jane', isVerified: true },
    });

    expect(parsed.personalInfo).toEqual({ firstName: 'Jane' });
  });

  it('strips personalInfo.email — login email changes use the email-change endpoint', async () => {
    const parsed = await UpdateTenantProfileSchema.parseAsync({
      email: 'top-level@test.com',
      personalInfo: { firstName: 'Jane', email: 'new@test.com' },
    });

    expect(parsed.personalInfo).toEqual({ firstName: 'Jane' });
    expect(parsed).not.toHaveProperty('email');
  });

  it('accepts numbers sent as strings by a multipart request', async () => {
    const parsed = await UpdateTenantProfileSchema.parseAsync({
      tenantInfo: {
        employerInfo: [{ companyName: 'Acme', position: 'Engineer', monthlyIncome: '5200.50' }],
        rentalReferences: [{ landlordName: 'Bob', durationMonths: '24' }],
      },
    });

    expect(parsed.tenantInfo?.employerInfo?.[0].monthlyIncome).toBe(5200.5);
    expect(parsed.tenantInfo?.rentalReferences?.[0].durationMonths).toBe(24);
  });

  it('rejects a non-numeric monthly income', async () => {
    const result = await UpdateTenantProfileSchema.safeParseAsync({
      tenantInfo: {
        employerInfo: [{ companyName: 'Acme', position: 'Engineer', monthlyIncome: 'lots' }],
      },
    });

    expect(result.success).toBe(false);
  });
});
