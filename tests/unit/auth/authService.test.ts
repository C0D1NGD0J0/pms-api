import { Types } from 'mongoose';
import { AuthService } from '@services/auth/auth.service';
import {
  UnauthorizedError,
  NotFoundError,
} from '@shared/customErrors';
import { 
  createMockAuthCache,
  createMockAuthTokenService,
  createMockClientDAO,
  createMockCurrentUser,
  createMockEmailQueue,
  createMockProfileDAO,
  createMockSignupData, 
  createMockUser,
  createMockUserDAO,
} from '@tests/helpers';

describe('AuthService', () => {
  let authService: AuthService;
  let mockTokenService: any;
  let mockAuthCache: any;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockEmailQueue: any;

  beforeEach(() => {
    mockTokenService = createMockAuthTokenService();
    mockAuthCache = createMockAuthCache();
    mockUserDAO = createMockUserDAO();
    mockClientDAO = createMockClientDAO();
    mockProfileDAO = createMockProfileDAO();
    mockEmailQueue = createMockEmailQueue();

    authService = new AuthService({
      tokenService: mockTokenService,
      authCache: mockAuthCache,
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emailQueue: mockEmailQueue,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // Test 1: refreshToken - success case
  describe('refreshToken', () => {
    it('should successfully refresh valid token', async () => {
      // Arrange
      const mockRefreshData = {
        refreshToken: 'mock-refresh-token',
        userId: new Types.ObjectId().toString(),
      };
      
      mockAuthCache.getRefreshToken.mockResolvedValue({ success: true });
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: { sub: mockRefreshData.userId, rememberMe: false, csub: 'mock-cuid' },
      });
      mockTokenService.createJwtTokens.mockReturnValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        rememberMe: false,
      });
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });

      // Act
      const result = await authService.refreshToken(mockRefreshData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('new-access-token');
    });

    it('should reject missing refreshToken or userId', async () => {
      // Act & Assert
      await expect(
        authService.refreshToken({ refreshToken: '', userId: 'user-id' })
      ).rejects.toThrow(UnauthorizedError);
    });
  });

  // Test 3: login - success case
  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      // Arrange
      const mockLoginData = {
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false,
      };
      
      const mockUser = createMockUser({
        isActive: true,
        cuids: [
          { cuid: 'test-cuid', isConnected: true, displayName: 'Test Client', roles: ['admin'] },
        ],
        activecuid: 'test-cuid',
      });

      mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);
      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
      mockTokenService.createJwtTokens.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(createMockCurrentUser());
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      // Act
      const result = await authService.login(mockLoginData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('access-token');
    });

    it('should reject invalid credentials', async () => {
      // Arrange
      const mockLoginData = {
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false,
      };
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);

      // Act & Assert
      await expect(authService.login(mockLoginData)).rejects.toThrow(NotFoundError);
    });
  });

  // Test 5: signup - success case
  describe('signup', () => {
    it('should successfully complete signup process', async () => {
      // Arrange
      const mockSignupData = createMockSignupData();
      const mockUser = createMockUser();
      const mockClient = { cuid: 'test-cuid' };
      const mockProfile = { fullname: 'Test User' };

      mockUserDAO.startSession.mockReturnValue('mock-session');
      mockUserDAO.withTransaction.mockImplementation(async (_session: any, callback: any) => {
        return await callback(_session);
      });
      mockUserDAO.insert.mockResolvedValue(mockUser);
      mockClientDAO.insert.mockResolvedValue(mockClient);
      mockProfileDAO.createUserProfile.mockResolvedValue(mockProfile);
      mockEmailQueue.addToEmailQueue.mockResolvedValue(true);

      // Act
      const result = await authService.signup(mockSignupData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('activationEmailSent');
    });

    it('should handle transaction failure', async () => {
      // Arrange
      const mockSignupData = createMockSignupData();
      mockUserDAO.startSession.mockReturnValue('mock-session');
      mockUserDAO.withTransaction.mockImplementation(async (_session: any, _callback: any) => {
        throw new Error('Transaction failed');
      });

      // Act & Assert
      await expect(authService.signup(mockSignupData)).rejects.toThrow('Transaction failed');
    });
  });

  // Test 7: switchActiveAccount
  describe('switchActiveAccount', () => {
    it('should successfully switch active account', async () => {
      // Arrange
      const userId = new Types.ObjectId().toString();
      const newCuid = 'new-cuid';
      const mockUser = createMockUser({
        cuids: [
          { cuid: 'old-cuid', isConnected: true, displayName: 'Old Client', roles: ['admin'] },
          { cuid: newCuid, isConnected: true, displayName: 'New Client', roles: ['tenant'] },
        ],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockUserDAO.updateById.mockResolvedValue({ acknowledged: true });
      mockTokenService.createJwtTokens.mockReturnValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(createMockCurrentUser());
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      // Act
      const result = await authService.switchActiveAccount(userId, newCuid);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.activeAccount.csub).toBe(newCuid);
    });
  });

  // Test 8: getTokenUser
  describe('getTokenUser', () => {
    it('should successfully validate valid token', async () => {
      // Arrange
      const mockToken = 'valid-jwt-token';
      const mockDecodedData = { sub: new Types.ObjectId().toString(), csub: 'test-cuid' };
      const mockUser = createMockUser({
        isActive: true,
        cuids: [
          { cuid: 'test-cuid', isConnected: true, displayName: 'Test Client', roles: ['admin'] },
        ],
      });

      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: mockDecodedData,
      });
      mockUserDAO.getUserById.mockResolvedValue(mockUser);

      // Act
      const result = await authService.getTokenUser(mockToken);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // Test 9: getCurrentUser
  describe('getCurrentUser', () => {
    it('should successfully get current user', async () => {
      // Arrange
      const userId = new Types.ObjectId().toString();
      const mockCurrentUser = createMockCurrentUser();
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(mockCurrentUser);
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      // Act
      const result = await authService.getCurrentUser(userId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCurrentUser);
    });
  });

  // Test 10: verifyClientAccess
  describe('verifyClientAccess', () => {
    it('should successfully verify client access', async () => {
      // Arrange
      const userId = new Types.ObjectId().toString();
      const clientId = 'test-cuid';
      const mockUser = createMockUser({
        cuids: [
          { cuid: clientId, isConnected: true, displayName: 'Test Client', roles: ['admin'] },
        ],
      });
      const mockClient = { cuid: clientId, displayName: 'Test Client' };

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);

      // Act
      const result = await authService.verifyClientAccess(userId, clientId);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // Test 11: forgotPassword
  describe('forgotPassword', () => {
    it('should successfully initiate password reset', async () => {
      // Arrange
      const userEmail = 'test@example.com';
      const mockUser = createMockUser({ email: userEmail });
      (mockUser as any).profile = { fullname: 'Test User' };

      mockUserDAO.createPasswordResetToken.mockResolvedValue(true);
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);
      mockEmailQueue.addToEmailQueue.mockResolvedValue(true);

      // Act
      const result = await authService.forgotPassword(userEmail);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // Test 12: resetPassword
  describe('resetPassword', () => {
    it('should successfully reset password', async () => {
      // Arrange
      const userEmail = 'test@example.com';
      const resetToken = 'reset-token';
      const mockUser = createMockUser({ email: userEmail });
      (mockUser as any).profile = { fullname: 'Test User' };

      mockUserDAO.resetPassword.mockResolvedValue(true);
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);
      mockEmailQueue.addToEmailQueue.mockResolvedValue(true);

      // Act
      const result = await authService.resetPassword(userEmail, resetToken);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // Test 13: accountActivation
  describe('accountActivation', () => {
    it('should successfully activate account', async () => {
      // Arrange
      const activationToken = 'activation-token';
      mockUserDAO.activateAccount.mockResolvedValue(true);

      // Act
      const result = await authService.accountActivation(activationToken);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // Test 14: logout
  describe('logout', () => {
    it('should successfully logout user', async () => {
      // Arrange
      const accessToken = 'valid-access-token';
      const userId = new Types.ObjectId().toString();
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: { sub: userId },
      });
      mockAuthCache.invalidateUserSession.mockResolvedValue({ success: true });

      // Act
      const result = await authService.logout(accessToken);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  // Test 15: loginAfterInvitationSignup
  describe('loginAfterInvitationSignup', () => {
    it('should successfully login after invitation signup', async () => {
      // Arrange
      const userId = new Types.ObjectId().toString();
      const clientId = 'test-cuid';
      const mockUser = createMockUser({
        cuids: [
          { cuid: clientId, isConnected: true, displayName: 'Test Client', roles: ['tenant'] },
        ],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockTokenService.createJwtTokens.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      mockAuthCache.saveRefreshToken.mockResolvedValue({ success: true });
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(createMockCurrentUser());
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      // Act
      const result = await authService.loginAfterInvitationSignup(userId, clientId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.activeAccount.csub).toBe(clientId);
    });
  });
});