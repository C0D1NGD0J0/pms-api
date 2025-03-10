import mongoose from 'mongoose';
import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { RedisService } from './redis-setup';

export interface IDatabaseService {
  clearTestDataRecords: (env?: Environments) => Promise<void>;
  disconnect: (env?: Environments) => Promise<void>;
  connect: (env?: Environments) => Promise<void>;
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

  async connect(env: Environments = envVariables.SERVER.ENV as Environments): Promise<void> {
    if (this.connected) {
      this.log.info('Database is already connected');
      return;
    }

    try {
      mongoose.set('strictQuery', true);
      let url: string;

      if (env === 'test') {
        this.mongoMemoryServer = await MongoMemoryServer.create({
          instance: {
            dbName: envVariables.DATABASE.TEST_URL,
          },
        });
        url = this.mongoMemoryServer.getUri();
      } else {
        url = this.getDatabaseUrl(env);
      }

      await mongoose.connect(url);
      if (env !== 'test') {
        this.redisService.connect();
      }
      mongoose.connection.on('disconnected', () => {
        this.connected = false;
        this.log.error('MongoDB disconnected....');
      });
      this.connected = true;
      this.log.info(`Connected to ${env} database`);
    } catch (err) {
      this.log.error(`Database Connection Error for ${env}: `, err);
      // process.exit(1);
      throw err;
    }
  }

  async disconnect(env: Environments = envVariables.SERVER.ENV as Environments): Promise<void> {
    try {
      if (!this.isConnected()) {
        this.log.info('Database is already disconnected');
        return;
      }

      if (env === 'test' && this.mongoMemoryServer) {
        await mongoose.connection.dropDatabase();
        await this.mongoMemoryServer.stop();
        this.mongoMemoryServer = null;
      }

      await mongoose.connection.close();
      this.connected = false;
      this.log.info(`Disconnected from ${env} database`);
    } catch (err) {
      this.log.error(`Database Disconnection Error for ${env}: `, err);
    }
  }

  async clearTestDataRecords(env: Environments = envVariables.SERVER.ENV as Environments) {
    if (env !== 'test') {
      this.log.warn(
        `Cannot clear data in ${env} environment. Operation only allowed in test environment.`
      );
      return;
    }

    try {
      if (env === 'test') {
        const db = mongoose.connection.db;

        if (!db) {
          this.log.warn('No database connection found. Skipping test data clearance.');
          return;
        }

        const collections = await db.collections();
        if (collections.length === 0) {
          return;
        }

        for (const collection of collections) {
          await collection.deleteMany({});
          await collection.dropIndexes();
        }
        this.log.info('Test records have been cleared.');
      }
    } catch (error) {
      this.log.error('Error clearing test data:', error);
      throw error;
    }
  }

  private getDatabaseUrl(env: Environments): string {
    switch (env) {
      case 'development':
        return envVariables.DATABASE.DEV_URL;
      case 'production':
        return envVariables.DATABASE.PROD_URL;
      default:
        throw new Error('Unknown environment');
    }
  }
}
