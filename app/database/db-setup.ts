import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

import { envVariables } from '@shared/config';
import { createLogger } from '@utils/helpers';

export type Environments = 'development' | 'production' | 'test';

interface IDatabaseService {
  clearTestDataRecords: (env: Environments) => Promise<void>;
  disconnect: (env: Environments) => Promise<void>;
  connect: (env: Environments) => Promise<void>;
}

export class DatabaseService implements IDatabaseService {
  private log;
  private connected = false;
  private mongoMemoryServer: MongoMemoryServer | null = null;

  constructor() {
    this.log = createLogger('DatabaseService');
  }

  public async connect(env: Environments = 'development'): Promise<void> {
    if (this.connected) {
      return this.log.info('Database is already connected');
    }

    try {
      mongoose.set('strictQuery', true);
      let url: string;

      if (env === 'test') {
        this.mongoMemoryServer = await MongoMemoryServer.create({
          instance: {
            dbName: envVariables.DATABASE.TESTDB_NAME,
          },
        });
        url = this.mongoMemoryServer.getUri();
      } else {
        url = this.getDatabaseUrl(env);
      }

      await mongoose.connect(url);

      this.connected = true;
      this.log.info(`Connected to ${env} database`);
    } catch (err) {
      this.log.error(`Database Connection Error for ${env}: `, err);
      process.exit(1); // Exit process with failure
    }
  }

  public async disconnect(env: Environments): Promise<void> {
    try {
      if (env === 'test' && this.mongoMemoryServer) {
        await this.mongoMemoryServer.stop();
        await mongoose.connection.dropDatabase();
      }

      await mongoose.connection.close();
      this.connected = false;
      this.log.info(`Disconnected from ${env} database`);
    } catch (err) {
      this.log.error(`Database Disconnection Error for ${env}: `, err);
    }
  }

  public async clearTestDataRecords(env: Environments) {
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
  }

  private getDatabaseUrl(env: Environments): string {
    switch (env) {
      case 'development':
        return envVariables.DATABASE.DEVDB_URL;
      case 'production':
        return envVariables.DATABASE.PRODDB_URL;
      case 'test':
        return envVariables.DATABASE.TESTDB_URL;
      default:
        throw new Error('Unknown environment');
    }
  }
}
