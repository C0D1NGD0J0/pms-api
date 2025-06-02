/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { BaseDAO } from '@dao/baseDAO';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';
import { Types, Document, ClientSession } from 'mongoose';

// Mock environment variables
jest.mock('@shared/config', () => ({
  envVariables: {
    SERVER: {
      ENV: 'test',
    },
  },
}));

// Mock utilities
jest.mock('@utils/index', () => ({
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

// Mock custom errors
jest.mock('@shared/customErrors', () => {
  const handleMongoError = jest.fn((error) => {
    return {
      name: error.name || 'TestError',
      message: error.message || 'Test error message',
      statusCode: error.statusCode || 500,
      errorInfo: error.errorInfo || null,
      stack: error.stack,
    };
  });
  
  return {
    handleMongoError,
  };
});

// Create a test document interface
interface TestDocument extends Document {
  _id: Types.ObjectId;
  name: string;
  value: number;
  isActive: boolean;
  deletedAt: Date | null;
}

describe('BaseDAO - Unit Tests', () => {
  let baseDAO: BaseDAO<TestDocument>;
  let mockModel: any;
  let mockLogger: any;
  let mockSession: ClientSession;

  beforeAll(() => {
    mockModel = {
      findOne: jest.fn(),
      find: jest.fn(),
      findById: jest.fn(),
      findOneAndUpdate: jest.fn(),
      updateOne: jest.fn(),
      updateMany: jest.fn(),
      deleteOne: jest.fn(),
      deleteMany: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      insertMany: jest.fn(),
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

    mockSession = {
      withTransaction: jest.fn(),
      endSession: jest.fn(),
      hasEnded: false,
    } as any;

    baseDAO = new BaseDAO<TestDocument>(mockModel);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup default mock implementations
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

    mockModel.findOne.mockReturnValue(createMockQuery());
    mockModel.find.mockReturnValue(createMockQuery());
    mockModel.findById.mockReturnValue(createMockQuery());
    mockModel.findOneAndUpdate.mockReturnValue(createMockQuery());
    mockModel.updateOne.mockReturnValue(createMockQuery());
    mockModel.updateMany.mockReturnValue(createMockQuery());
    mockModel.deleteOne.mockReturnValue(createMockQuery());
    mockModel.deleteMany.mockReturnValue(createMockQuery());
    mockModel.countDocuments.mockReturnValue(createMockQuery());
    mockModel.aggregate.mockReturnValue(createMockQuery());
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findFirst', () => {
    describe('Successful document retrieval', () => {
      it('should find first document with basic filter', async () => {
        // Arrange
        const filter = { name: 'test' };
        const document = TestDataFactory.createGenericDocument({ name: 'test' });
        
        mockModel.findOne().exec.mockResolvedValue(document);

        // Act
        const result = await baseDAO.findFirst(filter);

        // Assert
        expect(result).toEqual(document);
        expect(mockModel.findOne).toHaveBeenCalledWith(filter);
      });

      it('should find first document with select option', async () => {
        // Arrange
        const filter = { isActive: true };
        const opts = { select: { name: 1, value: 1 } };
        const document = TestDataFactory.createGenericDocument({ isActive: true });
        
        mockModel.findOne().exec.mockResolvedValue(document);

        // Act
        const result = await baseDAO.findFirst(filter, opts);

        // Assert
        expect(result).toEqual(document);
        expect(mockModel.findOne().select).toHaveBeenCalledWith(opts.select);
      });

      it('should return null when no document is found', async () => {
        // Arrange
        const filter = { name: 'nonexistent' };
        
        mockModel.findOne().exec.mockResolvedValue(null);

        // Act
        const result = await baseDAO.findFirst(filter);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Document retrieval errors', () => {
      it('should handle database errors', async () => {
        // Arrange
        const filter = { name: 'test' };
        const dbError = new Error('Database connection failed');
        
        mockModel.findOne().exec.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.findFirst(filter))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Database connection failed',
          });
      });
    });
  });

  describe('list', () => {
    describe('Successful document listing', () => {
      it('should list documents with basic filter', async () => {
        // Arrange
        const filter = { isActive: true };
        const documents = [
          TestDataFactory.createGenericDocument({ isActive: true }),
          TestDataFactory.createGenericDocument({ isActive: true }),
        ];
        
        mockModel.find().exec.mockResolvedValue(documents);
        mockModel.countDocuments().exec.mockResolvedValue(2);

        // Act
        const result = await baseDAO.list(filter);

        // Assert
        expect(result.data).toEqual(documents);
        expect(result).toHaveProperty('pagination');
        expect(mockModel.find).toHaveBeenCalledWith(filter);
      });

      it('should handle empty results', async () => {
        // Arrange
        const filter = { name: 'nonexistent' };
        
        mockModel.find().exec.mockResolvedValue([]);
        mockModel.countDocuments().exec.mockResolvedValue(0);

        // Act
        const result = await baseDAO.list(filter);

        // Assert
        expect(result.data).toEqual([]);
        expect(result).toHaveProperty('pagination');
      });
    });

    describe('Document listing errors', () => {
      it('should handle database errors', async () => {
        // Arrange
        const filter = { name: 'test' };
        const dbError = new Error('Database query failed');
        
        mockModel.find().exec.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.list(filter))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Database query failed',
          });
      });
    });
  });

  describe('findById', () => {
    describe('Successful document retrieval by ID', () => {
      it('should find document by string ID', async () => {
        // Arrange
        const id = 'document-123';
        const document = TestDataFactory.createGenericDocument({ _id: id });
        
        mockModel.findById().exec.mockResolvedValue(document);

        // Act
        const result = await baseDAO.findById(id);

        // Assert
        expect(result).toEqual(document);
        expect(mockModel.findById).toHaveBeenCalledWith(id);
      });

      it('should return null for non-existent ID', async () => {
        // Arrange
        const id = 'non-existent-id';
        
        mockModel.findById().exec.mockResolvedValue(null);

        // Act
        const result = await baseDAO.findById(id);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Document retrieval by ID errors', () => {
      it('should handle database errors', async () => {
        // Arrange
        const id = 'error-id';
        const dbError = new Error('Database findById failed');
        
        mockModel.findById().exec.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.findById(id))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Database findById failed',
          });
      });
    });
  });

  describe('insert', () => {
    describe('Successful document insertion', () => {
      it('should insert document without session', async () => {
        // Arrange
        const data = { name: 'test document', value: 100 };
        const insertedDocument = TestDataFactory.createGenericDocument(data);
        
        mockModel.create.mockResolvedValue([insertedDocument]);

        // Act
        const result = await baseDAO.insert(data);

        // Assert
        expect(result).toEqual(insertedDocument);
        expect(mockModel.create).toHaveBeenCalledWith([{ ...data }], { session: null });
      });

      it('should insert document with session', async () => {
        // Arrange
        const data = { name: 'test document', value: 100 };
        const insertedDocument = TestDataFactory.createGenericDocument(data);
        
        mockModel.create.mockResolvedValue([insertedDocument]);

        // Act
        const result = await baseDAO.insert(data, mockSession);

        // Assert
        expect(result).toEqual(insertedDocument);
        expect(mockModel.create).toHaveBeenCalledWith([{ ...data }], { session: mockSession });
      });
    });

    describe('Document insertion errors', () => {
      it('should handle database insertion errors', async () => {
        // Arrange
        const data = { name: 'test document' };
        const dbError = new Error('Database insertion failed');
        
        mockModel.create.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.insert(data))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Database insertion failed',
          });
      });
    });
  });

  describe('updateById', () => {
    describe('Successful document update by ID', () => {
      it('should update document by ID', async () => {
        // Arrange
        const id = 'document-123';
        const updateData = { $set: { name: 'updated name' } };
        const updatedDocument = TestDataFactory.createGenericDocument({ 
          _id: id, 
          name: 'updated name' 
        });
        
        mockModel.findOneAndUpdate.mockResolvedValue(updatedDocument);

        // Act
        const result = await baseDAO.updateById(id, updateData);

        // Assert
        expect(result).toEqual(updatedDocument);
        expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
          { _id: expect.any(Types.ObjectId) },
          updateData,
          { new: true }
        );
      });

      it('should return null for non-existent document', async () => {
        // Arrange
        const id = 'non-existent-id';
        const updateData = { $set: { name: 'new name' } };
        
        mockModel.findOneAndUpdate.mockResolvedValue(null);

        // Act
        const result = await baseDAO.updateById(id, updateData);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Document update by ID errors', () => {
      it('should handle database update errors', async () => {
        // Arrange
        const id = 'error-id';
        const updateData = { $set: { name: 'updated' } };
        const dbError = new Error('Database update failed');
        
        mockModel.findOneAndUpdate.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.updateById(id, updateData))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Database update failed',
          });
      });
    });
  });

  describe('update', () => {
    describe('Successful document update', () => {
      it('should update document with filter', async () => {
        // Arrange
        const filter = { name: 'test' };
        const updateData = { $set: { value: 200 } };
        const updatedDocument = TestDataFactory.createGenericDocument({ 
          name: 'test',
          value: 200 
        });
        
        mockModel.findOneAndUpdate.mockResolvedValue(updatedDocument);

        // Act
        const result = await baseDAO.update(filter, updateData);

        // Assert
        expect(result).toEqual(updatedDocument);
        expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
          filter,
          updateData,
          { new: true, upsert: false }
        );
      });
    });
  });

  describe('deleteById', () => {
    describe('Successful document deletion by ID', () => {
      it('should delete document by ID', async () => {
        // Arrange
        const id = 'document-123';
        
        mockModel.deleteOne().exec.mockResolvedValue({ deletedCount: 1 });

        // Act
        const result = await baseDAO.deleteById(id);

        // Assert
        expect(result).toBe(true);
        expect(mockModel.deleteOne).toHaveBeenCalledWith({ 
          _id: expect.any(Types.ObjectId) 
        });
      });

      it('should return false when no document is deleted', async () => {
        // Arrange
        const id = 'non-existent-id';
        
        mockModel.deleteOne().exec.mockResolvedValue({ deletedCount: 0 });

        // Act
        const result = await baseDAO.deleteById(id);

        // Assert
        expect(result).toBe(false);
      });
    });

    describe('Document deletion by ID errors', () => {
      it('should handle database deletion errors', async () => {
        // Arrange
        const id = 'error-id';
        const dbError = new Error('Database deletion failed');
        
        mockModel.deleteOne().exec.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.deleteById(id))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Database deletion failed',
          });
      });
    });
  });

  describe('deleteAll', () => {
    describe('Successful multiple document deletion', () => {
      it('should delete all documents by IDs', async () => {
        // Arrange
        const ids = ['id1', 'id2', 'id3'];
        
        mockModel.deleteMany().exec.mockResolvedValue({ deletedCount: 3 });

        // Act
        const result = await baseDAO.deleteAll(ids);

        // Assert
        expect(result).toBe(true);
        expect(mockModel.deleteMany).toHaveBeenCalledWith({
          _id: { $in: expect.arrayContaining([
            expect.any(Types.ObjectId),
            expect.any(Types.ObjectId),
            expect.any(Types.ObjectId),
          ]) }
        });
      });

      it('should return false when not all documents are deleted', async () => {
        // Arrange
        const ids = ['id1', 'id2', 'id3'];
        
        mockModel.deleteMany().exec.mockResolvedValue({ deletedCount: 2 });

        // Act
        const result = await baseDAO.deleteAll(ids);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('countDocuments', () => {
    describe('Successful document counting', () => {
      it('should count documents with filter', async () => {
        // Arrange
        const filter = { isActive: true };
        
        mockModel.countDocuments().exec.mockResolvedValue(5);

        // Act
        const result = await baseDAO.countDocuments(filter);

        // Assert
        expect(result).toBe(5);
        expect(mockModel.countDocuments).toHaveBeenCalledWith(filter);
      });

      it('should return zero for no matching documents', async () => {
        // Arrange
        const filter = { name: 'nonexistent' };
        
        mockModel.countDocuments().exec.mockResolvedValue(0);

        // Act
        const result = await baseDAO.countDocuments(filter);

        // Assert
        expect(result).toBe(0);
      });
    });

    describe('Document counting errors', () => {
      it('should handle database count errors', async () => {
        // Arrange
        const filter = { name: 'test' };
        const dbError = new Error('Database count failed');
        
        mockModel.countDocuments().exec.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.countDocuments(filter))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Database count failed',
          });
      });
    });
  });

  describe('aggregate', () => {
    describe('Successful aggregation', () => {
      it('should perform aggregation with pipeline', async () => {
        // Arrange
        const pipeline = [
          { $match: { isActive: true } },
          { $group: { _id: '$name', count: { $sum: 1 } } },
        ];
        const aggregationResult = [
          { _id: 'test1', count: 2 },
          { _id: 'test2', count: 3 },
        ];
        
        mockModel.aggregate().exec.mockResolvedValue(aggregationResult);

        // Act
        const result = await baseDAO.aggregate(pipeline);

        // Assert
        expect(result).toEqual(aggregationResult);
        expect(mockModel.aggregate).toHaveBeenCalledWith(pipeline, undefined);
      });

      it('should perform aggregation with options', async () => {
        // Arrange
        const pipeline = [{ $match: { value: { $gt: 100 } } }];
        const opts = { allowDiskUse: true };
        const aggregationResult = [{ _id: 'result' }];
        
        mockModel.aggregate().exec.mockResolvedValue(aggregationResult);

        // Act
        const result = await baseDAO.aggregate(pipeline, opts);

        // Assert
        expect(result).toEqual(aggregationResult);
        expect(mockModel.aggregate).toHaveBeenCalledWith(pipeline, opts);
      });
    });

    describe('Aggregation errors', () => {
      it('should handle aggregation errors', async () => {
        // Arrange
        const pipeline = [{ $match: { name: 'test' } }];
        const dbError = new Error('Aggregation failed');
        
        mockModel.aggregate().exec.mockRejectedValue(dbError);

        // Act & Assert
        await expect(baseDAO.aggregate(pipeline))
          .rejects.toMatchObject({
            success: false,
            errorType: 'TestError',
            message: 'Aggregation failed',
          });
      });
    });
  });

  describe('upsert', () => {
    describe('Successful upsert operations', () => {
      it('should upsert document without session', async () => {
        // Arrange
        const data = { $set: { name: 'upserted', value: 150 } };
        const filter = { name: 'test' };
        const upsertedDocument = TestDataFactory.createGenericDocument({ 
          name: 'upserted',
          value: 150 
        });
        
        mockModel.findOneAndUpdate.mockResolvedValue(upsertedDocument);

        // Act
        const result = await baseDAO.upsert(data, filter);

        // Assert
        expect(result).toEqual(upsertedDocument);
        expect(mockModel.findOneAndUpdate).toHaveBeenCalledWith(
          filter,
          data,
          { new: true, upsert: true }
        );
      });
    });
  });

  describe('updateMany', () => {
    describe('Successful bulk updates', () => {
      it('should update many documents', async () => {
        // Arrange
        const filter = { isActive: true };
        const updateOperation = { $set: { value: 999 } };
        const updateResult = { 
          acknowledged: true, 
          modifiedCount: 3, 
          matchedCount: 3 
        };
        
        mockModel.updateMany().session().exec.mockResolvedValue(updateResult);

        // Act
        const result = await baseDAO.updateMany(filter, updateOperation);

        // Assert
        expect(result).toEqual(updateResult);
        expect(mockModel.updateMany).toHaveBeenCalledWith(filter, updateOperation);
      });
    });
  });

  describe('insertMany', () => {
    describe('Successful bulk insertion', () => {
      it('should insert many documents', async () => {
        // Arrange
        const documents = [
          { name: 'doc1', value: 100 },
          { name: 'doc2', value: 200 },
          { name: 'doc3', value: 300 },
        ];
        const insertedDocs = documents.map(doc => 
          TestDataFactory.createGenericDocument(doc)
        );
        
        mockModel.insertMany.mockResolvedValue(insertedDocs);

        // Act
        const result = await baseDAO.insertMany(documents);

        // Assert
        expect(result).toEqual(insertedDocs);
        expect(mockModel.insertMany).toHaveBeenCalledWith(documents, {
          session: null,
          ordered: false,
        });
      });

      it('should insert many documents with session', async () => {
        // Arrange
        const documents = [{ name: 'session doc' }];
        const insertedDocs = [TestDataFactory.createGenericDocument(documents[0])];
        
        mockModel.insertMany.mockResolvedValue(insertedDocs);

        // Act
        const result = await baseDAO.insertMany(documents, mockSession);

        // Assert
        expect(result).toEqual(insertedDocs);
        expect(mockModel.insertMany).toHaveBeenCalledWith(documents, {
          session: mockSession,
          ordered: false,
        });
      });
    });
  });

  describe('archiveDocument', () => {
    describe('Successful document archiving', () => {
      it('should archive document by setting deletedAt', async () => {
        // Arrange
        const id = 'document-123';
        
        mockModel.updateOne().exec.mockResolvedValue({
          acknowledged: true,
          modifiedCount: 1,
        });

        // Act
        const result = await baseDAO.archiveDocument(id);

        // Assert
        expect(result).toBe(true);
        expect(mockModel.updateOne).toHaveBeenCalledWith(
          { _id: expect.any(Types.ObjectId) },
          { $set: { deletedAt: expect.any(Date) } }
        );
      });

      it('should return false when document is not found', async () => {
        // Arrange
        const id = 'non-existent-id';
        
        mockModel.updateOne().exec.mockResolvedValue({
          acknowledged: true,
          modifiedCount: 0,
        });

        // Act
        const result = await baseDAO.archiveDocument(id);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('startSession', () => {
    describe('Successful session creation', () => {
      it('should start new MongoDB session', async () => {
        // Arrange
        mockModel.db.startSession.mockResolvedValue(mockSession);

        // Act
        const result = await baseDAO.startSession();

        // Assert
        expect(result).toEqual(mockSession);
        expect(mockModel.db.startSession).toHaveBeenCalled();
      });
    });

    describe('Session creation errors', () => {
      it('should handle session creation errors', async () => {
        // Arrange
        const sessionError = new Error('Session creation failed');
        
        mockModel.db.startSession.mockRejectedValue(sessionError);

        // Act & Assert
        await expect(baseDAO.startSession())
          .rejects.toThrow('Session creation failed');
      });
    });
  });

  describe('withTransaction', () => {
    describe('Successful transaction execution', () => {
      it('should execute operations within transaction', async () => {
        // Arrange
        const operationResult = { success: true };
        const operations = jest.fn().mockResolvedValue(operationResult);
        
        mockSession.withTransaction.mockImplementation(async (callback) => {
          return await callback();
        });

        // Act
        const result = await baseDAO.withTransaction(mockSession, operations);

        // Assert
        expect(result).toEqual(operationResult);
        expect(mockSession.withTransaction).toHaveBeenCalled();
        expect(operations).toHaveBeenCalledWith(mockSession);
      });

      it('should execute operations without session', async () => {
        // Arrange
        const operationResult = { noSession: true };
        const operations = jest.fn().mockResolvedValue(operationResult);

        // Act
        const result = await baseDAO.withTransaction(null, operations);

        // Assert
        expect(result).toEqual(operationResult);
        expect(operations).toHaveBeenCalledWith();
      });

      it('should end session after transaction', async () => {
        // Arrange
        const operations = jest.fn().mockResolvedValue({ success: true });
        
        mockSession.withTransaction.mockImplementation(async (callback) => {
          return await callback();
        });

        // Act
        await baseDAO.withTransaction(mockSession, operations);

        // Assert
        expect(mockSession.endSession).toHaveBeenCalled();
      });
    });

    describe('Transaction execution errors', () => {
      it('should handle transaction errors', async () => {
        // Arrange
        const operations = jest.fn().mockRejectedValue(new Error('Operation failed'));
        
        mockSession.withTransaction.mockImplementation(async (callback) => {
          return await callback();
        });

        // Act & Assert
        await expect(baseDAO.withTransaction(mockSession, operations))
          .rejects.toThrow('Operation failed');

        expect(mockSession.endSession).toHaveBeenCalled();
      });
    });
  });

  describe('throwErrorHandler', () => {
    describe('Error handling and formatting', () => {
      it('should format and throw database errors', () => {
        // Arrange
        const originalError = new Error('Test database error');
        originalError.name = 'DatabaseError';

        // Act
        const result = baseDAO.throwErrorHandler(originalError);

        // Assert
        expect(result).toMatchObject({
          success: false,
          errorType: 'DatabaseError',
          message: 'Test database error',
          statusCode: 500,
        });
      });

      it('should include stack trace in non-production environments', () => {
        // Arrange
        const originalError = new Error('Test error with stack');
        originalError.stack = 'Error stack trace...';

        // Act
        const result = baseDAO.throwErrorHandler(originalError);

        // Assert
        expect(result).toHaveProperty('stack');
        expect(result.stack).toBe('Error stack trace...');
      });
    });
  });
});