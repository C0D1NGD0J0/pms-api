import mongoose from 'mongoose';
import { envVariables } from '@shared/config';

const connectTestDB = async () => {
  try {
    mongoose.set('strictQuery', true);
    await mongoose.connect(envVariables.DATABASE.TEST_URL);
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
  await mongoose.connection.dropDatabase();
  await mongoose.connection.close();
  console.log('Disconnected from test database');
};

export const db = {
  connectTestDB,
  clearTestDB,
  disconnectTestDB,
};
