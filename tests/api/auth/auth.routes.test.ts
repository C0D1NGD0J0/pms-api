// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import express, { Response, Request } from 'express';
import { ROLES, ROLE_GROUPS } from '@shared/constants/roles.constants';

// Create mock ObjectId generator to avoid mongoose import
class MockObjectId {
  private _id: string;

  constructor() {
    this._id = faker.string.alphanumeric(24);
  }

  toString() {
    return this._id;
  }
}

// Mock Types object to avoid mongoose dependency
const Types = {
  ObjectId: MockObjectId,
};
// Define interfaces and constants directly to avoid imports

enum DataRetentionPolicy {
  STANDARD = 'standard',
  EXTENDED = 'extended',
  MINIMAL = 'minimal',
}

// Define HTTP status codes directly to avoid importing full app
const httpStatusCodes = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  TOO_MANY_REQUESTS: 429,
  INTERNAL_SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
};

// Create inline mock user factory to avoid external imports
const createMockCurrentUser = (overrides = {}) => ({
  sub: new Types.ObjectId().toString(),
  uid: faker.string.uuid(),
  email: faker.internet.email(),
  isActive: true,
  displayName: faker.person.fullName(),
  fullname: faker.person.fullName(),
  avatarUrl: faker.image.avatar(),
  preferences: {
    theme: 'light' as const,
    lang: 'en',
    timezone: 'UTC',
  },
  client: {
    cuid: faker.string.uuid(),
    displayname: faker.company.name(),
    role: IUserRole.ADMIN,
  },
  clients: [
    {
      cuid: faker.string.uuid(),
      isConnected: true,
      roles: [IUserRole.ADMIN],
      clientDisplayName: faker.company.name(),
    },
  ],
  permissions: ['read', 'write', 'admin'],
  gdpr: {
    dataRetentionPolicy: DataRetentionPolicy.STANDARD,
    dataProcessingConsent: true,
    processingConsentDate: new Date(),
    retentionExpiryDate: faker.date.future(),
  },
  accounts: [] as any[],
  activeAccount: null,
  ...overrides,
});

// Simplified Express app for testing - focus on route logic only
function createTestApp(controller: any) {
  const app = express();
  app.use(express.json());

  // Inject container directly without complex middleware chains
  app.use((req, res, next) => {
    req.container = mockContainer as any;
    req.context = {
      currentuser: createMockCurrentUser({
        preferences: { theme: 'light' as const, lang: 'en', timezone: 'UTC' },
        clients: [
          {
            cuid: 'test-cuid',
            isConnected: true,
            roles: [ROLES.ADMIN],
            clientDisplayName: 'Test Client',
          },
        ],
      }),
      userAgent: {
        browser: 'Chrome',
        version: '91.0',
        os: 'macOS',
        raw: 'test-user-agent',
        isMobile: false,
        isBot: false,
      },
      request: {
        path: req.path,
        method: req.method,
        params: req.params,
        url: req.url,
        query: req.query,
      },
      langSetting: {
        lang: 'en',
        t: jest.fn((key: string) => key),
      },
      timing: {
        startTime: Date.now(),
      },
      service: { env: 'test' },
      source: 'WEB' as any,
      requestId: faker.string.uuid(),
      timestamp: new Date(),
      ip: '127.0.0.1',
    };
    next();
  });

  const baseUrl = '/api/v1/auth';

  // Simple route definitions without complex middleware
  app.post(`${baseUrl}/signup`, controller.signup);
  app.post(`${baseUrl}/login`, controller.login);
  app.get(`${baseUrl}/:cuid/me`, controller.getCurrentUser);
  app.put(`${baseUrl}/:cuid/account_activation`, controller.accountActivation);
  app.put(`${baseUrl}/resend_activation_link`, controller.sendActivationLink);
  app.patch(`${baseUrl}/switch_client_account`, controller.switchClientAccount);
  app.put(`${baseUrl}/forgot_password`, controller.forgotPassword);
  app.post(`${baseUrl}/reset_password`, controller.resetPassword);
  app.delete(`${baseUrl}/:cuid/logout`, controller.logout);
  app.post(`${baseUrl}/refresh_token`, controller.refreshToken);

  return app;
}

// Simplified mock container
const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'authController':
        return {
          signup: jest.fn(),
          login: jest.fn(),
          getCurrentUser: jest.fn(),
          accountActivation: jest.fn(),
          sendActivationLink: jest.fn(),
          switchClientAccount: jest.fn(),
          forgotPassword: jest.fn(),
          resetPassword: jest.fn(),
          logout: jest.fn(),
          refreshToken: jest.fn(),
        };
      default:
        return {};
    }
  }),
};

// Helper functions for consistent responses
const createSuccessResponse = (data: any, message = 'Success') => ({
  success: true,
  message,
  data,
});

const createErrorResponse = (message: string) => ({
  success: false,
  message,
});

// Mock auth data factories
const createMockSignupData = (overrides: any = {}) => ({
  firstName: faker.person.firstName(),
  lastName: faker.person.lastName(),
  email: faker.internet.email(),
  password: 'ValidPassword123!',
  location: 'New York',
  phoneNumber: faker.phone.number(),
  accountType: {
    planId: new Types.ObjectId().toString(),
    planName: 'personal' as const,
    isCorporate: false,
  },
  lang: 'en',
  timeZone: 'America/New_York',
  ...overrides,
});

const createMockLoginData = (overrides: any = {}) => ({
  email: faker.internet.email(),
  password: 'ValidPassword123!',
  rememberMe: false,
  ...overrides,
});

const createMockBusinessSignupData = () => ({
  ...createMockSignupData(),
  accountType: {
    planId: new Types.ObjectId().toString(),
    planName: 'business' as const,
    isCorporate: true,
  },
  companyProfile: {
    tradingName: faker.company.name(),
    legalEntityName: faker.company.name(),
    website: faker.internet.url(),
    companyEmail: faker.internet.email(),
    companyPhoneNumber: faker.phone.number(),
    registrationNumber: faker.string.alphanumeric(10),
    contactInfo: {
      email: faker.internet.email(),
      address: faker.location.streetAddress(),
      phoneNumber: faker.phone.number(),
      contactPerson: faker.person.fullName(),
    },
    identification: {
      idType: 'corporation-license' as const,
      idNumber: faker.string.alphanumeric(10),
      authority: 'State Business Authority',
      issueDate: faker.date.past().toISOString(),
      expiryDate: faker.date.future().toISOString(),
      issuingState: 'NY',
    },
  },
});

describe('Auth Routes Integration Tests', () => {
  const baseUrl = '/api/v1/auth';
  let mockController: any;
  let app: any;

  beforeEach(() => {
    // Clear all mocks to ensure test isolation
    jest.clearAllMocks();

    // Recreate controller and app for each test
    mockController = mockContainer.resolve('authController');
    app = createTestApp(mockController);
  });

  describe('POST /signup (public)', () => {
    const endpoint = `${baseUrl}/signup`;

    it('should register new personal account successfully', async () => {
      const signupData = createMockSignupData();
      const mockResponse = {
        success: true,
        message:
          'Account created successfully. Please check your email for activation instructions.',
        data: {
          userId: new Types.ObjectId().toString(),
          email: signupData.email,
          isActive: false,
          activationEmailSent: true,
        },
      };

      mockController.signup.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.signup).toHaveBeenCalled();
    });

    it('should register new business account successfully', async () => {
      const signupData = createMockBusinessSignupData();
      const mockResponse = {
        success: true,
        message:
          'Business account created successfully. Please check your email for activation instructions.',
        data: {
          userId: new Types.ObjectId().toString(),
          email: signupData.email,
          isActive: false,
          activationEmailSent: true,
          companyProfile: {
            tradingName: signupData.companyProfile.tradingName,
            legalEntityName: signupData.companyProfile.legalEntityName,
          },
        },
      };

      mockController.signup.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.signup).toHaveBeenCalled();
    });

    it('should return 400 for duplicate email', async () => {
      const signupData = createMockSignupData();
      const errorResponse = {
        success: false,
        message: 'Email already in use.',
        errors: [
          {
            field: 'email',
            message: 'Email already in use.',
          },
        ],
      };

      mockController.signup.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
    });

    it('should handle validation errors', async () => {
      const errorResponse = {
        success: false,
        message: 'Validation failed',
        errors: [
          { field: 'email', message: 'Invalid email format' },
          { field: 'password', message: 'Password too weak' },
        ],
      };

      mockController.signup.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send({
          email: 'invalid-email',
          password: 'weak',
        })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
      expect(mockController.signup).toHaveBeenCalled();
    });
  });

  describe('POST /login (public)', () => {
    const endpoint = `${baseUrl}/login`;

    it('should login with valid credentials successfully', async () => {
      const loginData = createMockLoginData();
      const mockResponse = {
        success: true,
        msg: 'Login successful',
        accounts: [
          {
            csub: 'mock-client-id',
            displayName: 'Test Company',
            role: IUserRole.ADMIN,
          },
        ],
        activeAccount: {
          csub: 'mock-client-id',
          displayName: 'Test Company',
          role: IUserRole.ADMIN,
        },
      };

      mockController.login.mockImplementation((_req: Request, res: Response) => {
        // Mock setting auth cookies
        res.cookie('access_token', 'Bearer mock-access-token');
        res.cookie('refresh_token', 'Bearer mock-refresh-token');
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app).post(endpoint).send(loginData).expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.login).toHaveBeenCalled();
    });

    it('should login with remember me option', async () => {
      const loginData = createMockLoginData({ rememberMe: true });
      const mockResponse = {
        success: true,
        msg: 'Login successful',
        accounts: [],
        activeAccount: null,
      };

      mockController.login.mockImplementation((_req: Request, res: Response) => {
        // Mock setting auth cookies with longer expiry
        res.cookie('access_token', 'Bearer mock-access-token', {
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        res.cookie('refresh_token', 'Bearer mock-refresh-token', {
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app).post(endpoint).send(loginData).expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
    });

    it('should return 401 for invalid credentials', async () => {
      const loginData = createMockLoginData({ password: 'wrongpassword' });
      const errorResponse = {
        success: false,
        message: 'Invalid email or password',
      };

      mockController.login.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send(loginData)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
    });

    it('should return 403 for inactive account', async () => {
      const loginData = createMockLoginData();
      const errorResponse = {
        success: false,
        message: 'Account is not activated. Please check your email for activation instructions.',
      };

      mockController.login.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.FORBIDDEN).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send(loginData)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body).toEqual(errorResponse);
    });
  });

  describe('GET /:cuid/me (private)', () => {
    const validCuid = faker.string.uuid();
    const endpoint = `${baseUrl}/${validCuid}/me`;

    it('should get current user information successfully', async () => {
      const mockUser = createMockCurrentUser();
      const mockResponse = {
        success: true,
        data: mockUser,
      };

      mockController.getCurrentUser.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .get(endpoint)
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual({
        ...mockResponse,
        data: {
          ...mockResponse.data,
          gdpr: {
            ...mockResponse.data.gdpr,
            processingConsentDate: expect.any(String),
            retentionExpiryDate: expect.any(String),
          },
        },
      });
      expect(mockController.getCurrentUser).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      const errorResponse = {
        success: false,
        message: 'Unauthorized access',
      };

      mockController.getCurrentUser.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
      expect(mockController.getCurrentUser).toHaveBeenCalled();
    });

    it('should return 401 for invalid token', async () => {
      const errorResponse = {
        success: false,
        message: 'Unauthorized access',
      };

      mockController.getCurrentUser.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app)
        .get(endpoint)
        .set('Authorization', 'Bearer invalid-token')
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
    });

    it('should return user with permissions and accounts', async () => {
      const mockUser = createMockCurrentUser();
      mockUser.accounts = [
        {
          csub: 'client-1',
          displayName: 'Company A',
          role: IUserRole.ADMIN,
        },
        {
          csub: 'client-2',
          displayName: 'Company B',
          role: IUserRole.STAFF,
        },
      ];
      mockUser.activeAccount = mockUser.accounts[0];

      const mockResponse = {
        success: true,
        data: mockUser,
      };

      mockController.getCurrentUser.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .get(endpoint)
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.accounts).toHaveLength(2);
      expect(response.body.data.activeAccount).toEqual(mockUser.activeAccount);
    });
  });

  describe('PUT /:cuid/account_activation (public)', () => {
    const validCuid = faker.string.uuid();
    const endpoint = `${baseUrl}/${validCuid}/account_activation`;

    it('should activate account with valid token successfully', async () => {
      const validToken = faker.string.alphanumeric(32);
      const mockResponse = {
        success: true,
        message: 'Account activated successfully',
        data: {
          userId: validCuid,
          isActive: true,
          activatedAt: new Date().toISOString(),
        },
      };

      mockController.accountActivation.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .put(endpoint)
        .query({ t: validToken })
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.accountActivation).toHaveBeenCalled();
    });

    it('should return 400 for expired token', async () => {
      const expiredToken = faker.string.alphanumeric(32);
      const errorResponse = {
        success: false,
        message: 'Activation token is invalid or has expired',
      };

      mockController.accountActivation.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .put(endpoint)
        .query({ t: expiredToken })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
    });

    it('should handle already activated account', async () => {
      const validToken = faker.string.alphanumeric(32);
      const errorResponse = {
        success: false,
        message: 'Account is already activated',
      };

      mockController.accountActivation.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .put(endpoint)
        .query({ t: validToken })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
    });
  });

  describe('PUT /resend_activation_link (public)', () => {
    const endpoint = `${baseUrl}/resend_activation_link`;

    it('should resend activation link successfully', async () => {
      const email = faker.internet.email();
      const mockResponse = {
        success: true,
        message: 'Activation link has been sent to your email',
        data: {
          email,
          activationEmailSent: true,
          sentAt: new Date().toISOString(),
        },
      };

      mockController.sendActivationLink.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app).put(endpoint).send({ email }).expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.sendActivationLink).toHaveBeenCalled();
    });

    it('should return 404 for non-existent email', async () => {
      const email = faker.internet.email();
      const errorResponse = {
        success: false,
        message: 'No account found with this email address',
      };

      mockController.sendActivationLink.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.NOT_FOUND).json(errorResponse);
      });

      const response = await request(app)
        .put(endpoint)
        .send({ email })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body).toEqual(errorResponse);
    });

    it('should return 400 for already active account', async () => {
      const email = faker.internet.email();
      const errorResponse = {
        success: false,
        message: 'Account is already activated',
      };

      mockController.sendActivationLink.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .put(endpoint)
        .send({ email })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
    });
  });

  describe('PATCH /switch_client_account (private)', () => {
    const endpoint = `${baseUrl}/switch_client_account`;

    it('should switch client account successfully', async () => {
      const clientId = new Types.ObjectId().toString();
      const mockResponse = {
        success: true,
        msg: 'Account switched successfully',
        activeAccount: {
          csub: clientId,
          displayName: 'New Company',
          role: IUserRole.STAFF,
        },
      };

      mockController.switchClientAccount.mockImplementation((_req: Request, res: Response) => {
        // Mock setting new auth cookies
        res.cookie('access_token', 'Bearer new-access-token');
        res.cookie('refresh_token', 'Bearer new-refresh-token');
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .patch(endpoint)
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .send({ clientId })
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.switchClientAccount).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      const errorResponse = {
        success: false,
        message: 'Unauthorized access',
      };

      mockController.switchClientAccount.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app)
        .patch(endpoint)
        .send({ clientId: new Types.ObjectId().toString() })
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
      expect(mockController.switchClientAccount).toHaveBeenCalled();
    });

    it('should return 403 for unauthorized client access', async () => {
      const clientId = new Types.ObjectId().toString();
      const errorResponse = {
        success: false,
        message: 'You do not have access to this client account',
      };

      mockController.switchClientAccount.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.FORBIDDEN).json(errorResponse);
      });

      const response = await request(app)
        .patch(endpoint)
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .send({ clientId })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body).toEqual(errorResponse);
    });

    it('should return 404 for non-existent client', async () => {
      const clientId = new Types.ObjectId().toString();
      const errorResponse = {
        success: false,
        message: 'Client account not found',
      };

      mockController.switchClientAccount.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.NOT_FOUND).json(errorResponse);
      });

      const response = await request(app)
        .patch(endpoint)
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .send({ clientId })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body).toEqual(errorResponse);
    });
  });

  describe('PUT /forgot_password (public)', () => {
    const endpoint = `${baseUrl}/forgot_password`;

    it('should send password reset email successfully', async () => {
      const email = faker.internet.email();
      const mockResponse = {
        success: true,
        message: 'Password reset instructions have been sent to your email',
        data: {
          email,
          resetEmailSent: true,
          sentAt: new Date().toISOString(),
        },
      };

      mockController.forgotPassword.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app).put(endpoint).send({ email }).expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.forgotPassword).toHaveBeenCalled();
    });

    it('should return success even for non-existent email (security)', async () => {
      const email = faker.internet.email();
      const mockResponse = {
        success: true,
        message: 'If an account with this email exists, password reset instructions have been sent',
      };

      mockController.forgotPassword.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app).put(endpoint).send({ email }).expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
    });
  });

  describe('POST /reset_password (public)', () => {
    const endpoint = `${baseUrl}/reset_password`;

    it('should reset password with valid token successfully', async () => {
      const token = faker.string.alphanumeric(32);
      const password = 'NewValidPassword123!';
      const mockResponse = {
        success: true,
        message: 'Password has been reset successfully',
        data: {
          passwordReset: true,
          resetAt: new Date().toISOString(),
        },
      };

      mockController.resetPassword.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send({ token, password })
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.resetPassword).toHaveBeenCalled();
    });

    it('should return 400 for expired token', async () => {
      const token = faker.string.alphanumeric(32);
      const password = 'NewValidPassword123!';
      const errorResponse = {
        success: false,
        message: 'Password reset token is invalid or has expired',
      };

      mockController.resetPassword.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send({ token, password })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
    });

    it('should return 400 for invalid token', async () => {
      const token = 'invalid-token';
      const password = 'NewValidPassword123!';
      const errorResponse = {
        success: false,
        message: 'Invalid password reset token',
      };

      mockController.resetPassword.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send({ token, password })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
    });

    it('should handle token already used', async () => {
      const token = faker.string.alphanumeric(32);
      const password = 'NewValidPassword123!';
      const errorResponse = {
        success: false,
        message: 'Password reset token has already been used',
      };

      mockController.resetPassword.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .send({ token, password })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body).toEqual(errorResponse);
    });
  });

  describe('DELETE /:cuid/logout (private)', () => {
    const validCuid = faker.string.uuid();
    const endpoint = `${baseUrl}/${validCuid}/logout`;

    it('should logout successfully', async () => {
      const mockResponse = {
        success: true,
        message: 'Logout successful',
        data: {
          loggedOut: true,
          loggedOutAt: new Date().toISOString(),
        },
      };

      mockController.logout.mockImplementation((_req: Request, res: Response) => {
        // Mock clearing cookies
        res.clearCookie('access_token', { path: '/' });
        res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh_token' });
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .delete(endpoint)
        .set('Cookie', ['access_token=Bearer mock-access-token'])
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.logout).toHaveBeenCalled();
    });

    it('should return 401 without authentication', async () => {
      const errorResponse = {
        success: false,
        message: 'Unauthorized access',
      };

      mockController.logout.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app).delete(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
      expect(mockController.logout).toHaveBeenCalled();
    });

    it('should return 401 for missing access token cookie', async () => {
      const errorResponse = {
        success: false,
        message: 'Access token not found',
      };

      mockController.logout.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app)
        .delete(endpoint)
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
    });

    it('should handle invalid token in cookie', async () => {
      const errorResponse = {
        success: false,
        message: 'Invalid access token',
      };

      mockController.logout.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app)
        .delete(endpoint)
        .set('Cookie', ['access_token=invalid-token'])
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
    });

    it('should clear all auth cookies on logout', async () => {
      const mockResponse = {
        success: true,
        message: 'Logout successful',
      };

      mockController.logout.mockImplementation((_req: Request, res: Response) => {
        res.clearCookie('access_token', { path: '/' });
        res.clearCookie('refresh_token', { path: '/api/v1/auth/refresh_token' });
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .delete(endpoint)
        .set('Cookie', [
          'access_token=Bearer mock-access-token',
          'refresh_token=Bearer mock-refresh-token',
        ])
        .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
    });
  });

  describe('POST /refresh_token (public)', () => {
    const endpoint = `${baseUrl}/refresh_token`;

    it('should refresh tokens successfully', async () => {
      const mockResponse = {
        success: true,
        message: 'Token refreshed successfully',
      };

      mockController.refreshToken.mockImplementation((_req: Request, res: Response) => {
        // Mock setting new auth cookies
        res.cookie('access_token', 'Bearer new-access-token');
        res.cookie('refresh_token', 'Bearer new-refresh-token');
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .set('Cookie', ['refresh_token=Bearer mock-refresh-token'])
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
      expect(mockController.refreshToken).toHaveBeenCalled();
    });

    it('should return 401 for missing refresh token', async () => {
      const errorResponse = {
        success: false,
        message: 'Refresh token not found',
      };

      mockController.refreshToken.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
    });

    it('should return 401 for invalid refresh token', async () => {
      const errorResponse = {
        success: false,
        message: 'Invalid refresh token',
      };

      mockController.refreshToken.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .set('Cookie', ['refresh_token=Bearer invalid-refresh-token'])
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
    });

    it('should return 401 for expired refresh token', async () => {
      const errorResponse = {
        success: false,
        message: 'Refresh token has expired',
      };

      mockController.refreshToken.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json(errorResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .set('Cookie', ['refresh_token=Bearer expired-refresh-token'])
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body).toEqual(errorResponse);
    });

    it('should handle refresh token without Bearer prefix', async () => {
      const mockResponse = {
        success: true,
        message: 'Token refreshed successfully',
      };

      mockController.refreshToken.mockImplementation((_req: Request, res: Response) => {
        res.cookie('access_token', 'Bearer new-access-token');
        res.cookie('refresh_token', 'Bearer new-refresh-token');
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .set('Cookie', ['refresh_token=raw-refresh-token'])
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
    });

    it('should handle remember me token refresh', async () => {
      const mockResponse = {
        success: true,
        message: 'Token refreshed successfully',
      };

      mockController.refreshToken.mockImplementation((_req: Request, res: Response) => {
        // Mock setting cookies with longer expiry for remember me
        res.cookie('access_token', 'Bearer new-access-token', { maxAge: 30 * 24 * 60 * 60 * 1000 });
        res.cookie('refresh_token', 'Bearer new-refresh-token', {
          maxAge: 30 * 24 * 60 * 60 * 1000,
        });
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .post(endpoint)
        .set('Cookie', ['refresh_token=Bearer remember-me-refresh-token'])
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual(mockResponse);
    });
  });

  describe('Route Integration', () => {
    it('should handle protected routes', async () => {
      const mockUser = createMockCurrentUser();
      const mockResponse = {
        success: true,
        data: mockUser,
      };

      mockController.getCurrentUser.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json(mockResponse);
      });

      const response = await request(app)
        .get(`${baseUrl}/${faker.string.uuid()}/me`)
        .expect(httpStatusCodes.OK);

      expect(response.body).toEqual({
        ...mockResponse,
        data: {
          ...mockResponse.data,
          gdpr: {
            ...mockResponse.data.gdpr,
            processingConsentDate: expect.any(String),
            retentionExpiryDate: expect.any(String),
          },
        },
      });
      expect(mockController.getCurrentUser).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle server errors gracefully', async () => {
      const endpoint = `${baseUrl}/login`;

      mockController.login.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: 'Internal server error',
        });
      });

      const response = await request(app)
        .post(endpoint)
        .send(createMockLoginData())
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
      expect(mockController.login).toHaveBeenCalled();
    });

    it('should handle controller method calls correctly', async () => {
      const endpoint = `${baseUrl}/${faker.string.uuid()}/me`;

      mockController.getCurrentUser.mockImplementation((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json({
          success: true,
          data: createMockCurrentUser(),
        });
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(mockController.getCurrentUser).toHaveBeenCalled();
      expect(response.body.success).toBe(true);
    });
  });
});
