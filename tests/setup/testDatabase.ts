import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

let mongoServer: MongoMemoryReplSet | null = null;

const USE_LOCAL_MONGO = process.env.USE_LOCAL_MONGO === 'true';

/**
 * Connect to in-memory MongoDB for testing
 * Supports transactions via replica set
 */
export const connectTestDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) {
    return;
  }

  let uri: string;

  if (USE_LOCAL_MONGO) {
    uri = 'mongodb://localhost:27017/pms-test-debug';
    console.log('🔍 Using LOCAL MongoDB (dev mode):', uri);
  } else {
    console.log('🔍 Using MongoDB Memory Server (CI mode)');
    mongoServer = await MongoMemoryReplSet.create({
      replSet: {
        name: 'rs0',
        count: 1,
        storageEngine: 'wiredTiger',
      },
    });
    uri = mongoServer.getUri();
  }

  await mongoose.connect(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    directConnection: !USE_LOCAL_MONGO,
  });

  try {
    await Promise.all(Object.values(mongoose.connection.models).map((model) => model.init()));
  } catch (error) {
    console.warn('Warning: Could not initialize all models:', error);
  }
};

export const setupTestDatabase = connectTestDatabase;

/**
 * Disconnect from test database and stop memory server
 */
export const disconnectTestDatabase = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 100));

  if (mongoose.connection.readyState === 1) {
    try {
      if (!USE_LOCAL_MONGO) {
        await mongoose.connection.close(false); // false = don't force, graceful close
      } else {
        console.log('Test data preserved in: pms-test-debug');
        await mongoose.connection.close(false);
      }
    } catch (error) {
      // Silently ignore "client was closed" errors - connection already closed elsewhere
      if (!(error instanceof Error) || !error.message?.includes('client was closed')) {
        console.error('Error during test database disconnect:', error);
      }
    }
  }

  if (mongoServer) {
    try {
      await mongoServer.stop();
      mongoServer = null;
    } catch (error) {
      console.error('Error stopping MongoDB Memory Server:', error);
    }
  }
};

/**
 * Clear all collections in the test database
 * Call this in beforeEach to ensure test isolation
 */
export const clearTestDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
};

/**
 * Clear specific collection(s)
 */
export const clearCollections = async (...collectionNames: string[]): Promise<void> => {
  if (mongoose.connection.readyState !== 1) {
    return;
  }

  const collections = mongoose.connection.collections;
  for (const name of collectionNames) {
    if (collections[name]) {
      await collections[name].deleteMany({});
    }
  }
};

/**
 * Get connection status
 */
export const isTestDatabaseConnected = (): boolean => {
  return mongoose.connection.readyState === 1;
};

/**
 * Helper to run tests within a database context
 */
export const withTestDatabase = (
  testFn: () => void | Promise<void>
): (() => void | Promise<void>) => {
  return async () => {
    await connectTestDatabase();
    try {
      await testFn();
    } finally {
      await disconnectTestDatabase();
    }
  };
};
