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
    console.log('Checking database connection status...', envVariables);
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

      await mongoose.connect(url, {
        maxPoolSize: 20,
        minPoolSize: 5,
        socketTimeoutMS: 45000,
        connectTimeoutMS: 10000,
        family: 4,
        serverSelectionTimeoutMS: 15000,
      });
      this.redisService.connect();

      mongoose.connection.on('disconnected', () => {
        this.connected = false;
        this.log.error('MongoDB disconnected....');
      });
      this.connected = true;
      this.log.info(`Connected to ${env} database`);
      return true;
    } catch (err) {
      this.log.error(`Database Connection Error for ${env}: `, err);
      // process.exit(1);
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
