/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks

import { jest } from '@jest/globals';

// Mock all models with common mongoose query pattern
export const createMockModel = () => {
  const createMockQuery = (returnValue = null) => ({
    select: jest.fn().mockReturnThis(),
    sort: jest.fn().mockReturnThis(),
    populate: jest.fn().mockReturnThis(),
    lean: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    session: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue(returnValue),
  });

  return {
    create: jest.fn(),
    findOne: jest.fn(() => createMockQuery()),
    find: jest.fn(() => createMockQuery()),
    findById: jest.fn(() => createMockQuery()),
    findByIdAndUpdate: jest.fn(() => createMockQuery()),
    findByIdAndDelete: jest.fn(() => createMockQuery()),
    findOneAndUpdate: jest.fn(() => createMockQuery()),
    updateOne: jest.fn(() => createMockQuery()),
    updateMany: jest.fn(() => createMockQuery()),
    deleteOne: jest.fn(() => createMockQuery()),
    deleteMany: jest.fn(() => createMockQuery()),
    countDocuments: jest.fn(() => createMockQuery()),
    aggregate: jest.fn(() => createMockQuery()),
    insertMany: jest.fn(),
    startSession: jest.fn(),
    db: {
      startSession: jest.fn(),
    },
  };
};

// Mock the models module
export const mockModels = () => {
  jest.mock('@models/index', () => ({
    User: createMockModel(),
    Client: createMockModel(),
    Profile: createMockModel(),
    Property: createMockModel(),
    PropertyUnit: createMockModel(),
  }));
};

// Mock BaseDAO
export const mockBaseDAO = () => {
  jest.mock('@dao/baseDAO', () => ({
    BaseDAO: class MockBaseDAO {
      constructor() {}
      startSession = jest.fn();
      withTransaction = jest.fn();
      findFirst = jest.fn();
      findById = jest.fn();
      list = jest.fn();
      insert = jest.fn();
      update = jest.fn();
      updateById = jest.fn();
      updateMany = jest.fn();
      deleteById = jest.fn();
      deleteAll = jest.fn();
      countDocuments = jest.fn();
      aggregate = jest.fn();
      upsert = jest.fn();
      insertMany = jest.fn();
      archiveDocument = jest.fn();
      createInstance = jest.fn();
      throwErrorHandler = jest.fn((error) => error);
    },
  }));
};

// Mock utilities
export const mockUtilities = () => {
  jest.mock('@utils/index', () => ({
    generateShortUID: jest.fn(() => 'profile-12345'),
    hashGenerator: jest.fn(() => 'generated-hash-token'),
    createLogger: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    })),
    paginateResult: jest.fn((count, skip, limit) => ({
      page: Math.floor((skip || 0) / (limit || 10)) + 1,
      limit: limit || 10,
      total: count,
      pages: Math.ceil(count / (limit || 10)),
    })),
  }));
};

// Mock custom errors
export const mockCustomErrors = () => {
  jest.mock('@shared/customErrors', () => ({
    handleMongoError: jest.fn((error) => ({
      name: error.name || 'TestError',
      message: error.message || 'Test error message',
      statusCode: error.statusCode || 500,
      errorInfo: error.errorInfo || null,
      stack: error.stack,
    })),
    BadRequestError: class MockBadRequestError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'BadRequestError';
      }
    },
    NotFoundError: class MockNotFoundError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'NotFoundError';
      }
    },
  }));
};

// Mock environment config
export const mockEnvironmentConfig = () => {
  jest.mock('@shared/config', () => ({
    envVariables: {
      SERVER: {
        ENV: 'test',
      },
    },
  }));
};

// Mock dayjs
export const mockDayjs = () => {
  jest.mock('dayjs', () => {
    const originalDayjs = jest.requireActual('dayjs');
    const mockDayjs = jest.fn(() => ({
      add: jest.fn(() => ({
        toDate: jest.fn(() => new Date('2024-01-01T14:00:00Z')), // 2 hours later
      })),
    }));
    mockDayjs.extend = originalDayjs.extend;
    return mockDayjs;
  });
};

// Centralized setup function for DAO tests
export const setupDAOTestMocks = () => {
  mockEnvironmentConfig();
  mockUtilities();
  mockCustomErrors();
  mockModels();
  mockBaseDAO();
  mockDayjs();
};

// Export individual functions for selective use
export {
  mockModels,
  mockBaseDAO,
  mockUtilities,
  mockCustomErrors,
  mockEnvironmentConfig,
  mockDayjs,
};
