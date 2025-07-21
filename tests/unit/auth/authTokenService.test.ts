import { AuthTokenService } from '@services/auth/authToken.service';
import { Request } from 'express';
import jwt from 'jsonwebtoken';

// Mock jwt module
jest.mock('jsonwebtoken');
const mockJwt = jwt as jest.Mocked<typeof jwt>;

// Mock environment variables
jest.mock('@shared/config', () => ({
  envVariables: {
    JWT: {
      SECRET: 'test-access-secret',
      EXPIREIN: '15m',
      REFRESH: {
        SECRET: 'test-refresh-secret',
        EXPIRESIN: '7d'
      },
      EXTENDED_ACCESS_TOKEN_EXPIRY: '30d',
      EXTENDED_REFRESH_TOKEN_EXPIRY: '90d'
    }
  }
}));

// Mock utils
jest.mock('@utils/index', () => ({
  JWT_KEY_NAMES: {
    ACCESS_TOKEN: 'accessToken',
    REFRESH_TOKEN: 'refreshToken'
  },
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn()
  }))
}));

describe('AuthTokenService', () => {
  let authTokenService: AuthTokenService;
  let mockLogger: any;

  beforeEach(() => {
    jest.clearAllMocks();
    authTokenService = new AuthTokenService();
    mockLogger = authTokenService['logger'];
  });

  describe('createJwtTokens', () => {
    const mockPayload = {
      sub: 'user-id-123',
      rememberMe: false,
      csub: 'client-id-456'
    };

    it('should create tokens with standard expiry when rememberMe is false', () => {
      // Arrange
      mockJwt.sign
        .mockReturnValueOnce('mock-access-token')
        .mockReturnValueOnce('mock-refresh-token');

      // Act
      const result = authTokenService.createJwtTokens(mockPayload);

      // Assert
      expect(result).toEqual({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
        rememberMe: false
      });
      expect(mockJwt.sign).toHaveBeenCalledTimes(2);
    });

    it('should create tokens with extended expiry when rememberMe is true', () => {
      // Arrange
      const rememberMePayload = { ...mockPayload, rememberMe: true };
      mockJwt.sign
        .mockReturnValueOnce('mock-access-token-extended')
        .mockReturnValueOnce('mock-refresh-token-extended');

      // Act
      const result = authTokenService.createJwtTokens(rememberMePayload);

      // Assert
      expect(result).toEqual({
        accessToken: 'mock-access-token-extended',
        refreshToken: 'mock-refresh-token-extended',
        rememberMe: true
      });
    });

    it('should handle token generation with valid payload structure', () => {
      // Arrange
      mockJwt.sign.mockReturnValue('generated-token');

      // Act
      const result = authTokenService.createJwtTokens(mockPayload);

      // Assert
      expect(result.accessToken).toBe('generated-token');
      expect(result.refreshToken).toBe('generated-token');
      expect(result.rememberMe).toBe(mockPayload.rememberMe);
    });
  });

  describe('verifyJwtToken', () => {
    const mockToken = 'valid-jwt-token';
    const mockDecodedPayload = {
      data: {
        sub: 'user-id-123',
        csub: 'client-id-456',
        rememberMe: false
      },
      iat: 1234567890,
      exp: 1234567999
    };

    it('should successfully verify access token', async () => {
      // Arrange
      mockJwt.verify.mockReturnValue(mockDecodedPayload);

      // Act
      const result = await authTokenService.verifyJwtToken('accessToken', mockToken);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        rememberMe: false,
        sub: 'user-id-123',
        csub: 'client-id-456',
        iat: 1234567890,
        exp: 1234567999
      });
    });

    it('should successfully verify refresh token', async () => {
      // Arrange
      mockJwt.verify.mockReturnValue(mockDecodedPayload);

      // Act
      const result = await authTokenService.verifyJwtToken('refreshToken', mockToken);

      // Assert
      expect(result.success).toBe(true);
      expect(mockJwt.verify).toHaveBeenCalledWith(mockToken, 'test-refresh-secret');
    });

    it('should handle token verification failure', async () => {
      // Arrange
      const verificationError = new Error('Token expired');
      mockJwt.verify.mockImplementation(() => {
        throw verificationError;
      });

      // Act & Assert
      await expect(authTokenService.verifyJwtToken('accessToken', mockToken))
        .rejects.toThrow('Token expired');
    });

    it('should reject invalid token type', async () => {
      // Act & Assert
      await expect(authTokenService.verifyJwtToken('invalidType' as any, mockToken))
        .rejects.toEqual({ success: false, error: 'Invalid token type.' });
    });

    it('should handle missing rememberMe in decoded token', async () => {
      // Arrange
      const payloadWithoutRememberMe = {
        data: {
          sub: 'user-id-123',
          csub: 'client-id-456'
          // rememberMe is missing
        },
        iat: 1234567890,
        exp: 1234567999
      };
      mockJwt.verify.mockReturnValue(payloadWithoutRememberMe);

      // Act
      const result = await authTokenService.verifyJwtToken('accessToken', mockToken);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.rememberMe).toBe(false); // Should default to false
    });
  });

  describe('decodeJwt', () => {
    const mockToken = 'valid-jwt-token';

    it('should successfully decode valid JWT', () => {
      // Arrange
      const mockDecodedData = {
        data: { sub: 'user-id-123' },
        iat: 1234567890,
        exp: 1234567999
      };
      mockJwt.decode.mockReturnValue(mockDecodedData);

      // Act
      const result = authTokenService.decodeJwt(mockToken);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDecodedData);
    });

    it('should handle empty token', () => {
      // Act
      const result = authTokenService.decodeJwt('');

      // Assert
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty('data');
    });

    it('should handle invalid token that cannot be decoded', () => {
      // Arrange
      mockJwt.decode.mockReturnValue(null);

      // Act
      const result = authTokenService.decodeJwt(mockToken);

      // Assert
      expect(result.success).toBe(false);
      expect(result).not.toHaveProperty('data');
    });
  });

  describe('extractTokenFromRequest', () => {
    it('should extract token from cookies', () => {
      // Arrange
      const mockRequest = {
        cookies: {
          accessToken: 'token-from-cookie'
        }
      } as Request;

      // Act
      const result = authTokenService.extractTokenFromRequest(mockRequest);

      // Assert
      expect(result).toBe('token-from-cookie');
    });

    it('should extract Bearer token from cookies', () => {
      // Arrange
      const mockRequest = {
        cookies: {
          accessToken: 'Bearer actual-token-value'
        }
      } as Request;

      // Act
      const result = authTokenService.extractTokenFromRequest(mockRequest);

      // Assert
      expect(result).toBe('actual-token-value');
    });

    it('should handle missing cookies', () => {
      // Arrange
      const mockRequest = {} as Request;

      // Act
      const result = authTokenService.extractTokenFromRequest(mockRequest);

      // Assert
      expect(result).toBeUndefined();
    });
  });
});