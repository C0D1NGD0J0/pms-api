/**
 * Jest Setup File
 *
 * Global test configuration and setup that runs once before all tests.
 * This file is executed by Jest before running test suites.
 */

import { disconnectTestDatabase, setupTestDatabase } from './testDatabase';
import { setupAllExternalMocks, resetAllExternalMocks } from './externalMocks';

jest.setTimeout(process.env.JEST_USE_DB === 'true' ? 90000 : 30000);

const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const shouldUseDatabase = process.env.JEST_USE_DB === 'true';

beforeAll(async () => {
  console.error = (...args: any[]) => {
    if (
      args[0]?.includes?.('punycode') ||
      args[0]?.includes?.('deprecated') ||
      args[0]?.includes?.('ExperimentalWarning')
    ) {
      return;
    }
    originalConsoleError(...args);
  };

  console.warn = (...args: any[]) => {
    if (
      args[0]?.includes?.('punycode') ||
      args[0]?.includes?.('deprecated') ||
      args[0]?.includes?.('ExperimentalWarning')
    ) {
      return;
    }
    originalConsoleWarn(...args);
  };

  if (shouldUseDatabase) {
    await setupTestDatabase();
  }

  setupAllExternalMocks();
});

afterAll(async () => {
  console.error = originalConsoleError;
  console.warn = originalConsoleWarn;

  if (shouldUseDatabase) {
    await disconnectTestDatabase();
  }
});

beforeEach(() => {
  resetAllExternalMocks();
});

// =============================================================================
// Custom Jest Matchers
// =============================================================================

expect.extend({
  toBeValidObjectId(received) {
    const pass = typeof received === 'string' && /^[0-9a-fA-F]{24}$/.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid ObjectId`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid ObjectId`,
        pass: false,
      };
    }
  },

  toBeValidEmail(received) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const pass = typeof received === 'string' && emailRegex.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid email`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid email`,
        pass: false,
      };
    }
  },

  toBeValidJWT(received) {
    const jwtRegex = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/;
    const pass = typeof received === 'string' && jwtRegex.test(received);
    if (pass) {
      return {
        message: () => `expected ${received} not to be a valid JWT`,
        pass: true,
      };
    } else {
      return {
        message: () => `expected ${received} to be a valid JWT`,
        pass: false,
      };
    }
  },
});

// =============================================================================
// TypeScript Type Declarations
// =============================================================================

declare module '@jest/expect' {
  interface Matchers<R> {
    toBeValidObjectId(): R;
    toBeValidEmail(): R;
    toBeValidJWT(): R;
  }
}
