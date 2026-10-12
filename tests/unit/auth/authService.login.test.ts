import { NotFoundError } from '@shared/customErrors';
import { AuthService } from '@services/auth/auth.service';

// ── Mock factories ──────────────────────────────────────────────────────────

const makeUser = (overrides: Record<string, any> = {}) => ({
  _id: { toString: () => 'user-id-1' },
  email: 'test@example.com',
  isActive: true,
  activecuid: 'CUID1',
  cuids: [{ cuid: 'CUID1', isConnected: true, clientDisplayName: 'Test Client' }],
  ...overrides,
});

const makeProfile = (overrides: Record<string, any> = {}) => ({
  user: { toString: () => 'user-id-1' },
  settings: {
    loginType: 'password',
    phoneVerification: {
      verified: false,
      verifiedPhone: null,
    },
    ...overrides.settings,
  },
  ...overrides,
});

const makeService = (mocks: Record<string, any> = {}) => {
  const userDAO = {
    getActiveUserByEmail: jest.fn(),
    verifyCredentials: jest.fn(),
    updateById: jest.fn(),
    ...mocks.userDAO,
  };

  const profileDAO = {
    findFirst: jest.fn(),
    generateCurrentUserInfo: jest
      .fn()
      .mockResolvedValue({ sub: 'user-id-1', client: { cuid: 'CUID1' } }),
    ...mocks.profileDAO,
  };

  const tokenService = {
    createJwtTokens: jest.fn().mockReturnValue({
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
    }),
    ...mocks.tokenService,
  };

  const authCache = {
    saveRefreshToken: jest.fn(),
    saveCurrentUser: jest.fn(),
    ...mocks.authCache,
  };

  const twilioService = {
    sendOTP: jest.fn().mockResolvedValue({ sid: 'twilio-sid-1', status: 'pending' }),
    verifyOTP: jest.fn().mockResolvedValue({ valid: true }),
    ...mocks.twilioService,
  };

  const featureFlagService = {
    isEnabled: jest.fn().mockReturnValue(true),
    ...mocks.featureFlagService,
  };

  return new AuthService({
    userDAO,
    profileDAO,
    tokenService,
    authCache,
    twilioService,
    featureFlagService,
    clientDAO: {
      list: jest.fn().mockReturnValue(Promise.resolve({ data: [] })),
      findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
    } as any,
    leaseDAO: {} as any,
    queueFactory: {} as any,
    vendorService: {} as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    paymentProcessorDAO: {} as any,
    paymentGatewayService: {} as any,
    subscriptionService: {} as any,
    paymentService: {} as any,
    webAuthnService: { ...mocks.webAuthnService } as any,
  } as any);
};

// ── Tests ───────────────────────────────────────────────────────────────────

const otpProfile = () =>
  makeProfile({
    settings: {
      loginType: 'otp',
      phoneVerification: { verified: true, verifiedPhone: '+14165551234' },
    },
  });

const INVALID_CREDENTIALS = 'auth.errors.invalidCredentials';

// The login form must not reveal whether an email has an account: every step answers the
// same way for unknown emails, and failures share one error.
describe('AuthService.login', () => {
  describe('Step 1: email only', () => {
    it('asks for a password without looking the email up', async () => {
      const getActiveUserByEmail = jest.fn();
      const sendOTP = jest.fn();
      const service = makeService({
        userDAO: { getActiveUserByEmail },
        twilioService: { sendOTP },
      });

      const result = await service.login({ email: 'unknown@example.com' });

      expect(result.data).toEqual({
        step: 'password_required',
        loginType: 'password',
        smsLogin: true,
      });
      expect(getActiveUserByEmail).not.toHaveBeenCalled();
      expect(sendOTP).not.toHaveBeenCalled();
    });

    it('answers an OTP or passkey user exactly like an unknown email', async () => {
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(makeUser()) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(otpProfile()) },
      });

      const known = await service.login({ email: 'test@example.com' });
      const unknown = await service.login({ email: 'unknown@example.com' });

      expect(known).toEqual(unknown);
    });

    it.each([true, false])(
      'reports platform-wide SMS sign-in (%s) without looking at the account',
      async (enabled) => {
        const getActiveUserByEmail = jest.fn();
        const service = makeService({
          userDAO: { getActiveUserByEmail },
          featureFlagService: { isEnabled: jest.fn().mockReturnValue(enabled) },
        });

        const result = await service.login({ email: 'test@example.com' });

        expect(result.data.smsLogin).toBe(enabled);
        expect(getActiveUserByEmail).not.toHaveBeenCalled();
      }
    );
  });

  describe('Requesting an SMS code', () => {
    it('sends a code to an account set up for SMS sign-in', async () => {
      const sendOTP = jest.fn().mockResolvedValue({ sid: 'sid-1' });
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(makeUser()) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(otpProfile()) },
        twilioService: { sendOTP },
      });

      const result = await service.login({ email: 'test@example.com', requestOtp: true });

      expect(sendOTP).toHaveBeenCalledWith('+14165551234');
      expect(result.data).toEqual({ step: 'otp_sent', loginType: 'otp' });
    });

    it.each([
      ['an unknown email', null, otpProfile(), true],
      ['a password-only account', makeUser(), makeProfile(), true],
      ['an unverified phone', makeUser(), makeProfile({ settings: { loginType: 'otp' } }), true],
      ['SMS switched off', makeUser(), otpProfile(), false],
    ])('gives the same answer and sends nothing for %s', async (_case, user, profile, sms) => {
      const sendOTP = jest.fn();
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
        featureFlagService: { isEnabled: jest.fn().mockReturnValue(sms) },
        twilioService: { sendOTP },
      });

      const result = await service.login({ email: 'test@example.com', requestOtp: true });

      expect(sendOTP).not.toHaveBeenCalled();
      expect(result.data).toEqual({ step: 'otp_sent', loginType: 'otp' });
    });

    it('does not reveal a failed SMS send', async () => {
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(makeUser()) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(otpProfile()) },
        twilioService: { sendOTP: jest.fn().mockRejectedValue(new Error('twilio down')) },
      });

      const result = await service.login({ email: 'test@example.com', requestOtp: true });

      expect(result.data).toEqual({ step: 'otp_sent', loginType: 'otp' });
    });
  });

  describe('Password login', () => {
    it('returns authenticated with tokens on valid password', async () => {
      const user = makeUser();
      const service = makeService({
        userDAO: { verifyCredentials: jest.fn().mockResolvedValue(user), updateById: jest.fn() },
      });

      const result = await service.login({
        email: 'test@example.com',
        password: 'ValidPass123',
        rememberMe: false,
      });

      expect(result.data.step).toBe('authenticated');
      expect(result.data.accessToken).toBe('mock-access-token');
      expect(result.data.refreshToken).toBe('mock-refresh-token');
      expect(result.data.activeAccount.cuid).toBe('CUID1');
    });

    it('fails with the generic error for a wrong password or unknown email', async () => {
      const service = makeService({
        userDAO: { verifyCredentials: jest.fn().mockResolvedValue(null) },
      });

      const attempt = service.login({ email: 'test@example.com', password: 'WrongPass123' });

      await expect(attempt).rejects.toThrow(NotFoundError);
      await expect(attempt).rejects.toThrow(INVALID_CREDENTIALS);
    });
  });

  describe('OTP login', () => {
    it('returns authenticated with tokens on valid OTP', async () => {
      const service = makeService({
        userDAO: {
          getActiveUserByEmail: jest.fn().mockResolvedValue(makeUser()),
          updateById: jest.fn(),
        },
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue(otpProfile()),
          generateCurrentUserInfo: jest
            .fn()
            .mockResolvedValue({ sub: 'user-id-1', client: { cuid: 'CUID1' } }),
        },
        twilioService: { verifyOTP: jest.fn().mockResolvedValue({ valid: true }) },
      });

      const result = await service.login({
        email: 'test@example.com',
        otp: '123456',
        rememberMe: false,
      });

      expect(result.data.step).toBe('authenticated');
      expect(result.data.accessToken).toBe('mock-access-token');
    });

    it.each([
      ['a wrong code', makeUser(), otpProfile()],
      ['an unknown email', null, otpProfile()],
      ['an account without SMS sign-in', makeUser(), makeProfile()],
    ])('fails with the generic error for %s', async (_case, user, profile) => {
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
        twilioService: { verifyOTP: jest.fn().mockResolvedValue({ valid: false }) },
      });

      const attempt = service.login({ email: 'test@example.com', otp: '000000' });

      await expect(attempt).rejects.toThrow(NotFoundError);
      await expect(attempt).rejects.toThrow(INVALID_CREDENTIALS);
    });
  });
});
