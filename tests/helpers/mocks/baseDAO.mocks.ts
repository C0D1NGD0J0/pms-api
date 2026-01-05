import { Types } from 'mongoose';

/**
 * Centralized BaseDAO mock factory
 * Provides consistent mock implementation for all DAO tests
 */
export const createMockBaseDAO = () => ({
  insert: jest.fn(),
  insertMany: jest.fn(),
  findFirst: jest.fn(),
  findById: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  deleteItem: jest.fn(),

  list: jest.fn().mockResolvedValue({
    items: [],
    pagination: {
      total: 0,
      currentPage: 1,
      totalPages: 1,
      hasMoreResource: false,
      perPage: 10,
    },
  }),
  countDocuments: jest.fn().mockResolvedValue(0),
  aggregate: jest.fn().mockResolvedValue([]),

  // Bulk operations
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
  deleteAll: jest.fn().mockResolvedValue(true),
  upsert: jest.fn(),

  // Utility operations
  createInstance: jest.fn(),
  archiveDocument: jest.fn().mockResolvedValue(true),

  // Transaction support
  startSession: jest.fn(),
  withTransaction: jest.fn().mockImplementation((session, operations) => {
    return operations();
  }),

  // Batch processing
  aggregateCursor: jest.fn(),
  aggregateInBatches: jest.fn(),

  // Error handling
  throwErrorHandler: jest.fn().mockImplementation((error) => {
    throw error;
  }),

  // Model reference (will be overridden in specific tests)
  model: null,
});

/**
 * BaseDAO mock with commonly used method implementations
 * Use this when you need basic successful responses
 */
export const createMockBaseDAOWithDefaults = () => ({
  ...createMockBaseDAO(),

  // Default successful implementations
  insert: jest
    .fn()
    .mockImplementation((data) => Promise.resolve({ ...data, _id: new Types.ObjectId() })),
  insertMany: jest
    .fn()
    .mockImplementation((items) =>
      Promise.resolve(items.map((item) => ({ ...item, _id: new Types.ObjectId() })))
    ),
  findFirst: jest.fn().mockResolvedValue(null),
  findById: jest.fn().mockResolvedValue(null),
  updateById: jest
    .fn()
    .mockImplementation((id, updates) =>
      Promise.resolve({ _id: new Types.ObjectId(id), ...updates })
    ),
  deleteById: jest.fn().mockResolvedValue(true),
  deleteItem: jest.fn().mockResolvedValue(true),
});

/**
 * Create a BaseDAO mock configured for specific test scenarios
 */
export const createMockBaseDAOForTesting = (overrides: Record<string, any> = {}) => ({
  ...createMockBaseDAO(),
  ...overrides,
});

/**
 * Mock BaseDAO class for jest.mock scenarios
 */
export const MockBaseDAO = jest.fn().mockImplementation((model) => ({
  ...createMockBaseDAO(),
  model,
}));
