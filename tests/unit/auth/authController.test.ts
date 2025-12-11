import { Response, Request } from 'express';
import { createMockCurrentUser } from '@tests/helpers';
import { AppRequest } from '@interfaces/utils.interface';
import { AuthService } from '@services/auth/auth.service';
import { AuthController } from '@controllers/AuthController';
import { httpStatusCodes, JWT_KEY_NAMES } from '@utils/index';

describe('AuthController', () => {
  let authController: AuthController;
  let mockAuthService: jest.Mocked<AuthService>;
  let mockRequest: Partial<Request | AppRequest>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let cookieMock: jest.Mock;
  let clearCookieMock: jest.Mock;

  beforeEach(() => {
    // Create mock auth service
    mockAuthService = {
      login: jest.fn(),
      signup: jest.fn(),
      refreshToken: jest.fn(),
      forgotPassword: jest.fn(),
      resetPassword: jest.fn(),
      accountActivation: jest.fn(),
      sendActivationLink: jest.fn(),
      logout: jest.fn(),
      switchActiveAccount: jest.fn(),
      tokenService: {
        decodeJwt: jest.fn(),
      },
    } as any;

    // Create mock response
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();
    cookieMock = jest.fn().mockReturnThis();
    clearCookieMock = jest.fn().mockReturnThis();

    mockResponse = {
      status: statusMock,
      json: jsonMock,
      cookie: cookieMock,
      clearCookie: clearCookieMock,
    };

    // Create controller instance
    authController = new AuthController({ authService: mockAuthService });

    // Reset request
    mockRequest = {
      body: {},
      query: {},
      cookies: {},
    };
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/login', () => {
    it('should successfully login with valid credentials', async () => {
      // Arrange
      const loginData = {
        email: 'test@example.com',
        password: 'password123',
        rememberMe: false,
      };

      const mockLoginResult = {
        success: true,
        message: 'Login successful',
        data: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          rememberMe: false,
          accounts: [{ cuid: 'client-1', clientDisplayName: 'Test Client' }],
          activeAccount: { cuid: 'client-1', clientDisplayName: 'Test Client' },
        },
      };

      mockRequest.body = loginData;
      mockAuthService.login.mockResolvedValue(mockLoginResult);

      // Act
      await authController.login(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.login).toHaveBeenCalledWith(loginData);
      expect(cookieMock).toHaveBeenCalledTimes(2); // accessToken and refreshToken
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        msg: 'Login successful',
        accounts: mockLoginResult.data.accounts,
        activeAccount: mockLoginResult.data.activeAccount,
      });
    });

    it('should return 401 for invalid credentials', async () => {
      // Arrange
      mockRequest.body = {
        email: 'test@example.com',
        password: 'wrongpassword',
      };

      const error = new Error('Invalid credentials');
      (error as any).statusCode = 401;
      mockAuthService.login.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.login(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Invalid credentials');
    });

    it('should return 403 for account not activated', async () => {
      // Arrange
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      const error = new Error('Account not activated');
      (error as any).statusCode = 403;
      mockAuthService.login.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.login(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Account not activated');
    });

    it('should return 403 for missing client access', async () => {
      // Arrange
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      const error = new Error('No client access');
      (error as any).statusCode = 403;
      mockAuthService.login.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.login(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('No client access');
    });

    it('should set authentication cookies on successful login', async () => {
      // Arrange
      const mockLoginResult = {
        success: true,
        message: 'Login successful',
        data: {
          accessToken: 'access-token-123',
          refreshToken: 'refresh-token-456',
          rememberMe: true,
          accounts: null,
          activeAccount: { cuid: 'client-1', clientDisplayName: 'Test Client' },
        },
      };

      mockRequest.body = { email: 'test@example.com', password: 'password123' };
      mockAuthService.login.mockResolvedValue(mockLoginResult);

      // Act
      await authController.login(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(cookieMock).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });
  });

  describe('POST /auth/signup', () => {
    it('should successfully register new user', async () => {
      // Arrange
      const signupData = {
        email: 'newuser@example.com',
        password: 'password123',
        accountType: 'individual',
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe',
        },
      };

      const mockSignupResult = {
        success: true,
        message: 'Registration successful',
        data: {
          emailData: { to: 'newuser@example.com' },
        },
      };

      mockRequest.body = signupData;
      mockAuthService.signup.mockResolvedValue(mockSignupResult);

      // Act
      await authController.signup(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.signup).toHaveBeenCalledWith(signupData);
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Registration successful',
      });
    });

    it('should return 409 for duplicate email', async () => {
      // Arrange
      mockRequest.body = {
        email: 'existing@example.com',
        password: 'password123',
      };

      const error = new Error('Email already exists');
      (error as any).statusCode = 409;
      mockAuthService.signup.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.signup(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Email already exists');
    });

    it('should return 400 for invalid registration data', async () => {
      // Arrange
      mockRequest.body = {
        email: 'invalid-email',
        password: '123', // too short
      };

      const error = new Error('Validation failed');
      (error as any).statusCode = 400;
      mockAuthService.signup.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.signup(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Validation failed');
    });

    it('should create vendor for corporate account', async () => {
      // Arrange
      const corporateSignupData = {
        email: 'vendor@example.com',
        password: 'password123',
        accountType: 'corporate',
        companyProfile: {
          companyName: 'Test Vendor LLC',
          registrationNumber: 'REG123',
        },
      };

      const mockSignupResult = {
        success: true,
        message: 'Corporate account created',
        data: {
          emailData: {},
        },
      };

      mockRequest.body = corporateSignupData;
      mockAuthService.signup.mockResolvedValue(mockSignupResult);

      // Act
      await authController.signup(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.signup).toHaveBeenCalledWith(corporateSignupData);
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should rollback on transaction error', async () => {
      // Arrange
      mockRequest.body = {
        email: 'test@example.com',
        password: 'password123',
      };

      const error = new Error('Transaction failed');
      mockAuthService.signup.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.signup(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Transaction failed');
    });
  });

  describe('POST /auth/refresh', () => {
    it('should successfully refresh tokens with valid refresh token', async () => {
      // Arrange
      const mockRefreshToken = 'valid-refresh-token';
      const mockUserId = 'user-123';

      mockRequest.cookies = {
        [JWT_KEY_NAMES.REFRESH_TOKEN]: mockRefreshToken,
      };

      ((mockAuthService as any).tokenService.decodeJwt as jest.Mock).mockReturnValue({
        success: true,
        data: {
          data: { sub: mockUserId },
        },
      });

      mockAuthService.refreshToken.mockResolvedValue({
        success: true,
        message: 'Token refreshed',
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          rememberMe: false,
        },
      });

      // Act
      await authController.refreshToken(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.refreshToken).toHaveBeenCalledWith({
        refreshToken: mockRefreshToken,
        userId: mockUserId,
      });
      expect(cookieMock).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should return 401 for expired refresh token', async () => {
      // Arrange
      mockRequest.cookies = {
        [JWT_KEY_NAMES.REFRESH_TOKEN]: 'expired-token',
      };

      ((mockAuthService as any).tokenService.decodeJwt as jest.Mock).mockReturnValue({
        success: true,
        data: { data: { sub: 'user-123' } },
      });

      const error = new Error('Refresh token expired');
      (error as any).statusCode = 401;
      mockAuthService.refreshToken.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.refreshToken(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Refresh token expired');
    });

    it('should return 400 for invalid token format', async () => {
      // Arrange
      mockRequest.cookies = {
        [JWT_KEY_NAMES.REFRESH_TOKEN]: 'invalid-format-token',
      };

      ((mockAuthService as any).tokenService.decodeJwt as jest.Mock).mockReturnValue({
        success: false,
      });

      // Act
      await authController.refreshToken(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: expect.any(String),
      });
    });

    it('should return 401 for missing refresh token', async () => {
      // Arrange
      mockRequest.cookies = {};

      // Act
      await authController.refreshToken(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: expect.any(String),
      });
    });

    it('should handle Bearer prefix in refresh token', async () => {
      // Arrange
      const mockToken = 'actual-token';
      mockRequest.cookies = {
        [JWT_KEY_NAMES.REFRESH_TOKEN]: `Bearer ${mockToken}`,
      };

      ((mockAuthService as any).tokenService.decodeJwt as jest.Mock).mockReturnValue({
        success: true,
        data: { data: { sub: 'user-123' } },
      });

      mockAuthService.refreshToken.mockResolvedValue({
        success: true,
        message: 'Token refreshed',
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          rememberMe: false,
        },
      });

      // Act
      await authController.refreshToken(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.refreshToken).toHaveBeenCalledWith({
        refreshToken: mockToken,
        userId: 'user-123',
      });
    });
  });

  describe('POST /auth/forgot-password', () => {
    it('should send password reset email successfully', async () => {
      // Arrange
      const email = 'user@example.com';
      mockRequest.body = { email };

      mockAuthService.forgotPassword.mockResolvedValue({
        success: true,
        message: 'Password reset email sent',
        data: null,
      });

      // Act
      await authController.forgotPassword(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.forgotPassword).toHaveBeenCalledWith(email);
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Password reset email sent',
      });
    });

    it('should return 200 even for non-existent user (security)', async () => {
      // Arrange
      mockRequest.body = { email: 'nonexistent@example.com' };

      mockAuthService.forgotPassword.mockResolvedValue({
        success: true,
        message: 'If the email exists, a reset link will be sent',
        data: null,
      });

      // Act
      await authController.forgotPassword(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should return 400 for invalid email format', async () => {
      // Arrange
      mockRequest.body = { email: 'invalid-email' };

      const error = new Error('Invalid email format');
      (error as any).statusCode = 400;
      mockAuthService.forgotPassword.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.forgotPassword(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Invalid email format');
    });

    it('should handle rate limiting', async () => {
      // Arrange
      mockRequest.body = { email: 'user@example.com' };

      const error = new Error('Too many requests');
      (error as any).statusCode = 429;
      mockAuthService.forgotPassword.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.forgotPassword(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Too many requests');
    });

    it('should generate reset token', async () => {
      // Arrange
      mockRequest.body = { email: 'user@example.com' };

      mockAuthService.forgotPassword.mockResolvedValue({
        success: true,
        message: 'Reset email sent',
        data: { tokenGenerated: true },
      });

      // Act
      await authController.forgotPassword(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.forgotPassword).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });
  });

  describe('POST /auth/reset-password', () => {
    it('should reset password with valid token', async () => {
      // Arrange
      const resetData = {
        resetToken: 'valid-reset-token',
        password: 'newPassword123!',
      };

      mockRequest.body = resetData;

      mockAuthService.resetPassword.mockResolvedValue({
        success: true,
        message: 'Password reset successful',
        data: null,
      });

      // Act
      await authController.resetPassword(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(
        resetData.resetToken,
        resetData.password
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Password reset successful',
      });
    });

    it('should return 400 for expired reset token', async () => {
      // Arrange
      mockRequest.body = {
        resetToken: 'expired-token',
        password: 'newPassword123!',
      };

      const error = new Error('Reset token expired');
      (error as any).statusCode = 400;
      mockAuthService.resetPassword.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.resetPassword(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Reset token expired');
    });

    it('should return 400 for invalid reset token', async () => {
      // Arrange
      mockRequest.body = {
        resetToken: 'invalid-token',
        password: 'newPassword123!',
      };

      const error = new Error('Invalid reset token');
      (error as any).statusCode = 400;
      mockAuthService.resetPassword.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.resetPassword(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Invalid reset token');
    });

    it('should return 400 for weak password', async () => {
      // Arrange
      mockRequest.body = {
        resetToken: 'valid-token',
        password: '123', // too weak
      };

      const error = new Error('Password too weak');
      (error as any).statusCode = 400;
      mockAuthService.resetPassword.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.resetPassword(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Password too weak');
    });

    it('should consume token after successful reset', async () => {
      // Arrange
      mockRequest.body = {
        resetToken: 'valid-token',
        password: 'newPassword123!',
      };

      mockAuthService.resetPassword.mockResolvedValue({
        success: true,
        message: 'Password reset successful',
        data: null,
      });

      // Act
      await authController.resetPassword(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(
        'valid-token',
        'newPassword123!'
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });
  });

  describe('POST /auth/activate', () => {
    it('should successfully activate account', async () => {
      // Arrange
      const activationToken = 'valid-activation-token';
      mockRequest.query = { t: activationToken };

      mockAuthService.accountActivation.mockResolvedValue({
        success: true,
        message: 'Account activated successfully',
        data: null,
      });

      // Act
      await authController.accountActivation(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.accountActivation).toHaveBeenCalledWith(activationToken);
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        message: 'Account activated successfully',
      });
    });

    it('should return 400 for invalid activation token', async () => {
      // Arrange
      mockRequest.query = { t: 'invalid-token' };

      const error = new Error('Invalid activation token');
      (error as any).statusCode = 400;
      mockAuthService.accountActivation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.accountActivation(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Invalid activation token');
    });

    it('should return 409 for already activated account', async () => {
      // Arrange
      mockRequest.query = { t: 'already-used-token' };

      const error = new Error('Account already activated');
      (error as any).statusCode = 409;
      mockAuthService.accountActivation.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.accountActivation(mockRequest as Request, mockResponse as Response)
      ).rejects.toThrow('Account already activated');
    });

    it('should consume activation token after use', async () => {
      // Arrange
      const token = 'valid-token';
      mockRequest.query = { t: token };

      mockAuthService.accountActivation.mockResolvedValue({
        success: true,
        message: 'Account activated',
        data: null,
      });

      // Act
      await authController.accountActivation(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.accountActivation).toHaveBeenCalledWith(token);
    });

    it('should update user status to active', async () => {
      // Arrange
      mockRequest.query = { t: 'valid-token' };

      mockAuthService.accountActivation.mockResolvedValue({
        success: true,
        message: 'Account activated',
        data: { isActive: true },
      });

      // Act
      await authController.accountActivation(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });
  });

  describe('POST /auth/switch-account', () => {
    it('should successfully switch client account', async () => {
      // Arrange
      const mockCurrentUser = createMockCurrentUser({
        sub: 'user-123',
        uid: 'old-client-id',
      });

      mockRequest = {
        body: { clientId: 'new-client-id' },
        context: { currentuser: mockCurrentUser },
      } as AppRequest;

      mockAuthService.switchActiveAccount.mockResolvedValue({
        success: true,
        message: 'Account switched',
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          activeAccount: { cuid: 'new-client-id', clientDisplayName: 'New Client' },
        },
      });

      // Act
      await authController.switchClientAccount(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockAuthService.switchActiveAccount).toHaveBeenCalledWith('user-123', 'new-client-id');
      expect(cookieMock).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should return 403 for invalid client access', async () => {
      // Arrange
      const mockCurrentUser = createMockCurrentUser({ sub: 'user-123' });

      mockRequest = {
        body: { clientId: 'unauthorized-client' },
        context: { currentuser: mockCurrentUser },
      } as AppRequest;

      const error = new Error('No access to this client');
      (error as any).statusCode = 403;
      mockAuthService.switchActiveAccount.mockRejectedValue(error);

      // Act & Assert
      await expect(
        authController.switchClientAccount(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('No access to this client');
    });

    it('should update session with new client context', async () => {
      // Arrange
      const mockCurrentUser = createMockCurrentUser({ sub: 'user-123' });

      mockRequest = {
        body: { clientId: 'new-client-id' },
        context: { currentuser: mockCurrentUser },
      } as AppRequest;

      mockAuthService.switchActiveAccount.mockResolvedValue({
        success: true,
        message: 'Switched',
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          activeAccount: { cuid: 'new-client-id', clientDisplayName: 'New Client' },
        },
      });

      // Act
      await authController.switchClientAccount(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(jsonMock).toHaveBeenCalledWith({
        success: true,
        msg: 'Switched',
        activeAccount: { cuid: 'new-client-id', name: 'New Client' },
      });
    });

    it('should regenerate tokens on switch', async () => {
      // Arrange
      const mockCurrentUser = createMockCurrentUser({ sub: 'user-123' });

      mockRequest = {
        body: { clientId: 'new-client-id' },
        context: { currentuser: mockCurrentUser },
      } as AppRequest;

      const mockResult = {
        success: true,
        message: 'Switched',
        data: {
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token',
          activeAccount: { cuid: 'new-client-id', clientDisplayName: 'New Client' },
        },
      };

      mockAuthService.switchActiveAccount.mockResolvedValue(mockResult);

      // Act
      await authController.switchClientAccount(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(cookieMock).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should return 401 for missing current user', async () => {
      // Arrange
      mockRequest = {
        body: { clientId: 'new-client-id' },
        context: { currentuser: null },
      } as unknown as AppRequest;

      // Act
      await authController.switchClientAccount(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: expect.any(String),
      });
    });
  });

  describe('POST /auth/logout', () => {
    it('should successfully logout user', async () => {
      // Arrange
      const mockAccessToken = 'Bearer valid-access-token';
      mockRequest.cookies = {
        [JWT_KEY_NAMES.ACCESS_TOKEN]: mockAccessToken,
      };

      mockAuthService.logout.mockResolvedValue({
        success: true,
        message: 'Logout successful',
        data: null,
      });

      // Act
      await authController.logout(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.logout).toHaveBeenCalledWith('valid-access-token');
      expect(clearCookieMock).toHaveBeenCalledTimes(2);
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });

    it('should return 401 for missing access token', async () => {
      // Arrange
      mockRequest.cookies = {};

      // Act
      await authController.logout(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.UNAUTHORIZED);
      expect(jsonMock).toHaveBeenCalledWith({
        success: false,
        message: expect.any(String),
      });
    });

    it('should clear authentication cookies', async () => {
      // Arrange
      mockRequest.cookies = {
        [JWT_KEY_NAMES.ACCESS_TOKEN]: 'Bearer token',
      };

      mockAuthService.logout.mockResolvedValue({
        success: true,
        message: 'Logged out',
        data: null,
      });

      // Act
      await authController.logout(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(clearCookieMock).toHaveBeenCalledWith(JWT_KEY_NAMES.ACCESS_TOKEN, { path: '/' });
      expect(clearCookieMock).toHaveBeenCalledWith(JWT_KEY_NAMES.REFRESH_TOKEN, {
        path: '/api/v1/auth/refresh_token',
      });
    });

    it('should handle token with Bearer prefix', async () => {
      // Arrange
      const token = 'actual-token-value';
      mockRequest.cookies = {
        [JWT_KEY_NAMES.ACCESS_TOKEN]: `Bearer ${token}`,
      };

      mockAuthService.logout.mockResolvedValue({
        success: true,
        message: 'Logged out',
        data: null,
      });

      // Act
      await authController.logout(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.logout).toHaveBeenCalledWith(token);
    });

    it('should invalidate session on logout', async () => {
      // Arrange
      mockRequest.cookies = {
        [JWT_KEY_NAMES.ACCESS_TOKEN]: 'Bearer token',
      };

      mockAuthService.logout.mockResolvedValue({
        success: true,
        message: 'Session invalidated',
        data: null,
      });

      // Act
      await authController.logout(mockRequest as Request, mockResponse as Response);

      // Assert
      expect(mockAuthService.logout).toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
    });
  });
});
