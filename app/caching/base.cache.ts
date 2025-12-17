import Logger from 'bunyan';
import crypto from 'crypto';
import { createClient } from 'redis';
import { RedisService } from '@database/index';
import { ISuccessReturnData } from '@interfaces/utils.interface';

export type RedisClient = ReturnType<typeof createClient>;

type IBaseCache = {
  client: RedisClient;
  log: Logger;
};

export class BaseCache implements IBaseCache {
  protected redisService: RedisService;
  client: RedisClient;
  log: Logger;

  constructor({ redisService }: { redisService: RedisService }) {
    this.redisService = redisService;
    this.client = redisService.client;
    this.log = redisService.log;
  }

  /**
   * Handle errors consistently across cache operations
   */
  protected handleError(error: unknown, operation = 'operation'): ISuccessReturnData {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.log.error({ error: error, operation }, `Cache ${operation} error: ${errorMessage}`);

    return {
      data: null,
      success: false,
      error: errorMessage || `Cache ${operation} error occurred.`,
    };
  }

  /**
   * Set a string value in the cache with optional TTL
   * @param key Cache key
   * @param value Value to store
   * @param ttl Time to live in seconds (optional)
   */
  protected async setItem(key: string, value: string, ttl?: number): Promise<ISuccessReturnData> {
    try {
      if (!key) {
        return { success: false, data: null, error: 'Cache key is required' };
      }

      const result = ttl
        ? await this.client.SETEX(key, ttl, value)
        : await this.client.SET(key, value);

      if (result !== 'OK') {
        this.log.error(`Failed to save item in cache with key: ${key}`);
        return { success: false, data: null, error: 'Failed to save item in cache' };
      }

      return { success: true, data: null };
    } catch (error) {
      return this.handleError(error, `setItem(${key})`);
    }
  }

  /**
   * Get a value from the cache by key
   * @param key Cache key
   * @returns Cached value or null if not found
   */
  protected async getItem<T>(key: string): Promise<ISuccessReturnData> {
    try {
      if (!key) {
        return { success: false, data: null, error: 'Cache key is required' };
      }

      const res = await this.client.GET(key);
      return {
        success: !!res,
        data: res ? this.deserialize<T>(res) : null,
      };
    } catch (error) {
      return this.handleError(error, `getItem(${key})`);
    }
  }

  /**
   * Store an object in the cache as a Redis hash
   * @param objName Hash name
   * @param data Object to store
   * @param ttl Time to live in seconds (optional)
   */
  protected async setObject<T extends object>(
    objName: string,
    data: T,
    ttl?: number
  ): Promise<ISuccessReturnData> {
    try {
      if (!objName) {
        return { success: false, data: null, error: 'Object name is required' };
      }

      if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
        return { success: false, data: null, error: 'Invalid data object' };
      }

      const fields = Object.entries(data).reduce(
        (acc, [key, value]) => {
          acc[key] = this.serialize(value);
          return acc;
        },
        {} as Record<string, string>
      );

      const multi = this.client.multi();
      multi.HSET(objName, fields);

      if (ttl) {
        multi.expire(objName, ttl);
      }

      const results = await multi.exec();
      const hsetResult = results?.[0];

      return {
        data: null,
        success: typeof hsetResult === 'number' && hsetResult >= 0,
      };
    } catch (error) {
      return this.handleError(error, `setObject(${objName})`);
    }
  }

  /**
   * Retrieve an object from the cache by hash name
   * @param objName Hash name
   * @returns The cached object or null if not found
   */
  protected async getObject<T extends object>(
    objName: string
  ): Promise<ISuccessReturnData<any | null>> {
    try {
      if (!objName) {
        return { success: false, data: null, error: 'Object name is required' };
      }

      const resp = await this.client.HGETALL(objName);

      if (!resp || Object.keys(resp).length === 0) {
        return { success: false, data: null, error: 'Object not found or empty' };
      }

      const parsedData = Object.fromEntries(
        Object.entries(resp).map(([key, value]) => [key, this.deserialize(value)])
      ) as T;

      return { success: true, data: parsedData };
    } catch (error) {
      return this.handleError(error, `getObject(${objName})`);
    }
  }

  /**
   * Delete one or more items from the cache
   * @param keys Array of keys to delete
   */
  protected async deleteItems(keys: string[]): Promise<ISuccessReturnData> {
    try {
      if (!keys || !keys.length) {
        return { success: false, data: null, error: 'At least one key must be provided' };
      }

      const resp = await this.client.del(keys);
      return {
        success: true,
        data: { deletedCount: resp },
      };
    } catch (error) {
      return this.handleError(error, 'deleteItems');
    }
  }

  /**
   * Check if a key exists in the cache
   * @param key Cache key to check
   */
  protected async hasKey(key: string): Promise<ISuccessReturnData> {
    try {
      if (!key) {
        return { success: false, error: 'Cache key is required', data: false };
      }

      const exists = await this.client.exists(key);
      return {
        success: true,
        data: exists === 1,
      };
    } catch (error) {
      return this.handleError(error, `hasKey(${key})`);
    }
  }

  /**
   * Set a key's time to live in seconds
   * @param key Cache key
   * @param ttl Time to live in seconds
   */
  protected async setExpiration(key: string, ttl: number): Promise<ISuccessReturnData> {
    try {
      if (!key) {
        return { success: false, data: null, error: 'Cache key is required' };
      }

      if (!ttl || ttl <= 0) {
        return { success: false, data: null, error: 'TTL must be a positive number' };
      }

      const result = await this.client.expire(key, ttl);
      return {
        success: result,
        data: { keyExists: result },
      };
    } catch (error) {
      return this.handleError(error, `setExpiration(${key})`);
    }
  }

  /**
   * Serialize data for storage in Redis
   * @param data Data to serialize
   * @returns Serialized string
   */
  protected serialize(data: any): string {
    return JSON.stringify(data);
  }

  /**
   * Deserialize data from Redis
   * @param data Serialized string
   * @returns Deserialized data or null if invalid
   */
  protected deserialize<T>(data: string | null): T | null {
    if (!data) {
      return null;
    }

    try {
      return JSON.parse(data) as T;
    } catch (e) {
      // Silent failure - just return null for invalid JSON
      return null;
    }
  }

  /*
   ** Generate a hash for the given data
   ** @param data Data to hash
   ** @returns Hash string
   */
  protected hashData(data: unknown): string {
    const paramsString = JSON.stringify(data);
    const hash = crypto.createHash('md5').update(paramsString).digest('hex').substring(0, 8);
    return hash;
  }

  /**
   * Add an item to a Redis list
   * @param key List key
   * @param value Value to add to the list
   * @param ttl Optional TTL in seconds
   */
  protected async addToList(key: string, value: string, ttl?: number): Promise<ISuccessReturnData> {
    try {
      if (!key) {
        return { success: false, data: null, error: 'List key is required' };
      }

      const multi = this.client.multi();
      multi.RPUSH(key, value);

      if (ttl) {
        multi.EXPIRE(key, ttl);
      }

      const results = await multi.exec();
      const rpushResult = results?.[0];

      return {
        success: typeof rpushResult === 'number' && rpushResult > 0,
        data: { listLength: rpushResult },
      };
    } catch (error) {
      return this.handleError(error, `addToList(${key})`);
    }
  }

  /**
   * Get a range of items from a Redis list
   * @param key List key
   * @param start Start index (0-based)
   * @param end End index (inclusive)
   * @returns Array of items or empty array if list not found
   */
  protected async getListRange<T>(
    key: string,
    start: number,
    end: number
  ): Promise<ISuccessReturnData<T[]>> {
    try {
      if (!key) {
        return { success: false, data: [], error: 'List key is required' };
      }

      const items = await this.client.LRANGE(key, start, end);

      if (!items || items.length === 0) {
        return { success: false, data: [], error: 'List not found or empty' };
      }

      const parsedItems = items.map((item) => this.deserialize<T>(item));
      return {
        success: true,
        data: parsedItems.filter((item) => item !== null) as T[],
      };
    } catch (error) {
      return this.handleError(error, `getListRange(${key})`);
    }
  }

  /**
   * Get the length of a Redis list
   * @param key List key
   * @returns List length or 0 if not found
   */
  protected async getListLength(key: string): Promise<ISuccessReturnData<number>> {
    try {
      if (!key) {
        return { success: false, data: 0, error: 'List key is required' };
      }

      const length = await this.client.LLEN(key);
      return {
        success: true,
        data: length,
      };
    } catch (error) {
      return this.handleError(error, `getListLength(${key})`);
    }
  }
}
