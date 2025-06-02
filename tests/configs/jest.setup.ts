import { jest } from '@jest/globals';

// Global Jest setup for all tests
beforeEach(() => {
  // Clear all mock calls and instances between tests
  jest.clearAllMocks();
  
  // Reset all mocks to their initial state
  jest.resetAllMocks();
  
  // Clear any module mocks
  jest.clearAllTimers();
  
  // Force garbage collection if available (for memory management)
  if (global.gc) {
    global.gc();
  }
});

afterEach(() => {
  // Additional cleanup after each test
  jest.restoreAllMocks();
});

// Global error handler for unhandled rejections in tests
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Increase the default timeout for async operations
jest.setTimeout(30000);

// Mock console methods to avoid noise in test output (optional)
global.console = {
  ...console,
  // Uncomment these to silence console output during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};