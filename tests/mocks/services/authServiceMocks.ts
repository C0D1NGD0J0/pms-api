import { jest } from '@jest/globals';
import { AuthTestFactory } from '@tests/utils/authTestHelpers';
import { MailType } from '@interfaces/utils.interface';

/**
 * Comprehensive mocks for AuthService dependencies
 */
export const createAuthServiceMocks = () => {
  // DAO Mocks
  const mockUserDAO = {
    getUserById: jest.fn(),
    getActiveUserByEmail: jest.fn(),
    verifyCredentials: jest.fn(),
    insert: jest.fn(),
    updateById: jest.fn(),
    activateAccount: jest.fn(),
    createActivationToken: jest.fn(),
    createPasswordResetToken: jest.fn(),
    resetPassword: jest.fn(),
    startSession: jest.fn(),
    withTransaction: jest.fn()
  };

  const mockClientDAO = {
    getClientByCid: jest.fn(),
    insert: jest.fn(),
    findById: jest.fn()
  };

  const mockProfileDAO = {
    createUserProfile: jest.fn(),
    generateCurrentUserInfo: jest.fn(),
    findById: jest.fn()
  };

  // Service Mocks
  const mockAuthTokenService = {
    createJwtTokens: jest.fn(),
    verifyJwtToken: jest.fn(),
    decodeToken: jest.fn(),
    generateTokens: jest.fn()
  };

  // Cache Mock
  const mockAuthCache = {
    saveRefreshToken: jest.fn(),
    getRefreshToken: jest.fn(),
    saveCurrentUser: jest.fn(),
    getCurrentUser: jest.fn(),
    invalidateUserSession: jest.fn(),
    invalidateRefreshToken: jest.fn()
  };

  // Queue Mock
  const mockEmailQueue = {
    addToEmailQueue: jest.fn(),
    getJobStatus: jest.fn()
  };

  // Setup default successful responses
  const setupDefaultMockResponses = () => {
    // UserDAO defaults
    mockUserDAO.startSession.mockResolvedValue({});
    mockUserDAO.withTransaction.mockImplementation(async (session, callback) => {
      return await callback(session);
    });

    // ClientDAO defaults
    mockClientDAO.getClientByCid.mockResolvedValue(
      AuthTestFactory.createClientDocument()
    );

    // ProfileDAO defaults
    mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
      AuthTestFactory.createCurrentUserInfo()
    );

    // AuthTokenService defaults
    mockAuthTokenService.createJwtTokens.mockReturnValue(
      AuthTestFactory.createJwtTokens()
    );
    
    mockAuthTokenService.verifyJwtToken.mockResolvedValue({
      success: true,
      data: {
        sub: 'user-123',
        csub: 'client-123',
        rememberMe: false,
        exp: Math.floor(Date.now() / 1000) + 3600
      }
    });

    // AuthCache defaults
    mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });
    mockAuthCache.getRefreshToken.mockResolvedValue({ 
      success: true, 
      data: 'valid-refresh-token' 
    });
    mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });
    mockAuthCache.invalidateUserSession.mockResolvedValue({ success: true });

    // EmailQueue defaults
    mockEmailQueue.addToEmailQueue.mockResolvedValue({ id: 'email-job-123' });
  };

  // Setup error scenarios
  const setupErrorScenarios = () => {
    return {
      databaseError: () => {
        mockUserDAO.insert.mockRejectedValue(new Error('Database connection failed'));
        mockUserDAO.getUserById.mockRejectedValue(new Error('Database connection failed'));
        mockClientDAO.insert.mockRejectedValue(new Error('Database connection failed'));
      },

      userNotFound: () => {
        mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);
        mockUserDAO.getUserById.mockResolvedValue(null);
      },

      inactiveUser: () => {
        const inactiveUser = AuthTestFactory.createUserDocument({ isActive: false });
        mockUserDAO.getActiveUserByEmail.mockResolvedValue(inactiveUser);
      },

      invalidCredentials: () => {
        mockUserDAO.verifyCredentials.mockResolvedValue(null);
      },

      tokenVerificationFailed: () => {
        mockAuthTokenService.verifyJwtToken.mockResolvedValue({
          success: false,
          data: null,
          error: 'Token expired'
        });
      },

      expiredRefreshToken: () => {
        mockAuthCache.getRefreshToken.mockResolvedValue({
          success: false,
          data: null,
          error: 'Token expired'
        });
      },

      cacheError: () => {
        mockAuthCache.saveRefreshToken.mockResolvedValue({ 
          success: false, 
          error: 'Cache error' 
        });
        mockAuthCache.saveCurrentUser.mockResolvedValue({ 
          success: false, 
          error: 'Cache error' 
        });
      },

      emailQueueError: () => {
        mockEmailQueue.addToEmailQueue.mockRejectedValue(
          new Error('Email queue service unavailable')
        );
      },

      clientNotFound: () => {
        mockClientDAO.getClientByCid.mockResolvedValue(null);
      },

      profileCreationError: () => {
        mockProfileDAO.createUserProfile.mockRejectedValue(
          new Error('Profile creation failed')
        );
      },

      activationTokenExpired: () => {
        mockUserDAO.activateAccount.mockResolvedValue(null);
      },

      passwordResetTokenExpired: () => {
        mockUserDAO.resetPassword.mockRejectedValue(
          new Error('Reset token expired or invalid')
        );
      }
    };
  };

  // Helper to setup successful signup scenario
  const setupSuccessfulSignupScenario = (signupData: any) => {
    const userId = 'user-123';
    const clientId = 'client-123';
    
    const createdUser = AuthTestFactory.createUserDocument({
      email: signupData.email,
      isActive: false
    });
    
    const createdClient = AuthTestFactory.createClientDocument({
      cid: clientId,
      accountAdmin: userId,
      accountType: signupData.accountType
    });
    
    const createdProfile = AuthTestFactory.createProfileDocument({
      user: userId,
      personalInfo: {
        firstName: signupData.firstName,
        lastName: signupData.lastName,
        displayName: signupData.displayName,
        phoneNumber: signupData.phoneNumber,
        location: signupData.location
      }
    });

    mockUserDAO.insert.mockResolvedValue(createdUser);
    mockClientDAO.insert.mockResolvedValue(createdClient);
    mockProfileDAO.createUserProfile.mockResolvedValue(createdProfile);

    return { createdUser, createdClient, createdProfile };
  };

  // Helper to setup successful login scenario
  const setupSuccessfulLoginScenario = (loginData: any, userOverrides = {}) => {
    const user = AuthTestFactory.createUserDocument({
      email: loginData.email,
      isActive: true,
      ...userOverrides
    });

    const tokens = AuthTestFactory.createJwtTokens({
      rememberMe: loginData.rememberMe
    });

    const currentUserInfo = AuthTestFactory.createCurrentUserInfo({
      sub: user._id.toString(),
      email: user.email
    });

    mockUserDAO.getActiveUserByEmail.mockResolvedValue(user);
    mockUserDAO.verifyCredentials.mockResolvedValue(user);
    mockAuthTokenService.createJwtTokens.mockReturnValue(tokens);
    mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(currentUserInfo);

    return { user, tokens, currentUserInfo };
  };

  // Helper to setup multi-client scenario
  const setupMultiClientScenario = () => {
    const user = AuthTestFactory.createMultiClientUserDocument();
    const tokens = AuthTestFactory.createJwtTokens();
    const currentUserInfo = AuthTestFactory.createCurrentUserInfo({
      sub: user._id.toString()
    });

    mockUserDAO.getActiveUserByEmail.mockResolvedValue(user);
    mockUserDAO.verifyCredentials.mockResolvedValue(user);
    mockAuthTokenService.createJwtTokens.mockReturnValue(tokens);
    mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(currentUserInfo);

    return { user, tokens, currentUserInfo };
  };

  // Helper to setup token refresh scenario
  const setupTokenRefreshScenario = (refreshTokenData: any, userOverrides = {}) => {
    const user = AuthTestFactory.createUserDocument({
      _id: refreshTokenData.userId,
      ...userOverrides
    });

    const decodedToken = {
      sub: refreshTokenData.userId,
      csub: 'client-123',
      rememberMe: false,
      exp: Math.floor(Date.now() / 1000) + 3600
    };

    const newTokens = AuthTestFactory.createJwtTokens();

    mockAuthCache.getRefreshToken.mockResolvedValue({
      success: true,
      data: refreshTokenData.refreshToken
    });

    mockAuthTokenService.verifyJwtToken.mockResolvedValue({
      success: true,
      data: decodedToken
    });

    mockAuthTokenService.createJwtTokens.mockReturnValue(newTokens);

    return { user, decodedToken, newTokens };
  };

  // Helper to setup password reset scenario
  const setupPasswordResetScenario = (email: string) => {
    const user = AuthTestFactory.createUserDocument({
      email,
      profile: AuthTestFactory.createProfileDocument()
    });

    mockUserDAO.createPasswordResetToken.mockResolvedValue(true);
    mockUserDAO.getActiveUserByEmail.mockResolvedValue(user);

    return user;
  };

  // Helper to setup account activation scenario
  const setupAccountActivationScenario = (token: string) => {
    const user = AuthTestFactory.createUserDocument({
      activationToken: token,
      isActive: false
    });

    mockUserDAO.activateAccount.mockResolvedValue(user);

    return user;
  };

  // Reset all mocks
  const resetAllMocks = () => {
    Object.values({
      ...mockUserDAO,
      ...mockClientDAO,
      ...mockProfileDAO,
      ...mockAuthTokenService,
      ...mockAuthCache,
      ...mockEmailQueue
    }).forEach(mock => {
      if (jest.isMockFunction(mock)) {
        mock.mockReset();
      }
    });
  };

  return {
    // DAOs
    mockUserDAO,
    mockClientDAO,
    mockProfileDAO,
    
    // Services
    mockAuthTokenService,
    
    // Cache & Queue
    mockAuthCache,
    mockEmailQueue,
    
    // Helpers
    setupDefaultMockResponses,
    setupErrorScenarios,
    setupSuccessfulSignupScenario,
    setupSuccessfulLoginScenario,
    setupMultiClientScenario,
    setupTokenRefreshScenario,
    setupPasswordResetScenario,
    setupAccountActivationScenario,
    resetAllMocks
  };
};

/**
 * Mock data generators for auth scenarios
 */
export const AuthMockData = {
  // Success responses
  createSuccessfulSignupResponse: () => ({
    success: true,
    data: null,
    message: 'Account activation email has been sent to test@example.com'
  }),

  createSuccessfulLoginResponse: (hasMultipleAccounts = false) => {
    const tokens = AuthTestFactory.createJwtTokens();
    const activeAccount = {
      csub: 'client-123',
      displayName: 'Test Account'
    };

    return {
      success: true,
      data: {
        ...tokens,
        activeAccount,
        accounts: hasMultipleAccounts ? [
          { csub: 'client-456', displayName: 'Secondary Account' }
        ] : []
      },
      message: 'Login successful.'
    };
  },

  createSuccessfulTokenRefreshResponse: () => {
    const tokens = AuthTestFactory.createJwtTokens();
    return {
      success: true,
      data: tokens,
      message: 'Token refreshed successfully'
    };
  },

  createSuccessfulLogoutResponse: () => ({
    success: true,
    data: null,
    message: 'Logout successful.'
  }),

  // Email responses
  createActivationEmailData: (email: string, activationToken: string) =>
    AuthTestFactory.createEmailData(MailType.ACCOUNT_ACTIVATION, {
      to: email,
      data: {
        fullname: 'Test User',
        activationUrl: `${process.env.FRONTEND_URL}/client-123/account_activation?t=${activationToken}`
      }
    }),

  createPasswordResetEmailData: (email: string, resetToken: string) =>
    AuthTestFactory.createEmailData(MailType.FORGOT_PASSWORD, {
      to: email,
      data: {
        fullname: 'Test User',
        resetUrl: `${process.env.FRONTEND_URL}/reset_password/${resetToken}`
      }
    }),

  // Error responses
  createValidationErrorResponse: (field: string, message: string) => ({
    success: false,
    error: 'Validation failed',
    details: { [field]: message }
  }),

  createAuthenticationErrorResponse: (message = 'Authentication failed') => ({
    success: false,
    error: message
  }),

  createDatabaseErrorResponse: (operation: string) =>
    new Error(`Database ${operation} operation failed`),

  // User scenarios
  createActiveUser: () => AuthTestFactory.createUserDocument({ isActive: true }),
  createInactiveUser: () => AuthTestFactory.createUserDocument({ isActive: false }),
  createUserWithExpiredToken: () => AuthTestFactory.createUserDocument({
    activationTokenExpiresAt: new Date(Date.now() - 3600000) // 1 hour ago
  }),

  // Token scenarios
  createValidTokenPayload: () => ({
    sub: 'user-123',
    csub: 'client-123',
    rememberMe: false,
    exp: Math.floor(Date.now() / 1000) + 3600 // 1 hour from now
  }),

  createExpiredTokenPayload: () => ({
    sub: 'user-123',
    csub: 'client-123',
    rememberMe: false,
    exp: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
  })
};