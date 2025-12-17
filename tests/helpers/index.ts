/**
 * Test Helpers Index
 *
 * Re-exports test setup utilities and factories.
 * Note: Old mock files have been removed in favor of the new test infrastructure.
 */

// External service mocks (only mock external services like S3, email, queues)
export {
  setupAllExternalMocks,
  resetAllExternalMocks,
  mockEmailTransporter,
  mockS3Client,
  mockQueue,
} from '../setup/externalMocks';

// Test database setup
export {
  disconnectTestDatabase,
  setupTestDatabase,
  clearTestDatabase,
} from '../setup/testDatabase';

// Test factories (create real data)
export * from '../setup/testFactories';
