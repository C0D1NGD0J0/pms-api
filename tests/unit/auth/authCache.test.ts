/* eslint-disable */
import * as utils from '@utils/index';
import { AuthCache } from '@caching/auth.cache';
import { ICurrentUser, IUserRole } from '@interfaces/user.interface';

const mockRedisClient = {
  isOpen: true,
  connect: jest.fn().mockResolvedValue(true),
  SETEX: jest.fn().mockResolvedValue('OK'),
  get: jest.fn(),
  del: jest.fn().mockResolvedValue(1),
  set: jest.fn().mockResolvedValue('OK'),
  quit: jest.fn().mockResolvedValue(true),
};

jest.mock('@shared/config', () => ({
  envVariables: {
    JWT: {
      EXPIREIN: '15m',
      REFRESH: {
        EXPIRESIN: '7d',
      },
      EXTENDED_ACCESS_TOKEN_EXPIRY: '30d',
      EXTENDED_REFRESH_TOKEN_EXPIRY: '60d',
    },
  },
}));

jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
  convertTimeToSecondsAndMilliseconds: jest.fn().mockImplementation((time) => {
    const timeMap: Record<string, { seconds: number }> = {
      '15m': { seconds: 900 },
      '7d': { seconds: 604800 },
      '30d': { seconds: 2592000 },
      '60d': { seconds: 5184000 },
    };
    return timeMap[time] || { seconds: 0 };
  }),
}));

jest.mock('redis', () => ({
  createClient: jest.fn().mockImplementation(() => mockRedisClient),
}));

describe('AuthCache', () => {
  let authCache: AuthCache;
  const mockUserId = 'mock-user-id';
  const mockRefreshToken = 'mock-refresh-token';
  const mockInvalidToken = 'invalid-token-format';

  beforeEach(() => {
    jest.clearAllMocks();
    authCache = new AuthCache();
    // @ts-ignore - Directly set the client for testing
    authCache.client = mockRedisClient;
  });

  describe('saveRefreshToken', () => {
    it('should save a valid refresh token successfully', async () => {
      const result = await authCache.saveRefreshToken(mockUserId, mockRefreshToken);

      expect(result.success).toBe(true);
      expect(mockRedisClient.SETEX).toHaveBeenCalledWith(
        'auth:token:mock-user-id',
        604800, // 7 days in seconds
        mockRefreshToken
      );
    });

    it('should save a token with extended TTL when rememberMe is true', async () => {
      const result = await authCache.saveRefreshToken(mockUserId, mockRefreshToken, true);

      expect(result.success).toBe(true);
      expect(mockRedisClient.SETEX).toHaveBeenCalledWith(
        'auth:token:mock-user-id',
        5184000, // 60 days in seconds
        mockRefreshToken
      );
    });

    it('should return failure for invalid userId', async () => {
      const result = await authCache.saveRefreshToken('', mockRefreshToken);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid userId or token format');
      expect(mockRedisClient.SETEX).not.toHaveBeenCalled();
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.SETEX.mockRejectedValueOnce(new Error('Redis connection error'));

      const result = await authCache.saveRefreshToken(mockUserId, mockRefreshToken);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Redis connection error');
    });
  });

  describe('getRefreshToken', () => {
    it('should retrieve a stored refresh token successfully', async () => {
      mockRedisClient.get.mockResolvedValueOnce(mockRefreshToken);

      const result = await authCache.getRefreshToken(mockUserId);

      expect(result.success).toBe(true);
      expect(result.data).toBe(mockRefreshToken);
      expect(mockRedisClient.get).toHaveBeenCalledWith('auth:token:mock-user-id');
    });

    it('should return failure when token is not found', async () => {
      mockRedisClient.get.mockResolvedValueOnce(null);

      const result = await authCache.getRefreshToken(mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Refresh token not found');
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValueOnce(new Error('Redis connection error'));

      const result = await authCache.getRefreshToken(mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Redis connection error');
    });
  });

  describe('saveCurrentUser', () => {
    const mockUserData: ICurrentUser = {
      sub: mockUserId,
      email: 'test@example.com',
      displayName: 'Test User',
      fullname: 'Test User',
      isActive: true,
      avatarUrl: '',
      permissions: ['read', 'write'],
      client: {
        csub: 'client-123',
        displayname: 'Test Client',
        role: IUserRole.ADMIN,
      },
      clients: [],
      preferences: {
        theme: 'light',
        lang: 'en',
        timezone: 'UTC',
      },
    };

    it('should save user data successfully', async () => {
      // @ts-ignore - Directly set the method for testing
      authCache.setItem = jest.fn().mockResolvedValue({ success: true, data: null });

      const result = await authCache.saveCurrentUser(mockUserData);

      expect(result.success).toBe(true);
      // @ts-ignore - Check the mock was called
      expect(authCache.setItem).toHaveBeenCalledWith(
        'auth:user:mock-user-id',
        JSON.stringify(mockUserData),
        900 + 300 // ACCESS_TOKEN_TTL + 5 min buffer
      );
    });

    it('should save user data with extended TTL when rememberMe is true', async () => {
      // @ts-ignore - Directly set the method for testing
      authCache.setItem = jest.fn().mockResolvedValue({ success: true, data: null });

      const result = await authCache.saveCurrentUser(mockUserData, true);

      expect(result.success).toBe(true);
      // @ts-ignore - Check the mock was called
      expect(authCache.setItem).toHaveBeenCalledWith(
        'auth:user:mock-user-id',
        JSON.stringify(mockUserData),
        2592000 // 30 days in seconds
      );
    });

    it('should return failure for invalid user data', async () => {
      const result = await authCache.saveCurrentUser({ ...mockUserData, sub: '' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid user data');
    });
  });

  describe('getCurrentUser', () => {
    const mockUserData: ICurrentUser = {
      sub: mockUserId,
      email: 'test@example.com',
      displayName: 'Test User',
      fullname: 'Test User',
      isActive: true,
      avatarUrl: '',
      permissions: ['read', 'write'],
      client: {
        csub: 'client-123',
        displayname: 'Test Client',
        role: IUserRole.ADMIN,
      },
      clients: [],
      preferences: {
        theme: 'light',
        lang: 'en',
        timezone: 'UTC',
      },
    };

    it('should retrieve user data successfully', async () => {
      // @ts-ignore - Directly set the method for testing
      authCache.getItem = jest.fn().mockResolvedValue({
        success: true,
        data: mockUserData,
      });

      const result = await authCache.getCurrentUser(mockUserId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUserData);
      // @ts-ignore - Check the mock was called
      expect(authCache.getItem).toHaveBeenCalledWith('auth:user:mock-user-id');
    });

    it('should return failure when user data is not found', async () => {
      // @ts-ignore - Directly set the method for testing
      authCache.getItem = jest.fn().mockResolvedValue({
        success: false,
        data: null,
        error: 'User not found',
      });

      const result = await authCache.getCurrentUser(mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found');
    });
  });

  describe('invalidateUserSession', () => {
    it('should invalidate user session successfully', async () => {
      // Mock the internal deleteItems method
      // @ts-ignore - Directly set the method for testing
      authCache.deleteItems = jest.fn().mockResolvedValue(true);

      const result = await authCache.invalidateUserSession(mockUserId);

      expect(result.success).toBe(true);
      // @ts-ignore - Check the mock was called
      expect(authCache.deleteItems).toHaveBeenCalledWith([
        'auth:user:mock-user-id',
        'auth:token:mock-user-id',
      ]);
    });

    it('should return failure when userId is missing', async () => {
      const result = await authCache.invalidateUserSession('');

      expect(result.success).toBe(false);
      expect(result.error).toBe('User ID is required');
    });

    it('should handle Redis errors gracefully', async () => {
      // @ts-ignore - Directly set the method for testing
      authCache.deleteItems = jest.fn().mockRejectedValueOnce(new Error('Redis error'));

      const result = await authCache.invalidateUserSession(mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Redis error');
    });
  });

  describe('updateCurrentUserProperty', () => {
    const mockUserData: ICurrentUser = {
      sub: mockUserId,
      email: 'test@example.com',
      displayName: 'Test User',
      fullname: 'Test User',
      isActive: true,
      avatarUrl: '',
      permissions: ['read', 'write'],
      client: {
        csub: 'client-123',
        displayname: 'Test Client',
        role: IUserRole.ADMIN,
      },
      clients: [],
      preferences: {
        theme: 'light',
        lang: 'en',
        timezone: 'UTC',
      },
    };

    it('should update user property successfully', async () => {
      // @ts-ignore - Directly set the method for testing
      authCache.getItem = jest.fn().mockResolvedValue({
        success: true,
        data: mockUserData,
      });

      // @ts-ignore - Directly set the method for testing
      authCache.setItem = jest.fn().mockResolvedValue({
        success: true,
        data: null,
      });

      const result = await authCache.updateCurrentUserProperty(
        mockUserId,
        'displayName',
        'Updated Name'
      );

      expect(result.success).toBe(true);
      // @ts-ignore - Check the mocks were called
      expect(authCache.getItem).toHaveBeenCalledWith('auth:user:mock-user-id');
      // @ts-ignore - Check the setItem was called with updated user
      expect(authCache.setItem).toHaveBeenCalledWith(
        'auth:user:mock-user-id',
        JSON.stringify({
          ...mockUserData,
          displayName: 'Updated Name',
        }),
        900
      );
    });

    it('should return failure when user is not found in cache', async () => {
      // @ts-ignore - Directly set the method for testing
      authCache.getItem = jest.fn().mockResolvedValue({
        success: false,
        data: null,
        error: 'User not found in cache',
      });

      const result = await authCache.updateCurrentUserProperty(
        mockUserId,
        'displayName',
        'Updated Name'
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe('User not found in cache');
    });
  });

  describe('deleteRefreshToken', () => {
    it('should delete refresh token successfully', async () => {
      const result = await authCache.deleteRefreshToken(mockUserId);

      expect(result.success).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith('auth:token:mock-user-id');
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.del.mockRejectedValueOnce(new Error('Redis error'));

      const result = await authCache.deleteRefreshToken(mockUserId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Redis error');
    });
  });
});
