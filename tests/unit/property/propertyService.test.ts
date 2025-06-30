/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { PropertyService } from '@services/property/property.service';
import { 
  mockPropertyDAO,
  mockPropertyUnitDAO,
  mockClientDAO,
  mockProfileDAO,
  mockPropertyCache,
  mockEventEmitterService,
  mockPropertyQueue,
  mockUploadQueue,
  mockGeoCoderService,
  mockPropertyCsvProcessor,
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError,
  ValidationRequestError
} from '@shared/customErrors';

// Mock PropertyValidationService
jest.mock('@services/property/propertyValidation.service', () => ({
  PropertyValidationService: {
    validateProperty: jest.fn().mockReturnValue({ valid: true, errors: [] })
  }
}));

jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  getRequestDuration: jest.fn(() => ({ durationInMs: 100 })),
  generateShortUID: jest.fn(() => 'prop-123'),
  JOB_NAME: {
    PROPERTY_CREATED: 'property_created'
  }
}));

describe('PropertyService - Unit Tests', () => {
  let propertyService: PropertyService;

  beforeAll(() => {
    propertyService = new PropertyService({
      propertyDAO: mockPropertyDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      propertyCache: mockPropertyCache,
      emitterService: mockEventEmitterService,
      propertyQueue: mockPropertyQueue,
      uploadQueue: mockUploadQueue,
      geoCoderService: mockGeoCoderService,
      propertyCsvProcessor: mockPropertyCsvProcessor,
    });
  });

  beforeEach(() => {
    resetTestContainer();
    jest.clearAllMocks();
  });

  describe('addProperty', () => {
    it('should create property successfully', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123' },
          url: '/api/properties'
        },
        currentuser: TestDataFactory.createUser({ sub: 'user-123' }),
        requestId: 'req-123'
      };

      const propertyData = TestDataFactory.createProperty({
        name: 'Test Property',
        address: '123 Main St',
        propertyType: 'RESIDENTIAL'
      });

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockCreatedProperty = { ...propertyData, _id: 'property-123' };

      mockClientDAO.findByCid.mockResolvedValue(mockClient);
      mockGeoCoderService.parseLocation.mockResolvedValue({ 
        success: true, 
        data: { coordinates: [-74.006, 40.7128] } 
      });
      mockPropertyDAO.startSession.mockResolvedValue({});
      mockPropertyDAO.withTransaction.mockImplementation((session, callback) => callback(session));
      mockPropertyDAO.insert.mockResolvedValue(mockCreatedProperty);
      mockPropertyCache.invalidatePropertyLists.mockResolvedValue(true);

      // Act
      const result = await propertyService.addProperty(context, propertyData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('Property created successfully');
      expect(result.data).toEqual(mockCreatedProperty);
      expect(mockClientDAO.findByCid).toHaveBeenCalledWith('client-123');
      expect(mockPropertyDAO.insert).toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123' },
          url: '/api/properties'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const invalidPropertyData = {
        name: '', // Invalid - empty name
        address: '',
        propertyType: 'INVALID'
      };

      // Mock validation failure
      const { PropertyValidationService } = require('@services/property/propertyValidation.service');
      PropertyValidationService.validateProperty.mockReturnValue({
        valid: false,
        errors: [{ field: 'name', message: 'Name is required' }]
      });

      // Act & Assert
      await expect(propertyService.addProperty(context, invalidPropertyData))
        .rejects.toThrow(ValidationRequestError);
    });

    it('should handle client not found', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'nonexistent-client' },
          url: '/api/properties'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const propertyData = TestDataFactory.createProperty();

      mockClientDAO.findByCid.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.addProperty(context, propertyData))
        .rejects.toThrow(BadRequestError);
    });
  });

  describe('getClientProperty', () => {
    it('should get property successfully', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123', pid: 'property-456' },
          url: '/api/properties/property-456'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperty = TestDataFactory.createProperty({ _id: 'property-456' });
      const mockUnits = {
        items: [TestDataFactory.createPropertyUnit()],
        pagination: { total: 1, page: 1, limit: 10, pages: 1 }
      };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.getPropertyUnits.mockResolvedValue(mockUnits);

      // Act
      const result = await propertyService.getClientProperty(context);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.property).toEqual(mockProperty);
      expect(result.data.units).toEqual(mockUnits);
    });

    it('should handle property not found', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123', pid: 'nonexistent-property' },
          url: '/api/properties/nonexistent-property'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.getClientProperty(context))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('getClientProperties', () => {
    it('should get properties list successfully', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123' },
          url: '/api/properties'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const queryParams = { page: 1, limit: 10 };
      const mockProperties = [
        TestDataFactory.createProperty({ name: 'Property 1' }),
        TestDataFactory.createProperty({ name: 'Property 2' })
      ];

      const mockResult = {
        data: mockProperties,
        pagination: { page: 1, limit: 10, total: 2, pages: 1 }
      };

      mockPropertyDAO.list.mockResolvedValue(mockResult);

      // Act
      const result = await propertyService.getClientProperties(context, queryParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.data).toHaveLength(2);
      expect(result.data.pagination.total).toBe(2);
    });

    it('should handle empty properties list', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123' },
          url: '/api/properties'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const queryParams = { page: 1, limit: 10 };
      const mockResult = {
        data: [],
        pagination: { page: 1, limit: 10, total: 0, pages: 0 }
      };

      mockPropertyDAO.list.mockResolvedValue(mockResult);

      // Act
      const result = await propertyService.getClientProperties(context, queryParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.data).toHaveLength(0);
    });
  });

  describe('updateClientProperty', () => {
    it('should update property successfully', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123', pid: 'property-456' },
          url: '/api/properties/property-456'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const updateData = { name: 'Updated Property Name' };
      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperty = TestDataFactory.createProperty({ _id: 'property-456' });
      const mockUpdatedProperty = { ...mockProperty, ...updateData };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.startSession.mockResolvedValue({});
      mockPropertyDAO.withTransaction.mockImplementation((session, callback) => callback(session));
      mockPropertyDAO.updateById.mockResolvedValue(mockUpdatedProperty);
      mockPropertyCache.invalidateProperty.mockResolvedValue(true);

      // Act
      const result = await propertyService.updateClientProperty(context, updateData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated Property Name');
      expect(mockPropertyDAO.updateById).toHaveBeenCalled();
    });

    it('should handle property not found for update', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123', pid: 'nonexistent-property' },
          url: '/api/properties/nonexistent-property'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const updateData = { name: 'Updated Name' };
      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.updateClientProperty(context, updateData))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('archiveClientProperty', () => {
    it('should archive property successfully', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123', pid: 'property-456' },
          url: '/api/properties/property-456'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperty = TestDataFactory.createProperty({ _id: 'property-456' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.startSession.mockResolvedValue({});
      mockPropertyDAO.withTransaction.mockImplementation((session, callback) => callback(session));
      mockPropertyDAO.updateById.mockResolvedValue({ ...mockProperty, deletedAt: new Date() });
      mockPropertyCache.invalidateProperty.mockResolvedValue(true);

      // Act
      const result = await propertyService.archiveClientProperty(context);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Property archived successfully');
    });

    it('should handle property not found for archive', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123', pid: 'nonexistent-property' },
          url: '/api/properties/nonexistent-property'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.archiveClientProperty(context))
        .rejects.toThrow(NotFoundError);
    });
  });

  describe('validateCsv', () => {
    it('should validate CSV successfully', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123' },
          url: '/api/properties/validate-csv'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const csvData = [
        { name: 'Property 1', address: '123 Main St', propertyType: 'RESIDENTIAL' },
        { name: 'Property 2', address: '456 Oak Ave', propertyType: 'COMMERCIAL' }
      ];

      mockPropertyCsvProcessor.validateCsv.mockResolvedValue({
        success: true,
        validRows: csvData,
        invalidRows: [],
        totalRows: 2
      });

      // Act
      const result = await propertyService.validateCsv(context, csvData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.validRows).toHaveLength(2);
      expect(result.data.invalidRows).toHaveLength(0);
    });

    it('should handle CSV validation errors', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123' },
          url: '/api/properties/validate-csv'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123'
      };

      const csvData = [
        { name: '', address: '', propertyType: 'INVALID' } // Invalid row
      ];

      mockPropertyCsvProcessor.validateCsv.mockResolvedValue({
        success: false,
        validRows: [],
        invalidRows: [{ row: 1, errors: ['Name is required', 'Address is required'] }],
        totalRows: 1
      });

      // Act
      const result = await propertyService.validateCsv(context, csvData);

      // Assert
      expect(result.success).toBe(false);
      expect(result.data.validRows).toHaveLength(0);
      expect(result.data.invalidRows).toHaveLength(1);
    });
  });
});