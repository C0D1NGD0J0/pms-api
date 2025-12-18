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
});
