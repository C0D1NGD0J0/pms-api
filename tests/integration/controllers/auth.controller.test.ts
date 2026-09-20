import bcrypt from 'bcryptjs';
import request from 'supertest';
import { Application } from 'express';
import { Profile, Client, User } from '@models/index';
import { ROLES } from '@shared/constants/roles.constants';
import { AuthService } from '@services/auth/auth.service';
import { ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { AuthController } from '@controllers/AuthController';
import { httpStatusCodes, JWT_KEY_NAMES } from '@utils/index';
import { VendorService } from '@services/vendor/vendor.service';
import { AuthTokenService } from '@services/auth/authToken.service';
import { setupAllExternalMocks, mockQueueFactory, mockAuthCache } from '@tests/setup/externalMocks';
import {
  createControllerTestApp,
  clearTestDatabase,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

describe('AuthController Integration Tests', () => {
  let app: Application;
  let authService: AuthService;
  let authController: AuthController;
  let userDAO: UserDAO;
  let clientDAO: ClientDAO;
  let profileDAO: ProfileDAO;
  let tokenService: AuthTokenService;

  // Route path constants
  const SIGNUP_PATH = '/api/v1/auth/signup';
  const LOGIN_PATH = '/api/v1/auth/login';
  const ME_PATH = '/api/v1/auth/:cuid/me';
  const ACTIVATION_PATH = '/api/v1/auth/:cuid/account_activation';
  const RESEND_ACTIVATION_PATH = '/api/v1/auth/resend_activation_link';
  const SWITCH_ACCOUNT_PATH = '/api/v1/auth/switch_client_account';
  const FORGOT_PASSWORD_PATH = '/api/v1/auth/forgot_password';
  const RESET_PASSWORD_PATH = '/api/v1/auth/reset_password';
  const LOGOUT_PATH = '/api/v1/auth/:cuid/logout';
  const REFRESH_TOKEN_PATH = '/api/v1/auth/refresh_token';

  // Dummy user for routes that don't rely on req.context (satisfies mockRequestContext shape)
  const dummyUser = { _id: 'anonymous', uid: 'anon', email: 'anon@test.com' };

  /**
   * Auth-specific middleware: decodes JWT from cookies and populates req.context.
   * Used inside handler callbacks for routes that require authentication (me, switch, logout).
   */
  const applyAuthContext = async (req: any) => {
    // Always reset context — createControllerTestApp sets it via mockRequestContext,
    // but auth routes need JWT-based context (or null when unauthenticated).
    req.context = { currentuser: null };
    const accessToken = req.cookies?.[JWT_KEY_NAMES.ACCESS_TOKEN];
    if (accessToken) {
      try {
        const rawToken = accessToken.startsWith('Bearer ')
          ? accessToken.split(' ')[1]
          : accessToken;
        const decoded = await tokenService.verifyJwtToken(
          JWT_KEY_NAMES.ACCESS_TOKEN as any,
          rawToken
        );
        if (decoded.success && decoded.data) {
          const user = await User.findById(decoded.data.sub);
          if (user) {
            req.context.currentuser = {
              sub: user._id.toString(),
              uid: user.uid,
              email: user.email,
              activecuid: user.activecuid,
              client: {
                cuid: user.activecuid,
              },
              clients: user.cuids,
            };
          }
        }
      } catch (error) {
        // Token invalid, continue without user
      }
    }
  };

  beforeAll(async () => {
    setupAllExternalMocks();

    // Initialize DAOs
    userDAO = new UserDAO({ userModel: User });
    clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    profileDAO = new ProfileDAO({ profileModel: Profile });

    // Initialize services
    const vendorService = new VendorService({
      vendorDAO: {} as any,
      userDAO,
      profileDAO,
      clientDAO,
      permissionService: {} as any,
      vendorCache: {
        getVendorDetail: jest.fn().mockResolvedValue({ success: false }),
        cacheVendorDetail: jest.fn(),
        invalidateVendor: jest.fn(),
      } as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
      geoCoderService: {} as any,
      paymentProcessorDAO: {} as any,
      maintenanceRequestDAO: {} as any,
      paymentGatewayService: {} as any,
      payoutAccountService: {} as any,
    } as any);

    tokenService = new AuthTokenService();

    authService = new AuthService({
      userDAO,
      clientDAO,
      profileDAO,
      queueFactory: mockQueueFactory as any,
      tokenService,
      authCache: mockAuthCache as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
      vendorService,
      leaseDAO: {} as any,
      paymentProcessorDAO: {} as any,
      paymentGatewayService: {} as any,
      paymentService: {} as any,
      subscriptionService: {
        createSubscription: jest
          .fn()
          .mockResolvedValue({ success: true, data: { subscriptionId: 'sub_mock' } }),
      } as any,
      emitterService: { on: jest.fn(), emit: jest.fn() } as any,
      twilioService: {} as any,
      featureFlagService: { isEnabled: jest.fn().mockReturnValue(false) } as any,
      webAuthnService: {} as any,
    });

    authController = new AuthController({ authService, webAuthnService: {} as any, userDAO });

    const testApp = createControllerTestApp({
      routes: [
        {
          method: 'post',
          path: SIGNUP_PATH,
          contextUser: () => dummyUser,
          handler: (req, res) => authController.signup(req, res),
        },
        {
          method: 'post',
          path: LOGIN_PATH,
          contextUser: () => dummyUser,
          handler: (req, res) => authController.login(req, res),
        },
        {
          method: 'get',
          path: ME_PATH,
          contextUser: () => dummyUser,
          handler: async (req, res) => {
            await applyAuthContext(req);
            return authController.getCurrentUser(req as any, res);
          },
        },
        {
          method: 'patch',
          path: ACTIVATION_PATH,
          contextUser: () => dummyUser,
          handler: (req, res) => authController.accountActivation(req, res),
        },
        {
          method: 'patch',
          path: RESEND_ACTIVATION_PATH,
          contextUser: () => dummyUser,
          handler: (req, res) => authController.sendActivationLink(req, res),
        },
        {
          method: 'patch',
          path: SWITCH_ACCOUNT_PATH,
          contextUser: () => dummyUser,
          handler: async (req, res) => {
            await applyAuthContext(req);
            return authController.switchClientAccount(req as any, res);
          },
        },
        {
          method: 'patch',
          path: FORGOT_PASSWORD_PATH,
          contextUser: () => dummyUser,
          handler: (req, res) => authController.forgotPassword(req, res),
        },
        {
          method: 'patch',
          path: RESET_PASSWORD_PATH,
          contextUser: () => dummyUser,
          handler: (req, res) => authController.resetPassword(req, res),
        },
        {
          method: 'delete',
          path: LOGOUT_PATH,
          contextUser: () => dummyUser,
          handler: async (req, res) => {
            await applyAuthContext(req);
            return authController.logout(req, res);
          },
        },
        {
          method: 'post',
          path: REFRESH_TOKEN_PATH,
          contextUser: () => dummyUser,
          handler: (req, res) => authController.refreshToken(req, res),
        },
      ],
    });

    app = testApp.app;
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
  });

  describe('POST /api/v1/auth/signup', () => {
    it('should successfully create new user account with 200 status', async () => {
      const signupData = {
        email: `test-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Doe',
        displayName: 'Test Company',
        phoneNumber: '+1234567890',
        lang: 'en',
        location: 'New York, United States',
        termsAccepted: true,
        accountType: {
          planName: 'growth',
          planId: 'plan_starter',
          billingInterval: 'monthly',
          category: 'individual',
          isEnterpriseAccount: false,
        },
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(signupData)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBeDefined();

      // Verify user created in database
      const savedUser = await User.findOne({ email: signupData.email });
      expect(savedUser).toBeDefined();
      expect(savedUser!.email).toBe(signupData.email);
      expect(savedUser!.isActive).toBe(false);

      // Verify client created
      const savedClient = await Client.findOne({ displayName: signupData.displayName });
      expect(savedClient).toBeDefined();
      expect(savedClient!.displayName).toBe(signupData.displayName);

      // Verify profile created
      const savedProfile = await Profile.findOne({ user: savedUser!._id });
      expect(savedProfile).toBeDefined();
      expect(savedProfile!.personalInfo.firstName).toBe(signupData.firstName);
    });

    it('should return 400 for missing required fields', async () => {
      const incompleteData = {
        email: `test-${Date.now()}@example.com`,
        // Missing password and other required fields
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(incompleteData)
        .expect('Content-Type', /json/);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.status).toBeLessThan(500);
    });

    it('should return 400 for duplicate email', async () => {
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
        location: 'Toronto, Canada',
        termsAccepted: true,
        accountType: {
          planName: 'growth',
          planId: 'plan_starter',
          billingInterval: 'monthly',
          category: 'individual',
          isEnterpriseAccount: false,
        },
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(signupData)
        .expect('Content-Type', /json/);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBeFalsy();
    });

    it('should accept paid plan signup with valid Stripe price ID', async () => {
      const signupData = {
        email: `paid-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        firstName: 'Jane',
        lastName: 'Smith',
        displayName: 'Paid Company',
        phoneNumber: '+1234567890',
        lang: 'en',
        location: 'Toronto, Canada',
        termsAccepted: true,
        accountType: {
          planName: 'essential',
          category: 'individual',
          planId: 'price_1234567890abcd',
          billingInterval: 'annual',
          isEnterpriseAccount: false,
        },
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(signupData)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      const savedUser = await User.findOne({ email: signupData.email });
      expect(savedUser).toBeDefined();
    });

    it('should reject signup from unsupported country', async () => {
      const signupData = {
        email: `invalid-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        firstName: 'John',
        lastName: 'Invalid',
        displayName: 'Invalid Plan',
        phoneNumber: '+1234567890',
        lang: 'en',
        location: 'Lagos, Nigeria',
        termsAccepted: true,
        accountType: {
          planName: 'essential',
          category: 'individual',
          planId: 'price_1234567890abcd',
          billingInterval: 'monthly',
          isEnterpriseAccount: false,
        },
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(signupData)
        .expect('Content-Type', /json/);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBeFalsy();
    });

    it('should accept location with state abbreviation', async () => {
      const signupData = {
        email: `state-${Date.now()}@example.com`,
        password: 'SecurePassword123!',
        firstName: 'State',
        lastName: 'Test',
        displayName: 'State Test Company',
        phoneNumber: '+1234567890',
        lang: 'en',
        location: 'Los Angeles, United States',
        termsAccepted: true,
        accountType: {
          planName: 'growth',
          planId: 'plan_starter',
          billingInterval: 'monthly',
          category: 'individual',
          isEnterpriseAccount: false,
        },
      };

      const response = await request(app)
        .post('/api/v1/auth/signup')
        .send(signupData)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    describe('Account Type + Plan Combinations', () => {
      it('should allow individual account with personal plan', async () => {
        const signupData = {
          email: `individual-personal-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          firstName: 'Individual',
          lastName: 'PersonalPlan',
          displayName: 'Individual Personal Account',
          phoneNumber: '+1234567890',
          lang: 'en',
          location: 'Seattle, United States',
          termsAccepted: true,
          accountType: {
            planName: 'essential',
            category: 'individual',
            planId: 'price_1234567890abcd',
            billingInterval: 'monthly',
            isEnterpriseAccount: false,
          },
        };

        const response = await request(app)
          .post('/api/v1/auth/signup')
          .send(signupData)
          .expect('Content-Type', /json/)
          .expect(httpStatusCodes.OK);

        expect(response.body.success).toBe(true);

        const savedClient = await Client.findOne({ displayName: signupData.displayName });
        expect(savedClient).toBeDefined();
        expect(savedClient!.accountType.isEnterpriseAccount).toBe(false);
      });

      it('should allow business account with personal plan', async () => {
        const signupData = {
          email: `business-personal-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          firstName: 'Business',
          lastName: 'PersonalPlan',
          displayName: 'Small Business Personal Account',
          phoneNumber: '+1234567890',
          lang: 'en',
          location: 'Austin, United States',
          termsAccepted: true,
          accountType: {
            planName: 'essential',
            category: 'business',
            planId: 'price_1234567890abcd',
            billingInterval: 'monthly',
            isEnterpriseAccount: true,
          },
          companyProfile: {
            tradingName: 'Small Business Inc',
            legalEntityName: 'Small Business Incorporated',
            companyEmail: `business-${Date.now()}@example.com`,
            companyPhone: '+12025551234',
            companyAddress: '123 Business Ave, Austin, United States',
          },
        };

        const response = await request(app)
          .post('/api/v1/auth/signup')
          .send(signupData)
          .expect('Content-Type', /json/)
          .expect(httpStatusCodes.OK);

        expect(response.body.success).toBe(true);

        const savedClient = await Client.findOne({ displayName: signupData.displayName });
        expect(savedClient).toBeDefined();
        expect(savedClient!.accountType.isEnterpriseAccount).toBe(true);
        expect(savedClient!.companyProfile?.tradingName).toBe('Small Business Inc');
      });

      it('should allow business account with professional plan', async () => {
        const signupData = {
          email: `business-professional-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          firstName: 'Business',
          lastName: 'ProfessionalPlan',
          displayName: 'Enterprise Professional Account',
          phoneNumber: '+1234567890',
          lang: 'en',
          location: 'San Francisco, United States',
          termsAccepted: true,
          accountType: {
            planName: 'portfolio',
            category: 'business',
            planId: 'price_1234567890abcd',
            billingInterval: 'annual',
            isEnterpriseAccount: true,
          },
          companyProfile: {
            tradingName: 'Enterprise Corporation',
            legalEntityName: 'Enterprise Corporation LLC',
            companyEmail: `enterprise-${Date.now()}@example.com`,
            companyPhone: '+14155551234',
            companyAddress: '456 Enterprise Blvd, San Francisco, United States',
          },
        };

        const response = await request(app)
          .post('/api/v1/auth/signup')
          .send(signupData)
          .expect('Content-Type', /json/)
          .expect(httpStatusCodes.OK);

        expect(response.body.success).toBe(true);

        const savedClient = await Client.findOne({ displayName: signupData.displayName });
        expect(savedClient).toBeDefined();
        expect(savedClient!.accountType.isEnterpriseAccount).toBe(true);
        expect(savedClient!.companyProfile?.tradingName).toBe('Enterprise Corporation');
      });

      it('should reject business account without company profile', async () => {
        const signupData = {
          email: `business-noprofile-${Date.now()}@example.com`,
          password: 'SecurePassword123!',
          firstName: 'Business',
          lastName: 'NoProfile',
          displayName: 'Business Without Profile',
          phoneNumber: '+1234567890',
          lang: 'en',
          location: 'Boston, United States',
          termsAccepted: true,
          accountType: {
            planName: 'essential',
            category: 'business',
            planId: 'price_1234567890abcd',
            billingInterval: 'monthly',
            isEnterpriseAccount: true,
          },
          // Missing companyProfile
        };

        const response = await request(app)
          .post('/api/v1/auth/signup')
          .send(signupData)
          .expect('Content-Type', /json/);

        expect(response.status).toBeGreaterThanOrEqual(400);
        expect(response.body.success).toBeFalsy();
      });
    });
  });

  describe('POST /api/v1/auth/login', () => {
    it('should successfully login with valid credentials and set auth cookies', async () => {
      const client = await createTestClient();
      const password = 'TestPassword123!';
      const email = `login-${Date.now()}@example.com`;

      const user = await createTestUser(client.cuid, {
        email,
        password,
        isActive: true,
      });

      // Create profile for current user generation
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

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password, rememberMe: false })
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.activeAccount).toBeDefined();
      expect(response.body.activeAccount.cuid).toBe(client.cuid);
      expect(response.body.accounts).toBeDefined();

      // Verify cookies are set
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toBeDefined();
      expect(cookies.length).toBeGreaterThan(0);

      const accessTokenCookie = cookies.find((cookie: string) =>
        cookie.startsWith(JWT_KEY_NAMES.ACCESS_TOKEN)
      );
      const refreshTokenCookie = cookies.find((cookie: string) =>
        cookie.startsWith(JWT_KEY_NAMES.REFRESH_TOKEN)
      );

      expect(accessTokenCookie).toBeDefined();
      expect(refreshTokenCookie).toBeDefined();
    });

    it('should return 404 for invalid email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'password123',
          rememberMe: false,
        })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
    });

    it('should return 404 for incorrect password', async () => {
      const client = await createTestClient();
      const correctPassword = 'CorrectPassword123!';
      const email = `password-test-${Date.now()}@example.com`;

      await createTestUser(client.cuid, {
        email,
        password: correctPassword,
        isActive: true,
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email,
          password: 'WrongPassword123!',
          rememberMe: false,
        })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
    });

    it('should reject inactive user login', async () => {
      const client = await createTestClient();
      const password = 'TestPassword123!';
      const email = `inactive-${Date.now()}@example.com`;

      await createTestUser(client.cuid, {
        email,
        password,
        isActive: false,
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password, rememberMe: false })
        .expect('Content-Type', /json/);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBeFalsy();
    });
  });

  describe('GET /api/v1/auth/:cuid/me', () => {
    it('should return current user with valid access token', async () => {
      const client = await createTestClient();
      const password = 'TestPassword123!';
      const email = `current-user-${Date.now()}@example.com`;

      const user = await createTestUser(client.cuid, {
        email,
        password,
        isActive: true,
      });

      // Create profile
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

      // Login to get tokens
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password, rememberMe: false });

      const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
      const accessTokenCookie = cookies.find((cookie: string) =>
        cookie.startsWith(JWT_KEY_NAMES.ACCESS_TOKEN)
      );

      // Get current user
      const response = await request(app)
        .get(`/api/v1/auth/${client.cuid}/me`)
        .set('Cookie', accessTokenCookie!)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return 401 without access token', async () => {
      const client = await createTestClient();

      const response = await request(app)
        .get(`/api/v1/auth/${client.cuid}/me`)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /api/v1/auth/:cuid/account_activation', () => {
    it('should activate account with valid activation token', async () => {
      const client = await createTestClient();
      const email = `activate-${Date.now()}@example.com`;

      const user = await createTestUser(client.cuid, {
        email,
        isActive: false,
      });

      // Set activation token
      const activationToken = 'valid-activation-token';
      await User.findByIdAndUpdate(user._id, {
        activationToken,
        activationTokenExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });

      const response = await request(app)
        .patch(`/api/v1/auth/${client.cuid}/account_activation?t=${activationToken}`)
        .send({ firstName: 'Test', lastName: 'User' })
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify user is activated
      const activatedUser = await User.findById(user._id);
      expect(activatedUser!.isActive).toBe(true);
      expect(activatedUser!.activationToken).toBeFalsy();
    });

    it('should return 404 for invalid activation token', async () => {
      const client = await createTestClient();

      const response = await request(app)
        .patch(`/api/v1/auth/${client.cuid}/account_activation?t=invalid-token`)
        .expect('Content-Type', /json/);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /api/v1/auth/resend_activation_link', () => {
    it('should send activation link for active user', async () => {
      const client = await createTestClient();
      const email = `resend-${Date.now()}@example.com`;

      const user = await createTestUser(client.cuid, {
        email,
        isActive: true,
      });

      // Create profile
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

      const response = await request(app)
        .patch('/api/v1/auth/resend_activation_link')
        .send({ email })
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent email', async () => {
      const response = await request(app)
        .patch('/api/v1/auth/resend_activation_link')
        .send({ email: 'nonexistent@example.com' })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
    });
  });

  describe('PATCH /api/v1/auth/switch_client_account', () => {
    it('should switch to different client account', async () => {
      const client1 = await createTestClient();
      const client2 = await createTestClient();
      const password = 'TestPassword123!';
      const email = `switch-${Date.now()}@example.com`;

      const user = await createTestUser(client1.cuid, {
        email,
        password,
        isActive: true,
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

      // Create profile
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

      // Login to get tokens
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password, rememberMe: false });

      const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
      const accessTokenCookie = cookies.find((cookie: string) =>
        cookie.startsWith(JWT_KEY_NAMES.ACCESS_TOKEN)
      );

      // Switch account
      const response = await request(app)
        .patch('/api/v1/auth/switch_client_account')
        .set('Cookie', accessTokenCookie!)
        .send({ clientId: client2.cuid })
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.activeAccount).toBeDefined();
      expect(response.body.activeAccount.cuid).toBe(client2.cuid);

      // Verify cookies are updated
      const newCookies = response.headers['set-cookie'];
      expect(newCookies).toBeDefined();
    });

    it('should return 401 without authentication', async () => {
      const client = await createTestClient();

      const response = await request(app)
        .patch('/api/v1/auth/switch_client_account')
        .send({ clientId: client.cuid })
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /api/v1/auth/forgot_password', () => {
    it('should send password reset email for valid user', async () => {
      const client = await createTestClient();
      const email = `forgot-${Date.now()}@example.com`;

      const user = await createTestUser(client.cuid, {
        email,
        isActive: true,
      });

      // Create profile
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

      const response = await request(app)
        .patch('/api/v1/auth/forgot_password')
        .send({ email })
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify reset token was set (field has select: false, so must explicitly select it)
      const updatedUser = await User.findById(user._id).select('+passwordResetToken');
      expect(updatedUser!.passwordResetToken).toBeDefined();
      expect(updatedUser!.passwordResetToken).not.toBe('');
    });

    it('should return 200 for non-existent email (anti-enumeration)', async () => {
      const response = await request(app)
        .patch('/api/v1/auth/forgot_password')
        .send({ email: 'nonexistent@example.com' })
        .expect('Content-Type', /json/);

      // Service always returns 200 to prevent account enumeration
      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
    });
  });

  describe('PATCH /api/v1/auth/reset_password', () => {
    it('should reset password with valid reset token', async () => {
      const client = await createTestClient();
      const email = `reset-${Date.now()}@example.com`;
      const oldPassword = 'OldPassword123!';
      const newPassword = 'NewPassword123!';

      const user = await createTestUser(client.cuid, {
        email,
        password: oldPassword,
        isActive: true,
      });

      // Create profile
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

      // Trigger forgot password
      await request(app).patch('/api/v1/auth/forgot_password').send({ email });

      const userWithToken = await User.findById(user._id).select('+passwordResetToken');
      const resetToken = userWithToken!.passwordResetToken;

      // Reset password
      const response = await request(app)
        .patch('/api/v1/auth/reset_password')
        .send({ resetToken, password: newPassword })
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify password was changed (both fields have select: false)
      const updatedUser = await User.findById(user._id).select('+password +passwordResetToken');
      expect(updatedUser!.passwordResetToken).toBeFalsy();

      const isNewPasswordValid = await bcrypt.compare(newPassword, updatedUser!.password);
      expect(isNewPasswordValid).toBe(true);
    });

    it('should return 400 for invalid reset token', async () => {
      const response = await request(app)
        .patch('/api/v1/auth/reset_password')
        .send({ resetToken: 'invalid-token', password: 'NewPassword123!' })
        .expect('Content-Type', /json/);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
    });
  });

  describe('DELETE /api/v1/auth/:cuid/logout', () => {
    it('should logout user and clear cookies', async () => {
      const client = await createTestClient();
      const password = 'TestPassword123!';
      const email = `logout-${Date.now()}@example.com`;

      const user = await createTestUser(client.cuid, {
        email,
        password,
        isActive: true,
      });

      // Create profile
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

      // Login to get tokens
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password, rememberMe: false });

      const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
      const accessTokenCookie = cookies.find((cookie: string) =>
        cookie.startsWith(JWT_KEY_NAMES.ACCESS_TOKEN)
      );

      // Logout
      const response = await request(app)
        .delete(`/api/v1/auth/${client.cuid}/logout`)
        .set('Cookie', accessTokenCookie!)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify cookies are cleared
      const logoutCookies = response.headers['set-cookie'] as unknown as string[];
      expect(logoutCookies).toBeDefined();

      const clearedAccessToken = logoutCookies.find(
        (cookie: string) =>
          cookie.includes(JWT_KEY_NAMES.ACCESS_TOKEN) &&
          (cookie.includes('Max-Age=0') || cookie.includes('Expires=Thu, 01 Jan 1970'))
      );
      const clearedRefreshToken = logoutCookies.find(
        (cookie: string) =>
          cookie.includes(JWT_KEY_NAMES.REFRESH_TOKEN) &&
          (cookie.includes('Max-Age=0') || cookie.includes('Expires=Thu, 01 Jan 1970'))
      );

      expect(clearedAccessToken).toBeDefined();
      expect(clearedRefreshToken).toBeDefined();
    });

    it('should return 401 without access token', async () => {
      const client = await createTestClient();

      const response = await request(app)
        .delete(`/api/v1/auth/${client.cuid}/logout`)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/auth/refresh_token', () => {
    it('should generate new tokens with valid refresh token', async () => {
      const client = await createTestClient();
      const password = 'TestPassword123!';
      const email = `refresh-${Date.now()}@example.com`;

      const user = await createTestUser(client.cuid, {
        email,
        password,
        isActive: true,
      });

      // Create profile
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

      // Login to get tokens
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({ email, password, rememberMe: false });

      const cookies = loginResponse.headers['set-cookie'] as unknown as string[];
      const refreshTokenCookie = cookies.find((cookie: string) =>
        cookie.startsWith(JWT_KEY_NAMES.REFRESH_TOKEN)
      );

      // Extract the raw JWT from the cookie value (format: "pms_refresh_token=Bearer%20<jwt>; ...")
      const cookieValue = refreshTokenCookie!.split(';')[0]; // "pms_refresh_token=Bearer%20<jwt>"
      const decodedValue = decodeURIComponent(cookieValue.split('=').slice(1).join('='));
      const rawRefreshToken = decodedValue.replace('Bearer ', '');

      // Mock authCache to return the exact refresh token so the comparison passes
      mockAuthCache.getRefreshToken.mockResolvedValueOnce({ success: true, data: rawRefreshToken });
      // Mock saveRefreshToken for the rotated token
      mockAuthCache.saveRefreshToken.mockResolvedValueOnce({ success: true });

      // Refresh token
      const response = await request(app)
        .post('/api/v1/auth/refresh_token')
        .set('Cookie', refreshTokenCookie!)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify new cookies are set
      const newCookies = response.headers['set-cookie'];
      expect(newCookies).toBeDefined();
      expect(newCookies.length).toBeGreaterThan(0);
    });

    it('should return 401 without refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh_token')
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should return 401 with invalid refresh token', async () => {
      mockAuthCache.getRefreshToken.mockResolvedValueOnce({ success: false });

      const response = await request(app)
        .post('/api/v1/auth/refresh_token')
        .set('Cookie', `${JWT_KEY_NAMES.REFRESH_TOKEN}=Bearer invalid-token`)
        .expect('Content-Type', /json/)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed JSON with 400 error', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/json')
        .send('{"invalid-json":');

      expect(response.status).toBe(400);
    });

    it('should handle missing Content-Type header gracefully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send('email=test@example.com&password=test123');

      // Express parses urlencoded body but login service validates credentials
      expect(response.status).toBeGreaterThanOrEqual(400);
    });
  });
});
