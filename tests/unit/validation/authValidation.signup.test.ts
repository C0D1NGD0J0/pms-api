import { UserSignupSchema } from '@shared/validations/AuthValidation/schemas';

jest.mock('@models/index', () => ({ User: { findOne: jest.fn() } }));
jest.mock('@di/setup', () => ({
  container: { cradle: { userDAO: { isEmailTaken: jest.fn().mockResolvedValue(false) } } },
}));
jest.mock('@utils/index', () => ({
  isValidPhoneNumber: () => true,
  isValidLocation: () => true,
}));

const businessSignup = {
  firstName: 'Nacho',
  lastName: 'Libre',
  email: 'nacho.libre@example.com',
  password: 'Password1',
  cpassword: 'Password1',
  location: 'Toronto, Ontario, Canada',
  accountType: {
    planId: 'price_1UFI0iQ578Wn96UMdSmRfiOo',
    planName: 'portfolio',
    category: 'business',
    lookUpKey: 'portfolio_monthly_eur',
    isEnterpriseAccount: true,
    billingInterval: 'monthly',
  },
  phoneNumber: '4165551234',
  displayName: 'Nacho Properties',
  companyProfile: {
    tradingName: 'Nacho Properties Inc',
    legalEntityName: 'Nacho Properties LLC',
    website: '',
    companyEmail: 'info@nachoproperties.com',
    companyPhone: '+14165551235',
    companyAddress: '88 Kensington Avenue, Toronto',
  },
  termsAccepted: true,
  dataProcessingConsent: true,
};

const companyAddressIssue = (
  result: Awaited<ReturnType<typeof UserSignupSchema.safeParseAsync>>
) =>
  result.success
    ? undefined
    : result.error.issues.find((issue) => issue.path.join('.') === 'companyProfile.companyAddress');

describe('UserSignupSchema — company address', () => {
  it('keeps companyAddress so the client can be saved', async () => {
    const result = await UserSignupSchema.safeParseAsync(businessSignup);

    expect(result.success).toBe(true);
    expect(result.success && result.data.companyProfile?.companyAddress).toBe(
      '88 Kensington Avenue, Toronto'
    );
  });

  it('requires companyAddress for business accounts', async () => {
    const { companyAddress: _omit, ...companyProfile } = businessSignup.companyProfile;
    const result = await UserSignupSchema.safeParseAsync({ ...businessSignup, companyProfile });

    expect(companyAddressIssue(result)?.message).toBe(
      'Company address is required for business accounts'
    );
  });

  it('requires it even when isEnterpriseAccount is not sent, since category decides', async () => {
    const { companyAddress: _omit, ...companyProfile } = businessSignup.companyProfile;
    const { isEnterpriseAccount: _flag, ...accountType } = businessSignup.accountType;
    const result = await UserSignupSchema.safeParseAsync({
      ...businessSignup,
      accountType,
      companyProfile,
    });

    expect(companyAddressIssue(result)).toBeDefined();
  });

  it('does not require a company address for individual accounts', async () => {
    const result = await UserSignupSchema.safeParseAsync({
      ...businessSignup,
      accountType: {
        ...businessSignup.accountType,
        category: 'individual',
        isEnterpriseAccount: false,
      },
      companyProfile: undefined,
    });

    expect(companyAddressIssue(result)).toBeUndefined();
  });
});

// validateRequest replaces req.body with the parsed result, so signup only sees declared fields
describe('UserSignupSchema — fields the signup service reads', () => {
  it('keeps displayName and termsAccepted in the parsed body', async () => {
    const result = await UserSignupSchema.safeParseAsync(businessSignup);

    expect(result.success).toBe(true);
    expect(result.success && result.data.displayName).toBe('Nacho Properties');
    expect(result.success && result.data.termsAccepted).toBe(true);
  });

  it('rejects a signup without a display name', async () => {
    const { displayName: _omit, ...signup } = businessSignup;
    const result = await UserSignupSchema.safeParseAsync(signup);

    expect(result.success).toBe(false);
    expect(
      !result.success && result.error.issues.some((issue) => issue.path[0] === 'displayName')
    ).toBe(true);
  });

  it('rejects a signup that has not accepted the terms', async () => {
    const result = await UserSignupSchema.safeParseAsync({
      ...businessSignup,
      termsAccepted: false,
    });

    expect(result.success).toBe(false);
    expect(
      !result.success && result.error.issues.some((issue) => issue.path[0] === 'termsAccepted')
    ).toBe(true);
  });
});
