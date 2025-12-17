import type { JestConfigWithTsJest } from 'ts-jest';
import baseConfig from './jest.config';

/**
 * Jest Configuration for Integration Tests
 *
 * Integration tests validate that services, DAOs, and controllers work together
 * correctly with the real database (mongodb-memory-server).
 *
 * Only external services (S3, email, queues, payment APIs) are mocked.
 */
const config: JestConfigWithTsJest = {
  ...baseConfig,
  displayName: 'integration',
  testMatch: ['**/tests/integration/**/*.test.[jt]s?(x)'],
  testTimeout: 60000, // Integration tests may take longer
  maxWorkers: 1, // Run integration tests serially to avoid DB conflicts
  coverageThreshold: {
    global: {
      branches: 50,
      functions: 60,
      lines: 70,
      statements: 70,
    },
  },
};

export default config;
