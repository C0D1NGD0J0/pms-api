/**
 * Centralized DAO test mocks and utilities
 * Export all common mocking functionality to eliminate duplication
 */

export * from './commonMocks';
export * from './daoTestSetup';

// Re-export for convenience
export { setupDAOTestMocks } from './commonMocks';
export { setupDAOTest, DAOTestHelpers, DAOTestPatterns } from './daoTestSetup';