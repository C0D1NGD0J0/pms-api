/**
 * Test Database Setup
 *
 * Provides MongoDB Memory Server connection for integration tests.
 * Uses the existing DatabaseService which already has test environment support.
 */

import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongoServer: MongoMemoryServer | null = null;

/**
 * Connect to in-memory MongoDB for testing
 */
export const connectTestDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState === 1) {
    return; // Already connected
  }

  mongoServer = await MongoMemoryServer.create();
  const uri = mongoServer.getUri();

  await mongoose.connect(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    socketTimeoutMS: 30000,
    connectTimeoutMS: 10000,
    serverSelectionTimeoutMS: 10000,
  });
};

/**
 * Disconnect from test database and stop memory server
 */
export const disconnectTestDatabase = async (): Promise<void> => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.connection.dropDatabase();
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
