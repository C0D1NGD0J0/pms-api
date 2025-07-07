import Logger from 'bunyan';
import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';
import { RedisClientType, createClient } from 'redis';
import { RedisMemoryServer } from 'redis-memory-server';
import { ISuccessReturnData } from '@interfaces/utils.interface';

export class RedisService {
  private redisMemoryServer: RedisMemoryServer | null = null;
  private connectionPromise: Promise<ISuccessReturnData> | null = null;
  private redisTestUrl: string = '';
  client: RedisClientType;
  log: Logger;
  private static sharedInstance: RedisService | null = null;

  constructor(cacheName: string) {
    this.log = createLogger(cacheName);

    if (envVariables.SERVER.ENV === 'test') {
      this.redisMemoryServer = new RedisMemoryServer();
    }

    this.client = createClient({
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 5) {
            return new Error('Too many reconnect attempts');
          }
          return Math.min(retries * 100, 3000);
        },
        connectTimeout: 10000,
        keepAlive: 30000,
      },
      commandsQueueMaxLength: 100,
    });

    this.client.on('error', (err: Error) => {
      console.error('Redis client error', err);
    });
  }

  protected handleError(error: unknown, operation = 'operation'): ISuccessReturnData {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.log.error({ error: error, operation }, `Redis ${operation} error: ${errorMessage}`);

    return {
      data: null,
      success: false,
      error: errorMessage || `Redis ${operation} error occurred.`,
    };
  }

  async connect(): Promise<ISuccessReturnData> {
    if (this.connectionPromise) {
      return this.connectionPromise;
    }

    if (this.client.isReady) {
      this.log.info('Redis client is already connected');
      return { success: this.client.isReady, data: null };
    }

    this.connectionPromise = this._connect();

    try {
      return await this.connectionPromise;
    } finally {
      this.connectionPromise = null;
    }
  }

  async disconnect(): Promise<ISuccessReturnData> {
    try {
      if (this.connectionPromise) {
        await this.connectionPromise.catch(() => {});
        this.connectionPromise = null;
      }

      if (this.client) {
        await this.client.quit().catch((err) => {
          this.log.warn({ err }, 'Error during Redis disconnect');
        });
      }

      if (this.redisMemoryServer) {
        await this.redisMemoryServer.stop();
        this.redisMemoryServer = null;
      }
      this.log.info('Disconnected from redis');
      return { success: true, data: null };
    } catch (error) {
      return this.handleError(error);
    }
  }

  private async initTestEnvironment(): Promise<string> {
    try {
      if (!this.redisMemoryServer) {
        this.redisMemoryServer = new RedisMemoryServer();
      }

      const port = await this.redisMemoryServer.getPort();
      const url = `redis://127.0.0.1:${port}`;
      this.redisTestUrl = url;
      this.log.info(`Redis memory server initialized at ${url}`);

      return url;
    } catch (error) {
      this.log.error({ err: error }, 'Failed to initialize Redis memory server');
      throw error;
    }
  }

  private async _connect(): Promise<ISuccessReturnData> {
    try {
      let redisUrl: string;

      if (envVariables.SERVER.ENV === 'test') {
        redisUrl = await this.initTestEnvironment();
      } else {
        redisUrl = envVariables.REDIS.URL;
      }

      if (this.client.options) {
        this.client.options.url = redisUrl;
      }

      this.client.on('connect', () => {
        this.log.info('Redis connection established');
      });

      this.client.on('end', () => {
        this.log.info('Redis connection ended');
      });

      await this.client.connect();
      if (!this.client.isReady) {
        return { success: false, data: null, error: 'Redis client failed to connect' };
      }

      return { success: true, data: null };
    } catch (error) {
      return this.handleError(error, 'connect');
    }
  }

  static getSharedInstance(): RedisService {
    if (!RedisService.sharedInstance) {
      RedisService.sharedInstance = new RedisService('SharedRedis');
    }
    return RedisService.sharedInstance;
  }

  static async shutdownSharedInstance(): Promise<void> {
    if (RedisService.sharedInstance) {
      await RedisService.sharedInstance.disconnect();
      RedisService.sharedInstance = null;
    }
  }

  getRedisUrl(): string {
    if (envVariables.SERVER.ENV === 'test') {
      return this.redisTestUrl || envVariables.REDIS.URL;
    }
    return envVariables.REDIS.URL;
  }
}
