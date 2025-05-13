/* eslint-disable */
import { AuthTokenService } from '@services/auth/authToken.service';
import { JWT_KEY_NAMES } from '@utils/index';
import { TokenType } from '@interfaces/utils.interface';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-jwt-secret';
process.env.JWT_EXPIREIN = '15m';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret';
process.env.JWT_REFRESH_EXPIRESIN = '7d';
process.env.JWT_EXTENDED_ACCESS_TOKEN_EXPIRY = '1d';
process.env.JWT_EXTENDED_REFRESH_TOKEN_EXPIRY = '30d';

jest.mock('jsonwebtoken', () => ({
  sign: jest.fn().mockImplementation(() => 'mocked-token'),
  verify: jest.fn(),
  decode: jest.fn(),
}));

jest.mock('@shared/config', () => ({
  envVariables: {
    JWT: {
      SECRET: 'test-jwt-secret',
      EXPIREIN: '15m',
      REFRESH: {
        SECRET: 'test-jwt-refresh-secret',
        EXPIRESIN: '7d',
      },
      EXTENDED_ACCESS_TOKEN_EXPIRY: '1d',
      EXTENDED_REFRESH_TOKEN_EXPIRY: '30d',
    },
  },
}));

jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
  JWT_KEY_NAMES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
  },
}));

describe('AuthTokenService', () => {
  let authTokenService: AuthTokenService;
  const userId = 'test-user-id';
  const clientId = 'test-client-id';

  beforeEach(() => {
    jest.clearAllMocks();
    authTokenService = new AuthTokenService();
  });

  describe('createJwtTokens', () => {
    it('should create access and refresh tokens with standard expiry', () => {
      const payload = {
        sub: userId,
        rememberMe: false,
        csub: clientId,
      };

      const result = authTokenService.createJwtTokens(payload);

      expect(result).toEqual({
        accessToken: 'mocked-token',
        refreshToken: 'mocked-token',
        rememberMe: false,
      });

      // Verify that jwt.sign was called with correct parameters
      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(jwt.sign).toHaveBeenNthCalledWith(1, { data: payload }, 'test-jwt-secret', {
        expiresIn: '15m',
      });
      expect(jwt.sign).toHaveBeenNthCalledWith(2, { data: payload }, 'test-jwt-refresh-secret', {
        expiresIn: '7d',
      });
    });

    it('should create tokens with extended expiry when rememberMe is true', () => {
      const payload = {
        sub: userId,
        rememberMe: true,
        csub: clientId,
      };

      const result = authTokenService.createJwtTokens(payload);

      expect(result.rememberMe).toBe(true);
      expect(jwt.sign).toHaveBeenCalledTimes(2);
      expect(jwt.sign).toHaveBeenNthCalledWith(1, { data: payload }, 'test-jwt-secret', {
        expiresIn: '1d',
      });
      expect(jwt.sign).toHaveBeenNthCalledWith(2, { data: payload }, 'test-jwt-refresh-secret', {
        expiresIn: '30d',
      });
    });
  });

  describe('verifyJwtToken', () => {
    it('should verify access token successfully', async () => {
      const mockToken = 'valid-access-token';
      const mockDecodedToken = {
        data: {
          sub: userId,
          csub: clientId,
          rememberMe: false,
        },
        iat: 1625097600,
        exp: 1625097900,
      };

      (jwt.verify as jest.Mock).mockReturnValueOnce(mockDecodedToken);

      const result = await authTokenService.verifyJwtToken(
        JWT_KEY_NAMES.ACCESS_TOKEN as TokenType,
        mockToken
      );

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        sub: userId,
        csub: clientId,
        rememberMe: false,
        iat: 1625097600,
        exp: 1625097900,
      });
      expect(jwt.verify).toHaveBeenCalledWith(mockToken, 'test-jwt-secret');
    });

    it('should verify refresh token successfully', async () => {
      const mockToken = 'valid-refresh-token';
      const mockDecodedToken = {
        data: {
          sub: userId,
          csub: clientId,
          rememberMe: true,
        },
        iat: 1625097600,
        exp: 1625097900,
      };

      (jwt.verify as jest.Mock).mockReturnValueOnce(mockDecodedToken);

      const result = await authTokenService.verifyJwtToken(
        JWT_KEY_NAMES.REFRESH_TOKEN as TokenType,
        mockToken
      );

      expect(result.success).toBe(true);
      expect(result.data.rememberMe).toBe(true);
      expect(jwt.verify).toHaveBeenCalledWith(mockToken, 'test-jwt-refresh-secret');
    });

    it('should throw error for invalid token type', async () => {
      const mockToken = 'valid-token';

      await expect(
        authTokenService.verifyJwtToken('invalid_token_type' as TokenType, mockToken)
      ).rejects.toEqual({ success: false, error: 'Invalid token type.' });

      expect(jwt.verify).not.toHaveBeenCalled();
    });

    it('should throw error when token verification fails', async () => {
      const mockToken = 'invalid-token';
      const mockError = new Error('Token expired');

      (jwt.verify as jest.Mock).mockImplementationOnce(() => {
        throw mockError;
      });

      await expect(
        authTokenService.verifyJwtToken(JWT_KEY_NAMES.ACCESS_TOKEN as TokenType, mockToken)
      ).rejects.toEqual(mockError);
    });
  });

  describe('decodeJwt', () => {
    it('should decode a valid JWT token', () => {
      const mockToken = 'valid-token';
      const mockDecodedToken = {
        data: {
          sub: userId,
          csub: clientId,
        },
        iat: 1625097600,
        exp: 1625097900,
      };

      (jwt.decode as jest.Mock).mockReturnValueOnce(mockDecodedToken);

      const result = authTokenService.decodeJwt(mockToken);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDecodedToken);
      expect(jwt.decode).toHaveBeenCalledWith(mockToken);
    });

    it('should return failure for null or empty token', () => {
      const result = authTokenService.decodeJwt('');
      expect(result.success).toBe(false);
      expect(jwt.decode).not.toHaveBeenCalled();
    });

    it('should return failure when decode returns null', () => {
      const mockToken = 'invalid-token';
      (jwt.decode as jest.Mock).mockReturnValueOnce(null);

      const result = authTokenService.decodeJwt(mockToken);

      expect(result.success).toBe(false);
      expect(jwt.decode).toHaveBeenCalledWith(mockToken);
    });
  });

  describe('extractTokenFromRequest', () => {
    it('should extract token from cookies', () => {
      const mockReq = {
        cookies: {
          access_token: 'token-from-cookie',
        },
      };

      const result = authTokenService.extractTokenFromRequest(mockReq as any);
      expect(result).toBe('token-from-cookie');
    });

    it('should extract token from Bearer Authorization header', () => {
      const mockReq = {
        cookies: {
          access_token: 'Bearer token-from-header',
        },
      };

      const result = authTokenService.extractTokenFromRequest(mockReq as any);
      expect(result).toBe('token-from-header');
    });

    it('should return undefined if no token is found', () => {
      const mockReq = {
        cookies: {},
      };

      const result = authTokenService.extractTokenFromRequest(mockReq as any);
      expect(result).toBeUndefined();
    });
  });
});
