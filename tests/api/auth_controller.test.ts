/* eslint-disable */
import { v4 as uuidv4 } from 'uuid';
import { appRequest } from '@tests/utils';
import { httpStatusCodes } from '@utils/index';
import { mockAuthService } from '@tests/mocks/di/mocks';

// Create a custom type for API errors
interface ApiError {
  statusCode: number;
  message: string;
  errors?: string[];
}

const baseUrl = '/api/v1/auth';

xdescribe('Auth API Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /auth/signup', () => {
    it('should successfully create a new user', async () => {
      const signupData = {
        email: 'test@example.com',
        password: 'Password123!',
        firstName: 'Test',
        lastName: 'User',
        displayName: 'testuser',
        phoneNumber: '+12345678901',
        location: 'New York',
        accountType: {
          planId: 'basic',
          planName: 'Basic Plan',
          isEnterpriseAccount: false,
        },
      };

      mockAuthService.signup.mockReturnValue({
        success: true,
        msg: 'Account activation email has been sent to test@example.com',
        data: null,
      });

      const response = await appRequest.post(`${baseUrl}/signup`).send(signupData);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toContain('Account activation email has been sent');

      expect(mockAuthService.signup).toHaveBeenCalledWith(signupData);
    });

    it('should handle validation errors during signup', async () => {
      const invalidData = {
        email: 'invalid-email',
        password: 'short',
      };

      const apiError: ApiError = {
        statusCode: httpStatusCodes.BAD_REQUEST,
        message: 'Validation failed',
        errors: ['Email must be a valid email address', 'Password must be at least 8 characters'],
      };

      mockAuthService.signup.mockRejectedValue(apiError as unknown as never);

      const response = await appRequest.post(`${baseUrl}/signup`).send(invalidData);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body.success).toBe(false);
      expect(response.body.errors).toBeDefined();
    });
  });

  describe('POST /auth/login', () => {
    it('should successfully log in a user with valid credentials', async () => {
      const loginData = {
        email: 'test@example.com',
        password: 'Password123!',
      };

      const mockClientId = uuidv4();

      // Mock login service response
      mockAuthService.login.mockReturnValue({
        success: true,
        msg: 'Login successful.',
        data: {
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token',
          activeAccount: {
            cid: mockClientId,
            displayName: 'Test User',
          },
          accounts: null,
        },
      });

      const response = await appRequest.post(`${baseUrl}/login`).send(loginData);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toBe('Login successful.');
      expect(response.body.accounts).toBe(null);
      expect(response.body.activeAccount).toEqual({
        cid: mockClientId,
        displayName: 'Test User',
      });

      // Check for auth cookies in response
      expect(response.headers['set-cookie']).toBeDefined();

      // Verify service was called with correct data
      expect(mockAuthService.login).toHaveBeenCalledWith(loginData.email, loginData.password);
    });

    it('should return error for invalid credentials', async () => {
      const invalidLoginData = {
        email: 'test@example.com',
        password: 'WrongPassword',
      };

      // mockAuthService.login.mockRejectedValueOnce({
      //   statusCode: httpStatusCodes.NOT_FOUND,
      //   message: 'Invalid email/password combination.',
      // });

      const response = await appRequest.post(`${baseUrl}/login`).send(invalidLoginData);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
      expect(response.body.msg).toBe('Invalid email/password combination.');
    });

    it('should handle unverified accounts', async () => {
      const unverifiedLoginData = {
        email: 'unverified@example.com',
        password: 'Password123!',
      };

      // mockAuthService.login.mockRejectedValueOnce({
      //   statusCode: httpStatusCodes.BAD_REQUEST,
      //   message: 'Account verification pending.',
      // });

      const response = await appRequest.post(`${baseUrl}/login`).send(unverifiedLoginData);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body.success).toBe(false);
      expect(response.body.msg).toBe('Account verification pending.');
    });
  });

  describe('GET /auth/account/activate', () => {
    it('should successfully activate a user account with valid token', async () => {
      const activationToken = 'valid-activation-token';

      mockAuthService.accountActivation.mockReturnValue({
        success: true,
        msg: 'Account activated successfully.',
        data: null,
      });

      const response = await appRequest
        .get(`${baseUrl}/account/activate`)
        .query({ t: activationToken });

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toBe('Account activated successfully.');

      // Verify service was called with token
      expect(mockAuthService.accountActivation).toHaveBeenCalledWith(activationToken);
    });

    it('should handle invalid activation token', async () => {
      const invalidToken = 'invalid-token';

      // mockAuthService.accountActivation.mockRejectedValueOnce({
      //   statusCode: httpStatusCodes.NOT_FOUND,
      //   message: 'Invalid or expired activation token.',
      // });

      const response = await appRequest
        .get(`${baseUrl}/account/activate`)
        .query({ t: invalidToken });

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
      expect(response.body.msg).toBe('Invalid or expired activation token.');
    });
  });

  describe('POST /auth/activation/resend', () => {
    it('should resend activation link for valid email', async () => {
      const requestData = {
        email: 'test@example.com',
      };

      // Mock service response
      mockAuthService.sendActivationLink.mockReturnValue({
        success: true,
        msg: 'Account activation link has been sent to test@example.com',
        data: null,
      });

      const response = await appRequest.post(`${baseUrl}/activation/resend`).send(requestData);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toContain('Account activation link has been sent');

      // Verify service was called with email
      expect(mockAuthService.sendActivationLink).toHaveBeenCalledWith(requestData.email);
    });

    it('should handle non-existent email for activation resend', async () => {
      const requestData = {
        email: 'nonexistent@example.com',
      };

      // mockAuthService.sendActivationLink.mockRejectedValueOnce({
      //   statusCode: httpStatusCodes.NOT_FOUND,
      //   message: 'No record found with email provided.',
      // });

      const response = await appRequest.post(`${baseUrl}/activation/resend`).send(requestData);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
      expect(response.body.msg).toBe('No record found with email provided.');
    });
  });

  describe('POST /auth/password/forgot', () => {
    it('should initiate password reset for valid email', async () => {
      const requestData = {
        email: 'test@example.com',
      };

      // Mock service response
      mockAuthService.forgotPassword.mockReturnValue({
        success: true,
        msg: 'Password reset email has been sent to test@example.com',
        data: null,
      });

      const response = await appRequest.post(`${baseUrl}/password/forgot`).send(requestData);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toContain('Password reset email has been sent');

      // Verify service was called with email
      expect(mockAuthService.forgotPassword).toHaveBeenCalledWith(requestData.email);
    });

    it('should handle non-existent email for password reset', async () => {
      const requestData = {
        email: 'nonexistent@example.com',
      };

      // mockAuthService.forgotPassword.mockRejectedValueOnce({
      //   statusCode: httpStatusCodes.NOT_FOUND,
      //   message: 'No record found with email provided.',
      // });

      const response = await appRequest.post(`${baseUrl}/password/forgot`).send(requestData);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
      expect(response.body.msg).toBe('No record found with email provided.');
    });
  });

  describe('POST /auth/password/reset', () => {
    it('should successfully reset password with valid token', async () => {
      const requestData = {
        token: 'valid-reset-token',
        password: 'NewPassword123!',
      };

      // Mock service response
      mockAuthService.resetPassword.mockReturnValue({
        success: true,
        msg: 'Password has been reset successfully.',
        data: null,
      });

      const response = await appRequest.post(`${baseUrl}/password/reset`).send(requestData);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toBe('Password has been reset successfully.');

      // Verify service was called with token and password
      expect(mockAuthService.resetPassword).toHaveBeenCalledWith(
        requestData.token,
        requestData.password
      );
    });

    it('should handle invalid or expired password reset token', async () => {
      const requestData = {
        token: 'invalid-token',
        password: 'NewPassword123!',
      };

      const response = await appRequest.post(`${baseUrl}/password/reset`).send(requestData);

      expect(response.status).toBe(httpStatusCodes.NOT_FOUND);
      expect(response.body.success).toBe(false);
      expect(response.body.msg).toBe('Invalid or expired password reset token.');
    });

    it('should validate password requirements', async () => {
      const requestData = {
        token: 'valid-token',
        password: 'weak',
      };

      const response = await appRequest.post(`${baseUrl}/password/reset`).send(requestData);

      expect(response.status).toBe(httpStatusCodes.BAD_REQUEST);
      expect(response.body.success).toBe(false);
      expect(response.body.msg).toContain('Password must be');
    });
  });

  describe('GET /auth/me', () => {
    it('should return the current user information when authenticated', async () => {
      const mockUserData = {
        _id: 'user-id',
        email: 'test@example.com',
        displayName: 'Test User',
        profile: {
          personalInfo: {
            firstName: 'Test',
            lastName: 'User',
          },
        },
      };

      // Mock the auth middleware setting the user
      jest.spyOn(appRequest, 'get').mockImplementationOnce((...args) => {
        const originalGet = jest
          .requireActual('supertest')
          .agent(jest.requireActual('express')()).get;
        const req = originalGet.apply(this, args);
        req.set('Authorization', 'Bearer mock-token');
        return req;
      });

      mockAuthService.getCurrentUser.mockReturnValue({
        success: true,
        data: mockUserData,
      });

      const response = await appRequest.get(`${baseUrl}/me`);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockUserData);
    });

    it('should return unauthorized error when not authenticated', async () => {
      const response = await appRequest.get(`${baseUrl}/me`);

      expect(response.status).toBe(httpStatusCodes.UNAUTHORIZED);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /auth/logout', () => {
    it('should successfully log out the user', async () => {
      // Mock the auth token in cookies
      jest.spyOn(appRequest, 'post').mockImplementationOnce((...args) => {
        const originalPost = jest
          .requireActual('supertest')
          .agent(jest.requireActual('express')()).post;
        const req = originalPost.apply(this, args);
        req.set('Cookie', ['access_token=mock-token']);
        return req;
      });

      mockAuthService.logout.mockReturnValue({
        success: true,
        message: 'Logout successful.',
        data: null,
      });

      const response = await appRequest.post(`${baseUrl}/logout`);

      expect(response.status).toBe(httpStatusCodes.OK);
      expect(response.body.success).toBe(true);
      expect(response.body.msg).toBe('Logout successful.');

      // Verify cookies have been cleared
      expect(response.headers['set-cookie']).toBeDefined();
    });
  });
});
