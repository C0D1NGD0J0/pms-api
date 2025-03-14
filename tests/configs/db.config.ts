import mongoose from 'mongoose';
import { envVariables } from '@shared/config';

let isConnected = false;

const connectTestDB = async () => {
  if (isConnected && mongoose.connection.readyState === 1) {
    console.log('Already connected to test database');
    return true;
  }

  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(envVariables.DATABASE.TEST_URL);
    isConnected = true;
    console.log('Connected to test database');
    return true;
  } catch (error) {
    return false;
  }
};

const clearTestDB = async () => {
  const db = mongoose.connection.db;

  if (!db) {
    console.warn('No database connection found. Skipping test data clearance.');
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
  console.info('Test records have been cleared.');
};

const disconnectTestDB = async () => {
  if (!isConnected || mongoose.connection.readyState === 0) {
    console.log('No database connection found. Skipping test data clearance.');
    return true;
  }

  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  isConnected = false;
  console.log('Disconnected from test database');
};

export const db = {
  connectTestDB,
  clearTestDB,
  disconnectTestDB,
};
