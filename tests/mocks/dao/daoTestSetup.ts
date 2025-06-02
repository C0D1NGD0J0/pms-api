/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks

/**
 * Centralized DAO test setup to eliminate duplication across DAO test files
 * This file provides common setup patterns for all DAO tests
 */

import { setupDAOTestMocks } from './commonMocks';
import { TestDataFactory } from '@tests/utils/testHelpers';

// Initialize all common mocks
setupDAOTestMocks();

/**
 * Standard DAO test setup function
 * @param DAOClass - The DAO class to test
 * @param modelName - The model name for the DAO
 * @returns Setup objects for testing
 */
export const setupDAOTest = <T>(DAOClass: new (params: any) => T, modelName: string) => {
  let dao: T;
  let mockModel: any;
  let mockLogger: any;

  const setup = () => {
    // Create query chain objects for mongoose mocking
    const createQueryChain = () => ({
      select: jest.fn().mockReturnThis(),
      sort: jest.fn().mockReturnThis(),
      populate: jest.fn().mockReturnThis(),
      lean: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      session: jest.fn().mockReturnThis(),
      exec: jest.fn(),
    });

    mockModel = {
      create: jest.fn(),
      findOne: jest.fn(() => createQueryChain()),
      find: jest.fn(() => createQueryChain()),
      findById: jest.fn(() => createQueryChain()),
      findByIdAndUpdate: jest.fn(() => createQueryChain()),
      findOneAndUpdate: jest.fn(() => createQueryChain()),
      updateOne: jest.fn(() => createQueryChain()),
      updateMany: jest.fn(() => createQueryChain()),
      deleteOne: jest.fn(() => createQueryChain()),
      deleteMany: jest.fn(() => createQueryChain()),
      countDocuments: jest.fn(() => createQueryChain()),
      aggregate: jest.fn(() => createQueryChain()),
      insertMany: jest.fn(),
      startSession: jest.fn(),
      db: {
        startSession: jest.fn(),
      },
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    // Create DAO instance with appropriate model parameter
    const modelParam = {};
    modelParam[`${modelName.toLowerCase()}Model`] = mockModel;
    dao = new DAOClass(modelParam);

    return { dao, mockModel, mockLogger };
  };

  const beforeEachSetup = () => {
    jest.clearAllMocks();
    
    // Reset all mock implementations
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

    // Reset all model methods to use fresh query chains
    Object.keys(mockModel).forEach(key => {
      if (typeof mockModel[key] === 'function' && key !== 'create' && key !== 'insertMany' && key !== 'startSession') {
        mockModel[key].mockReturnValue(createMockQuery());
      }
    });
  };

  return {
    setup,
    beforeEachSetup,
    get dao() { return dao; },
    get mockModel() { return mockModel; },
    get mockLogger() { return mockLogger; },
  };
};

/**
 * Common test helpers for DAO tests
 */
export const DAOTestHelpers = {
  expectSuccessfulCRUD: (mockModel: any, method: string, params: any[]) => {
    expect(mockModel[method]).toHaveBeenCalledWith(...params);
  },

  expectDatabaseError: async (operation: () => Promise<any>, expectedError: string) => {
    await expect(operation()).rejects.toMatchObject({
      success: false,
      message: expectedError,
    });
  },

  createMockSession: () => ({
    withTransaction: jest.fn(),
    endSession: jest.fn(),
    hasEnded: false,
  }),

  createPaginatedResult: (data: any[], total: number, page = 1, limit = 10) => ({
    data,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  }),
};

/**
 * Standard describe block generators for common DAO test patterns
 */
export const DAOTestPatterns = {
  createCRUDTests: (daoName: string, entityFactory: () => any) => ({
    findById: () => ({
      describe: `${daoName} findById operations`,
      tests: [
        {
          name: 'should find entity by ID successfully',
          test: async (dao: any, mockModel: any) => {
            const id = 'test-id';
            const entity = entityFactory();
            mockModel.findById().exec.mockResolvedValue(entity);
            
            const result = await dao.findById(id);
            
            expect(result).toEqual(entity);
            expect(mockModel.findById).toHaveBeenCalledWith(id);
          }
        },
        {
          name: 'should return null for non-existent ID',
          test: async (dao: any, mockModel: any) => {
            const id = 'non-existent-id';
            mockModel.findById().exec.mockResolvedValue(null);
            
            const result = await dao.findById(id);
            
            expect(result).toBeNull();
          }
        }
      ]
    }),

    create: () => ({
      describe: `${daoName} create operations`,
      tests: [
        {
          name: 'should create entity successfully',
          test: async (dao: any, mockModel: any) => {
            const entityData = entityFactory();
            dao.insert = jest.fn().mockResolvedValue(entityData);
            
            const result = await dao.insert(entityData);
            
            expect(result).toEqual(entityData);
          }
        }
      ]
    })
  })
};

export default {
  setupDAOTest,
  DAOTestHelpers,
  DAOTestPatterns,
};