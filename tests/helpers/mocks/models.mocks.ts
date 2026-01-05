import { Types } from 'mongoose';

/**
 * Generic Mongoose model mock factory
 * Provides consistent fluent interface and method mocking
 */
export const createMockModel = (overrides: Record<string, any> = {}) => ({
  // Document creation
  create: jest.fn(),
  insertMany: jest.fn(),

  // Document querying - returns query objects for chaining
  find: jest.fn().mockReturnThis(),
  findOne: jest.fn().mockReturnThis(),
  findById: jest.fn().mockReturnThis(),
  findOneAndUpdate: jest.fn().mockReturnThis(),
  findByIdAndUpdate: jest.fn().mockReturnThis(),

  // Document updating
  updateOne: jest.fn().mockReturnThis(),
  updateMany: jest.fn().mockReturnThis(),

  // Document deletion
  deleteOne: jest.fn().mockReturnThis(),
  deleteMany: jest.fn().mockReturnThis(),

  // Aggregation
  aggregate: jest.fn().mockReturnThis(),
  countDocuments: jest.fn().mockReturnThis(),

  // Query execution methods (fluent interface)
  exec: jest.fn(),
  lean: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  session: jest.fn().mockReturnThis(),
  cursor: jest.fn(),

  // Static methods
  cleanIndexes: jest.fn().mockResolvedValue(undefined),
  syncIndexes: jest.fn().mockResolvedValue(undefined),

  // Database connection
  db: {
    startSession: jest.fn(),
  },

  // Apply overrides
  ...overrides,
});

/**
 * Create a model mock with default successful responses
 */
export const createMockModelWithDefaults = (overrides: Record<string, any> = {}) => {
  const mockModel = createMockModel(overrides);

  // Configure default successful responses
  mockModel.exec.mockResolvedValue(null);
  mockModel.create.mockImplementation((data) =>
    Promise.resolve(Array.isArray(data)
      ? data.map(item => ({ ...item, _id: new Types.ObjectId() }))
      : { ...data, _id: new Types.ObjectId() }
    )
  );

  return mockModel;
};

/**
 * Create a notification-specific model mock
 */
export const createMockNotificationModel = (overrides: Record<string, any> = {}) => {
  const mockModel = createMockModelWithDefaults();

  // Notification-specific methods
  mockModel.cleanupDeleted = jest.fn().mockResolvedValue({ deletedCount: 0 });

  // Apply overrides
  Object.assign(mockModel, overrides);

  return mockModel;
};

/**
 * Mock document instance factory
 */
export const createMockDocument = (data: any = {}) => ({
  _id: new Types.ObjectId(),
  ...data,

  // Document instance methods
  save: jest.fn().mockResolvedValue(data),
  remove: jest.fn().mockResolvedValue(data),
  delete: jest.fn().mockResolvedValue(data),
  toJSON: jest.fn().mockReturnValue(data),
  toObject: jest.fn().mockReturnValue(data),
  markModified: jest.fn(),
  isModified: jest.fn().mockReturnValue(false),
  isNew: false,
});

/**
 * Helper to create chainable query mock results
 */
export const createChainableQueryResult = (result: any) => ({
  exec: jest.fn().mockResolvedValue(result),
  lean: jest.fn().mockReturnThis(),
  select: jest.fn().mockReturnThis(),
  populate: jest.fn().mockReturnThis(),
  sort: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  session: jest.fn().mockReturnThis(),
});

/**
 * Mock model constructor for jest.mock scenarios
 */
export const MockModel = jest.fn().mockImplementation(() =>
  createMockModelWithDefaults()
);