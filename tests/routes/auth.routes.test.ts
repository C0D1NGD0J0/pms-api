import request from 'supertest';
import express from 'express';
import authRoutes from '@routes/auth.routes';
import { AuthController } from '@controllers/AuthController';
import { validateRequest } from '@shared/validations';
import { isAuthenticated } from '@shared/middlewares';
import { asyncWrapper } from '@utils/index';
import { AuthTestFactory } from '@tests/utils/authTestHelpers';

jest.mock('@controllers/AuthController');
jest.mock('@shared/validations');
jest.mock('@shared/middlewares');
jest.mock('@utils/index', () => ({
  asyncWrapper: jest.fn((handler) => handler),
  httpStatusCodes: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404
  }
}));

describe('Auth Routes - Integration Tests', () => {
  let app: express.Application;
  let mockAuthController: jest.Mocked<AuthController>;

  beforeEach(() => {
    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Mock auth controller methods
    mockAuthController = {
      signup: jest.fn(),
      login: jest.fn(),
      getCurrentUser: jest.fn(),
      accountActivation: jest.fn(),
      sendActivationLink: jest.fn(),
      switchClientAccount: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      logout: jest.fn(),
      refreshToken: jest.fn()
    } as any;

    // Mock container resolution
    app.use((req, res, next) => {
      req.container = {
        resolve: jest.fn().mockReturnValue(mockAuthController)
      } as any;
      next();
    });

    // Mock validation middleware
    (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => next());
    
    // Mock authentication middleware
    (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => next());

    // Use auth routes
    app.use('/auth', authRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/signup', () => {
    it('should handle user signup request', async () => {
      const signupData = AuthTestFactory.createSignupData();
      const expectedResponse = {
        success: true,
        message: 'User created successfully',
        data: { userId: 'user123' }
      };

      mockAuthController.signup.mockImplementation((req, res) => {
        res.status(201).json(expectedResponse);
      });

      const response = await request(app)
        .post('/auth/signup')
        .send(signupData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.signup).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object) // AuthValidations.signup
      });
    });

    it('should handle signup validation errors', async () => {
      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['Email is required']
        });
      });

      await request(app)
        .post('/auth/signup')
        .send({})
        .expect(400);

      expect(mockAuthController.signup).not.toHaveBeenCalled();
    });

    it('should handle controller errors in signup', async () => {
      const signupData = AuthTestFactory.createSignupData();

      mockAuthController.signup.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Email already exists'
        });
      });

      const response = await request(app)
        .post('/auth/signup')
        .send(signupData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Email already exists');
    });
  });

  describe('POST /auth/login', () => {
    it('should handle user login request', async () => {
      const loginData = AuthTestFactory.createLoginData();
      const expectedResponse = {
        success: true,
        message: 'Login successful',
        data: {
          user: AuthTestFactory.createCurrentUserInfo(),
          tokens: AuthTestFactory.createJwtTokens()
        }
      };

      mockAuthController.login.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.login).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object) // AuthValidations.login
      });
    });

    it('should handle invalid login credentials', async () => {
      const loginData = AuthTestFactory.createLoginData();

      mockAuthController.login.mockImplementation((req, res) => {
        res.status(401).json({
          success: false,
          message: 'Invalid credentials'
        });
      });

      const response = await request(app)
        .post('/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid credentials');
    });
  });

  describe('GET /auth/:cid/me', () => {
    it('should get current user information', async () => {
      const cid = 'client123';
      const expectedResponse = {
        success: true,
        data: AuthTestFactory.createCurrentUserInfo()
      };

      mockAuthController.getCurrentUser.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get(`/auth/${cid}/me`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.getCurrentUser).toHaveBeenCalledTimes(1);
      expect(isAuthenticated).toHaveBeenCalled();
    });

    it('should require authentication', async () => {
      (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      });

      const cid = 'client123';

      await request(app)
        .get(`/auth/${cid}/me`)
        .expect(401);

      expect(mockAuthController.getCurrentUser).not.toHaveBeenCalled();
    });
  });

  describe('PUT /auth/:cid/account_activation', () => {
    it('should activate user account', async () => {
      const cid = 'client123';
      const activationToken = 'activation_token_123';
      const expectedResponse = {
        success: true,
        message: 'Account activated successfully'
      };

      mockAuthController.accountActivation.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .put(`/auth/${cid}/account_activation`)
        .query({ token: activationToken })
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.accountActivation).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        query: expect.any(Object) // AuthValidations.activationToken
      });
    });

    it('should handle invalid activation token', async () => {
      const cid = 'client123';

      mockAuthController.accountActivation.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Invalid or expired activation token'
        });
      });

      const response = await request(app)
        .put(`/auth/${cid}/account_activation`)
        .query({ token: 'invalid_token' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /auth/resend_activation_link', () => {
    it('should resend activation link', async () => {
      const emailData = { email: 'user@example.com' };
      const expectedResponse = {
        success: true,
        message: 'Activation link sent successfully'
      };

      mockAuthController.sendActivationLink.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .put('/auth/resend_activation_link')
        .send(emailData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.sendActivationLink).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object) // AuthValidations.resendActivation
      });
    });

    it('should handle user not found for activation resend', async () => {
      const emailData = { email: 'nonexistent@example.com' };

      mockAuthController.sendActivationLink.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
      });

      const response = await request(app)
        .put('/auth/resend_activation_link')
        .send(emailData)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /auth/switch_client_account', () => {
    it('should switch client account', async () => {
      const switchData = { cid: 'new_client_123' };
      const expectedResponse = {
        success: true,
        message: 'Client account switched successfully',
        data: { activeCid: 'new_client_123' }
      };

      mockAuthController.switchClientAccount.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch('/auth/switch_client_account')
        .send(switchData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.switchClientAccount).toHaveBeenCalledTimes(1);
    });

    it('should handle invalid client account switch', async () => {
      const switchData = { cid: 'invalid_client' };

      mockAuthController.switchClientAccount.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Invalid client account'
        });
      });

      const response = await request(app)
        .patch('/auth/switch_client_account')
        .send(switchData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PUT /auth/forgot_password', () => {
    it('should handle forgot password request', async () => {
      const emailData = { email: 'user@example.com' };
      const expectedResponse = {
        success: true,
        message: 'Password reset link sent successfully'
      };

      mockAuthController.forgotPassword.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .put('/auth/forgot_password')
        .send(emailData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.forgotPassword).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object) // AuthValidations.emailValidation
      });
    });

    it('should handle user not found for password reset', async () => {
      const emailData = { email: 'nonexistent@example.com' };

      mockAuthController.forgotPassword.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'User not found'
        });
      });

      const response = await request(app)
        .put('/auth/forgot_password')
        .send(emailData)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/reset_password', () => {
    it('should reset password successfully', async () => {
      const resetData = {
        token: 'reset_token_123',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!'
      };
      const expectedResponse = {
        success: true,
        message: 'Password reset successfully'
      };

      mockAuthController.resetPassword.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .post('/auth/reset_password')
        .send(resetData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.resetPassword).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object) // AuthValidations.resetPassword
      });
    });

    it('should handle invalid reset token', async () => {
      const resetData = {
        token: 'invalid_token',
        password: 'NewPassword123!',
        confirmPassword: 'NewPassword123!'
      };

      mockAuthController.resetPassword.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Invalid or expired reset token'
        });
      });

      const response = await request(app)
        .post('/auth/reset_password')
        .send(resetData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /auth/:cid/logout', () => {
    it('should logout user successfully', async () => {
      const cid = 'client123';
      const expectedResponse = {
        success: true,
        message: 'Logout successful'
      };

      mockAuthController.logout.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .delete(`/auth/${cid}/logout`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.logout).toHaveBeenCalledTimes(1);
      expect(isAuthenticated).toHaveBeenCalled();
    });

    it('should require authentication for logout', async () => {
      (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      });

      const cid = 'client123';

      await request(app)
        .delete(`/auth/${cid}/logout`)
        .expect(401);

      expect(mockAuthController.logout).not.toHaveBeenCalled();
    });
  });

  describe('POST /auth/:cid/refresh_token', () => {
    it('should refresh token successfully', async () => {
      const cid = 'client123';
      const expectedResponse = {
        success: true,
        message: 'Token refreshed successfully',
        data: {
          tokens: AuthTestFactory.createJwtTokens()
        }
      };

      mockAuthController.refreshToken.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .post(`/auth/${cid}/refresh_token`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockAuthController.refreshToken).toHaveBeenCalledTimes(1);
      expect(isAuthenticated).toHaveBeenCalled();
    });

    it('should require authentication for token refresh', async () => {
      (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      });

      const cid = 'client123';

      await request(app)
        .post(`/auth/${cid}/refresh_token`)
        .expect(401);

      expect(mockAuthController.refreshToken).not.toHaveBeenCalled();
    });

    it('should handle invalid refresh token', async () => {
      const cid = 'client123';

      mockAuthController.refreshToken.mockImplementation((req, res) => {
        res.status(401).json({
          success: false,
          message: 'Invalid refresh token'
        });
      });

      const response = await request(app)
        .post(`/auth/${cid}/refresh_token`)
        .expect(401);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toBe('Invalid refresh token');
    });
  });

  describe('Route-level middleware integration', () => {
    it('should apply validation middleware to all routes requiring validation', async () => {
      // Test multiple routes to ensure validation is applied
      await request(app).post('/auth/signup').send({});
      await request(app).post('/auth/login').send({});
      await request(app).put('/auth/resend_activation_link').send({});
      await request(app).put('/auth/forgot_password').send({});
      await request(app).post('/auth/reset_password').send({});

      // Validation should be called for each route
      expect(validateRequest).toHaveBeenCalledTimes(5);
    });

    it('should apply authentication middleware to protected routes', async () => {
      const cid = 'client123';
      
      // Test protected routes
      await request(app).get(`/auth/${cid}/me`);
      await request(app).delete(`/auth/${cid}/logout`);
      await request(app).post(`/auth/${cid}/refresh_token`);

      // Authentication should be called for each protected route
      expect(isAuthenticated).toHaveBeenCalledTimes(3);
    });

    it('should handle async wrapper for all routes', async () => {
      // Ensure asyncWrapper is used for all route handlers
      expect(asyncWrapper).toHaveBeenCalled();
    });
  });

  describe('Container resolution', () => {
    it('should resolve AuthController from container for all routes', async () => {
      const mockResolve = jest.fn().mockReturnValue(mockAuthController);
      
      app.use((req, res, next) => {
        req.container = { resolve: mockResolve } as any;
        next();
      });

      // Test a few routes to verify container resolution
      await request(app).post('/auth/signup').send(AuthTestFactory.createSignupData());
      await request(app).post('/auth/login').send(AuthTestFactory.createLoginData());

      expect(mockResolve).toHaveBeenCalledWith('authController');
      expect(mockResolve).toHaveBeenCalledTimes(2);
    });

    it('should handle container resolution errors', async () => {
      app.use((req, res, next) => {
        req.container = {
          resolve: jest.fn().mockImplementation(() => {
            throw new Error('Container resolution failed');
          })
        } as any;
        next();
      });

      await request(app)
        .post('/auth/signup')
        .send(AuthTestFactory.createSignupData())
        .expect(500);
    });
  });

  describe('Error handling', () => {
    it('should handle controller method errors gracefully', async () => {
      mockAuthController.signup.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await request(app)
        .post('/auth/signup')
        .send(AuthTestFactory.createSignupData())
        .expect(500);
    });

    it('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/auth/signup')
        .send('invalid json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toMatchObject({
        error: expect.any(String)
      });
    });
  });
});