/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { AuthService } from '@services/auth/auth.service';
import { 
  mockUserDAO,
  mockClientDAO,
  mockProfileDAO,
  mockAuthCache,
  mockEmailQueue,
  mockAuthTokenService,
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError,
  UnauthorizedError,
  InvalidRequestError,
  ForbiddenError
} from '@shared/customErrors';

jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  generateShortUID: jest.fn(() => 'short-uid-123'),
  hashGenerator: jest.fn(() => 'hash-123'),
  getLocationDetails: jest.fn(() => ({ city: 'Test City', country: 'Test Country' })),
  JWT_KEY_NAMES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token'
  },
  JOB_NAME: {
    SEND_EMAIL: 'send_email'
  }
}));

describe('AuthService - Unit Tests', () => {
  let authService: AuthService;

  beforeAll(() => {
    authService = new AuthService({
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      authCache: mockAuthCache,
      emailQueue: mockEmailQueue,
      tokenService: mockAuthTokenService,
    });
  });

  beforeEach(() => {
    resetTestContainer();
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should create user account successfully', async () => {
      // Arrange
      const signupData = {
        email: 'test@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        phoneNumber: '+1234567890',
        role: 'admin' as any
      };

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockUser = TestDataFactory.createUser({ 
        email: signupData.email,
        _id: 'user-123'
      });
      const mockProfile = TestDataFactory.createProfile({ userId: 'user-123' });

      mockUserDAO.isEmailUnique.mockResolvedValue(true);
      mockUserDAO.startSession.mockResolvedValue({});
      mockUserDAO.withTransaction.mockImplementation((session, callback) => callback(session));
      mockClientDAO.insert.mockResolvedValue(mockClient);
      mockUserDAO.insert.mockResolvedValue(mockUser);
      mockProfileDAO.createUserProfile.mockResolvedValue(mockProfile);
      mockUserDAO.associateUserWithClient.mockResolvedValue(true);
      mockEmailQueue.addToEmailQueue.mockResolvedValue({ success: true });

      // Act
      const result = await authService.signup(signupData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Account created successfully');
      expect(mockUserDAO.isEmailUnique).toHaveBeenCalledWith(signupData.email);
      expect(mockClientDAO.insert).toHaveBeenCalled();
      expect(mockUserDAO.insert).toHaveBeenCalled();
      expect(mockProfileDAO.createUserProfile).toHaveBeenCalled();
    });

    it('should reject signup with existing email', async () => {
      // Arrange
      const signupData = {
        email: 'existing@example.com',
        password: 'password123',
        firstName: 'John',
        lastName: 'Doe',
        phoneNumber: '+1234567890',
        role: 'admin' as any
      };

      mockUserDAO.isEmailUnique.mockResolvedValue(false);

      // Act & Assert
      await expect(authService.signup(signupData))
        .rejects.toThrow(BadRequestError);
      
      expect(mockUserDAO.isEmailUnique).toHaveBeenCalledWith(signupData.email);
    });
  });

  describe('login', () => {
    it('should login successfully with valid credentials', async () => {
      // Arrange
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false
      };

      const mockUser = TestDataFactory.createUser({ 
        email: loginData.email,
        isActive: true
      });

      const mockTokens = {
        accessToken: 'access-token-123',
        refreshToken: 'refresh-token-123'
      };

      const mockProfile = TestDataFactory.createProfile({ userId: mockUser._id });

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(mockProfile);
      mockAuthTokenService.createJwtTokens.mockResolvedValue({ 
        success: true, 
        data: mockTokens 
      });
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      // Act
      const result = await authService.login(loginData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe(mockTokens.accessToken);
      expect(result.data.refreshToken).toBe(mockTokens.refreshToken);
      expect(mockUserDAO.verifyCredentials).toHaveBeenCalledWith(loginData.email, loginData.password);
    });

    it('should reject login with invalid credentials', async () => {
      // Arrange
      const loginData = {
        email: 'test@example.com',
        password: 'wrongpassword',
        rememberMe: false
      };

      mockUserDAO.verifyCredentials.mockResolvedValue(null);

      // Act & Assert
      await expect(authService.login(loginData))
        .rejects.toThrow(UnauthorizedError);
    });

    it('should reject login for inactive user', async () => {
      // Arrange
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false
      };

      const mockUser = TestDataFactory.createUser({ 
        email: loginData.email,
        isActive: false // User not activated
      });

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(authService.login(loginData))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe('refreshToken', () => {
    it('should refresh tokens successfully', async () => {
      // Arrange
      const refreshData = {
        refreshToken: 'valid-refresh-token',
        userId: 'user-123'
      };

      const mockUser = TestDataFactory.createUser({ _id: refreshData.userId });
      const mockNewTokens = {
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token'
      };

      mockAuthCache.getRefreshToken.mockResolvedValue({ 
        success: true, 
        data: refreshData.refreshToken 
      });
      mockAuthTokenService.verifyJwtToken.mockReturnValue({ 
        success: true, 
        data: { sub: refreshData.userId } 
      });
      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockAuthTokenService.createJwtTokens.mockResolvedValue({ 
        success: true, 
        data: mockNewTokens 
      });
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });

      // Act
      const result = await authService.refreshToken(refreshData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe(mockNewTokens.accessToken);
      expect(result.data.refreshToken).toBe(mockNewTokens.refreshToken);
    });

    it('should reject invalid refresh token', async () => {
      // Arrange
      const refreshData = {
        refreshToken: 'invalid-refresh-token',
        userId: 'user-123'
      };

      mockAuthCache.getRefreshToken.mockResolvedValue({ 
        success: false, 
        data: null 
      });

      // Act & Assert
      await expect(authService.refreshToken(refreshData))
        .rejects.toThrow(UnauthorizedError);
    });
  });

  describe('getCurrentUser', () => {
    it('should get current user successfully', async () => {
      // Arrange
      const userId = 'user-123';
      const mockUserData = TestDataFactory.createUser({ _id: userId });

      mockAuthCache.getCurrentUser.mockResolvedValue({ 
        success: true, 
        data: mockUserData 
      });

      // Act
      const result = await authService.getCurrentUser(userId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUserData);
    });

    it('should handle user not found in cache', async () => {
      // Arrange
      const userId = 'user-123';

      mockAuthCache.getCurrentUser.mockResolvedValue({ 
        success: false, 
        data: null 
      });

      // Act & Assert
      await expect(authService.getCurrentUser(userId))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('accountActivation', () => {
    it('should activate account successfully', async () => {
      // Arrange
      const activationToken = 'valid-activation-token';

      mockUserDAO.activateAccount.mockResolvedValue(true);

      // Act
      const result = await authService.accountActivation(activationToken);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Account activated successfully');
      expect(mockUserDAO.activateAccount).toHaveBeenCalledWith(activationToken);
    });

    it('should reject invalid activation token', async () => {
      // Arrange
      const activationToken = 'invalid-activation-token';

      mockUserDAO.activateAccount.mockResolvedValue(false);

      // Act & Assert
      await expect(authService.accountActivation(activationToken))
        .rejects.toThrow(BadRequestError);
    });
  });

  describe('verifyClientAccess', () => {
    it('should verify client access successfully', async () => {
      // Arrange
      const userId = 'user-123';
      const clientId = 'client-123';

      const mockUser = TestDataFactory.createUser({ 
        _id: userId,
        cids: [{ cid: clientId, isConnected: true }]
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);

      // Act
      const result = await authService.verifyClientAccess(userId, clientId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('User has access to client');
    });

    it('should reject access for unconnected client', async () => {
      // Arrange
      const userId = 'user-123';
      const clientId = 'client-456';

      const mockUser = TestDataFactory.createUser({ 
        _id: userId,
        cids: [{ cid: 'client-123', isConnected: true }] // Different client
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);

      // Act & Assert
      await expect(authService.verifyClientAccess(userId, clientId))
        .rejects.toThrow(ForbiddenError);
    });
  });

  describe('sendActivationLink', () => {
    it('should send activation link successfully', async () => {
      // Arrange
      const email = 'test@example.com';
      const mockUser = TestDataFactory.createUser({ 
        email,
        activationToken: 'activation-token-123'
      });

      mockUserDAO.createActivationToken.mockResolvedValue(mockUser);
      mockEmailQueue.addToEmailQueue.mockResolvedValue({ success: true });

      // Act
      const result = await authService.sendActivationLink(email);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Activation link sent successfully');
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalled();
    });

    it('should handle user not found for activation', async () => {
      // Arrange
      const email = 'nonexistent@example.com';

      mockUserDAO.createActivationToken.mockResolvedValue(null);

      // Act & Assert
      await expect(authService.sendActivationLink(email))
        .rejects.toThrow(NotFoundError);
    });
  });
});