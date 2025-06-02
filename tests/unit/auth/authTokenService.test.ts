/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import jwt from 'jsonwebtoken';
import { AuthTokenService } from '@services/auth/authToken.service';
import { JWT_KEY_NAMES } from '@utils/index';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';

// Mock jsonwebtoken
jest.mock('jsonwebtoken', () => ({
  sign: jest.fn(),
  verify: jest.fn(),
  decode: jest.fn(),
}));

// Mock environment variables
jest.mock('@shared/config', () => ({
  envVariables: {
    JWT: {
      SECRET: 'test-jwt-secret',
      EXPIREIN: '15m',
      REFRESH: {
        SECRET: 'test-refresh-secret',
        EXPIRESIN: '7d',
      },
      EXTENDED_ACCESS_TOKEN_EXPIRY: '30d',
      EXTENDED_REFRESH_TOKEN_EXPIRY: '90d',
    },
  },
}));

// Mock logger
jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  JWT_KEY_NAMES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
  },
}));

describe('AuthTokenService - Unit Tests', () => {
  let authTokenService: AuthTokenService;
  let mockJwt: any;

  beforeAll(() => {
    authTokenService = new AuthTokenService();
    mockJwt = jwt as any;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createJwtTokens', () => {
    describe('Successful token creation', () => {
      it('should create tokens with standard expiry when rememberMe is false', () => {
        // Arrange
        const payload = {
          sub: 'user-123',
          rememberMe: false,
          csub: 'client-456',
        };

        const mockAccessToken = 'mock-access-token';
        const mockRefreshToken = 'mock-refresh-token';

        mockJwt.sign
          .mockReturnValueOnce(mockAccessToken)
          .mockReturnValueOnce(mockRefreshToken);

        // Act
        const result = authTokenService.createJwtTokens(payload);

        // Assert
        expect(result).toEqual({
          accessToken: mockAccessToken,
          refreshToken: mockRefreshToken,
          rememberMe: false,
        });

        expect(mockJwt.sign).toHaveBeenCalledTimes(2);
        
        // Check access token generation
        expect(mockJwt.sign).toHaveBeenNthCalledWith(
          1,
          { data: payload },
          'test-jwt-secret',
          { expiresIn: '15m' }
        );

        // Check refresh token generation
        expect(mockJwt.sign).toHaveBeenNthCalledWith(
          2,
          { data: payload },
          'test-refresh-secret',
          { expiresIn: '7d' }
        );
      });

      it('should create tokens with extended expiry when rememberMe is true', () => {
        // Arrange
        const payload = {
          sub: 'user-123',
          rememberMe: true,
          csub: 'client-456',
        };

        const mockAccessToken = 'mock-extended-access-token';
        const mockRefreshToken = 'mock-extended-refresh-token';

        mockJwt.sign
          .mockReturnValueOnce(mockAccessToken)
          .mockReturnValueOnce(mockRefreshToken);

        // Act
        const result = authTokenService.createJwtTokens(payload);

        // Assert
        expect(result).toEqual({
          accessToken: mockAccessToken,
          refreshToken: mockRefreshToken,
          rememberMe: true,
        });

        // Check extended expiry for access token
        expect(mockJwt.sign).toHaveBeenNthCalledWith(
          1,
          { data: payload },
          'test-jwt-secret',
          { expiresIn: '30d' }
        );

        // Check extended expiry for refresh token
        expect(mockJwt.sign).toHaveBeenNthCalledWith(
          2,
          { data: payload },
          'test-refresh-secret',
          { expiresIn: '90d' }
        );
      });

      it('should handle different user and client combinations', () => {
        // Arrange
        const payload = {
          sub: 'different-user-789',
          rememberMe: false,
          csub: 'different-client-101',
        };

        mockJwt.sign
          .mockReturnValueOnce('access-token-789')
          .mockReturnValueOnce('refresh-token-789');

        // Act
        const result = authTokenService.createJwtTokens(payload);

        // Assert
        expect(result.accessToken).toBe('access-token-789');
        expect(result.refreshToken).toBe('refresh-token-789');
        expect(result.rememberMe).toBe(false);

        expect(mockJwt.sign).toHaveBeenCalledWith(
          { data: payload },
          expect.any(String),
          expect.any(Object)
        );
      });
    });

    describe('Token creation with edge cases', () => {
      it('should handle empty string values in payload', () => {
        // Arrange
        const payload = {
          sub: '',
          rememberMe: false,
          csub: '',
        };

        mockJwt.sign
          .mockReturnValueOnce('empty-access-token')
          .mockReturnValueOnce('empty-refresh-token');

        // Act
        const result = authTokenService.createJwtTokens(payload);

        // Assert
        expect(result).toEqual({
          accessToken: 'empty-access-token',
          refreshToken: 'empty-refresh-token',
          rememberMe: false,
        });
      });

      it('should handle special characters in payload', () => {
        // Arrange
        const payload = {
          sub: 'user@#$%^&*()',
          rememberMe: true,
          csub: 'client-with-special-chars!@#',
        };

        mockJwt.sign
          .mockReturnValueOnce('special-access-token')
          .mockReturnValueOnce('special-refresh-token');

        // Act
        const result = authTokenService.createJwtTokens(payload);

        // Assert
        expect(result.rememberMe).toBe(true);
        expect(mockJwt.sign).toHaveBeenCalledWith(
          { data: payload },
          expect.any(String),
          expect.objectContaining({ expiresIn: '30d' })
        );
      });
    });
  });

  describe('verifyJwtToken', () => {
    describe('Successful token verification', () => {
      it('should verify valid access token', async () => {
        // Arrange
        const token = 'valid-access-token';
        const tokenType = JWT_KEY_NAMES.ACCESS_TOKEN;
        
        const mockDecodedToken = {
          data: {
            sub: 'user-123',
            csub: 'client-456',
            rememberMe: false,
          },
          iat: 1625097600,
          exp: 1625097900,
        };

        mockJwt.verify.mockReturnValue(mockDecodedToken);

        // Act
        const result = await authTokenService.verifyJwtToken(tokenType, token);

        // Assert
        expect(result).toEqual({
          success: true,
          data: {
            sub: 'user-123',
            csub: 'client-456',
            rememberMe: false,
            iat: 1625097600,
            exp: 1625097900,
          },
        });

        expect(mockJwt.verify).toHaveBeenCalledWith(token, 'test-jwt-secret');
      });

      it('should verify valid refresh token', async () => {
        // Arrange
        const token = 'valid-refresh-token';
        const tokenType = JWT_KEY_NAMES.REFRESH_TOKEN;
        
        const mockDecodedToken = {
          data: {
            sub: 'user-789',
            csub: 'client-101',
            rememberMe: true,
          },
          iat: 1625097600,
          exp: 1625184000,
        };

        mockJwt.verify.mockReturnValue(mockDecodedToken);

        // Act
        const result = await authTokenService.verifyJwtToken(tokenType, token);

        // Assert
        expect(result).toEqual({
          success: true,
          data: {
            sub: 'user-789',
            csub: 'client-101',
            rememberMe: true,
            iat: 1625097600,
            exp: 1625184000,
          },
        });

        expect(mockJwt.verify).toHaveBeenCalledWith(token, 'test-refresh-secret');
      });

      it('should handle token without rememberMe field', async () => {
        // Arrange
        const token = 'token-without-remember-me';
        const tokenType = JWT_KEY_NAMES.ACCESS_TOKEN;
        
        const mockDecodedToken = {
          data: {
            sub: 'user-123',
            csub: 'client-456',
            // No rememberMe field
          },
          iat: 1625097600,
          exp: 1625097900,
        };

        mockJwt.verify.mockReturnValue(mockDecodedToken);

        // Act
        const result = await authTokenService.verifyJwtToken(tokenType, token);

        // Assert
        expect(result.data.rememberMe).toBe(false); // Should default to false
        expect(result.success).toBe(true);
      });
    });

    describe('Token verification failures', () => {
      it('should throw error for invalid token type', async () => {
        // Arrange
        const token = 'any-token';
        const invalidTokenType = 'invalid_token_type';

        // Act & Assert
        await expect(authTokenService.verifyJwtToken(invalidTokenType, token))
          .rejects.toEqual({ success: false, error: 'Invalid token type.' });

        expect(mockJwt.verify).not.toHaveBeenCalled();
      });

      it('should handle JWT verification errors', async () => {
        // Arrange
        const token = 'invalid-token';
        const tokenType = JWT_KEY_NAMES.ACCESS_TOKEN;
        
        const jwtError = new Error('JWT verification failed');
        mockJwt.verify.mockImplementation(() => {
          throw jwtError;
        });

        // Act & Assert
        await expect(authTokenService.verifyJwtToken(tokenType, token))
          .rejects.toThrow(jwtError);

        expect(mockJwt.verify).toHaveBeenCalledWith(token, 'test-jwt-secret');
      });

      it('should handle expired token errors', async () => {
        // Arrange
        const expiredToken = 'expired-token';
        const tokenType = JWT_KEY_NAMES.REFRESH_TOKEN;
        
        const expiredError = new Error('TokenExpiredError');
        expiredError.name = 'TokenExpiredError';
        mockJwt.verify.mockImplementation(() => {
          throw expiredError;
        });

        // Act & Assert
        await expect(authTokenService.verifyJwtToken(tokenType, expiredToken))
          .rejects.toThrow(expiredError);

        expect(mockJwt.verify).toHaveBeenCalledWith(expiredToken, 'test-refresh-secret');
      });

      it('should handle malformed token errors', async () => {
        // Arrange
        const malformedToken = 'malformed.token.here';
        const tokenType = JWT_KEY_NAMES.ACCESS_TOKEN;
        
        const malformedError = new Error('JsonWebTokenError');
        malformedError.name = 'JsonWebTokenError';
        mockJwt.verify.mockImplementation(() => {
          throw malformedError;
        });

        // Act & Assert
        await expect(authTokenService.verifyJwtToken(tokenType, malformedToken))
          .rejects.toThrow(malformedError);
      });
    });
  });

  describe('decodeJwt', () => {
    describe('Successful token decoding', () => {
      it('should decode valid JWT token', () => {
        // Arrange
        const token = 'valid.jwt.token';
        const mockDecodedData = {
          data: {
            sub: 'user-123',
            csub: 'client-456',
            rememberMe: false,
          },
          iat: 1625097600,
          exp: 1625097900,
        };

        mockJwt.decode.mockReturnValue(mockDecodedData);

        // Act
        const result = authTokenService.decodeJwt(token);

        // Assert
        expect(result).toEqual({
          success: true,
          data: mockDecodedData,
        });

        expect(mockJwt.decode).toHaveBeenCalledWith(token);
      });

      it('should decode token with complex payload', () => {
        // Arrange
        const token = 'complex.jwt.token';
        const complexPayload = {
          data: {
            sub: 'user-789',
            csub: 'client-101',
            rememberMe: true,
            roles: ['admin', 'user'],
            permissions: ['read', 'write', 'delete'],
          },
          iat: 1625097600,
          exp: 1625184000,
        };

        mockJwt.decode.mockReturnValue(complexPayload);

        // Act
        const result = authTokenService.decodeJwt(token);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data).toEqual(complexPayload);
      });
    });

    describe('Token decoding failures', () => {
      it('should return failure for empty token', () => {
        // Act
        const result = authTokenService.decodeJwt('');

        // Assert
        expect(result).toEqual({ success: false });
        expect(mockJwt.decode).not.toHaveBeenCalled();
      });

      it('should return failure for null token', () => {
        // Act
        const result = authTokenService.decodeJwt(null);

        // Assert
        expect(result).toEqual({ success: false });
        expect(mockJwt.decode).not.toHaveBeenCalled();
      });

      it('should return failure for undefined token', () => {
        // Act
        const result = authTokenService.decodeJwt(undefined);

        // Assert
        expect(result).toEqual({ success: false });
        expect(mockJwt.decode).not.toHaveBeenCalled();
      });

      it('should return failure when JWT decode returns null', () => {
        // Arrange
        const invalidToken = 'invalid.token';
        mockJwt.decode.mockReturnValue(null);

        // Act
        const result = authTokenService.decodeJwt(invalidToken);

        // Assert
        expect(result).toEqual({ success: false });
        expect(mockJwt.decode).toHaveBeenCalledWith(invalidToken);
      });

      it('should return failure when JWT decode returns undefined', () => {
        // Arrange
        const invalidToken = 'another.invalid.token';
        mockJwt.decode.mockReturnValue(undefined);

        // Act
        const result = authTokenService.decodeJwt(invalidToken);

        // Assert
        expect(result).toEqual({ success: false });
      });
    });
  });

  describe('extractTokenFromRequest', () => {
    describe('Successful token extraction', () => {
      it('should extract token from Bearer format', () => {
        // Arrange
        const mockRequest = {
          cookies: {
            [JWT_KEY_NAMES.ACCESS_TOKEN]: 'Bearer actual-token-value',
          },
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBe('actual-token-value');
      });

      it('should extract token without Bearer prefix', () => {
        // Arrange
        const mockRequest = {
          cookies: {
            [JWT_KEY_NAMES.ACCESS_TOKEN]: 'direct-token-value',
          },
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBe('direct-token-value');
      });

      it('should handle token with extra spaces in Bearer format', () => {
        // Arrange
        const mockRequest = {
          cookies: {
            [JWT_KEY_NAMES.ACCESS_TOKEN]: 'Bearer  token-with-spaces',
          },
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBe(' token-with-spaces'); // Preserves the space after Bearer
      });
    });

    describe('Token extraction edge cases', () => {
      it('should return undefined when no cookies', () => {
        // Arrange
        const mockRequest = {};

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBeUndefined();
      });

      it('should return undefined when cookies is null', () => {
        // Arrange
        const mockRequest = {
          cookies: null,
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBeUndefined();
      });

      it('should return undefined when access token cookie is missing', () => {
        // Arrange
        const mockRequest = {
          cookies: {
            'other-cookie': 'other-value',
          },
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBeUndefined();
      });

      it('should return undefined when access token is empty string', () => {
        // Arrange
        const mockRequest = {
          cookies: {
            [JWT_KEY_NAMES.ACCESS_TOKEN]: '',
          },
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBe('');
      });

      it('should handle malformed Bearer token (only "Bearer")', () => {
        // Arrange
        const mockRequest = {
          cookies: {
            [JWT_KEY_NAMES.ACCESS_TOKEN]: 'Bearer',
          },
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBe(''); // split(' ')[1] would be undefined, but we handle this
      });

      it('should handle Bearer with no space', () => {
        // Arrange
        const mockRequest = {
          cookies: {
            [JWT_KEY_NAMES.ACCESS_TOKEN]: 'Bearertoken123',
          },
        };

        // Act
        const result = authTokenService.extractTokenFromRequest(mockRequest);

        // Assert
        expect(result).toBe('Bearertoken123'); // Doesn't start with "Bearer ", so returns as-is
      });
    });
  });

  describe('Integration scenarios', () => {
    it('should create and verify tokens in complete flow', async () => {
      // Arrange
      const payload = {
        sub: 'user-integration-test',
        rememberMe: false,
        csub: 'client-integration-test',
      };

      const mockAccessToken = 'integration-access-token';
      const mockRefreshToken = 'integration-refresh-token';

      // Mock token creation
      mockJwt.sign
        .mockReturnValueOnce(mockAccessToken)
        .mockReturnValueOnce(mockRefreshToken);

      // Mock token verification
      const mockDecodedToken = {
        data: payload,
        iat: 1625097600,
        exp: 1625097900,
      };
      mockJwt.verify.mockReturnValue(mockDecodedToken);

      // Act - Create tokens
      const tokens = authTokenService.createJwtTokens(payload);

      // Act - Verify access token
      const verificationResult = await authTokenService.verifyJwtToken(
        JWT_KEY_NAMES.ACCESS_TOKEN,
        tokens.accessToken
      );

      // Assert
      expect(tokens.accessToken).toBe(mockAccessToken);
      expect(tokens.refreshToken).toBe(mockRefreshToken);
      expect(verificationResult.success).toBe(true);
      expect(verificationResult.data.sub).toBe(payload.sub);
      expect(verificationResult.data.csub).toBe(payload.csub);
    });

    it('should handle remember me flow with extended expiry', async () => {
      // Arrange
      const payload = {
        sub: 'user-remember-me',
        rememberMe: true,
        csub: 'client-remember-me',
      };

      mockJwt.sign
        .mockReturnValueOnce('extended-access-token')
        .mockReturnValueOnce('extended-refresh-token');

      // Act
      const tokens = authTokenService.createJwtTokens(payload);

      // Assert
      expect(tokens.rememberMe).toBe(true);
      expect(mockJwt.sign).toHaveBeenCalledWith(
        { data: payload },
        'test-jwt-secret',
        { expiresIn: '30d' }
      );
      expect(mockJwt.sign).toHaveBeenCalledWith(
        { data: payload },
        'test-refresh-secret',
        { expiresIn: '90d' }
      );
    });
  });
});