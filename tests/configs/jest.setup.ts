import { jest } from '@jest/globals';
import express from 'express';
import { asValue } from 'awilix';
import { container } from '@di/index';
import { routes } from '@routes/index';
import cookieParser from 'cookie-parser';
import { contextBuilder } from '@shared/middlewares';

// Initialize test app once for all tests
const initializeTestApp = () => {
  // Check if already initialized
  if (container.hasRegistration('testApp')) {
    return;
  }

  const app = express();

  // Basic middleware
  app.use(express.json());
  app.use(cookieParser());

  // Context middleware
  app.use(contextBuilder);

  // Register routes
  const BASE_PATH = '/api/v1';
  
  // Health check route
  app.use(`${BASE_PATH}/healthcheck`, (req, res) => {
    const healthCheck = {
      uptime: process.uptime(),
      message: 'OK',
      timestamp: Date.now(),
      database: 'Connected', // Always return connected in test environment
    };
    res.status(200).json(healthCheck);
  });
  
  app.use(`${BASE_PATH}/auth`, routes.authRoutes);
  app.use(`${BASE_PATH}/properties`, routes.propertyRoutes);

  // Register app in container
  container.register({
    testApp: asValue(app),
  });
};

// Initialize the test app before all tests
initializeTestApp();

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