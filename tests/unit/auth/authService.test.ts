import { Types } from 'mongoose';
import { AuthService } from '@services/auth/auth.service';
import { AuthTestFactory } from '@tests/utils/authTestHelpers';
import { TestDataFactory } from '@tests/utils/testHelpers';
import { UnauthorizedError, ForbiddenError, NotFoundError, BadRequestError } from '@shared/customErrors';

/**
 * Comprehensive AuthService Tests
 * 
 * This consolidated test suite covers:
 * - Basic authentication operations (login, signup, activation)
 * - Client connection management and multi-client scenarios
 * - Token validation with connection status
 * - Client access verification and switching
 * - Edge cases and error handling
 */

// Mock utilities
jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  generateShortUID: jest.fn(() => 'short-uid-123'),
  hashGenerator: jest.fn(() => 'hash-123'),
  getLocationDetails: jest.fn(() => ({ city: 'Test City', country: 'Test Country' })),
  JWT_KEY_NAMES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
  },
  JOB_NAME: {
    SEND_EMAIL: 'send_email',
  },
}));

describe('AuthService - Comprehensive Tests', () => {
  let authService: AuthService;
  let mockTokenService: any;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockEmailQueue: any;
  let mockAuthCache: any;

  beforeEach(() => {
    // Mock all dependencies
    mockTokenService = {
      createJwtTokens: jest.fn(),
      verifyJwtToken: jest.fn(),
      extractTokenFromRequest: jest.fn(),
      refreshAccessToken: jest.fn()
    };

    mockUserDAO = {
      getUserById: jest.fn(),
      getActiveUserByEmail: jest.fn(),
      verifyCredentials: jest.fn(),
      updateById: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn(),
      insert: jest.fn(),
      activateAccount: jest.fn(),
      createActivationToken: jest.fn(),
      createPasswordResetToken: jest.fn(),
      resetPassword: jest.fn()
    };

    mockClientDAO = {
      getClientByCid: jest.fn(),
      insert: jest.fn()
    };

    mockProfileDAO = {
      generateCurrentUserInfo: jest.fn(),
      createUserProfile: jest.fn()
    };

    mockEmailQueue = {
      addToEmailQueue: jest.fn()
    };

    mockAuthCache = {
      saveCurrentUser: jest.fn(),
      getCurrentUser: jest.fn(),
      deleteCurrentUser: jest.fn(),
      getUserSessions: jest.fn(),
      deleteUserSessions: jest.fn()
    };

    // Initialize AuthService with mocks
    authService = new AuthService({
      authTokenService: mockTokenService,
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emailQueue: mockEmailQueue,
      authCache: mockAuthCache
    });

    // Clear all mocks before each test
    jest.clearAllMocks();
  });

  describe('Basic Authentication Operations', () => {
    describe('Account Activation', () => {
      test('should successfully activate user account', async () => {
        const mockContext = TestDataFactory.createMockRequestContext();
        const activationData = {
          activationId: 'activation-123',
          activationCode: 'code-123'
        };

        mockUserDAO.activateAccount.mockResolvedValue({
          success: true,
          data: { sub: 'user-123', email: 'test@example.com' },
          message: 'Account activated successfully'
        });

        const result = await authService.accountActivation(mockContext, activationData);

        expect(mockUserDAO.activateAccount).toHaveBeenCalledWith(activationData);
        expect(result.success).toBe(true);
        expect(result.message).toBe('Account activated successfully');
      });

      test('should handle activation failure', async () => {
        const mockContext = TestDataFactory.createMockRequestContext();
        const activationData = {
          activationId: 'invalid-id',
          activationCode: 'invalid-code'
        };

        mockUserDAO.activateAccount.mockRejectedValue(
          new BadRequestError({ message: 'Invalid activation code' })
        );

        await expect(
          authService.accountActivation(mockContext, activationData)
        ).rejects.toThrow('Invalid activation code');
      });
    });

    describe('Send Activation Link', () => {
      test('should handle user not found scenario', async () => {
        const mockContext = TestDataFactory.createMockRequestContext();
        const email = 'nonexistent@example.com';

        mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);

        await expect(
          authService.sendActivationLink(mockContext, email)
        ).rejects.toThrow(NotFoundError);

        expect(mockUserDAO.getActiveUserByEmail).toHaveBeenCalledWith(email);
      });

      test('should successfully send activation link for existing user', async () => {
        const mockContext = TestDataFactory.createMockRequestContext();
        const email = 'test@example.com';
        const mockUser = TestDataFactory.createMockUser({
          email,
          isActive: false,
          emailVerified: false
        });

        mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);
        mockUserDAO.createActivationToken.mockResolvedValue('activation-token-123');
        mockEmailQueue.addToEmailQueue.mockResolvedValue(true);

        const result = await authService.sendActivationLink(mockContext, email);

        expect(mockUserDAO.getActiveUserByEmail).toHaveBeenCalledWith(email);
        expect(mockUserDAO.createActivationToken).toHaveBeenCalledWith(mockUser._id);
        expect(result.success).toBe(true);
      });
    });

    describe('Refresh Token', () => {
      test('should reject invalid refresh token', async () => {
        const mockContext = TestDataFactory.createMockRequestContext();
        const invalidToken = 'invalid-refresh-token';

        mockTokenService.verifyJwtToken.mockRejectedValue(
          new UnauthorizedError({ message: 'Invalid refresh token' })
        );

        await expect(
          authService.refreshToken(mockContext, invalidToken)
        ).rejects.toThrow('Invalid refresh token');

        expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith(invalidToken);
      });

      test('should successfully refresh valid token', async () => {
        const mockContext = TestDataFactory.createMockRequestContext();
        const validToken = 'valid-refresh-token';
        const mockTokenPayload = {
          sub: 'user-123',
          csub: 'client-123'
        };

        mockTokenService.verifyJwtToken.mockResolvedValue(mockTokenPayload);
        mockTokenService.refreshAccessToken.mockResolvedValue({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token'
        });

        const result = await authService.refreshToken(mockContext, validToken);

        expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith(validToken);
        expect(result.success).toBe(true);
        expect(result.data.accessToken).toBe('new-access-token');
      });
    });
  });

  describe('Client Connection Management', () => {
    describe('Login with Connection Filtering', () => {
      test('should allow login for user with connected clients', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithConnectedClients();
        const loginCredentials = { email: 'test@example.com', password: 'password123' };

        mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
        mockTokenService.createJwtTokens.mockResolvedValue({
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token'
        });
        mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
          AuthTestFactory.createMockCurrentUser(mockUser)
        );

        const result = await authService.login(mockContext, loginCredentials);

        expect(result.success).toBe(true);
        expect(mockUserDAO.verifyCredentials).toHaveBeenCalledWith(
          loginCredentials.email,
          loginCredentials.password
        );
      });

      test('should block login for user with no connected clients', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithDisconnectedClients();
        const loginCredentials = { email: 'test@example.com', password: 'password123' };

        mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);

        await expect(authService.login(mockContext, loginCredentials)).rejects.toThrow(
          ForbiddenError
        );
        expect(mockUserDAO.verifyCredentials).toHaveBeenCalledWith(
          loginCredentials.email,
          loginCredentials.password
        );
      });

      test('should filter disconnected clients from multi-client user', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithMixedClients();
        const loginCredentials = { email: 'test@example.com', password: 'password123' };

        mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
        mockTokenService.createJwtTokens.mockResolvedValue({
          accessToken: 'mock-access-token',
          refreshToken: 'mock-refresh-token'
        });
        mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
          AuthTestFactory.createMockCurrentUser(mockUser)
        );

        const result = await authService.login(mockContext, loginCredentials);

        expect(result.success).toBe(true);
        // Verify that only connected clients are included
        const currentUser = await mockProfileDAO.generateCurrentUserInfo.mock.calls[0][0];
        const connectedClients = currentUser.cids.filter(c => c.isConnected);
        expect(connectedClients.length).toBeGreaterThan(0);
      });

      test('should handle user with disconnected active client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithDisconnectedActiveClient();
        const loginCredentials = { email: 'test@example.com', password: 'password123' };

        mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);

        await expect(authService.login(mockContext, loginCredentials)).rejects.toThrow(
          ForbiddenError
        );
      });
    });

    describe('Token Validation with Connection Status', () => {
      test('should validate token with connection status check', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockToken = 'valid-jwt-token';
        const mockTokenPayload = {
          sub: 'user-123',
          csub: 'client-123'
        };
        const mockUser = AuthTestFactory.createMockUserWithConnectedClients();

        mockTokenService.verifyJwtToken.mockResolvedValue(mockTokenPayload);
        mockUserDAO.getUserById.mockResolvedValue(mockUser);
        mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
          AuthTestFactory.createMockCurrentUser(mockUser)
        );

        const result = await authService.validateTokenWithConnectionStatus(mockContext, mockToken);

        expect(result.success).toBe(true);
        expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith(mockToken);
        expect(mockUserDAO.getUserById).toHaveBeenCalledWith(mockTokenPayload.sub);
      });

      test('should reject token for disconnected client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockToken = 'valid-jwt-token';
        const mockTokenPayload = {
          sub: 'user-123',
          csub: 'disconnected-client-123'
        };
        const mockUser = AuthTestFactory.createMockUserWithDisconnectedClients();

        mockTokenService.verifyJwtToken.mockResolvedValue(mockTokenPayload);
        mockUserDAO.getUserById.mockResolvedValue(mockUser);

        await expect(
          authService.validateTokenWithConnectionStatus(mockContext, mockToken)
        ).rejects.toThrow(UnauthorizedError);
      });
    });

    describe('Client Switching with Connection Status', () => {
      test('should allow switching to connected client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithMixedClients();
        const targetClientId = 'connected-client-123';

        mockUserDAO.getUserById.mockResolvedValue(mockUser);
        mockClientDAO.getClientByCid.mockResolvedValue({ 
          _id: new Types.ObjectId(), 
          cid: targetClientId 
        });
        mockTokenService.createJwtTokens.mockResolvedValue({
          accessToken: 'new-access-token',
          refreshToken: 'new-refresh-token'
        });
        mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
          AuthTestFactory.createMockCurrentUser(mockUser, targetClientId)
        );

        const result = await authService.switchClient(mockContext, mockUser.sub, targetClientId);

        expect(result.success).toBe(true);
        expect(mockClientDAO.getClientByCid).toHaveBeenCalledWith(targetClientId);
      });

      test('should prevent switching to disconnected client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithMixedClients();
        const targetClientId = 'disconnected-client-123';

        mockUserDAO.getUserById.mockResolvedValue(mockUser);

        await expect(
          authService.switchClient(mockContext, mockUser.sub, targetClientId)
        ).rejects.toThrow(ForbiddenError);
      });

      test('should handle switching to non-existent client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithConnectedClients();
        const nonExistentClientId = 'non-existent-client';

        mockUserDAO.getUserById.mockResolvedValue(mockUser);

        await expect(
          authService.switchClient(mockContext, mockUser.sub, nonExistentClientId)
        ).rejects.toThrow(NotFoundError);
      });
    });

    describe('Client Access Verification', () => {
      test('should verify access to connected client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithConnectedClients();
        const clientId = 'connected-client-123';

        const result = await authService.verifyClientAccess(mockUser, clientId);

        expect(result).toBe(true);
      });

      test('should deny access to disconnected client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithDisconnectedClients();
        const clientId = 'disconnected-client-123';

        await expect(
          authService.verifyClientAccess(mockUser, clientId)
        ).rejects.toThrow(ForbiddenError);
      });

      test('should handle user without access to any client', async () => {
        const mockContext = AuthTestFactory.createMockRequestContext();
        const mockUser = AuthTestFactory.createMockUserWithoutClients();
        const clientId = 'any-client-123';

        await expect(
          authService.verifyClientAccess(mockUser, clientId)
        ).rejects.toThrow(UnauthorizedError);
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    test('should handle user with empty cids array', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const mockUser = {
        ...AuthTestFactory.createMockUserWithConnectedClients(),
        cids: []
      };
      const loginCredentials = { email: 'test@example.com', password: 'password123' };

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);

      await expect(authService.login(mockContext, loginCredentials)).rejects.toThrow(
        ForbiddenError
      );
    });

    test('should handle user with null connection status', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const mockUser = {
        ...AuthTestFactory.createMockUserWithConnectedClients(),
        cids: [
          {
            cid: 'client-123',
            roles: ['tenant'],
            displayName: 'Test Client',
            isConnected: null // null connection status
          }
        ]
      };
      const loginCredentials = { email: 'test@example.com', password: 'password123' };

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);

      await expect(authService.login(mockContext, loginCredentials)).rejects.toThrow(
        ForbiddenError
      );
    });

    test('should handle database errors gracefully', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const loginCredentials = { email: 'test@example.com', password: 'password123' };

      mockUserDAO.verifyCredentials.mockRejectedValue(new Error('Database connection failed'));

      await expect(authService.login(mockContext, loginCredentials)).rejects.toThrow(
        'Database connection failed'
      );
    });

    test('should handle token service errors', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const mockUser = AuthTestFactory.createMockUserWithConnectedClients();
      const loginCredentials = { email: 'test@example.com', password: 'password123' };

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
      mockTokenService.createJwtTokens.mockRejectedValue(new Error('Token generation failed'));

      await expect(authService.login(mockContext, loginCredentials)).rejects.toThrow(
        'Token generation failed'
      );
    });

    test('should handle cache service errors', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const mockUser = AuthTestFactory.createMockUserWithConnectedClients();
      const loginCredentials = { email: 'test@example.com', password: 'password123' };

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
      mockTokenService.createJwtTokens.mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token'
      });
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
        AuthTestFactory.createMockCurrentUser(mockUser)
      );
      mockAuthCache.saveCurrentUser.mockRejectedValue(new Error('Cache service unavailable'));

      // Should still succeed even if cache fails
      const result = await authService.login(mockContext, loginCredentials);
      expect(result.success).toBe(true);
    });
  });

  describe('Performance and Load Testing', () => {
    test('should handle rapid successive login attempts', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const mockUser = AuthTestFactory.createMockUserWithConnectedClients();
      const loginCredentials = { email: 'test@example.com', password: 'password123' };

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
      mockTokenService.createJwtTokens.mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token'
      });
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
        AuthTestFactory.createMockCurrentUser(mockUser)
      );

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(authService.login(mockContext, loginCredentials));
      }

      const results = await Promise.all(promises);
      expect(results.every(r => r.success)).toBe(true);
    });

    test('should handle user with many client connections', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const mockUser = AuthTestFactory.createMockUserWithManyClients(50);
      const loginCredentials = { email: 'test@example.com', password: 'password123' };

      mockUserDAO.verifyCredentials.mockResolvedValue(mockUser);
      mockTokenService.createJwtTokens.mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token'
      });
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(
        AuthTestFactory.createMockCurrentUser(mockUser)
      );

      const result = await authService.login(mockContext, loginCredentials);
      expect(result.success).toBe(true);
    });
  });

  describe('Security and Authorization', () => {
    test('should prevent unauthorized client access attempts', async () => {
      const mockUser = AuthTestFactory.createMockUserWithConnectedClients();
      const unauthorizedClientId = 'unauthorized-client-123';

      await expect(
        authService.verifyClientAccess(mockUser, unauthorizedClientId)
      ).rejects.toThrow(UnauthorizedError);
    });

    test('should validate token expiration properly', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const expiredToken = 'expired-jwt-token';

      mockTokenService.verifyJwtToken.mockRejectedValue(
        new UnauthorizedError({ message: 'Token has expired' })
      );

      await expect(
        authService.validateTokenWithConnectionStatus(mockContext, expiredToken)
      ).rejects.toThrow('Token has expired');
    });

    test('should handle malformed tokens', async () => {
      const mockContext = AuthTestFactory.createMockRequestContext();
      const malformedToken = 'malformed.jwt.token';

      mockTokenService.verifyJwtToken.mockRejectedValue(
        new UnauthorizedError({ message: 'Invalid token format' })
      );

      await expect(
        authService.validateTokenWithConnectionStatus(mockContext, malformedToken)
      ).rejects.toThrow('Invalid token format');
    });
  });
});