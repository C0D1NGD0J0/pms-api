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
  resetTestContainer,
} from '@tests/mocks/di';
import { TestDataFactory, TestSuiteHelpers } from '@tests/utils/testHelpers';
import { BadRequestError, NotFoundError, ValidationRequestError } from '@shared/customErrors';

// Mock PropertyValidationService
jest.mock('@services/property/propertyValidation.service', () => ({
  PropertyValidationService: {
    validateProperty: jest.fn().mockReturnValue({ valid: true, errors: [] }),
  },
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
    PROPERTY_CREATED: 'property_created',
  },
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
    it('should handle validation errors', async () => {
      // Arrange
      const context = {
        request: {
          params: { cid: 'client-123' },
          url: '/api/properties',
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123',
      };

      const invalidPropertyData = {
        name: '', // Invalid - empty name
        address: '',
        propertyType: 'INVALID',
      };

      // Mock validation failure
      const {
        PropertyValidationService,
      } = require('@services/property/propertyValidation.service');
      PropertyValidationService.validateProperty.mockReturnValue({
        valid: false,
        errors: [{ field: 'name', message: 'Name is required' }],
      });

      // Act & Assert
      await expect(propertyService.addProperty(context, invalidPropertyData)).rejects.toThrow(
        ValidationRequestError
      );
    });
  });

  describe('getClientProperty', () => {
    it('should get property successfully', async () => {
      // Arrange
      const cid = 'client-123';
      const pid = 'property-456';
      const currentUser = TestDataFactory.createUser();

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperty = TestDataFactory.createProperty({
        _id: 'property-456',
        toJSON: jest.fn().mockReturnValue({ _id: 'property-456', name: 'Test Property' }),
      });
      const mockUnitInfo = {
        canAddUnit: true,
        maxAllowedUnits: 10,
        currentUnits: 2,
        availableSpaces: 8,
        unitStats: {
          occupied: 1,
          vacant: 1,
          maintenance: 0,
          available: 1,
          reserved: 0,
          inactive: 0,
        },
      };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      propertyService.getUnitInfoForProperty = jest.fn().mockResolvedValue(mockUnitInfo);

      // Act
      const result = await propertyService.getClientProperty(cid, pid, currentUser);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.unitInfo).toEqual(mockUnitInfo);
      expect(mockClientDAO.getClientByCid).toHaveBeenCalledWith(cid);
      expect(mockPropertyDAO.findFirst).toHaveBeenCalledWith({
        pid,
        cid,
        deletedAt: null,
      });
    });

    it('should handle property not found', async () => {
      // Arrange
      const cid = 'client-123';
      const pid = 'nonexistent-property';
      const currentUser = TestDataFactory.createUser();

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.getClientProperty(cid, pid, currentUser)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('getClientProperties', () => {
    it('should get properties list successfully', async () => {
      // Arrange
      const cid = 'client-123';
      const queryParams = {
        pagination: { page: 1, limit: 10 },
        filters: {},
      };

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperties = [
        TestDataFactory.createProperty({ name: 'Property 1' }),
        TestDataFactory.createProperty({ name: 'Property 2' }),
      ];

      const mockResult = {
        items: mockProperties,
        pagination: { page: 1, limit: 10, total: 2, pages: 1 },
      };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyCache.getClientProperties.mockResolvedValue({ success: false, data: null });
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue(mockResult);
      mockPropertyCache.saveClientProperties.mockResolvedValue(true);

      // Act
      const result = await propertyService.getClientProperties(cid, queryParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(2);
      expect(result.data.pagination.total).toBe(2);
      expect(mockClientDAO.getClientByCid).toHaveBeenCalledWith(cid);
    });

    it('should handle empty properties list', async () => {
      // Arrange
      const cid = 'client-123';
      const queryParams = {
        pagination: { page: 1, limit: 10 },
        filters: {},
      };

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockResult = {
        items: [],
        pagination: { page: 1, limit: 10, total: 0, pages: 0 },
      };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyCache.getClientProperties.mockResolvedValue({ success: false, data: null });
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue(mockResult);
      mockPropertyCache.saveClientProperties.mockResolvedValue(true);

      // Act
      const result = await propertyService.getClientProperties(cid, queryParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(0);
    });
  });

  describe('updateClientProperty', () => {
    it('should update property successfully', async () => {
      // Arrange
      const ctx = {
        cid: 'client-123',
        pid: 'property-456',
        currentuser: TestDataFactory.createUser(),
      };

      const updateData = { name: 'Updated Property Name' };
      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperty = TestDataFactory.createProperty({ _id: 'property-456' });
      const mockUpdatedProperty = { ...mockProperty, ...updateData };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.update.mockResolvedValue(mockUpdatedProperty);
      mockPropertyCache.invalidateProperty.mockResolvedValue(true);

      // Act
      const result = await propertyService.updateClientProperty(ctx, updateData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.name).toBe('Updated Property Name');
      expect(mockPropertyDAO.update).toHaveBeenCalledWith(
        {
          cid: ctx.cid,
          pid: ctx.pid,
          deletedAt: null,
        },
        {
          $set: expect.objectContaining(updateData),
        }
      );
    });

    it('should handle property not found for update', async () => {
      // Arrange
      const ctx = {
        cid: 'client-123',
        pid: 'nonexistent-property',
        currentuser: TestDataFactory.createUser(),
      };

      const updateData = { name: 'Updated Name' };
      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.updateClientProperty(ctx, updateData)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('archiveClientProperty', () => {
    it('should archive property successfully', async () => {
      // Arrange
      const cid = 'client-123';
      const pid = 'property-456';
      const currentUser = TestDataFactory.createUser();

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperty = TestDataFactory.createProperty({
        _id: 'property-456',
        id: 'property-456',
      });
      const mockArchivedProperty = { ...mockProperty, deletedAt: new Date() };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.archiveProperty.mockResolvedValue(mockArchivedProperty);
      mockPropertyCache.invalidateProperty.mockResolvedValue(true);
      mockPropertyCache.invalidatePropertyLists.mockResolvedValue(true);

      // Act
      const result = await propertyService.archiveClientProperty(cid, pid, currentUser);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Property archived successfully');
      expect(mockPropertyDAO.archiveProperty).toHaveBeenCalledWith(
        mockProperty.id,
        currentUser.sub
      );
    });

    it('should handle property not found for archive', async () => {
      // Arrange
      const cid = 'client-123';
      const pid = 'nonexistent-property';
      const currentUser = TestDataFactory.createUser();

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.archiveClientProperty(cid, pid, currentUser)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('validateCsv', () => {
    it('should validate CSV successfully', async () => {
      // Arrange
      const cid = 'client-123';
      const csvFile = {
        path: '/tmp/test.csv',
        fileSize: 1024,
        originalName: 'test.csv',
        mimetype: 'text/csv',
      };
      const currentUser = TestDataFactory.createUser();

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockJob = { id: 'job-123' };

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockPropertyQueue.addCsvValidationJob.mockResolvedValue(mockJob);

      // Act
      const result = await propertyService.validateCsv(cid, csvFile, currentUser);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processId).toBe('job-123');
      expect(result.message).toBe('CSV validation process started.');
      expect(mockPropertyQueue.addCsvValidationJob).toHaveBeenCalledWith({
        cid,
        userId: currentUser.sub,
        csvFilePath: csvFile.path,
      });
    });

    it('should handle file size too large', async () => {
      // Arrange
      const cid = 'client-123';
      const csvFile = {
        path: '/tmp/large.csv',
        fileSize: 15 * 1024 * 1024, // 15MB - too large
        originalName: 'large.csv',
        mimetype: 'text/csv',
      };
      const currentUser = TestDataFactory.createUser();

      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      mockEventEmitterService.emit.mockResolvedValue(true);

      // Act & Assert
      await expect(propertyService.validateCsv(cid, csvFile, currentUser)).rejects.toThrow(
        BadRequestError
      );
      expect(mockEventEmitterService.emit).toHaveBeenCalledWith('delete:local:asset', [
        csvFile.path,
      ]);
    });

    it('should handle client not found', async () => {
      // Arrange
      const cid = 'nonexistent-client';
      const csvFile = {
        path: '/tmp/test.csv',
        fileSize: 1024,
        originalName: 'test.csv',
        mimetype: 'text/csv',
      };
      const currentUser = TestDataFactory.createUser();

      mockClientDAO.getClientByCid.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.validateCsv(cid, csvFile, currentUser)).rejects.toThrow(
        BadRequestError
      );
    });
  });
});
