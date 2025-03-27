import { envVariables } from '@shared/config';
import { ICurrentUser } from '@interfaces/user.interface';
import { ISuccessReturnData } from '@interfaces/utils.interface';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';

import { BaseCache } from './base.cache';

export class AuthCache extends BaseCache {
  private readonly ExtendedRefreshTokenTTL: number;
  private readonly ExtendedUserCacheTTL: number;
  private readonly KEY_PREFIXES = {
    TOKEN: 'auth:token',
    USER: 'auth:user',
  };

  private readonly ACCESS_TOKEN_TTL: number;
  private readonly REFRESH_TOKEN_TTL: number;
  private readonly USER_CACHE_TTL: number;

  constructor(cacheName = 'AuthCache') {
    super(cacheName);
    this.initializeClient().then(() => {
      console.info('AuthCache connected to Redis');
    });
    this.ACCESS_TOKEN_TTL = convertTimeToSecondsAndMilliseconds(envVariables.JWT.EXPIREIN).seconds;
    this.REFRESH_TOKEN_TTL = convertTimeToSecondsAndMilliseconds(
      envVariables.JWT.REFRESH.EXPIRESIN
    ).seconds;
    this.USER_CACHE_TTL = this.ACCESS_TOKEN_TTL + 300; // 5 minutes buffer so user data outlive token for a bit
    this.ExtendedRefreshTokenTTL = convertTimeToSecondsAndMilliseconds(
      envVariables.JWT.EXTENDED_REFRESH_TOKEN_EXPIRY
    ).seconds;
    this.ExtendedUserCacheTTL = convertTimeToSecondsAndMilliseconds(
      envVariables.JWT.EXTENDED_ACCESS_TOKEN_EXPIRY
    ).seconds;
  }

  /**
   * Validates if a string appears to be a properly formatted JWT token
   * Note: This only checks format, not token validity
   */
  private isValidJwtFormat(token: string): boolean {
    const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
    return jwtRegex.test(token);
  }

  private async initializeClient() {
    try {
      if (!this.client.isOpen) {
        await this.client.connect();
      }
    } catch (error) {
      this.log.error('Error connecting to Redis:', error);
    }
  }

  /**
   * Stores a refresh token in the cache
   * @param userId - User identifier
   * @param refreshToken - JWT refresh token
   */
  async saveRefreshToken(
    userId: string,
    refreshToken: string,
    rememberMe = false
  ): Promise<ISuccessReturnData> {
    try {
      if (!userId || !this.isValidJwtFormat(refreshToken)) {
        return {
          data: null,
          success: false,
          error: 'Invalid userId or token format',
        };
      }
      const ttl = rememberMe ? this.ExtendedRefreshTokenTTL : this.REFRESH_TOKEN_TTL;
      const key = `${this.KEY_PREFIXES.TOKEN}:${userId}`;
      await this.client.SETEX(key, ttl, refreshToken);
      return { success: true, data: null };
    } catch (error) {
      this.log.error('Failed to save refresh token:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Retrieves a stored refresh token
   */
  async getRefreshToken(userId: string): Promise<ISuccessReturnData<string | null>> {
    try {
      const key = `${this.KEY_PREFIXES.TOKEN}:${userId}`;
      const refreshToken = await this.client.get(key);

      if (!refreshToken) {
        return {
          success: false,
          data: null,
          error: 'Refresh token not found',
        };
      }

      return { success: true, data: refreshToken };
    } catch (error) {
      this.log.error('Failed to retrieve refresh token:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Removes user session data and tokens from cache
   */
  async invalidateUserSession(userId: string): Promise<ISuccessReturnData> {
    try {
      if (!userId) {
        return {
          data: null,
          success: false,
          error: 'User ID is required',
        };
      }

      const currentuserKey = `${this.KEY_PREFIXES.USER}:${userId}`;
      const refreshTokenKey = `${this.KEY_PREFIXES.TOKEN}:${userId}`;

      await this.deleteItems([currentuserKey, refreshTokenKey]);
      return { data: null, success: true };
    } catch (error) {
      this.log.error('Failed to logout user:', error);
      return {
        data: null,
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Stores current user info in cache
   */
  async saveCurrentUser(userData: ICurrentUser, rememberMe = false): Promise<ISuccessReturnData> {
    try {
      if (!userData || !userData.sub) {
        return {
          success: false,
          data: null,
          error: 'Invalid user data',
        };
      }

      const key = `${this.KEY_PREFIXES.USER}:${userData.sub}`;
      const ttl = rememberMe ? this.ExtendedUserCacheTTL : this.USER_CACHE_TTL;

      return await this.setItem(key, JSON.stringify(userData), ttl);
    } catch (error) {
      this.log.error('Failed to save user data:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Retrieves current user info from cache
   */
  async getCurrentUser(userId: string): Promise<ISuccessReturnData<ICurrentUser | null>> {
    try {
      const key = `${this.KEY_PREFIXES.USER}:${userId}`;
      return await this.getItem<ICurrentUser>(key);
    } catch (error) {
      this.log.error('Failed to get user data:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Updates a specific property of the cached user data
   */
  async updateCurrentUserProperty(
    userId: string,
    property: keyof ICurrentUser,
    value: any
  ): Promise<ISuccessReturnData> {
    try {
      const key = `${this.KEY_PREFIXES.USER}:${userId}`;
      const userResponse = await this.getItem<ICurrentUser>(key);

      if (!userResponse.success || !userResponse.data) {
        return {
          success: false,
          data: null,
          error: 'User not found in cache',
        };
      }

      const updatedUser = {
        ...userResponse.data,
        [property]: value,
      };

      return await this.setItem(key, JSON.stringify(updatedUser), this.ACCESS_TOKEN_TTL);
    } catch (error) {
      this.log.error('Failed to update user property:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Removes refresh token from cache
   */
  async deleteRefreshToken(userId: string): Promise<ISuccessReturnData> {
    try {
      const key = `${this.KEY_PREFIXES.TOKEN}:${userId}`;
      await this.client.del(key);
      return { success: true, data: null };
    } catch (error) {
      this.log.error('Failed to remove refresh token:', error);
      return {
        success: false,
        data: null,
        error: (error as Error).message,
      };
    }
  }
}
