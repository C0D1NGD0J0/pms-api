import bcrypt from 'bcryptjs';
import { NotFoundError } from '@shared/customErrors';
import { Profile, Client, User } from '@models/index';
import { AuthService } from '@services/auth/auth.service';
import { ROLES } from '@shared/constants/roles.constants';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { VendorService } from '@services/vendor/vendor.service';
import { mockTokenService, mockQueueFactory, mockAuthCache } from '@tests/setup/externalMocks';
import {
  clearTestDatabase,
  setupTestDatabase,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

describe('AuthService Integration Tests', () => {
  let authService: AuthService;
  let userDAO: UserDAO;
  let clientDAO: ClientDAO;
  let profileDAO: ProfileDAO;
  let vendorService: VendorService;

  beforeAll(async () => {
    await setupTestDatabase();

    userDAO = new UserDAO({ userModel: User });
    clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    profileDAO = new ProfileDAO({ profileModel: Profile });

    vendorService = new VendorService({
      vendorDAO: {} as any,
      userDAO,
      profileDAO,
      queueFactory: mockQueueFactory as any,
      emitterService: {} as any,
    } as any);

    authService = new AuthService({
      userDAO,
      clientDAO,
      profileDAO,
      queueFactory: mockQueueFactory as any,
      tokenService: mockTokenService as any,
      authCache: mockAuthCache as any,
      vendorService,
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
  });

  describe('signup', () => {
    it('should create new user and client in database', async () => {
      const signupData = {
        email: `test-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe',
        displayName: 'Test Company',
        phoneNumber: '+1234567890',
        lang: 'en',
        location: 'US',
        termsAccepted: true,
        accountType: {
          planName: 'starter',
          planId: 'plan_starter',
          isEnterpriseAccount: false,
        },
      };

      const result = await authService.signup(signupData as any);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();

      const savedUser = await User.findOne({ email: signupData.email });
      expect(savedUser).not.toBeNull();
      expect(savedUser!.email).toBe(signupData.email);
      expect(savedUser!.isActive).toBe(false);
      expect(savedUser!.uid).toBeDefined();
      expect(savedUser!.activationToken).toBeDefined();

      const savedClient = await Client.findOne({ displayName: signupData.displayName });
      expect(savedClient).not.toBeNull();
      expect(savedClient!.displayName).toBe(signupData.displayName);
      expect(savedClient!.cuid).toBeDefined();

      expect(savedUser!.cuids).toHaveLength(1);
      expect(savedUser!.cuids[0].cuid).toBe(savedClient!.cuid);
      expect(savedUser!.cuids[0].roles).toContain(ROLES.ADMIN);
      expect(savedUser!.activecuid).toBe(savedClient!.cuid);

      const savedProfile = await Profile.findOne({ user: savedUser!._id });
      expect(savedProfile).not.toBeNull();
      expect(savedProfile!.personalInfo.firstName).toBe(signupData.firstName);
      expect(savedProfile!.personalInfo.lastName).toBe(signupData.lastName);
    });

    it('should reject duplicate email addresses', async () => {
      const email = `duplicate-${Date.now()}@example.com`;

      const client = await createTestClient();
      await createTestUser(client.cuid, { email });

      const signupData = {
        email,
        password: 'SecurePassword123!',
        firstName: 'Jane',
        lastName: 'Doe',
        displayName: 'Another Company',
        phoneNumber: '+1234567890',
        lang: 'en',
        location: 'US',
        termsAccepted: true,
        accountType: {
          planName: 'starter',
          planId: 'plan_starter',
          isEnterpriseAccount: false,
        },
      };

      await expect(authService.signup(signupData)).rejects.toThrow();

      // Verify only ONE user with this email exists
      const users = await User.find({ email });
      expect(users).toHaveLength(1);
    });

    it('should hash password before storing', async () => {
      const plainPassword = 'SecurePassword123!';
      const signupData = {
        email: `password-test-${Date.now()}@example.com`,
        password: plainPassword,
        firstName: 'Password',
        lastName: 'Test',
        displayName: 'Password Test Company',
        phoneNumber: '+1234567890',
        lang: 'en',
        location: 'US',
        termsAccepted: true,
        accountType: {
          planName: 'starter',
          planId: 'plan_starter',
          isEnterpriseAccount: false,
        },
      };

      await authService.signup(signupData);

      const savedUser = await User.findOne({ email: signupData.email });
      expect(savedUser!.password).not.toBe(plainPassword);
      expect(savedUser!.password.length).toBeGreaterThan(20); // Bcrypt hash length

      // Verify password can be verified
      const isValid = await bcrypt.compare(plainPassword, savedUser!.password);
      expect(isValid).toBe(true);
    });
  });

  describe('login', () => {
    it('should successfully login with valid credentials', async () => {
      // Arrange: Create test user with known password
      const client = await createTestClient();
      const password = 'TestPassword123!';
      // Pass plain password - pre-save hook will hash it

      const user = await createTestUser(client.cuid, {
        email: `login-test-${Date.now()}@example.com`,
        password: password, // Plain password - will be hashed by pre-save hook
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            clientDisplayName: client.displayName,
          },
        ],
        activecuid: client.cuid,
      });

      // Mock profileDAO response
      const mockCurrentUser = {
        uid: user.uid,
        email: user.email,
        fullname: 'Test User',
        activecuid: client.cuid,
        roles: [ROLES.STAFF],
      };
      jest.spyOn(profileDAO, 'generateCurrentUserInfo').mockResolvedValue(mockCurrentUser as any);

      const loginData = {
        email: user.email,
        password: password,
        rememberMe: false,
      };

      // Act
      const result = await authService.login(loginData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('mock-access-token');
      expect(result.data.refreshToken).toBe('mock-refresh-token');
      expect(result.data.activeAccount).toBeDefined();
      expect(result.data.activeAccount.cuid).toBe(client.cuid);
      expect(mockTokenService.createJwtTokens).toHaveBeenCalled();
      expect(mockAuthCache.saveRefreshToken).toHaveBeenCalled();
      expect(mockAuthCache.saveCurrentUser).toHaveBeenCalled();
    });

    it('should reject invalid email', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'password123',
        rememberMe: false,
      };

      await expect(authService.login(loginData)).rejects.toThrow(NotFoundError);
    });

    it('should reject incorrect password', async () => {
      const client = await createTestClient();
      const correctPassword = 'CorrectPassword123!';
      // Pass plain password - will be hashed by pre-save hook

      const user = await createTestUser(client.cuid, {
        email: `password-reject-${Date.now()}@example.com`,
        password: correctPassword,
      });

      const loginData = {
        email: user.email,
        password: 'WrongPassword123!',
        rememberMe: false,
      };

      await expect(authService.login(loginData)).rejects.toThrow(NotFoundError);
    });

    it('should reject inactive user login', async () => {
      const client = await createTestClient();
      const password = 'TestPassword123!';

      const user = await createTestUser(client.cuid, {
        email: `inactive-${Date.now()}@example.com`,
        password: password,
        isActive: false, // Inactive user
      });

      const loginData = {
        email: user.email,
        password: password,
        rememberMe: false,
      };

      await expect(authService.login(loginData)).rejects.toThrow();
    });

    it('should select correct active client on login', async () => {
      // Create user with multiple clients
      const client1 = await createTestClient();
      const client2 = await createTestClient();

      const password = 'TestPassword123!';

      const user = await createTestUser(client1.cuid, {
        email: `multi-client-${Date.now()}@example.com`,
        password: password,
        cuids: [
          {
            cuid: client1.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            clientDisplayName: client1.displayName,
          },
          {
            cuid: client2.cuid,
            roles: [ROLES.ADMIN],
            isConnected: true,
            clientDisplayName: client2.displayName,
          },
        ],
        activecuid: client1.cuid, // Client1 is active
      });

      const mockCurrentUser = {
        uid: user.uid,
        email: user.email,
        activecuid: client1.cuid,
      };
      jest.spyOn(profileDAO, 'generateCurrentUserInfo').mockResolvedValue(mockCurrentUser as any);

      const result = await authService.login({
        email: user.email,
        password: password,
        rememberMe: false,
      });

      expect(result.success).toBe(true);
      expect(result.data.activeAccount.cuid).toBe(client1.cuid);
    });
  });

  describe('switchAccount', () => {
    it('should switch user to different client account', async () => {
      // Create user with access to multiple clients
      const client1 = await createTestClient();
      const client2 = await createTestClient();

      const user = await createTestUser(client1.cuid, {
        cuids: [
          {
            cuid: client1.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            clientDisplayName: client1.displayName,
          },
          {
            cuid: client2.cuid,
            roles: [ROLES.MANAGER],
            isConnected: true,
            clientDisplayName: client2.displayName,
          },
        ],
        activecuid: client1.cuid,
      });

      const mockCurrentUser = {
        uid: user.uid,
        email: user.email,
        activecuid: client2.cuid,
        roles: [ROLES.MANAGER],
      };
      jest.spyOn(profileDAO, 'generateCurrentUserInfo').mockResolvedValue(mockCurrentUser as any);

      const result = await authService.switchActiveAccount(user._id.toString(), client2.cuid);

      expect(result.success).toBe(true);
      expect(result.data.activeAccount.cuid).toBe(client2.cuid);

      // Verify activecuid updated in database
      const updatedUser = await User.findById(user._id);
      expect(updatedUser!.activecuid).toBe(client2.cuid);
    });

    it('should reject switching to unauthorized client', async () => {
      const client1 = await createTestClient();
      const client2 = await createTestClient(); // User has NO access to this

      const user = await createTestUser(client1.cuid, {
        cuids: [
          {
            cuid: client1.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            clientDisplayName: client1.displayName,
          },
        ],
        activecuid: client1.cuid,
      });

      await expect(
        authService.switchActiveAccount(
          user._id.toString(),
          client2.cuid // No access
        )
      ).rejects.toThrow();
    });
  });

  describe('refreshToken', () => {
    it('should generate new tokens with valid refresh token', async () => {
      const userId = 'user-123';
      const refreshToken = 'valid-refresh-token';

      mockAuthCache.getRefreshToken.mockResolvedValueOnce({ success: true });
      mockTokenService.verifyJwtToken.mockResolvedValueOnce({
        success: true,
        data: { sub: userId, rememberMe: false, cuid: 'test-cuid' },
      });
      mockAuthCache.saveRefreshToken.mockResolvedValueOnce({ success: true });

      const result = await authService.refreshToken({ refreshToken, userId });

      expect(result.success).toBe(true);
      expect(result.data.accessToken).toBe('mock-access-token');
      expect(result.data.refreshToken).toBe('mock-refresh-token');
      expect(mockTokenService.createJwtTokens).toHaveBeenCalled();
    });

    it('should reject invalid refresh token', async () => {
      const userId = 'user-123';
      const refreshToken = 'invalid-token';

      mockAuthCache.getRefreshToken.mockResolvedValueOnce({ success: false });

      await expect(authService.refreshToken({ refreshToken, userId })).rejects.toThrow();
    });

    it('should reject expired refresh token', async () => {
      const userId = 'user-123';
      const refreshToken = 'expired-token';

      mockAuthCache.getRefreshToken.mockResolvedValueOnce({ success: true });
      mockTokenService.verifyJwtToken.mockResolvedValueOnce({ success: false });

      await expect(authService.refreshToken({ refreshToken, userId })).rejects.toThrow();
    });
  });

  describe('getTokenUser', () => {
    it('should return user for valid access token', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        isActive: true,
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            clientDisplayName: client.displayName,
          },
        ],
      });

      mockTokenService.verifyJwtToken.mockResolvedValueOnce({
        success: true,
        data: { sub: user._id.toString(), cuid: client.cuid },
      });

      const result = await authService.getTokenUser('valid-token');

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should reject invalid access token', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValueOnce({ success: false });

      await expect(authService.getTokenUser('invalid-token')).rejects.toThrow();
    });

    it('should reject token for inactive user', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { isActive: false });

      mockTokenService.verifyJwtToken.mockResolvedValueOnce({
        success: true,
        data: { sub: user._id.toString(), cuid: client.cuid },
      });

      await expect(authService.getTokenUser('token')).rejects.toThrow();
    });

    it('should reject token for disconnected client', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        isActive: true,
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.STAFF],
            isConnected: false,
            clientDisplayName: client.displayName,
          },
        ],
      });

      mockTokenService.verifyJwtToken.mockResolvedValueOnce({
        success: true,
        data: { sub: user._id.toString(), cuid: client.cuid },
      });

      await expect(authService.getTokenUser('token')).rejects.toThrow();
    });
  });

  describe('getCurrentUser', () => {
    it('should generate and cache current user info', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid);

      const mockCurrentUser = {
        uid: user.uid,
        email: user.email,
        activecuid: client.cuid,
      };
      jest
        .spyOn(profileDAO, 'generateCurrentUserInfo')
        .mockResolvedValueOnce(mockCurrentUser as any);
      mockAuthCache.saveCurrentUser.mockResolvedValueOnce({ success: true });

      const result = await authService.getCurrentUser(user._id.toString());

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCurrentUser);
      expect(mockAuthCache.saveCurrentUser).toHaveBeenCalled();
    });

    it('should reject for non-existent user', async () => {
      jest.spyOn(profileDAO, 'generateCurrentUserInfo').mockResolvedValueOnce(null);

      await expect(authService.getCurrentUser('non-existent-id')).rejects.toThrow();
    });
  });

  describe('logout', () => {
    it('should invalidate user session with valid access token', async () => {
      const userId = 'user-123';
      const accessToken = 'valid-access-token';

      mockTokenService.verifyJwtToken.mockResolvedValueOnce({
        success: true,
        data: { sub: userId },
      });
      mockAuthCache.invalidateUserSession = jest.fn().mockResolvedValueOnce({ success: true });

      const result = await authService.logout(accessToken);

      expect(result.success).toBe(true);
      expect(mockAuthCache.invalidateUserSession).toHaveBeenCalledWith(userId);
    });

    it('should reject logout with invalid token', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValueOnce({ success: false });

      await expect(authService.logout('invalid-token')).rejects.toThrow();
    });
  });

  describe('accountActivation', () => {
    it('should activate account with valid token', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        email: `activate-${Date.now()}@example.com`,
        isActive: false,
      });

      await User.findByIdAndUpdate(user._id, {
        isEmailVerified: false,
        activationToken: 'valid-activation-token',
        activationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const result = await authService.accountActivation('valid-activation-token');

      expect(result.success).toBe(true);

      const activatedUser = await User.findById(user._id);
      expect(activatedUser!.isActive).toBe(true);
      expect(activatedUser!.activationToken).toBeFalsy();
    });

    it('should reject invalid activation token', async () => {
      await expect(authService.accountActivation('invalid-token')).rejects.toThrow();
    });

    it('should reject expired activation token', async () => {
      const client = await createTestClient();
      const activationToken = 'expired-token';

      await User.create({
        uid: `uid-${Date.now()}`,
        email: `expired-${Date.now()}@example.com`,
        password: '$2b$10$hashedPassword',
        isActive: false,
        activationToken,
        activationExpires: new Date(Date.now() - 1000),
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.ADMIN],
            isConnected: true,
            clientDisplayName: client.displayName,
          },
        ],
        activecuid: client.cuid,
      });

      await expect(authService.accountActivation(activationToken)).rejects.toThrow();
    });
  });

  describe('sendActivationLink', () => {
    it('should send activation email to active user', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        email: `resend-${Date.now()}@example.com`,
        isActive: true,
      });

      await Profile.create({
        puid: `puid-${Date.now()}`,
        user: user._id,
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
          displayName: 'Test User',
          location: 'US',
        },
      });

      const result = await authService.sendActivationLink(user.email);

      expect(result.success).toBe(true);
      expect(mockQueueFactory.getQueue).toHaveBeenCalled();
    });

    it('should reject for non-existent email', async () => {
      await expect(authService.sendActivationLink('nonexistent@example.com')).rejects.toThrow();
    });
  });

  describe('forgotPassword', () => {
    it('should send password reset email', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        email: `forgot-${Date.now()}@example.com`,
        isActive: true,
      });

      await Profile.create({
        puid: `puid-${Date.now()}`,
        user: user._id,
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
          displayName: 'Test User',
          location: 'US',
        },
      });

      const result = await authService.forgotPassword(user.email);

      expect(result.success).toBe(true);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser!.passwordResetToken).toBeDefined();
    });

    it('should reject for non-existent email', async () => {
      await expect(authService.forgotPassword('nonexistent@example.com')).rejects.toThrow();
    });
  });

  describe('resetPassword', () => {
    it('should reset password with valid token', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        email: `reset-${Date.now()}@example.com`,
        isActive: true,
      });

      await Profile.create({
        puid: `puid-${Date.now()}`,
        user: user._id,
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
          displayName: 'Test User',
          location: 'US',
        },
      });

      await authService.forgotPassword(user.email);

      const userWithToken = await User.findById(user._id);
      const resetToken = userWithToken!.passwordResetToken;

      const newPassword = 'NewPassword123!';
      const result = await authService.resetPassword(resetToken!, newPassword);

      expect(result.success).toBe(true);

      const updatedUser = await User.findById(user._id);
      expect(updatedUser!.password).not.toBe(user.password);
      expect(updatedUser!.passwordResetToken).toBeFalsy();

      const isValid = await bcrypt.compare(newPassword, updatedUser!.password);
      expect(isValid).toBe(true);
    });

    it('should reject invalid reset token', async () => {
      await expect(authService.resetPassword('invalid-token', 'NewPassword123!')).rejects.toThrow();
    });

    it('should reject expired reset token', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        email: `expired-reset-${Date.now()}@example.com`,
        isActive: true,
      });

      await User.findByIdAndUpdate(user._id, {
        passwordResetToken: 'some-expired-token',
        passwordResetExpires: new Date(Date.now() - 1000),
      });

      await expect(
        authService.resetPassword('some-expired-token', 'NewPassword123!')
      ).rejects.toThrow();
    });
  });

  describe('verifyClientAccess', () => {
    it('should verify user has access to client', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            clientDisplayName: client.displayName,
          },
        ],
      });

      const result = await authService.verifyClientAccess(user._id.toString(), client.cuid);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });

    it('should reject access for unauthorized client', async () => {
      const client1 = await createTestClient();
      const client2 = await createTestClient();

      const user = await createTestUser(client1.cuid, {
        cuids: [
          {
            cuid: client1.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            clientDisplayName: client1.displayName,
          },
        ],
      });

      await expect(
        authService.verifyClientAccess(user._id.toString(), client2.cuid)
      ).rejects.toThrow();
    });
  });
});
