import mongoose from 'mongoose';
import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { RedisService } from './redis-setup';

export interface IDatabaseService {
  disconnect: (env?: Environments) => Promise<boolean>;
  connect: (env?: Environments) => Promise<boolean>;
  isConnected: () => boolean;
}

export type Environments = 'development' | 'production' | 'test';

export class DatabaseService implements IDatabaseService {
  private log;
  private connected = false;
  private redisService: RedisService;
  private mongoMemoryServer: MongoMemoryServer | null = null;

  constructor({ redisService }: { redisService: RedisService }) {
    this.log = createLogger('DatabaseService');
    this.redisService = redisService;
  }

  isConnected(): boolean {
    return this.connected && mongoose.connection.readyState === 1;
  }

  async connect(env: Environments = envVariables.SERVER.ENV as Environments): Promise<boolean> {
    if (this.connected) {
      this.log.info('Database is already connected');
      return true;
    }

    if (env === 'test') {
      try {
        if (!this.mongoMemoryServer) {
          this.mongoMemoryServer = await MongoMemoryServer.create();
        }
        const uri = this.mongoMemoryServer.getUri();
        await mongoose.connect(uri, {
          maxPoolSize: 10,
          minPoolSize: 2,
          socketTimeoutMS: 30000,
          connectTimeoutMS: 10000,
          serverSelectionTimeoutMS: 10000,
        });
        this.connected = true;
        this.log.info('Connected to test database (in-memory)');
        return true;
      } catch (err) {
        this.log.error('Test Database Connection Error: ', err);
        return false;
      }
    }

    try {
      mongoose.set('strictQuery', true);

      const url = this.getDatabaseUrl(env);
      console.log(`🔗 Connecting to ${env} database at ${url}...`);
      await mongoose.connect(url, {
        family: 4,
        minPoolSize: 5,
        maxPoolSize: 20,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        serverSelectionTimeoutMS: 15000,
      });

      // Set up Redis connection
      this.redisService.connect();

      // Set up disconnect handler
      mongoose.connection.on('disconnected', () => {
        this.connected = false;
        this.log.error('MongoDB disconnected....');
      });

      this.connected = true;
      console.log('✅ Database service fully initialized');
      this.log.info(`Connected to ${env} database`);
      return true;
    } catch (err) {
      console.error('❌ Database connection failed:', err);
      this.log.error(`Database Connection Error for ${env}: `, err);
      this.connected = false;
      throw err;
    }
  }

  async disconnect(env: Environments = envVariables.SERVER.ENV as Environments): Promise<boolean> {
    try {
      if (!this.isConnected()) {
        this.log.info('Database is already disconnected');
        return true;
      }

      await mongoose.connection.close();

      if (env === 'test' && this.mongoMemoryServer) {
        await this.mongoMemoryServer.stop();
        this.mongoMemoryServer = null;
        this.log.info('Stopped test database (in-memory)');
      }

      this.connected = false;
      this.log.info(`Disconnected from ${env} database`);
      return true;
    } catch (err) {
      this.log.error(`Database Disconnection Error for ${env}: `, err);
      return false;
    }
  }

  private getDatabaseUrl(env: Environments): string {
    switch (env) {
      case 'development':
        return envVariables.DATABASE.DEV_URL;
      case 'production':
        return envVariables.DATABASE.PROD_URL;
      default:
        return envVariables.DATABASE.DEV_URL;
      // throw new Error('Unknown environment');
    }
  }
}
