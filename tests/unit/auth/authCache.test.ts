import { AuthCache } from '@caching/auth.cache';
import { createMockCurrentUser } from '@tests/helpers';
import { ICurrentUser } from '@interfaces/user.interface';

// Mock environment variables
jest.mock('@shared/config', () => ({
  envVariables: {
    JWT: {
      EXPIREIN: '15m',
      REFRESH: {
        EXPIRESIN: '7d',
      },
      EXTENDED_ACCESS_TOKEN_EXPIRY: '30d',
      EXTENDED_REFRESH_TOKEN_EXPIRY: '90d',
    },
  },
}));

jest.mock('@utils/index', () => ({
  convertTimeToSecondsAndMilliseconds: jest.fn((time: string) => {
    const timeMap: Record<string, number> = {
      '15m': 900,
      '7d': 604800,
      '30d': 2592000,
      '90d': 7776000,
    };
    return { seconds: timeMap[time] || 900 };
  }),
}));

// Mock the BaseCache class
jest.mock('@caching/base.cache', () => {
  return {
    BaseCache: jest.fn().mockImplementation(function (this: any) {
      this.client = {
        SETEX: jest.fn(),
        get: jest.fn(),
        del: jest.fn(),
        isOpen: true,
        connect: jest.fn(),
      };
      this.log = {
        error: jest.fn(),
        info: jest.fn(),
        debug: jest.fn(),
        warn: jest.fn(),
      };
      this.setItem = jest.fn();
      this.getItem = jest.fn();
      this.deleteItems = jest.fn();
      this.initializeClient = jest.fn().mockResolvedValue(undefined);
    }),
  };
});

describe('AuthCache', () => {
  let authCache: AuthCache;
  let mockClient: any;

  beforeEach(() => {
    jest.clearAllMocks();
    authCache = new AuthCache();
    mockClient = (authCache as any).client;
  });

  describe('saveRefreshToken', () => {
    it('should successfully save refresh token', async () => {
      // Arrange
      const userId = 'user-123';
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
      mockClient.SETEX.mockResolvedValue('OK');

      // Act
      const result = await authCache.saveRefreshToken(userId, validToken, false);

      // Assert
      expect(result.success).toBe(true);
      expect(mockClient.SETEX).toHaveBeenCalledWith('auth:token:user-123', 604800, validToken);
    });

    it('should reject invalid userId or token format', async () => {
      // Act & Assert
      const result1 = await authCache.saveRefreshToken('', 'valid-token');
      const result2 = await authCache.saveRefreshToken('user-123', 'invalid-token');

      expect(result1.success).toBe(false);
      expect(result2.success).toBe(false);
    });
  });

  describe('getRefreshToken', () => {
    it('should successfully retrieve refresh token', async () => {
      // Arrange
      const userId = 'user-123';
      const validToken = 'stored-token';
      mockClient.get.mockResolvedValue(validToken);

      // Act
      const result = await authCache.getRefreshToken(userId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toBe(validToken);
    });

    it('should handle token not found', async () => {
      // Arrange
      mockClient.get.mockResolvedValue(null);

      // Act
      const result = await authCache.getRefreshToken('user-123');

      // Assert
      expect(result.success).toBe(false);
      expect(result.error).toBe('Refresh token not found');
    });
  });

  describe('invalidateUserSession', () => {
    it('should successfully invalidate user session', async () => {
      // Arrange
      const userId = 'user-123';
      (authCache as any).deleteItems = jest.fn().mockResolvedValue({ success: true });

      // Act
      const result = await authCache.invalidateUserSession(userId);

      // Assert
      expect(result.success).toBe(true);
      expect((authCache as any).deleteItems).toHaveBeenCalledWith([
        'auth:user:user-123',
        'auth:token:user-123',
      ]);
    });
  });

  describe('saveCurrentUser', () => {
    it('should successfully save current user', async () => {
      // Arrange
      const mockUserData = createMockCurrentUser();
      (authCache as any).setItem = jest.fn().mockResolvedValue({ success: true, data: null });

      // Act
      const result = await authCache.saveCurrentUser(mockUserData, false);

      // Assert
      expect(result.success).toBe(true);
      expect((authCache as any).setItem).toHaveBeenCalledWith(
        `auth:user:${mockUserData.sub}`,
        JSON.stringify(mockUserData),
        1200
      );
    });
  });

  describe('getCurrentUser', () => {
    it('should successfully get current user', async () => {
      // Arrange
      const userId = 'user-123';
      const mockUserData = createMockCurrentUser();
      (authCache as any).getItem = jest.fn().mockResolvedValue({
        success: true,
        data: mockUserData,
      });

      // Act
      const result = await authCache.getCurrentUser(userId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUserData);
    });
  });

  describe('updateCurrentUserProperty', () => {
    it('should successfully update user property', async () => {
      // Arrange
      const userId = 'user-123';
      const mockUserData = createMockCurrentUser();
      const propertyKey = 'displayName' as keyof ICurrentUser;
      const newValue = 'Updated Name';

      (authCache as any).getItem = jest.fn().mockResolvedValue({
        success: true,
        data: mockUserData,
      });
      (authCache as any).setItem = jest.fn().mockResolvedValue({ success: true });

      // Act
      const result = await authCache.updateCurrentUserProperty(userId, propertyKey, newValue);

      // Assert
      expect(result.success).toBe(true);
    });
  });

  describe('deleteRefreshToken', () => {
    it('should successfully delete refresh token', async () => {
      // Arrange
      const userId = 'user-123';
      mockClient.del.mockResolvedValue(1);

      // Act
      const result = await authCache.deleteRefreshToken(userId);

      // Assert
      expect(result.success).toBe(true);
      expect(mockClient.del).toHaveBeenCalledWith('auth:token:user-123');
    });
  });
});
