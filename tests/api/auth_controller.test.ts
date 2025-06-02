/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { Request, Response } from 'express';
import { AuthController } from '@controllers/AuthController';
import { httpStatusCodes, JWT_KEY_NAMES } from '@utils/index';
import { 
  mockAuthService, 
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  AssertionHelpers,
  HttpTestHelpers, 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';

describe('AuthController - API Tests', () => {
  let authController: AuthController;
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeAll(() => {
    // Initialize controller with mocked dependencies
    authController = new AuthController({
      authService: mockAuthService,
    });
  });

  beforeEach(() => {
    // Reset all mocks and container state
    resetTestContainer();
    
    // Setup fresh request and response objects
    req = TestSuiteHelpers.setupMockRequest();
    res = TestSuiteHelpers.setupMockResponse();
  });

  afterEach(() => {
    // Additional cleanup if needed
    jest.clearAllMocks();
  });

  describe('POST /signup', () => {
    describe('Successful signup', () => {
      it('should create a new user successfully', async () => {
        // Arrange
        const signupData = TestDataFactory.createSignupData();
        req.body = signupData;

        const expectedResponse = {
          success: true,
          message: 'Account activation email has been sent to test@example.com',
          data: null,
        };

        mockAuthService.signup.mockResolvedValue(expectedResponse);

        // Act
        await authController.signup(req as Request, res as Response);

        // Assert
        AssertionHelpers.expectSuccessResponse(res, {
          message: 'Account activation email has been sent to test@example.com',
        });
        AssertionHelpers.expectServiceCalledWith(mockAuthService, 'signup', [signupData]);
      });

      it('should handle signup with different account types', async () => {
        // Arrange
        const signupData = TestDataFactory.createSignupData({
          accountType: {
            planId: 'premium',
            planName: 'Premium Plan',
            isEnterpriseAccount: true,
          },
        });
        req.body = signupData;

        mockAuthService.signup.mockResolvedValue({
          success: true,
          message: 'Enterprise account created successfully',
          data: null,
        });

        // Act
        await authController.signup(req as Request, res as Response);

        // Assert
        AssertionHelpers.expectSuccessResponse(res);
        expect(mockAuthService.signup).toHaveBeenCalledWith(
          expect.objectContaining({
            accountType: expect.objectContaining({
              isEnterpriseAccount: true,
            }),
          })
        );
      });
    });

    describe('Signup errors', () => {
      it('should handle validation errors during signup', async () => {
        // Arrange
        const invalidData = {
          email: 'invalid-email',
          password: 'short',
        };
        req.body = invalidData;

        const error = {
          statusCode: httpStatusCodes.BAD_REQUEST,
          message: 'Validation failed',
          errors: ['Invalid email format', 'Password too short'],
        };

        mockAuthService.signup.mockRejectedValue(error);

        // Act & Assert
        await expect(authController.signup(req as Request, res as Response))
          .rejects.toEqual(error);
        
        AssertionHelpers.expectServiceCalledWith(mockAuthService, 'signup', [invalidData]);
      });

      it('should handle duplicate email error', async () => {
        // Arrange
        const signupData = TestDataFactory.createSignupData();
        req.body = signupData;

        const error = {
          statusCode: httpStatusCodes.BAD_REQUEST,
          message: 'Email already exists',
        };

        mockAuthService.signup.mockRejectedValue(error);

        // Act & Assert
        await expect(authController.signup(req as Request, res as Response))
          .rejects.toEqual(error);
      });
    });
  });

  describe('POST /login', () => {
    describe('Successful login', () => {
      it('should log in user with valid credentials', async () => {
        // Arrange
        const loginData = TestDataFactory.createLoginData();
        const tokens = TestDataFactory.createTokens();
        req.body = loginData;

        mockAuthService.login.mockResolvedValue({
          success: true,
          message: 'Login successful.',
          data: tokens,
        });

        // Mock the setAuthCookies functionality
        res.cookie = jest.fn().mockReturnThis();

        // Act
        await authController.login(req as Request, res as Response);

        // Assert
        AssertionHelpers.expectSuccessResponse(res, {
          msg: 'Login successful.',
          accounts: tokens.accounts,
          activeAccount: tokens.activeAccount,
        });
        AssertionHelpers.expectServiceCalledWith(mockAuthService, 'login', [loginData]);
      });

      it('should handle remember me option', async () => {
        // Arrange
        const loginData = TestDataFactory.createLoginData({ rememberMe: true });
        const tokens = TestDataFactory.createTokens({ rememberMe: true });
        req.body = loginData;

        mockAuthService.login.mockResolvedValue({
          success: true,
          message: 'Login successful.',
          data: tokens,
        });

        res.cookie = jest.fn().mockReturnThis();

        // Act
        await authController.login(req as Request, res as Response);

        // Assert
        AssertionHelpers.expectSuccessResponse(res);
        expect(mockAuthService.login).toHaveBeenCalledWith(
          expect.objectContaining({ rememberMe: true })
        );
      });
    });

    describe('Login errors', () => {
      it('should handle invalid credentials', async () => {
        // Arrange
        const invalidLoginData = TestDataFactory.createLoginData({
          password: 'WrongPassword',
        });
        req.body = invalidLoginData;

        const error = {
          statusCode: httpStatusCodes.UNAUTHORIZED,
          message: 'Invalid email/password combination.',
        };

        mockAuthService.login.mockRejectedValue(error);

        // Act & Assert
        await expect(authController.login(req as Request, res as Response))
          .rejects.toEqual(error);
      });

      it('should handle account not activated error', async () => {
        // Arrange
        const loginData = TestDataFactory.createLoginData();
        req.body = loginData;

        const error = {
          statusCode: httpStatusCodes.FORBIDDEN,
          message: 'Account not activated. Please check your email.',
        };

        mockAuthService.login.mockRejectedValue(error);

        // Act & Assert
        await expect(authController.login(req as Request, res as Response))
          .rejects.toEqual(error);
      });
    });
  });

  describe('GET /account-activation', () => {
    describe('Successful activation', () => {
      it('should activate account with valid token', async () => {
        // Arrange
        const activationToken = 'valid-activation-token';
        req.query = { t: activationToken };

        mockAuthService.accountActivation.mockResolvedValue({
          success: true,
          message: 'Account activated successfully.',
          data: null,
        });

        // Act
        await authController.accountActivation(req as Request, res as Response);

        // Assert
        AssertionHelpers.expectSuccessResponse(res, {
          message: 'Account activated successfully.',
          data: null,
        });
        AssertionHelpers.expectServiceCalledWith(mockAuthService, 'accountActivation', [activationToken]);
      });
    });

    describe('Activation errors', () => {
      it('should handle invalid activation token', async () => {
        // Arrange
        const invalidToken = 'invalid-token';
        req.query = { t: invalidToken };

        const error = {
          statusCode: httpStatusCodes.BAD_REQUEST,
          message: 'Invalid or expired activation token.',
        };

        mockAuthService.accountActivation.mockRejectedValue(error);

        // Act & Assert
        await expect(authController.accountActivation(req as Request, res as Response))
          .rejects.toEqual(error);
      });

      it('should handle missing token', async () => {
        // Arrange
        req.query = {};

        const error = {
          statusCode: httpStatusCodes.BAD_REQUEST,
          message: 'Activation token is required.',
        };

        mockAuthService.accountActivation.mockRejectedValue(error);

        // Act & Assert
        await expect(authController.accountActivation(req as Request, res as Response))
          .rejects.toEqual(error);
      });
    });
  });

  describe('POST /send-activation-link', () => {
    it('should send activation link for valid email', async () => {
      // Arrange
      const email = 'test@example.com';
      req.body = { email };

      mockAuthService.sendActivationLink.mockResolvedValue({
        success: true,
        message: 'Account activation link has been sent',
        data: null,
      });

      // Act
      await authController.sendActivationLink(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectSuccessResponse(res, {
        message: 'Account activation link has been sent',
        data: null,
      });
      AssertionHelpers.expectServiceCalledWith(mockAuthService, 'sendActivationLink', [email]);
    });

    it('should handle non-existent email', async () => {
      // Arrange
      const nonExistentEmail = 'nonexistent@example.com';
      req.body = { email: nonExistentEmail };

      const error = {
        statusCode: httpStatusCodes.NOT_FOUND,
        message: 'No record found with email provided.',
      };

      mockAuthService.sendActivationLink.mockRejectedValue(error);

      // Act & Assert
      await expect(authController.sendActivationLink(req as Request, res as Response))
        .rejects.toEqual(error);
    });
  });

  describe('POST /forgot-password', () => {
    it('should initiate password reset for valid email', async () => {
      // Arrange
      const email = 'test@example.com';
      req.body = { email };

      mockAuthService.forgotPassword.mockResolvedValue({
        success: true,
        message: 'Password reset email has been sent',
        data: null,
      });

      // Act
      await authController.forgotPassword(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectSuccessResponse(res, {
        message: 'Password reset email has been sent',
        data: null,
      });
      AssertionHelpers.expectServiceCalledWith(mockAuthService, 'forgotPassword', [email]);
    });
  });

  describe('POST /reset-password', () => {
    it('should reset password with valid token', async () => {
      // Arrange
      const token = 'valid-reset-token';
      const password = 'NewPassword123!';
      req.body = { token, password };

      mockAuthService.resetPassword.mockResolvedValue({
        success: true,
        message: 'Password has been reset successfully.',
        data: null,
      });

      // Act
      await authController.resetPassword(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectSuccessResponse(res, {
        message: 'Password has been reset successfully.',
        data: null,
      });
      AssertionHelpers.expectServiceCalledWith(mockAuthService, 'resetPassword', [token, password]);
    });
  });

  describe('GET /current-user', () => {
    it('should return current user when authenticated', async () => {
      // Arrange
      const userData = TestDataFactory.createUser();
      req = HttpTestHelpers.createAuthRequest(userData);

      // Act
      await authController.getCurrentUser(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectSuccessResponse(res, {
        success: 200,
        data: userData,
      });
    });

    it('should return unauthorized when not authenticated', async () => {
      // Arrange
      req = HttpTestHelpers.createUnauthenticatedRequest();

      // Act
      await authController.getCurrentUser(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectErrorResponse(res, httpStatusCodes.UNAUTHORIZED, 'Unauthorized');
    });
  });

  describe('POST /logout', () => {
    it('should logout user successfully', async () => {
      // Arrange
      req.cookies = {
        [JWT_KEY_NAMES.ACCESS_TOKEN]: 'Bearer mock-access-token',
      };

      mockAuthService.logout.mockResolvedValue({
        success: true,
        message: 'Logout successful.',
        data: null,
      });

      // Act
      await authController.logout(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectSuccessResponse(res, {
        message: 'Logout successful.',
        data: null,
      });
      AssertionHelpers.expectCookiesCleared(res);
      AssertionHelpers.expectServiceCalledWith(mockAuthService, 'logout', ['mock-access-token']);
    });

    it('should handle logout without token', async () => {
      // Arrange
      req.cookies = {};

      // Act & Assert
      await expect(authController.logout(req as Request, res as Response))
        .rejects.toThrow();
    });
  });

  describe('POST /switch-account', () => {
    it('should switch client account successfully', async () => {
      // Arrange
      const userData = TestDataFactory.createUser();
      const clientId = 'client-123';
      const tokens = TestDataFactory.createTokens();
      
      req = HttpTestHelpers.createAuthRequest(userData, {
        body: { clientId },
      });

      mockAuthService.switchActiveAccount.mockResolvedValue({
        success: true,
        message: 'Account switched successfully.',
        data: tokens,
      });

      res.cookie = jest.fn().mockReturnThis();

      // Act
      await authController.switchClientAccount(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectSuccessResponse(res, {
        msg: 'Account switched successfully.',
        activeAccount: tokens.activeAccount,
      });
      AssertionHelpers.expectServiceCalledWith(mockAuthService, 'switchActiveAccount', [userData.sub, clientId]);
    });

    it('should handle unauthorized switch attempt', async () => {
      // Arrange
      req = HttpTestHelpers.createUnauthenticatedRequest({
        body: { clientId: 'client-123' },
      });

      // Act
      await authController.switchClientAccount(req as Request, res as Response);

      // Assert
      AssertionHelpers.expectErrorResponse(res, httpStatusCodes.UNAUTHORIZED, 'Unauthorized');
    });
  });
});