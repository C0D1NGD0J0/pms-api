/**
 * Test Database Setup
 *
 * Provides MongoDB Memory Server connection for integration tests.
 * Uses the existing DatabaseService which already has test environment support.
 *
 * Set USE_LOCAL_MONGO=true to use local MongoDB instead (data persists for debugging)
 */

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
    console.log('   Data will persist - check with MongoDB Compass');
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
};

export const setupTestDatabase = connectTestDatabase;

/**
 * Disconnect from test database and stop memory server
 */
export const disconnectTestDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    if (!USE_LOCAL_MONGO) {
      await mongoose.connection.dropDatabase();
    } else {
      console.log('   Test data preserved in: pms-test-debug');
    }
    await mongoose.connection.close();
  }

  if (mongoServer) {
    await mongoServer.stop();
    mongoServer = null;
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
