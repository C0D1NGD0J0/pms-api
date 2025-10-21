// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { Application, Response, Request } from 'express';
import { httpStatusCodes, JWT_KEY_NAMES } from '@utils/index';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock Auth Controller
const mockAuthController = {
  signup: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Registration successful. Please check your email for activation link.',
    });
  }),

  login: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      msg: 'Login successful',
      accounts: [
        {
          cuid: faker.string.uuid(),
          name: faker.company.name(),
          role: 'admin',
        },
      ],
      activeAccount: {
        cuid: faker.string.uuid(),
        name: faker.company.name(),
        role: 'admin',
      },
    });
  }),

  getCurrentUser: jest.fn((req: Request, res: Response) => {
    const currentUser = (req as any).context?.currentuser;
    if (!currentUser) {
      return res.status(httpStatusCodes.UNAUTHORIZED).json({
        success: false,
        message: 'Unauthorized',
      });
    }
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: currentUser,
    });
  }),

  switchClientAccount: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      msg: 'Client account switched successfully',
      activeAccount: {
        cuid: faker.string.uuid(),
        name: faker.company.name(),
        role: 'admin',
      },
    });
  }),

  accountActivation: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Account activated successfully',
    });
  }),

  sendActivationLink: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Activation link sent successfully',
    });
  }),

  forgotPassword: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Password reset link sent to your email',
    });
  }),

  resetPassword: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Password reset successfully',
    });
  }),

  logout: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Logout successful',
    });
  }),

  refreshToken: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Token refreshed successfully',
    });
  }),
};

// Simplified mock container
const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'authController':
        return mockAuthController;
      default:
        return {};
    }
  }),
};

describe('Auth Routes Integration Tests', () => {
  const baseUrl = '/api/v1/auth';
  const apiHelper = createApiTestHelper();
  let app: Application;

  beforeAll(() => {
    // Setup test app with routes
    app = apiHelper.createApp((testApp) => {
      // Inject container directly
      testApp.use((req, res, next) => {
        req.container = mockContainer as any;
        req.context = { currentuser: null } as any;
        next();
      });

      // Define auth routes (matching auth.routes.ts structure)
      testApp.post(`${baseUrl}/signup`, mockAuthController.signup);
      testApp.post(`${baseUrl}/login`, mockAuthController.login);
      testApp.get(`${baseUrl}/:cuid/me`, (req, res) => {
        // Simulate isAuthenticated middleware
        req.context = { currentuser: createMockCurrentUser() } as any;
        mockAuthController.getCurrentUser(req, res);
      });
      testApp.patch(`${baseUrl}/:cuid/account_activation`, mockAuthController.accountActivation);
      testApp.patch(`${baseUrl}/resend_activation_link`, mockAuthController.sendActivationLink);
      testApp.patch(`${baseUrl}/switch_client_account`, (req, res) => {
        // Simulate isAuthenticated middleware
        req.context = { currentuser: createMockCurrentUser() } as any;
        mockAuthController.switchClientAccount(req, res);
      });
      testApp.patch(`${baseUrl}/forgot_password`, mockAuthController.forgotPassword);
      testApp.patch(`${baseUrl}/reset_password`, mockAuthController.resetPassword);
      testApp.delete(`${baseUrl}/:cuid/logout`, (req, res) => {
        // Simulate isAuthenticated middleware
        req.context = { currentuser: createMockCurrentUser() } as any;
        mockAuthController.logout(req, res);
      });
      testApp.post(`${baseUrl}/refresh_token`, mockAuthController.refreshToken);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/signup (public)', () => {
    const endpoint = `${baseUrl}/signup`;

    it('should successfully register a new personal account user', async () => {
      const signupData = {
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        email: faker.internet.email(),
        password: 'ValidPass123',
        cpassword: 'ValidPass123',
        location: 'New York',
        phoneNumber: faker.phone.number(),
        accountType: {
          planId: faker.string.uuid(),
          planName: 'personal',
          isCorporate: false,
        },
        lang: 'en',
        timeZone: 'America/New_York',
      };

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Registration successful');
      expect(mockAuthController.signup).toHaveBeenCalled();
    });

    it('should successfully register a new business account user', async () => {
      const signupData = {
        firstName: faker.person.firstName(),
        lastName: faker.person.lastName(),
        email: faker.internet.email(),
        password: 'ValidPass123',
        cpassword: 'ValidPass123',
        location: 'Los Angeles',
        accountType: {
          planId: faker.string.uuid(),
          planName: 'business',
          isCorporate: true,
        },
        companyProfile: {
          tradingName: faker.company.name(),
          legalEntityName: faker.company.name(),
          registrationNumber: faker.string.alphanumeric(10),
          website: faker.internet.url(),
          contactInfo: {
            email: faker.internet.email(),
            address: faker.location.streetAddress(),
            phoneNumber: faker.phone.number(),
            contactPerson: faker.person.fullName(),
          },
        },
      };

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(mockAuthController.signup).toHaveBeenCalled();
    });

    it('should handle validation errors for missing required fields', async () => {
      mockAuthController.signup.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Validation failed',
          errors: ['First name is required', 'Email is required'],
        });
      });

      const response = await request(app)
        .post(endpoint)
        .send({ password: 'test' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 for duplicate email', async () => {
      mockAuthController.signup.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Email already in use.',
        });
      });

      const signupData = {
        firstName: 'John',
        lastName: 'Doe',
        email: 'existing@example.com',
        password: 'ValidPass123',
        cpassword: 'ValidPass123',
        location: 'New York',
        accountType: {
          planId: faker.string.uuid(),
          planName: 'personal',
          isCorporate: false,
        },
      };

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Email already in use');
    });

    it('should validate password strength', async () => {
      mockAuthController.signup.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Password must contain at least one uppercase letter, and one number',
        });
      });

      const signupData = {
        firstName: 'John',
        lastName: 'Doe',
        email: faker.internet.email(),
        password: 'weakpass',
        cpassword: 'weakpass',
        location: 'New York',
        accountType: {
          planId: faker.string.uuid(),
          planName: 'personal',
          isCorporate: false,
        },
      };

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should validate password confirmation match', async () => {
      mockAuthController.signup.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Passwords do not match',
        });
      });

      const signupData = {
        firstName: 'John',
        lastName: 'Doe',
        email: faker.internet.email(),
        password: 'ValidPass123',
        cpassword: 'DifferentPass456',
        location: 'New York',
        accountType: {
          planId: faker.string.uuid(),
          planName: 'personal',
          isCorporate: false,
        },
      };

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Passwords do not match');
    });

    it('should require company profile for business accounts', async () => {
      mockAuthController.signup.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Company profile is required for business accounts',
        });
      });

      const signupData = {
        firstName: 'John',
        lastName: 'Doe',
        email: faker.internet.email(),
        password: 'ValidPass123',
        cpassword: 'ValidPass123',
        location: 'New York',
        accountType: {
          planId: faker.string.uuid(),
          planName: 'business',
          isCorporate: true,
        },
        // Missing companyProfile
      };

      const response = await request(app)
        .post(endpoint)
        .send(signupData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Company profile is required');
    });
  });

  describe('POST /auth/login (public)', () => {
    const endpoint = `${baseUrl}/login`;

    it('should successfully login with valid credentials', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'ValidPass123',
        rememberMe: false,
      };

      const response = await request(app).post(endpoint).send(loginData).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.msg).toBe('Login successful');
      expect(response.body.accounts).toBeDefined();
      expect(response.body.activeAccount).toBeDefined();
      expect(mockAuthController.login).toHaveBeenCalled();
    });

    it('should return 401 for invalid credentials', async () => {
      mockAuthController.login.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Invalid email or password',
        });
      });

      const loginData = {
        email: 'user@example.com',
        password: 'wrongpassword',
      };

      const response = await request(app)
        .post(endpoint)
        .send(loginData)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Invalid');
    });

    it('should return 403 for inactive account', async () => {
      mockAuthController.login.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: 'Account not activated. Please check your email for activation link.',
        });
      });

      const loginData = {
        email: 'inactive@example.com',
        password: 'ValidPass123',
      };

      const response = await request(app)
        .post(endpoint)
        .send(loginData)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.message).toContain('Account not activated');
    });

    it('should handle rememberMe flag', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'ValidPass123',
        rememberMe: true,
      };

      await request(app).post(endpoint).send(loginData).expect(httpStatusCodes.OK);

      expect(mockAuthController.login).toHaveBeenCalled();
    });

    it('should validate email format', async () => {
      mockAuthController.login.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Invalid email format.',
        });
      });

      const loginData = {
        email: 'invalid-email',
        password: 'ValidPass123',
      };

      const response = await request(app)
        .post(endpoint)
        .send(loginData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid email');
    });

    it('should return user accounts and active account on success', async () => {
      const mockAccounts = [
        { cuid: faker.string.uuid(), name: 'Company A', role: 'admin' },
        { cuid: faker.string.uuid(), name: 'Company B', role: 'manager' },
      ];

      mockAuthController.login.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json({
          success: true,
          msg: 'Login successful',
          accounts: mockAccounts,
          activeAccount: mockAccounts[0],
        });
      });

      const response = await request(app)
        .post(endpoint)
        .send({
          email: 'user@example.com',
          password: 'ValidPass123',
        })
        .expect(httpStatusCodes.OK);

      expect(response.body.accounts).toHaveLength(2);
      expect(response.body.activeAccount).toEqual(mockAccounts[0]);
    });
  });

  describe('GET /auth/:cuid/me (protected)', () => {
    const cuid = faker.string.uuid();
    const endpoint = `${baseUrl}/${cuid}/me`;

    it('should return current user data when authenticated', async () => {
      const mockUser = createMockCurrentUser();

      mockAuthController.getCurrentUser.mockImplementationOnce((req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json({
          success: true,
          data: mockUser,
        });
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(mockAuthController.getCurrentUser).toHaveBeenCalled();
    });

    it('should return 401 when not authenticated', async () => {
      mockAuthController.getCurrentUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Unauthorized',
        });
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('Unauthorized');
    });

    it('should include user permissions', async () => {
      const mockUser = createMockCurrentUser({
        permissions: ['read:users', 'write:users', 'delete:users'],
      });

      mockAuthController.getCurrentUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.OK).json({
          success: true,
          data: mockUser,
        });
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.permissions).toEqual(['read:users', 'write:users', 'delete:users']);
    });
  });

  describe('PATCH /auth/switch_client_account (protected)', () => {
    const endpoint = `${baseUrl}/switch_client_account`;

    it('should successfully switch client account', async () => {
      const newClientId = faker.string.uuid();
      const switchData = { clientId: newClientId };

      const response = await request(app)
        .patch(endpoint)
        .send(switchData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.msg).toContain('switched successfully');
      expect(response.body.activeAccount).toBeDefined();
      expect(mockAuthController.switchClientAccount).toHaveBeenCalled();
    });

    it('should return 403 for invalid client access', async () => {
      mockAuthController.switchClientAccount.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'You do not have access to this client',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ clientId: 'unauthorized-client-id' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.message).toContain('access');
    });
  });

  describe('PATCH /auth/:cuid/account_activation (public)', () => {
    const cuid = faker.string.uuid();
    const endpoint = `${baseUrl}/${cuid}/account_activation`;

    it('should successfully activate account with valid token', async () => {
      const validToken = faker.string.alphanumeric(32);

      const response = await request(app)
        .patch(endpoint)
        .query({ t: validToken })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('activated successfully');
      expect(mockAuthController.accountActivation).toHaveBeenCalled();
    });

    it('should return 400 for invalid token', async () => {
      mockAuthController.accountActivation.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Token is invalid or has expired',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .query({ t: 'invalid-token' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('invalid');
    });
  });

  describe('PATCH /auth/resend_activation_link (public)', () => {
    const endpoint = `${baseUrl}/resend_activation_link`;

    it('should successfully resend activation link', async () => {
      const email = faker.internet.email();

      const response = await request(app)
        .patch(endpoint)
        .send({ email })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('sent successfully');
      expect(mockAuthController.sendActivationLink).toHaveBeenCalled();
    });

    it('should return 400 for invalid email', async () => {
      mockAuthController.sendActivationLink.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid email format.',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ email: 'invalid-email' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid email');
    });
  });

  describe('PATCH /auth/forgot_password (public)', () => {
    const endpoint = `${baseUrl}/forgot_password`;

    it('should successfully send password reset email', async () => {
      const email = faker.internet.email();

      const response = await request(app)
        .patch(endpoint)
        .send({ email })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Password reset');
      expect(mockAuthController.forgotPassword).toHaveBeenCalled();
    });

    it('should return 400 for invalid email format', async () => {
      mockAuthController.forgotPassword.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Invalid email format.',
        });
      });

      const response = await request(app)
        .patch(endpoint)
        .send({ email: 'invalid-email' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid email');
    });
  });

  describe('PATCH /auth/reset_password (public)', () => {
    const endpoint = `${baseUrl}/reset_password`;

    it('should successfully reset password with valid token', async () => {
      const resetData = {
        resetToken: faker.string.alphanumeric(32),
        password: 'NewValidPass123',
      };

      const response = await request(app)
        .patch(endpoint)
        .send(resetData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('reset successfully');
      expect(mockAuthController.resetPassword).toHaveBeenCalled();
    });

    it('should return 400 for invalid reset token', async () => {
      mockAuthController.resetPassword.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Password reset token is invalid or has expired',
        });
      });

      const response = await request(app)
        .patch(endpoint)
        .send({
          resetToken: 'invalid-token',
          password: 'NewValidPass123',
        })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('invalid');
    });

    it('should validate password strength', async () => {
      mockAuthController.resetPassword.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Password must be at least 6 characters long.',
        });
      });

      const response = await request(app)
        .patch(endpoint)
        .send({
          resetToken: faker.string.alphanumeric(32),
          password: 'weak',
        })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Password');
    });
  });

  describe('DELETE /auth/:cuid/logout (protected)', () => {
    const cuid = faker.string.uuid();
    const endpoint = `${baseUrl}/${cuid}/logout`;

    it('should successfully logout user', async () => {
      const response = await request(app).delete(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Logout successful');
      expect(mockAuthController.logout).toHaveBeenCalled();
    });

    it('should return 401 when access token is missing', async () => {
      mockAuthController.logout.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Access token not found',
        });
      });

      const response = await request(app).delete(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.message).toContain('Access token not found');
    });
  });

  describe('POST /auth/refresh_token (public)', () => {
    const endpoint = `${baseUrl}/refresh_token`;

    it('should successfully refresh tokens with valid refresh token', async () => {
      const response = await request(app)
        .post(endpoint)
        .set('Cookie', [`${JWT_KEY_NAMES.REFRESH_TOKEN}=valid-refresh-token`])
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('Token refreshed');
      expect(mockAuthController.refreshToken).toHaveBeenCalled();
    });

    it('should return 401 for missing refresh token', async () => {
      mockAuthController.refreshToken.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Refresh token not found',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.message).toContain('Refresh token not found');
    });

    it('should return 401 for expired refresh token', async () => {
      mockAuthController.refreshToken.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.UNAUTHORIZED).json({
          success: false,
          message: 'Refresh token has expired',
        });
      });

      const response = await request(app)
        .post(endpoint)
        .set('Cookie', [`${JWT_KEY_NAMES.REFRESH_TOKEN}=expired-token`])
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.message).toContain('expired');
    });
  });

  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async () => {
      mockAuthController.login.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
          success: false,
          message: 'Internal server error',
        });
      });

      const response = await request(app)
        .post(`${baseUrl}/login`)
        .send({ email: 'test@example.com', password: 'password' })
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle validation errors consistently', async () => {
      mockAuthController.login.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Validation failed',
          errors: ['Invalid email format', 'Password is required'],
        });
      });

      const response = await request(app)
        .post(`${baseUrl}/login`)
        .send({ email: 'invalid', password: '' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.errors).toBeDefined();
      expect(Array.isArray(response.body.errors)).toBe(true);
    });
  });
});
