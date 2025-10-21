import { Types } from 'mongoose';
import { AuthService } from '@services/auth/auth.service';
import { ROLE_GROUPS, ROLES } from '@shared/constants/roles.constants';
import { UnauthorizedError, NotFoundError } from '@shared/customErrors';
import { createAuthServiceDependencies, createServiceWithMocks } from '@tests/helpers/mocks/services.mocks';
import {
  createMockCompanyProfile,
  createMockCurrentUser,
  createMockSignupData,
  createMockUser,
} from '@tests/helpers';

describe('AuthService', () => {
  let authService: AuthService;
  let mocks: any;

  beforeEach(() => {
    const result = createServiceWithMocks(AuthService, createAuthServiceDependencies);
    authService = result.service;
    mocks = result.mocks;
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

      mocks.authCache.getRefreshToken.mockResolvedValue({ success: true });
      mocks.tokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: { sub: mockRefreshData.userId, rememberMe: false, csub: 'mock-cuid' },
      });
      mocks.tokenService.createJwtTokens.mockReturnValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        rememberMe: false,
      });
      mocks.authCache.saveRefreshToken.mockResolvedValue({ success: true });

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
          {
            cuid: 'test-cuid',
            isConnected: true,
            clientDisplayName: 'Test Client',
            roles: [ROLES.ADMIN],
          },
        ],
        activecuid: 'test-cuid',
      });

      mocks.userDAO.getActiveUserByEmail.mockResolvedValue(mockUser);
      mocks.userDAO.verifyCredentials.mockResolvedValue(mockUser);
      mocks.tokenService.createJwtTokens.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      mocks.authCache.saveRefreshToken.mockResolvedValue({ success: true });
      mocks.profileDAO.generateCurrentUserInfo.mockResolvedValue(createMockCurrentUser());
      mocks.authCache.saveCurrentUser.mockResolvedValue({ success: true });

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
      mocks.userDAO.getActiveUserByEmail.mockResolvedValue(null);

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

      mocks.userDAO.startSession.mockReturnValue('mock-session');
      mocks.userDAO.withTransaction.mockImplementation(async (_session: any, callback: any) => {
        return await callback(_session);
      });
      mocks.userDAO.insert.mockResolvedValue(mockUser);
      mocks.clientDAO.insert.mockResolvedValue(mockClient);
      mocks.profileDAO.createUserProfile.mockResolvedValue(mockProfile);
      mocks.emailQueue.addToEmailQueue.mockResolvedValue(true);

      // Act
      const result = await authService.signup(mockSignupData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('activationEmailSent');
    });

    it('should handle transaction failure', async () => {
      // Arrange
      const mockSignupData = createMockSignupData();
      mocks.userDAO.startSession.mockReturnValue('mock-session');
      mocks.userDAO.withTransaction.mockImplementation(async (_session: any, _callback: any) => {
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
          {
            cuid: 'old-cuid',
            isConnected: true,
            clientDisplayName: 'Old Client',
            roles: [ROLES.ADMIN],
          },
          { cuid: newCuid, isConnected: true, clientDisplayName: 'New Client', roles: [ROLES.TENANT] },
        ],
      });

      mocks.userDAO.getUserById.mockResolvedValue(mockUser);
      mocks.userDAO.updateById.mockResolvedValue({ acknowledged: true });
      mocks.tokenService.createJwtTokens.mockReturnValue({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
      });
      mocks.authCache.saveRefreshToken.mockResolvedValue({ success: true });
      mocks.profileDAO.generateCurrentUserInfo.mockResolvedValue(createMockCurrentUser());
      mocks.authCache.saveCurrentUser.mockResolvedValue({ success: true });

      // Act
      const result = await authService.switchActiveAccount(userId, newCuid);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.activeAccount.cuid).toBe(newCuid);
    });
  });

  // Test 8: getTokenUser
  describe('getTokenUser', () => {
    it('should successfully validate valid token', async () => {
      // Arrange
      const mockToken = 'valid-jwt-token';
      const mockDecodedData = { sub: new Types.ObjectId().toString(), cuid: 'test-cuid' };
      const mockUser = createMockUser({
        isActive: true,
        cuids: [
          {
            cuid: 'test-cuid',
            isConnected: true,
            clientDisplayName: 'Test Client',
            roles: [ROLES.ADMIN],
          },
        ],
      });

      mocks.tokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: mockDecodedData,
      });
      mocks.userDAO.getUserById.mockResolvedValue(mockUser);

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
      mocks.profileDAO.generateCurrentUserInfo.mockResolvedValue(mockCurrentUser);
      mocks.authCache.saveCurrentUser.mockResolvedValue({ success: true });

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
          { cuid: clientId, isConnected: true, clientDisplayName: 'Test Client', roles: [ROLES.ADMIN] },
        ],
      });
      const mockClient = { cuid: clientId, displayName: 'Test Client' };

      mocks.userDAO.getUserById.mockResolvedValue(mockUser);
      mocks.clientDAO.getClientByCuid.mockResolvedValue(mockClient);

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

      mocks.userDAO.createPasswordResetToken.mockResolvedValue(true);
      mocks.userDAO.getActiveUserByEmail.mockResolvedValue(mockUser);
      mocks.emailQueue.addToEmailQueue.mockResolvedValue(true);

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

      mocks.userDAO.resetPassword.mockResolvedValue(true);
      mocks.userDAO.getActiveUserByEmail.mockResolvedValue(mockUser);
      mocks.emailQueue.addToEmailQueue.mockResolvedValue(true);

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
      mocks.userDAO.activateAccount.mockResolvedValue(true);

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
      mocks.tokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: { sub: userId },
      });
      mocks.authCache.invalidateUserSession.mockResolvedValue({ success: true });

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
          {
            cuid: clientId,
            isConnected: true,
            clientDisplayName: 'Test Client',
            roles: [ROLES.TENANT],
          },
        ],
      });

      mocks.userDAO.getUserById.mockResolvedValue(mockUser);
      mocks.tokenService.createJwtTokens.mockReturnValue({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
      });
      mocks.authCache.saveRefreshToken.mockResolvedValue({ success: true });
      mocks.profileDAO.generateCurrentUserInfo.mockResolvedValue(createMockCurrentUser());
      mocks.authCache.saveCurrentUser.mockResolvedValue({ success: true });

      // Act
      const result = await authService.loginAfterInvitationSignup(userId, clientId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.activeAccount.cuid).toBe(clientId);
    });
  });

  describe('vendor signup integration', () => {
    it('should create vendor during corporate account signup', async () => {
      const signupData = createMockSignupData({
        accountType: {
          isCorporate: true,
          planName: 'business',
          planId: 'business-plan',
        },
        companyProfile: createMockCompanyProfile(),
      });

      const mockUser = createMockUser();
      const mockClient = { _id: new Types.ObjectId(), cuid: 'test-client' };
      const mockProfile = { _id: new Types.ObjectId(), user: mockUser._id };

      // Mock successful user and client creation
      mocks.userDAO.withTransaction.mockImplementation(async (session: any, callback: any) => {
        return callback(session);
      });
      mocks.userDAO.insert.mockResolvedValue(mockUser);
      mocks.clientDAO.insert.mockResolvedValue(mockClient);
      mocks.profileDAO.createUserProfile.mockResolvedValue(mockProfile);
      mocks.emailQueue.addToEmailQueue.mockResolvedValue(true);

      // Mock successful vendor creation
      mocks.vendorService.createVendorFromCompanyProfile.mockResolvedValue({
        vuid: 'vendor-123',
        companyName: signupData.companyProfile?.legalEntityName || 'Test Company',
      });

      const result = await authService.signup(signupData);

      expect(result.success).toBe(true);
      expect(mocks.vendorService.createVendorFromCompanyProfile).toHaveBeenCalledWith(
        expect.any(String), // cuid is generated dynamically
        mockUser._id?.toString(),
        signupData.companyProfile
      );
    });

    it('should handle vendor creation failure gracefully during signup', async () => {
      const signupData = createMockSignupData({
        accountType: {
          isCorporate: true,
          planName: 'business',
          planId: 'business-plan',
        },
        companyProfile: createMockCompanyProfile(),
      });

      const mockUser = createMockUser();
      const mockClient = { _id: new Types.ObjectId(), cuid: 'test-client' };
      const mockProfile = { _id: new Types.ObjectId(), user: mockUser._id };

      // Mock successful user and client creation
      mocks.userDAO.withTransaction.mockImplementation(async (session: any, callback: any) => {
        return callback(session);
      });
      mocks.userDAO.insert.mockResolvedValue(mockUser);
      mocks.clientDAO.insert.mockResolvedValue(mockClient);
      mocks.profileDAO.createUserProfile.mockResolvedValue(mockProfile);
      mocks.emailQueue.addToEmailQueue.mockResolvedValue(true);

      // Mock vendor creation failure (should not break signup)
      mocks.vendorService.createVendorFromCompanyProfile.mockRejectedValue(
        new Error('Vendor creation failed')
      );

      const result = await authService.signup(signupData);

      expect(result.success).toBe(true);
      expect(mocks.vendorService.createVendorFromCompanyProfile).toHaveBeenCalled();
    });

    it('should skip vendor creation for non-corporate accounts', async () => {
      const signupData = createMockSignupData({
        accountType: {
          isCorporate: false,
          planName: 'basic',
          planId: 'basic-plan',
        },
      });

      const mockUser = createMockUser();
      const mockClient = { _id: new Types.ObjectId(), cuid: 'test-client' };
      const mockProfile = { _id: new Types.ObjectId(), user: mockUser._id };

      mocks.userDAO.withTransaction.mockImplementation(async (session: any, callback: any) => {
        return callback(session);
      });
      mocks.userDAO.insert.mockResolvedValue(mockUser);
      mocks.clientDAO.insert.mockResolvedValue(mockClient);
      mocks.profileDAO.createUserProfile.mockResolvedValue(mockProfile);
      mocks.emailQueue.addToEmailQueue.mockResolvedValue(true);

      const result = await authService.signup(signupData);

      expect(result.success).toBe(true);
      expect(mocks.vendorService.createVendorFromCompanyProfile).not.toHaveBeenCalled();
    });

    it('should create vendor with email and contact person mapping', async () => {
      const signupData = createMockSignupData({
        email: 'owner@company.com',
        firstName: 'John',
        lastName: 'Owner',
        accountType: {
          isCorporate: true,
          planName: 'business',
          planId: 'business-plan',
        },
        companyProfile: createMockCompanyProfile({
          companyEmail: 'info@company.com',
          contactPerson: null, // Should fallback to signup data
        }),
      });

      const mockUser = createMockUser();
      const mockClient = { _id: new Types.ObjectId(), cuid: 'test-client' };
      const mockProfile = { _id: new Types.ObjectId(), user: mockUser._id };

      mocks.userDAO.withTransaction.mockImplementation(async (session: any, callback: any) => {
        return callback(session);
      });
      mocks.userDAO.insert.mockResolvedValue(mockUser);
      mocks.clientDAO.insert.mockResolvedValue(mockClient);
      mocks.profileDAO.createUserProfile.mockResolvedValue(mockProfile);
      mocks.emailQueue.addToEmailQueue.mockResolvedValue(true);

      mocks.vendorService.createVendorFromCompanyProfile.mockResolvedValue({
        vuid: 'vendor-123',
        companyName:
          signupData?.companyProfile?.legalEntityName || signupData?.companyProfile?.tradingName,
      });

      await authService.signup(signupData);

      expect(mocks.vendorService.createVendorFromCompanyProfile).toHaveBeenCalledWith(
        expect.any(String), // cuid is generated dynamically
        mockUser?._id?.toString(),
        expect.objectContaining({
          companyEmail: 'info@company.com',
          // Should use signup data for contact person when not provided
        })
      );
    });
  });

  // NEW: Additional tests for 80% coverage
  describe('login - edge cases', () => {
    it('should reject login for inactive account', async () => {
      const mockLoginData = {
        email: 'inactive@example.com',
        password: 'password123',
        rememberMe: false,
      };

      const mockInactiveUser = createMockUser({
        isActive: false,
        email: mockLoginData.email,
        cuids: [
          {
            cuid: 'test-cuid',
            isConnected: true,
            roles: [ROLES.EMPLOYEE],
          },
        ],
      });

      mocks.userDAO.findFirst.mockResolvedValue(mockInactiveUser);
      mocks.authUtils.comparePassword.mockResolvedValue(true);

      await expect(authService.login(mockLoginData)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('forgotPassword', () => {
    it('should handle non-existent email gracefully', async () => {
      mocks.userDAO.findFirst.mockResolvedValue(null);

      const result = await authService.forgotPassword('nonexistent@example.com');

      // Should still return success for security (don't reveal if email exists)
      expect(result.success).toBe(true);
      expect(mocks.emailQueue.addToEmailQueue).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('should reject expired reset token', async () => {
      const mockUser = createMockUser({
        resetPasswordToken: 'expired-token',
        resetPasswordExpires: new Date(Date.now() - 1000), // Expired 1 second ago
      });

      mocks.userDAO.findFirst.mockResolvedValue(mockUser);

      await expect(
        authService.resetPassword('expired-token', 'newPassword123')
      ).rejects.toThrow(UnauthorizedError);
    });
  });
});
