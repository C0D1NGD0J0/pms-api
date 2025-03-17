import { envVariables } from '@shared/config';
import { ICurrentUser } from '@interfaces/user.interface';
import { ICacheResponse } from '@interfaces/utils.interface';
import { convertTimeToSecondsAndMilliseconds } from '@utils/index';

import { BaseCache } from './base.cache';

export class AuthCache extends BaseCache {
  private readonly KEY_PREFIXES = {
    TOKEN: 'auth:token',
    USER: 'auth:user',
  };

  private readonly ACCESS_TOKEN_TTL = convertTimeToSecondsAndMilliseconds(envVariables.JWT.EXPIREIN)
    .seconds;
  private readonly REFRESH_TOKEN_TTL = convertTimeToSecondsAndMilliseconds(
    envVariables.JWT.REFRESH.EXPIRESIN
  ).seconds;

  constructor(cacheName = 'AuthCache') {
    super(cacheName);
    this.initializeClient().then(() => {
      console.info('AuthCache connected to Redis');
    });
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
  async saveRefreshToken(userId: string, refreshToken: string): Promise<ICacheResponse> {
    try {
      if (!userId || !this.isValidJwtFormat(refreshToken)) {
        return {
          success: false,
          error: 'Invalid userId or token format',
        };
      }

      const key = `${this.KEY_PREFIXES.TOKEN}:${userId}`;
      await this.client.SETEX(key, this.REFRESH_TOKEN_TTL, refreshToken);
      return { success: true };
    } catch (error) {
      this.log.error('Failed to save refresh token:', error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Retrieves a stored refresh token
   */
  async getRefreshToken(userId: string): Promise<ICacheResponse<string | null>> {
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
  async logoutUser(userId: string): Promise<ICacheResponse> {
    try {
      if (!userId) {
        return {
          success: false,
          error: 'User ID is required',
        };
      }

      const userKey = `${this.KEY_PREFIXES.USER}:${userId}`;
      const tokenKey = `${this.KEY_PREFIXES.TOKEN}:${userId}`;

      await this.deleteItems([userKey, tokenKey]);
      return { success: true };
    } catch (error) {
      this.log.error('Failed to logout user:', error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Stores current user info in cache
   */
  async saveCurrentUser(userData: ICurrentUser): Promise<ICacheResponse> {
    try {
      if (!userData || !userData.sub) {
        return {
          success: false,
          error: 'Invalid user data',
        };
      }

      const key = `${this.KEY_PREFIXES.USER}:${userData.sub}`;
      return await this.setItem(key, JSON.stringify(userData), this.ACCESS_TOKEN_TTL);
    } catch (error) {
      this.log.error('Failed to save user data:', error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }

  /**
   * Retrieves current user info from cache
   */
  async getCurrentUser(userId: string): Promise<ICacheResponse<ICurrentUser | null>> {
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
  ): Promise<ICacheResponse> {
    try {
      const key = `${this.KEY_PREFIXES.USER}:${userId}`;
      const userResponse = await this.getItem<ICurrentUser>(key);

      if (!userResponse.success || !userResponse.data) {
        return {
          success: false,

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
        error: (error as Error).message,
      };
    }
  }

  /**
   * Removes refresh token from cache
   */
  async removeRefreshToken(userId: string): Promise<ICacheResponse> {
    try {
      const key = `${this.KEY_PREFIXES.TOKEN}:${userId}`;
      await this.client.del(key);
      return { success: true };
    } catch (error) {
      this.log.error('Failed to remove refresh token:', error);
      return {
        success: false,
        error: (error as Error).message,
      };
    }
  }
}
