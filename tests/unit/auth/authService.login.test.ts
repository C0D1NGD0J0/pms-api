import { AuthService } from '@services/auth/auth.service';
import { InvalidRequestError, UnauthorizedError, BadRequestError, NotFoundError } from '@shared/customErrors';

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
    generateCurrentUserInfo: jest.fn().mockResolvedValue({ sub: 'user-id-1', client: { cuid: 'CUID1' } }),
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
    clientDAO: {} as any,
    leaseDAO: {} as any,
    queueFactory: {} as any,
    vendorService: {} as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    paymentProcessorDAO: {} as any,
    paymentGatewayService: {} as any,
    subscriptionService: {} as any,
    paymentService: {} as any,
  } as any);
};

// ── Tests ───────────────────────────────────────────────────────────────────

describe('AuthService.login', () => {
  describe('Step 1: resolve login type (email only)', () => {
    it('returns password_required for password users', async () => {
      const user = makeUser();
      const profile = makeProfile();
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
      });

      const result = await service.login({ email: 'test@example.com' });

      expect(result.data.step).toBe('password_required');
      expect(result.data.loginType).toBe('password');
    });

    it('sends OTP and returns otp_sent for verified OTP users', async () => {
      const user = makeUser();
      const profile = makeProfile({
        settings: {
          loginType: 'otp',
          phoneVerification: { verified: true, verifiedPhone: '+14165551234' },
        },
      });
      const mockSendOTP = jest.fn().mockResolvedValue({ sid: 'sid-1' });
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
        twilioService: { sendOTP: mockSendOTP },
      });

      const result = await service.login({ email: 'test@example.com' });

      expect(result.data.step).toBe('otp_sent');
      expect(result.data.loginType).toBe('otp');
      expect(result.data.maskedPhone).toContain('1234');
      expect(mockSendOTP).toHaveBeenCalledWith('+14165551234');
    });

    it('falls back to password when SMS feature flag is disabled', async () => {
      const user = makeUser();
      const profile = makeProfile({
        settings: {
          loginType: 'otp',
          phoneVerification: { verified: true, verifiedPhone: '+14165551234' },
        },
      });
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
        featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) },
      });

      const result = await service.login({ email: 'test@example.com' });

      expect(result.data.step).toBe('password_required');
      expect(result.data.loginType).toBe('password');
    });

    it('falls back to password when phone is not verified', async () => {
      const user = makeUser();
      const profile = makeProfile({
        settings: {
          loginType: 'otp',
          phoneVerification: { verified: false, verifiedPhone: null },
        },
      });
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
      });

      const result = await service.login({ email: 'test@example.com' });

      expect(result.data.step).toBe('password_required');
      expect(result.data.loginType).toBe('password');
    });

    it('throws NotFoundError for unknown email', async () => {
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(null) },
      });

      await expect(service.login({ email: 'unknown@example.com' })).rejects.toThrow(NotFoundError);
    });

    it('throws InvalidRequestError for inactive user', async () => {
      const user = makeUser({ isActive: false });
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
      });

      await expect(service.login({ email: 'test@example.com' })).rejects.toThrow(InvalidRequestError);
    });
  });

  describe('Step 2a: password login', () => {
    it('returns authenticated with tokens on valid password', async () => {
      const user = makeUser();
      const service = makeService({
        userDAO: {
          getActiveUserByEmail: jest.fn().mockResolvedValue(user),
          verifyCredentials: jest.fn().mockResolvedValue(user),
          updateById: jest.fn(),
        },
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

    it('throws NotFoundError for wrong password', async () => {
      const user = makeUser();
      const service = makeService({
        userDAO: {
          getActiveUserByEmail: jest.fn().mockResolvedValue(user),
          verifyCredentials: jest.fn().mockResolvedValue(null),
        },
      });

      await expect(
        service.login({ email: 'test@example.com', password: 'WrongPass123' })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('Step 2b: OTP login', () => {
    it('returns authenticated with tokens on valid OTP', async () => {
      const user = makeUser();
      const profile = makeProfile({
        settings: {
          loginType: 'otp',
          phoneVerification: { verified: true, verifiedPhone: '+14165551234' },
        },
      });
      const service = makeService({
        userDAO: {
          getActiveUserByEmail: jest.fn().mockResolvedValue(user),
          updateById: jest.fn(),
        },
        profileDAO: {
          findFirst: jest.fn().mockResolvedValue(profile),
          generateCurrentUserInfo: jest.fn().mockResolvedValue({ sub: 'user-id-1', client: { cuid: 'CUID1' } }),
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

    it('throws UnauthorizedError for invalid OTP', async () => {
      const user = makeUser();
      const profile = makeProfile({
        settings: {
          loginType: 'otp',
          phoneVerification: { verified: true, verifiedPhone: '+14165551234' },
        },
      });
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
        twilioService: { verifyOTP: jest.fn().mockResolvedValue({ valid: false }) },
      });

      await expect(
        service.login({ email: 'test@example.com', otp: '000000' })
      ).rejects.toThrow(UnauthorizedError);
    });

    it('throws BadRequestError when phone not verified', async () => {
      const user = makeUser();
      const profile = makeProfile({
        settings: { phoneVerification: { verified: false, verifiedPhone: null } },
      });
      const service = makeService({
        userDAO: { getActiveUserByEmail: jest.fn().mockResolvedValue(user) },
        profileDAO: { findFirst: jest.fn().mockResolvedValue(profile) },
      });

      await expect(
        service.login({ email: 'test@example.com', otp: '123456' })
      ).rejects.toThrow(BadRequestError);
    });
  });
});
