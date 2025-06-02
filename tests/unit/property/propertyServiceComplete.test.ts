/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { PropertyService } from '@services/property/property.service';
import { PropertyValidationService } from '@services/property/propertyValidation.service';
import { 
  mockPropertyDAO,
  mockPropertyUnitDAO,
  mockClientDAO,
  mockProfileDAO,
  mockPropertyCache,
  mockGeoCoderService,
  mockPropertyCsvProcessor,
  mockEventEmitterService,
  mockPropertyQueue,
  mockUploadQueue,
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  ValidationRequestError,
  InvalidRequestError,
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';
import { EventTypes } from '@interfaces/index';

// Mock PropertyValidationService
jest.mock('@services/property/propertyValidation.service', () => ({
  PropertyValidationService: {
    validateProperty: jest.fn(),
  },
}));

// Mock utilities
jest.mock('@utils/index', () => ({
  getRequestDuration: jest.fn(() => ({ durationInMs: 100 })),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  JOB_NAME: {
    CSV_VALIDATION: 'csv-validation',
    CSV_IMPORT: 'csv-import',
  },
}));

describe('PropertyService - Unit Tests', () => {
  let propertyService: PropertyService;

  beforeAll(() => {
    // Initialize service with mocked dependencies
    propertyService = new PropertyService({
      propertyDAO: mockPropertyDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      propertyCache: mockPropertyCache,
      geoCoderService: mockGeoCoderService,
      propertyCsvProcessor: mockPropertyCsvProcessor,
      emitterService: mockEventEmitterService,
      propertyQueue: mockPropertyQueue,
      uploadQueue: mockUploadQueue,
    });
  });

  beforeEach(() => {
    // Reset all mocks and container state
    resetTestContainer();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addProperty', () => {
    describe('Successful property creation', () => {
      it('should create a property successfully with valid data', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123' }, url: '/api/properties' },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const propertyData = TestDataFactory.createProperty({
          address: {
            fullAddress: '123 Test Street, Test City, TS 12345',
            street: '123 Test Street',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
          },
        });

        const mockClient = TestDataFactory.createClient({ cid: 'client-123' });
        const mockSession = { commit: jest.fn(), abort: jest.fn() };
        const createdProperty = { ...propertyData, _id: 'property-123' };

        // Mock validation
        PropertyValidationService.validateProperty.mockReturnValue({
          valid: true,
          errors: [],
        });

        // Mock session and transaction
        mockPropertyDAO.startSession.mockResolvedValue(mockSession);
        mockPropertyDAO.withTransaction.mockImplementation(async (session, callback) => {
          return await callback(session);
        });

        // Mock dependencies
        mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
        mockPropertyDAO.findPropertyByAddress.mockResolvedValue(null);
        mockPropertyDAO.createProperty.mockResolvedValue(createdProperty);
        mockPropertyCache.invalidatePropertyLists.mockResolvedValue(true);

        // Act
        const result = await propertyService.addProperty(context, propertyData);

        // Assert
        expect(result).toEqual({
          success: true,
          message: 'Property created successfully.',
          data: createdProperty,
        });

        expect(PropertyValidationService.validateProperty).toHaveBeenCalledWith(propertyData);
        expect(mockClientDAO.getClientByCid).toHaveBeenCalledWith('client-123');
        expect(mockPropertyDAO.findPropertyByAddress).toHaveBeenCalledWith(
          propertyData.address.fullAddress,
          'client-123'
        );
        expect(mockPropertyDAO.createProperty).toHaveBeenCalledWith(
          expect.objectContaining({
            ...propertyData,
            cid: 'client-123',
            userId: context.currentuser.sub,
          }),
          mockSession
        );
        expect(mockPropertyCache.invalidatePropertyLists).toHaveBeenCalledWith('client-123');
      });

      it('should handle property with uploaded files', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-456' }, url: '/api/properties' },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-456',
        };

        const propertyData = TestDataFactory.createProperty({
          scannedFiles: [
            {
              filename: 'property-doc.pdf',
              mimetype: 'application/pdf',
              size: 1024,
              path: '/tmp/property-doc.pdf',
            },
          ],
        });

        const mockClient = TestDataFactory.createClient();
        const mockSession = { commit: jest.fn(), abort: jest.fn() };
        const createdProperty = { ...propertyData, _id: 'property-456' };

        // Setup mocks
        PropertyValidationService.validateProperty.mockReturnValue({ valid: true, errors: [] });
        mockPropertyDAO.startSession.mockResolvedValue(mockSession);
        mockPropertyDAO.withTransaction.mockImplementation(async (session, callback) => {
          return await callback(session);
        });
        mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
        mockPropertyDAO.findPropertyByAddress.mockResolvedValue(null);
        mockPropertyDAO.createProperty.mockResolvedValue(createdProperty);
        mockUploadQueue.addToUploadQueue.mockResolvedValue(true);
        mockPropertyCache.invalidatePropertyLists.mockResolvedValue(true);

        // Act
        const result = await propertyService.addProperty(context, propertyData);

        // Assert
        expect(result.success).toBe(true);
        expect(mockUploadQueue.addToUploadQueue).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({
            files: propertyData.scannedFiles,
            propertyId: 'property-456',
          })
        );
      });
    });

    describe('Property creation validation errors', () => {
      it('should throw ValidationRequestError for invalid property data', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123' }, url: '/api/properties' },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const invalidPropertyData = {
          name: '', // Invalid empty name
          address: {}, // Invalid incomplete address
        };

        const validationErrors = [
          { field: 'name', message: 'Property name is required' },
          { field: 'address.street', message: 'Street address is required' },
        ];

        PropertyValidationService.validateProperty.mockReturnValue({
          valid: false,
          errors: validationErrors,
        });

        // Act & Assert
        await expect(propertyService.addProperty(context, invalidPropertyData))
          .rejects.toThrow(ValidationRequestError);

        expect(PropertyValidationService.validateProperty).toHaveBeenCalledWith(invalidPropertyData);
      });

      it('should throw BadRequestError for non-existent client', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'non-existent-client' }, url: '/api/properties' },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const propertyData = TestDataFactory.createProperty();
        const mockSession = { commit: jest.fn(), abort: jest.fn() };

        PropertyValidationService.validateProperty.mockReturnValue({ valid: true, errors: [] });
        mockPropertyDAO.startSession.mockResolvedValue(mockSession);
        mockPropertyDAO.withTransaction.mockImplementation(async (session, callback) => {
          return await callback(session);
        });
        mockClientDAO.getClientByCid.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyService.addProperty(context, propertyData))
          .rejects.toThrow(BadRequestError);

        expect(mockClientDAO.getClientByCid).toHaveBeenCalledWith('non-existent-client');
      });

      it('should throw InvalidRequestError for duplicate address', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123' }, url: '/api/properties' },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const propertyData = TestDataFactory.createProperty({
          address: {
            fullAddress: '123 Duplicate Street, Test City, TS 12345',
          },
        });

        const mockClient = TestDataFactory.createClient();
        const mockSession = { commit: jest.fn(), abort: jest.fn() };
        const existingProperty = TestDataFactory.createProperty();

        PropertyValidationService.validateProperty.mockReturnValue({ valid: true, errors: [] });
        mockPropertyDAO.startSession.mockResolvedValue(mockSession);
        mockPropertyDAO.withTransaction.mockImplementation(async (session, callback) => {
          return await callback(session);
        });
        mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
        mockPropertyDAO.findPropertyByAddress.mockResolvedValue(existingProperty);

        // Act & Assert
        await expect(propertyService.addProperty(context, propertyData))
          .rejects.toThrow(InvalidRequestError);

        expect(mockPropertyDAO.findPropertyByAddress).toHaveBeenCalledWith(
          propertyData.address.fullAddress,
          'client-123'
        );
      });
    });
  });

  describe('validateCsv', () => {
    describe('Successful CSV validation', () => {
      it('should validate CSV file successfully', async () => {
        // Arrange
        const cid = 'client-123';
        const csvFile = {
          filename: 'properties.csv',
          path: '/tmp/properties.csv',
          mimetype: 'text/csv',
          size: 2048,
        };
        const currentUser = TestDataFactory.createUser();

        const validationResult = {
          success: true,
          validRows: 10,
          invalidRows: 0,
          errors: [],
          data: [
            { name: 'Property 1', address: '123 Main St' },
            { name: 'Property 2', address: '456 Oak Ave' },
          ],
        };

        mockPropertyCsvProcessor.validateCsv.mockResolvedValue(validationResult);

        // Act
        const result = await propertyService.validateCsv(cid, csvFile, currentUser);

        // Assert
        expect(result).toEqual(validationResult);
        expect(mockPropertyCsvProcessor.validateCsv).toHaveBeenCalledWith(cid, csvFile, currentUser);
      });

      it('should handle CSV validation with errors', async () => {
        // Arrange
        const cid = 'client-456';
        const csvFile = {
          filename: 'properties-with-errors.csv',
          path: '/tmp/properties-with-errors.csv',
          mimetype: 'text/csv',
          size: 1024,
        };
        const currentUser = TestDataFactory.createUser();

        const validationResult = {
          success: false,
          validRows: 8,
          invalidRows: 2,
          errors: [
            { row: 3, message: 'Invalid address format' },
            { row: 7, message: 'Missing required field: name' },
          ],
          data: [],
        };

        mockPropertyCsvProcessor.validateCsv.mockResolvedValue(validationResult);

        // Act
        const result = await propertyService.validateCsv(cid, csvFile, currentUser);

        // Assert
        expect(result).toEqual(validationResult);
        expect(result.success).toBe(false);
        expect(result.invalidRows).toBe(2);
      });
    });

    describe('CSV validation errors', () => {
      it('should handle CSV processor errors', async () => {
        // Arrange
        const cid = 'client-123';
        const csvFile = {
          filename: 'corrupted.csv',
          path: '/tmp/corrupted.csv',
          mimetype: 'text/csv',
          size: 512,
        };
        const currentUser = TestDataFactory.createUser();

        mockPropertyCsvProcessor.validateCsv.mockRejectedValue(
          new Error('Failed to parse CSV file')
        );

        // Act & Assert
        await expect(propertyService.validateCsv(cid, csvFile, currentUser))
          .rejects.toThrow('Failed to parse CSV file');
      });
    });
  });

  describe('addPropertiesFromCsv', () => {
    describe('Successful CSV import', () => {
      it('should import properties from CSV successfully', async () => {
        // Arrange
        const cid = 'client-123';
        const csvFilePath = '/tmp/properties-import.csv';
        const currentUser = TestDataFactory.createUser();

        const importResult = {
          success: true,
          imported: 15,
          failed: 0,
          errors: [],
          properties: [
            TestDataFactory.createProperty({ name: 'Imported Property 1' }),
            TestDataFactory.createProperty({ name: 'Imported Property 2' }),
          ],
        };

        mockPropertyQueue.addCsvImportJob.mockResolvedValue(importResult);

        // Act
        const result = await propertyService.addPropertiesFromCsv(cid, csvFilePath, currentUser);

        // Assert
        expect(result).toEqual(importResult);
        expect(mockPropertyQueue.addCsvImportJob).toHaveBeenCalledWith(
          expect.any(String),
          {
            cid,
            csvFilePath,
            userId: currentUser.sub,
          }
        );
      });

      it('should handle partial import with some failures', async () => {
        // Arrange
        const cid = 'client-456';
        const csvFilePath = '/tmp/properties-partial.csv';
        const currentUser = TestDataFactory.createUser();

        const importResult = {
          success: true,
          imported: 12,
          failed: 3,
          errors: [
            { row: 5, message: 'Duplicate property name' },
            { row: 8, message: 'Invalid property type' },
            { row: 12, message: 'Missing required field' },
          ],
          properties: [
            TestDataFactory.createProperty({ name: 'Successfully Imported 1' }),
          ],
        };

        mockPropertyQueue.addCsvImportJob.mockResolvedValue(importResult);

        // Act
        const result = await propertyService.addPropertiesFromCsv(cid, csvFilePath, currentUser);

        // Assert
        expect(result.success).toBe(true);
        expect(result.imported).toBe(12);
        expect(result.failed).toBe(3);
        expect(result.errors).toHaveLength(3);
      });
    });

    describe('CSV import errors', () => {
      it('should handle import processing errors', async () => {
        // Arrange
        const cid = 'client-123';
        const csvFilePath = '/tmp/corrupted-import.csv';
        const currentUser = TestDataFactory.createUser();

        mockPropertyQueue.addCsvImportJob.mockRejectedValue(
          new Error('Failed to process CSV import')
        );

        // Act & Assert
        await expect(propertyService.addPropertiesFromCsv(cid, csvFilePath, currentUser))
          .rejects.toThrow('Failed to process CSV import');
      });
    });
  });

  describe('getClientProperties', () => {
    describe('Successful property retrieval', () => {
      it('should get all properties for client with pagination', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123' } },
          currentuser: TestDataFactory.createUser(),
        };
        const queryParams = {
          page: 1,
          limit: 10,
          propertyType: 'RESIDENTIAL',
        };

        const properties = [
          TestDataFactory.createProperty({ name: 'Property 1', propertyType: 'RESIDENTIAL' }),
          TestDataFactory.createProperty({ name: 'Property 2', propertyType: 'RESIDENTIAL' }),
        ];

        const paginatedResult = {
          data: properties,
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
            pages: 1,
          },
        };

        mockPropertyDAO.getFilteredProperties.mockResolvedValue(paginatedResult);

        // Act
        const result = await propertyService.getClientProperties(context, queryParams);

        // Assert
        expect(result).toEqual({
          success: true,
          data: paginatedResult.data,
          pagination: paginatedResult.pagination,
        });

        expect(mockPropertyDAO.getFilteredProperties).toHaveBeenCalledWith(
          'client-123',
          expect.objectContaining({
            page: 1,
            limit: 10,
            propertyType: 'RESIDENTIAL',
          })
        );
      });

      it('should handle empty property list', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-empty' } },
          currentuser: TestDataFactory.createUser(),
        };
        const queryParams = { page: 1, limit: 10 };

        const emptyResult = {
          data: [],
          pagination: {
            page: 1,
            limit: 10,
            total: 0,
            pages: 0,
          },
        };

        mockPropertyDAO.getFilteredProperties.mockResolvedValue(emptyResult);

        // Act
        const result = await propertyService.getClientProperties(context, queryParams);

        // Assert
        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });
    });

    describe('Property retrieval errors', () => {
      it('should handle database query errors', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123' } },
          currentuser: TestDataFactory.createUser(),
        };
        const queryParams = { page: 1, limit: 10 };

        mockPropertyDAO.getFilteredProperties.mockRejectedValue(
          new Error('Database connection failed')
        );

        // Act & Assert
        await expect(propertyService.getClientProperties(context, queryParams))
          .rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('getClientProperty', () => {
    describe('Successful property retrieval', () => {
      it('should get specific property by ID', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123', propertyId: 'property-456' } },
          currentuser: TestDataFactory.createUser(),
        };

        const property = TestDataFactory.createProperty({
          _id: 'property-456',
          cid: 'client-123',
        });

        const unitInfo = {
          totalUnits: 5,
          occupiedUnits: 3,
          vacantUnits: 2,
        };

        mockPropertyDAO.getClientProperty.mockResolvedValue(property);
        mockPropertyService.getUnitInfoForProperty = jest.fn().mockResolvedValue(unitInfo);

        // Act
        const result = await propertyService.getClientProperty(context);

        // Assert
        expect(result).toEqual({
          success: true,
          data: {
            ...property,
            unitInfo,
          },
        });

        expect(mockPropertyDAO.getClientProperty).toHaveBeenCalledWith('client-123', 'property-456');
      });
    });

    describe('Property retrieval errors', () => {
      it('should throw NotFoundError for non-existent property', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123', propertyId: 'non-existent' } },
          currentuser: TestDataFactory.createUser(),
        };

        mockPropertyDAO.getClientProperty.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyService.getClientProperty(context))
          .rejects.toThrow(NotFoundError);
      });
    });
  });

  describe('updateClientProperty', () => {
    describe('Successful property update', () => {
      it('should update property successfully', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123', propertyId: 'property-456' } },
          currentuser: TestDataFactory.createUser(),
        };

        const updateData = {
          name: 'Updated Property Name',
          description: 'Updated description',
        };

        const existingProperty = TestDataFactory.createProperty({
          _id: 'property-456',
          cid: 'client-123',
        });

        const updatedProperty = {
          ...existingProperty,
          ...updateData,
        };

        PropertyValidationService.validateProperty.mockReturnValue({ valid: true, errors: [] });
        mockPropertyDAO.getClientProperty.mockResolvedValue(existingProperty);
        mockPropertyDAO.updateClientProperty.mockResolvedValue(updatedProperty);
        mockPropertyCache.invalidateProperty.mockResolvedValue(true);
        mockPropertyCache.invalidatePropertyLists.mockResolvedValue(true);

        // Act
        const result = await propertyService.updateClientProperty(context, updateData);

        // Assert
        expect(result).toEqual({
          success: true,
          message: 'Property updated successfully.',
          data: updatedProperty,
        });

        expect(mockPropertyDAO.updateClientProperty).toHaveBeenCalledWith(
          'client-123',
          'property-456',
          updateData
        );
        expect(mockPropertyCache.invalidateProperty).toHaveBeenCalledWith('property-456');
        expect(mockPropertyCache.invalidatePropertyLists).toHaveBeenCalledWith('client-123');
      });
    });

    describe('Property update errors', () => {
      it('should throw ValidationRequestError for invalid update data', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123', propertyId: 'property-456' } },
          currentuser: TestDataFactory.createUser(),
        };

        const invalidUpdateData = {
          name: '', // Invalid empty name
          rent: -100, // Invalid negative rent
        };

        const validationErrors = [
          { field: 'name', message: 'Property name cannot be empty' },
          { field: 'rent', message: 'Rent must be positive' },
        ];

        PropertyValidationService.validateProperty.mockReturnValue({
          valid: false,
          errors: validationErrors,
        });

        // Act & Assert
        await expect(propertyService.updateClientProperty(context, invalidUpdateData))
          .rejects.toThrow(ValidationRequestError);
      });

      it('should throw NotFoundError for non-existent property', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123', propertyId: 'non-existent' } },
          currentuser: TestDataFactory.createUser(),
        };

        const updateData = { name: 'New Name' };

        PropertyValidationService.validateProperty.mockReturnValue({ valid: true, errors: [] });
        mockPropertyDAO.getClientProperty.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyService.updateClientProperty(context, updateData))
          .rejects.toThrow(NotFoundError);
      });
    });
  });

  describe('archiveClientProperty', () => {
    describe('Successful property archival', () => {
      it('should archive property successfully', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123', propertyId: 'property-456' } },
          currentuser: TestDataFactory.createUser(),
        };

        const property = TestDataFactory.createProperty({
          _id: 'property-456',
          cid: 'client-123',
          isArchived: false,
        });

        const archivedProperty = {
          ...property,
          isArchived: true,
        };

        mockPropertyDAO.getClientProperty.mockResolvedValue(property);
        mockPropertyDAO.updateClientProperty.mockResolvedValue(archivedProperty);
        mockPropertyCache.invalidateProperty.mockResolvedValue(true);
        mockPropertyCache.invalidatePropertyLists.mockResolvedValue(true);

        // Act
        const result = await propertyService.archiveClientProperty(context);

        // Assert
        expect(result).toEqual({
          success: true,
          message: 'Property archived successfully.',
          data: archivedProperty,
        });

        expect(mockPropertyDAO.updateClientProperty).toHaveBeenCalledWith(
          'client-123',
          'property-456',
          { isArchived: true }
        );
      });
    });

    describe('Property archival errors', () => {
      it('should throw NotFoundError for non-existent property', async () => {
        // Arrange
        const context = {
          request: { params: { cid: 'client-123', propertyId: 'non-existent' } },
          currentuser: TestDataFactory.createUser(),
        };

        mockPropertyDAO.getClientProperty.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyService.archiveClientProperty(context))
          .rejects.toThrow(NotFoundError);
      });
    });
  });

  describe('Event handling', () => {
    describe('handleUploadCompleted', () => {
      it('should handle upload completion event', async () => {
        // Arrange
        const payload = {
          propertyId: 'property-123',
          uploadResults: [
            { filename: 'doc1.pdf', url: 'https://example.com/doc1.pdf' },
            { filename: 'doc2.jpg', url: 'https://example.com/doc2.jpg' },
          ],
        };

        mockPropertyDAO.updatePropertyDocuments.mockResolvedValue(true);

        // Act
        await propertyService.handleUploadCompleted(payload);

        // Assert
        expect(mockPropertyDAO.updatePropertyDocuments).toHaveBeenCalledWith(
          payload.propertyId,
          payload.uploadResults
        );
      });
    });

    describe('handleUploadFailed', () => {
      it('should handle upload failure event', async () => {
        // Arrange
        const payload = {
          propertyId: 'property-456',
          error: 'Upload failed due to network error',
        };

        mockPropertyDAO.markDocumentsAsFailed = jest.fn().mockResolvedValue(true);

        // Act
        await propertyService.handleUploadFailed(payload);

        // Assert
        expect(mockPropertyDAO.markDocumentsAsFailed).toHaveBeenCalledWith(
          payload.propertyId,
          payload.error
        );
      });
    });

    it('should setup event listeners on initialization', () => {
      // Assert
      expect(mockEventEmitterService.on).toHaveBeenCalledWith(
        EventTypes.UPLOAD_COMPLETED,
        expect.any(Function)
      );
      expect(mockEventEmitterService.on).toHaveBeenCalledWith(
        EventTypes.UPLOAD_FAILED,
        expect.any(Function)
      );
    });
  });
});