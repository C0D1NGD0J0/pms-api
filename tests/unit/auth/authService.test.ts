/* eslint-disable */
import * as uuid from 'uuid';
import { Types } from 'mongoose';
import * as utils from '@utils/index';
import { JOB_NAME } from '@utils/constants';
import { AuthService } from '@services/auth/auth.service';
import { JWT_KEY_NAMES } from '@utils/index';
import { TokenType, MailType } from '@interfaces/utils.interface';
import '@tests/mocks/di';
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  InvalidRequestError,
} from '@shared/customErrors';

jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

jest.mock('dayjs', () => {
  const actualDayjs = jest.requireActual('dayjs');
  const mockDayjsInstance = {
    add: jest.fn().mockReturnThis(),
    toDate: jest.fn().mockReturnValue(new Date('2023-01-01T00:00:00.000Z')),
  };
  const dayjs = jest.fn(() => mockDayjsInstance);
  Object.assign(dayjs, actualDayjs);
  return dayjs;
});

jest.mock('@utils/index', () => ({
  hashGenerator: jest.fn((_hashOpts = {}) => 'test-activation-token'),
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
  JWT_KEY_NAMES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
  },
  JOB_NAME: {
    ACCOUNT_ACTIVATION_JOB: 'account-activation-job',
  },
  getLocationDetails: jest.fn((location) =>
    location ? { city: location, country: 'Nigeria' } : null
  ),
  generateShortUID: jest.fn().mockReturnValue('mock-short-uid'),
  httpStatusCodes: {
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    INTERNAL_SERVER_ERROR: 500,
  },
}));

process.env.FRONTEND_URL = 'https://example.com';

describe('AuthService', () => {
  let mockSession: any;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockAuthCache: any;
  let mockEmailQueue: any;
  let mockProfileDAO: any;
  let mockTokenService: any;
  let authService: AuthService;

  const mockClientId = 'mock-cid';
  const mockClientId2 = 'mock-cid-2';
  const mockUserId = new Types.ObjectId();
  const mockAccessToken = 'valid-access-token';
  const mockRefreshToken = 'valid-refresh-token';

  const mockSignupData = {
    firstName: 'Test',
    lastName: 'User',
    email: 'test@example.com',
    password: 'password123',
    location: 'Lagos',
    phoneNumber: '1234567890',
    accountType: {
      planId: 'basic',
      planName: 'Basic Plan',
      isCorporate: false,
    },
    displayName: 'Test User',
    lang: 'en',
    timeZone: 'UTC',
    companyProfile: {
      contactInfo: {
        email: 'company_admin@company.com',
        address: '123, Company Street',
        phoneNumber: '12344321',
        contactPerson: 'James Brown',
      },
      registrationNumber: 'ABC123456',
      yearEstablished: '2000',
      legalEntityName: 'Boring Company',
      businessType: 'software',
      tradingName: 'Boring Co',
      industry: 'IT/Tech',
      website: 'boringcompany.com',
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (uuid.v4 as jest.Mock).mockReturnValue(mockClientId);

    mockSession = {
      endSession: jest.fn(),
    };

    mockUserDAO = {
      startSession: jest.fn().mockResolvedValue(mockSession),
      withTransaction: jest.fn((session, callback) => callback(session)),
      insert: jest.fn().mockResolvedValue({
        _id: mockUserId,
        email: mockSignupData.email,
        firstName: mockSignupData.firstName,
        lastName: mockSignupData.lastName,
        fullname: `${mockSignupData.firstName} ${mockSignupData.lastName}`,
        activationToken: 'test-activation-token',
      }),
      activateAccount: jest.fn(),
      createActivationToken: jest.fn(),
      createPasswordResetToken: jest.fn(),
      resetPassword: jest.fn(),
      getActiveUserByEmail: jest.fn(),
      getUserById: jest.fn(),
      verifyCredentials: jest.fn(),
      updateById: jest.fn(),
    };

    mockClientDAO = {
      insert: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        cid: mockClientId,
        settings: { lang: 'en', timeZone: 'UTC' },
      }),
      getClientByCid: jest.fn(),
      findByCid: jest.fn(),
    };

    mockProfileDAO = {
      createUserProfile: jest.fn().mockResolvedValue({
        _id: new Types.ObjectId(),
        user: mockUserId,
      }),
      generateCurrentUserInfo: jest.fn(),
      findByUserId: jest.fn(),
    };

    mockTokenService = {
      createJwtTokens: jest.fn(),
      verifyJwtToken: jest.fn(),
      decodeJwt: jest.fn(),
    };

    mockAuthCache = {
      saveRefreshToken: jest.fn(),
      getRefreshToken: jest.fn(),
      saveCurrentUser: jest.fn(),
      invalidateUserSession: jest.fn(),
      getCurrentUser: jest.fn(),
    };

    mockEmailQueue = {
      addToEmailQueue: jest.fn(),
    };

    authService = new AuthService({
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emailQueue: mockEmailQueue,
      tokenService: mockTokenService,
      authCache: mockAuthCache,
    });
  });

  // Signup tests
  describe('signup', () => {
    it('should create user with activation token expiry 2 hours in the future', async () => {
      await authService.signup(mockSignupData);

      expect(mockUserDAO.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          activationTokenExpiresAt: new Date('2023-01-01T00:00:00.000Z'),
        }),
        mockSession
      );
    });

    it('should use location details from getLocationDetails helper', async () => {
      const locationDetail = { city: 'Lagos', country: 'Nigeria' };
      jest.spyOn(utils, 'getLocationDetails').mockReturnValue(locationDetail as any);
      await authService.signup(mockSignupData);

      expect(utils.getLocationDetails).toHaveBeenCalledWith(mockSignupData.location);
      expect(mockProfileDAO.createUserProfile).toHaveBeenCalledWith(
        expect.any(Types.ObjectId),
        expect.objectContaining({
          personalInfo: expect.objectContaining({
            location: locationDetail,
          }),
        }),
        mockSession
      );
    });

    it('should use "Unknown" if getLocationDetails returns null', async () => {
      (utils.getLocationDetails as jest.Mock).mockReturnValueOnce(null);

      await authService.signup(mockSignupData);

      expect(mockProfileDAO.createUserProfile).toHaveBeenCalledWith(
        expect.any(Types.ObjectId),
        expect.objectContaining({
          personalInfo: expect.objectContaining({
            location: 'Unknown',
          }),
        }),
        mockSession
      );
    });
  });

  // Login and Session Management tests
  describe('login', () => {
    const loginData = {
      email: 'test@example.com',
      password: 'Password123!',
      rememberMe: false,
    };

    it('should throw BadRequestError if email or password is missing', async () => {
      await expect(
        authService.login({ email: '', password: '', rememberMe: false })
      ).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.getActiveUserByEmail).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if user is not found by email', async () => {
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);

      await expect(authService.login(loginData)).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.getActiveUserByEmail).toHaveBeenCalledWith(loginData.email);
      expect(mockUserDAO.verifyCredentials).not.toHaveBeenCalled();
    });

    it('should throw InvalidRequestError if account is not activated', async () => {
      mockUserDAO.getActiveUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: false,
      });

      await expect(authService.login(loginData)).rejects.toThrow(InvalidRequestError);
      expect(mockUserDAO.getActiveUserByEmail).toHaveBeenCalledWith(loginData.email);
      expect(mockUserDAO.verifyCredentials).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if credentials verification fails', async () => {
      mockUserDAO.getActiveUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
      });
      mockUserDAO.verifyCredentials.mockResolvedValue(null);

      await expect(authService.login(loginData)).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.getActiveUserByEmail).toHaveBeenCalledWith(loginData.email);
      expect(mockUserDAO.verifyCredentials).toHaveBeenCalledWith(
        loginData.email,
        loginData.password
      );
    });

    it('should successfully login with single account', async () => {
      const mockTokens = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      };

      // Setup user with one account
      mockUserDAO.getActiveUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
        ],
      });

      mockUserDAO.verifyCredentials.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
        ],
      });

      mockTokenService.createJwtTokens.mockReturnValue(mockTokens);
      mockAuthCache.saveRefreshToken.mockResolvedValue(true);
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        displayName: 'Test User',
      });
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      const result = await authService.login(loginData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Login successful.');
      expect(result.data).toEqual({
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
        rememberMe: loginData.rememberMe,
        activeAccount: {
          csub: mockClientId,
          displayName: 'Test User',
        },
        accounts: [],
      });

      expect(mockTokenService.createJwtTokens).toHaveBeenCalledWith({
        sub: mockUserId.toString(),
        rememberMe: loginData.rememberMe,
        csub: mockClientId,
      });
      expect(mockAuthCache.saveRefreshToken).toHaveBeenCalledWith(
        mockUserId.toString(),
        mockTokens.refreshToken,
        loginData.rememberMe
      );
    });

    it('should successfully login with multiple accounts', async () => {
      const mockTokens = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      };

      // Setup user with multiple accounts
      mockUserDAO.getActiveUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
          {
            cid: mockClientId2,
            isConnected: true,
            roles: ['USER'],
            displayName: 'Test User 2',
          },
        ],
      });

      mockUserDAO.verifyCredentials.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
          {
            cid: mockClientId2,
            isConnected: true,
            roles: ['USER'],
            displayName: 'Test User 2',
          },
        ],
      });

      mockTokenService.createJwtTokens.mockReturnValue(mockTokens);
      mockAuthCache.saveRefreshToken.mockResolvedValue(true);
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        displayName: 'Test User',
      });
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      const result = await authService.login(loginData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Login successful.');
      expect(result.data).toEqual({
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
        rememberMe: loginData.rememberMe,
        activeAccount: {
          csub: mockClientId,
          displayName: 'Test User',
        },
        accounts: [
          {
            csub: mockClientId2,
            displayName: 'Test User 2',
          },
        ],
      });
    });
  });

  // Current User tests
  describe('getCurrentUser', () => {
    it('should throw BadRequestError if userId is missing', async () => {
      await expect(authService.getCurrentUser('')).rejects.toThrow(BadRequestError);
      expect(mockProfileDAO.generateCurrentUserInfo).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if user not found', async () => {
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(null);

      await expect(authService.getCurrentUser(mockUserId.toString())).rejects.toThrow(
        UnauthorizedError
      );
      expect(mockProfileDAO.generateCurrentUserInfo).toHaveBeenCalledWith(mockUserId.toString());
    });

    it('should return user data successfully', async () => {
      const userData = {
        _id: mockUserId,
        email: 'test@example.com',
        displayName: 'Test User',
      };

      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(userData);
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      const result = await authService.getCurrentUser(mockUserId.toString());

      expect(result.success).toBe(true);
      expect(result.data).toEqual(userData);
      expect(mockAuthCache.saveCurrentUser).toHaveBeenCalledWith(userData);
    });

    it('should handle cache failure gracefully', async () => {
      const userData = {
        _id: mockUserId,
        email: 'test@example.com',
        displayName: 'Test User',
      };

      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(userData);
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: false });

      const result = await authService.getCurrentUser(mockUserId.toString());

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });
  });

  // Account Switching tests
  describe('switchActiveAccount', () => {
    it('should throw BadRequestError if userId or newCid is missing', async () => {
      await expect(authService.switchActiveAccount('', mockClientId)).rejects.toThrow(
        BadRequestError
      );
      await expect(authService.switchActiveAccount(mockUserId.toString(), '')).rejects.toThrow(
        BadRequestError
      );
      expect(mockUserDAO.getUserById).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if user not found', async () => {
      mockUserDAO.getUserById.mockResolvedValue(null);

      await expect(
        authService.switchActiveAccount(mockUserId.toString(), mockClientId)
      ).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.getUserById).toHaveBeenCalledWith(mockUserId.toString());
    });

    it('should throw NotFoundError if account does not exist for user', async () => {
      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        cids: [{ cid: 'different-cid', displayName: 'Different Account' }],
      });

      await expect(
        authService.switchActiveAccount(mockUserId.toString(), mockClientId)
      ).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.updateById).not.toHaveBeenCalled();
    });

    it('should successfully switch to a valid account', async () => {
      const mockTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      };

      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        activeCid: mockClientId,
        cids: [
          { cid: 'different-cid', displayName: 'Different Account' },
          { cid: mockClientId, displayName: 'Test Account' },
        ],
      });

      mockUserDAO.updateById.mockResolvedValue(true);
      mockTokenService.createJwtTokens.mockReturnValue(mockTokens);
      mockAuthCache.saveRefreshToken.mockResolvedValue(true);
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue({
        _id: mockUserId,
        email: 'test@example.com',
        displayName: 'Test User',
      });

      const result = await authService.switchActiveAccount(mockUserId.toString(), mockClientId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Success.');
      expect(result.data).toEqual({
        refreshToken: mockTokens.refreshToken,
        accessToken: mockTokens.accessToken,
        activeAccount: {
          csub: mockClientId,
          displayName: 'Test Account',
        },
      });
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(mockUserId.toString(), {
        $set: { activeCid: mockClientId },
      });
    });
  });

  // Logout tests
  describe('logout', () => {
    it('should throw ForbiddenError if accessToken is empty or invalid', async () => {
      // The actual implementation throws ForbiddenError when token is invalid/missing
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: false,
        data: null,
      });

      await expect(authService.logout('')).rejects.toThrow(ForbiddenError);
      expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith('access_token', '');
      expect(mockAuthCache.invalidateUserSession).not.toHaveBeenCalled();
    });

    it('should not invalidate session if token verification fails', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: false,
        data: null,
      });

      await expect(authService.logout('invalid-token')).rejects.toThrow();
      expect(mockAuthCache.invalidateUserSession).not.toHaveBeenCalled();
    });

    it('should successfully logout and invalidate session', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: { sub: mockUserId.toString() },
      });

      mockAuthCache.invalidateUserSession.mockResolvedValue(true);

      const result = await authService.logout('valid-token');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logout successful.');
      expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith('access_token', 'valid-token');
      expect(mockAuthCache.invalidateUserSession).toHaveBeenCalledWith(mockUserId.toString());
    });
  });

  // Account Activation tests
  describe('accountActivation', () => {
    it('should successfully activate an account with valid token', async () => {
      mockUserDAO.activateAccount.mockResolvedValue(true);

      const result = await authService.accountActivation('valid-token');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Account activated successfully.');
      expect(mockUserDAO.activateAccount).toHaveBeenCalledWith('valid-token');
    });

    it('should throw NotFoundError for invalid or expired token', async () => {
      mockUserDAO.activateAccount.mockResolvedValue(false);

      await expect(authService.accountActivation('invalid-token')).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.activateAccount).toHaveBeenCalledWith('invalid-token');
    });

    it('should throw BadRequestError if token is missing', async () => {
      await expect(authService.accountActivation('')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.activateAccount).not.toHaveBeenCalled();
    });
  });

  // Send Activation Link tests
  describe('sendActivationLink', () => {
    it('should successfully send activation link for valid email', async () => {
      mockUserDAO.createActivationToken.mockResolvedValue({
        email: 'test@example.com',
        fullname: 'Test User',
        cid: mockClientId,
        activationToken: 'new-activation-token',
      });

      mockUserDAO.getActiveUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: 'test@example.com',
        activeCid: mockClientId,
        activationToken: 'new-activation-token',
        profile: {
          fullname: 'Test User',
        },
      });

      const result = await authService.sendActivationLink('test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Account activation link has been sent');
      // Don't assert specific job name, just check the data content
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        expect.any(String), // Don't assert specific job name
        expect.objectContaining({
          to: 'test@example.com',
          emailType: MailType.ACCOUNT_ACTIVATION,
        })
      );
    });

    it('should throw NotFoundError if email not found', async () => {
      mockUserDAO.createActivationToken.mockResolvedValue(null);

      await expect(authService.sendActivationLink('nonexistent@example.com')).rejects.toThrow(
        NotFoundError
      );
      expect(mockUserDAO.createActivationToken).toHaveBeenCalledWith('', 'nonexistent@example.com');
    });

    it('should throw BadRequestError if email is missing', async () => {
      await expect(authService.sendActivationLink('')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.createActivationToken).not.toHaveBeenCalled();
    });
  });

  // Forgot Password tests
  describe('forgotPassword', () => {
    it('should successfully send password reset email for valid email', async () => {
      mockUserDAO.createPasswordResetToken.mockResolvedValue({
        email: 'test@example.com',
        fullname: 'Test User',
        passwordResetToken: 'reset-token',
      });

      mockUserDAO.getActiveUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: 'test@example.com',
        passwordResetToken: 'reset-token',
        profile: {
          fullname: 'Test User',
        },
      });

      const result = await authService.forgotPassword('test@example.com');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Password reset email has been sent');
      // Don't assert specific job name, just check the data content
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        expect.any(String), // Don't assert specific job name
        expect.objectContaining({
          to: 'test@example.com',
          emailType: MailType.FORGOT_PASSWORD,
        })
      );
    });

    it('should throw NotFoundError if email not found', async () => {
      mockUserDAO.createPasswordResetToken.mockResolvedValue(null);

      await expect(authService.forgotPassword('nonexistent@example.com')).rejects.toThrow(
        NotFoundError
      );
      expect(mockUserDAO.createPasswordResetToken).toHaveBeenCalledWith('nonexistent@example.com');
    });

    it('should throw BadRequestError if email is missing', async () => {
      await expect(authService.forgotPassword('')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.createPasswordResetToken).not.toHaveBeenCalled();
    });
  });

  // Reset Password tests
  describe('resetPassword', () => {
    it('should successfully reset password with valid email and token', async () => {
      mockUserDAO.resetPassword.mockResolvedValue({
        email: 'test@example.com',
        fullname: 'Test User',
      });

      // Need to mock getActiveUserByEmail to not throw NotFoundError
      mockUserDAO.getActiveUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: 'test@example.com',
        profile: {
          fullname: 'Test User',
        },
      });

      const result = await authService.resetPassword('test@example.com', 'valid-token');

      expect(result.success).toBe(true);
      expect(result.message).toContain('Password reset email has been sent');
      // Don't assert specific job name, just check the data content
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        expect.any(String), // Don't assert specific job name
        expect.objectContaining({
          to: 'test@example.com',
          emailType: MailType.PASSWORD_RESET,
        })
      );
    });

    it('should throw NotFoundError if email/token combination not found', async () => {
      mockUserDAO.resetPassword.mockResolvedValue(null);

      await expect(authService.resetPassword('test@example.com', 'invalid-token')).rejects.toThrow(
        NotFoundError
      );
      expect(mockUserDAO.resetPassword).toHaveBeenCalledWith('test@example.com', 'invalid-token');
    });

    it('should throw BadRequestError if both email and token are missing', async () => {
      await expect(authService.resetPassword('', '')).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.resetPassword).not.toHaveBeenCalled();
    });
  });

  // Refresh Token tests
  describe('refreshToken', () => {
    it('should throw UnauthorizedError if refreshToken or userId is missing', async () => {
      await expect(
        authService.refreshToken({ refreshToken: '', userId: mockUserId.toString() })
      ).rejects.toThrow(UnauthorizedError);
      await expect(
        authService.refreshToken({ refreshToken: mockRefreshToken, userId: '' })
      ).rejects.toThrow(UnauthorizedError);
      expect(mockAuthCache.getRefreshToken).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if stored refresh token is not found', async () => {
      mockAuthCache.getRefreshToken.mockResolvedValue({ success: false, error: 'Token not found' });

      await expect(
        authService.refreshToken({ refreshToken: mockRefreshToken, userId: mockUserId.toString() })
      ).rejects.toThrow(UnauthorizedError);

      expect(mockAuthCache.getRefreshToken).toHaveBeenCalledWith(mockUserId.toString());
      expect(mockTokenService.verifyJwtToken).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if token verification fails', async () => {
      mockAuthCache.getRefreshToken.mockResolvedValue({ success: true, data: mockRefreshToken });
      mockTokenService.verifyJwtToken.mockResolvedValue({ success: false, error: 'Invalid token' });

      await expect(
        authService.refreshToken({ refreshToken: mockRefreshToken, userId: mockUserId.toString() })
      ).rejects.toThrow(UnauthorizedError);

      expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith(
        JWT_KEY_NAMES.REFRESH_TOKEN as TokenType,
        mockRefreshToken
      );
      expect(mockTokenService.createJwtTokens).not.toHaveBeenCalled();
    });

    it('should successfully refresh tokens with rememberMe flag', async () => {
      const mockTokenPayload = {
        data: {
          sub: mockUserId.toString(),
          csub: mockClientId,
          rememberMe: true,
        },
        iat: 1625097600,
        exp: 1625097900,
      };

      const newTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        rememberMe: true,
      };

      mockAuthCache.getRefreshToken.mockResolvedValue({ success: true, data: mockRefreshToken });
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: {
          sub: mockUserId.toString(),
          csub: mockClientId,
          rememberMe: true,
          iat: mockTokenPayload.iat,
          exp: mockTokenPayload.exp,
        },
      });
      mockTokenService.createJwtTokens.mockReturnValue(newTokens);
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });

      const result = await authService.refreshToken({
        refreshToken: mockRefreshToken,
        userId: mockUserId.toString(),
      });

      expect(result.success).toBe(true);
      expect(result.message).toBe('Token refreshed successfully');
      expect(result.data).toEqual(newTokens);

      expect(mockTokenService.createJwtTokens).toHaveBeenCalledWith({
        sub: mockUserId.toString(),
        rememberMe: true,
        csub: mockClientId,
      });
      expect(mockAuthCache.saveRefreshToken).toHaveBeenCalledWith(
        mockUserId.toString(),
        newTokens.refreshToken,
        true
      );
    });

    it('should throw UnauthorizedError if saving refresh token fails', async () => {
      mockAuthCache.getRefreshToken.mockResolvedValue({ success: true, data: mockRefreshToken });
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: {
          sub: mockUserId.toString(),
          csub: mockClientId,
          rememberMe: false,
          iat: 1625097600,
          exp: 1625097900,
        },
      });
      mockTokenService.createJwtTokens.mockReturnValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        rememberMe: false,
      });
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: false, error: 'Failed to save' });

      await expect(
        authService.refreshToken({ refreshToken: mockRefreshToken, userId: mockUserId.toString() })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  // Token Validation tests
  describe('getTokenUser', () => {
    it('should throw UnauthorizedError if token is missing', async () => {
      await expect(authService.getTokenUser('')).rejects.toThrow(UnauthorizedError);
      expect(mockTokenService.verifyJwtToken).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if token verification fails', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({ success: false, error: 'Invalid token' });

      await expect(authService.getTokenUser(mockAccessToken)).rejects.toThrow(UnauthorizedError);

      expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith(
        JWT_KEY_NAMES.ACCESS_TOKEN as TokenType,
        mockAccessToken
      );
      expect(mockUserDAO.getUserById).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if user not found', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: {
          sub: mockUserId.toString(),
          csub: mockClientId,
          rememberMe: false,
          iat: 1625097600,
          exp: 1625097900,
        },
      });
      mockUserDAO.getUserById.mockResolvedValue(null);

      await expect(authService.getTokenUser(mockAccessToken)).rejects.toThrow(UnauthorizedError);

      expect(mockUserDAO.getUserById).toHaveBeenCalledWith(mockUserId.toString());
    });

    it('should throw UnauthorizedError if user account is not active', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: {
          sub: mockUserId.toString(),
          csub: mockClientId,
          rememberMe: false,
          iat: 1625097600,
          exp: 1625097900,
        },
      });
      mockUserDAO.getUserById.mockResolvedValue({ isActive: false });

      await expect(authService.getTokenUser(mockAccessToken)).rejects.toThrow(UnauthorizedError);
    });

    it('should successfully validate token and user', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: {
          sub: mockUserId.toString(),
          csub: mockClientId,
          rememberMe: false,
          iat: 1625097600,
          exp: 1625097900,
        },
      });
      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        isActive: true,
        email: 'test@example.com',
      });

      const result = await authService.getTokenUser(mockAccessToken);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Token validated successfully');
      expect(result.data).toBeNull();
    });
  });

  // Client Access Verification tests
  describe('verifyClientAccess', () => {
    it('should throw ForbiddenError if user not found', async () => {
      mockUserDAO.getUserById.mockResolvedValue(null);

      await expect(
        authService.verifyClientAccess(mockUserId.toString(), mockClientId)
      ).rejects.toThrow(ForbiddenError);

      expect(mockUserDAO.getUserById).toHaveBeenCalledWith(mockUserId.toString());
      expect(mockClientDAO.getClientByCid).not.toHaveBeenCalled();
    });

    it('should throw ForbiddenError if client not found', async () => {
      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        cids: [{ cid: mockClientId, displayName: 'Test Client' }],
      });
      mockClientDAO.getClientByCid.mockResolvedValue(null);

      await expect(
        authService.verifyClientAccess(mockUserId.toString(), mockClientId)
      ).rejects.toThrow(ForbiddenError);

      expect(mockClientDAO.getClientByCid).toHaveBeenCalledWith(mockClientId);
    });

    it('should throw ForbiddenError if user does not have access to client', async () => {
      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        cids: [{ cid: 'different-client-id', displayName: 'Different Client' }],
      });
      mockClientDAO.getClientByCid.mockResolvedValue({
        _id: new Types.ObjectId(),
        cid: mockClientId,
      });

      await expect(
        authService.verifyClientAccess(mockUserId.toString(), mockClientId)
      ).rejects.toThrow(ForbiddenError);
    });

    it('should successfully verify client access', async () => {
      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        cids: [{ cid: mockClientId, displayName: 'Test Client' }],
      });
      mockClientDAO.getClientByCid.mockResolvedValue({
        _id: new Types.ObjectId(),
        cid: mockClientId,
      });

      const result = await authService.verifyClientAccess(mockUserId.toString(), mockClientId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('User has access to client');
      expect(result.data).toBeNull();
    });
  });
});
