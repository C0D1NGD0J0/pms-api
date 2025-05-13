import supertest from 'supertest';
import { container } from '@di/index';

// Get the test app from the container (initialized in tests/configs/setup.ts)
export const getTestApp = () => {
  if (!container.hasRegistration('testApp')) {
    throw new Error('Test app not initialized. Make sure setup.ts has been run.');
  }
  return container.resolve('testApp');
};

export const appRequest = supertest(getTestApp());
