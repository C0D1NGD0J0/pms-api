import { PropertyService } from '@services/property/property.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { Types } from 'mongoose';
import { PropertyTypeManager } from '@utils/PropertyTypeManager';
import {
  createMockClient,
  createMockClientDAO,
  createMockCurrentUser,
  createMockEventEmitterService,
  createMockGeoCoderService,
  createMockNewProperty,
  createMockProfileDAO,
  createMockProperty,
  createMockPropertyCache,
  createMockPropertyCsvProcessor,
  createMockPropertyDAO,
  createMockPropertyQueue,
  createMockPropertyUnitDAO,
  createMockRequestContext,
  createMockUploadQueue,
} from '@tests/helpers';

// Mock PropertyTypeManager
jest.mock('@utils/PropertyTypeManager', () => ({
  PropertyTypeManager: {
    supportsMultipleUnits: jest.fn(),
    validateUnitCount: jest.fn().mockReturnValue({ valid: true }),
    validateTotalArea: jest.fn().mockReturnValue({ valid: true }),
    allowsBedroomsAtPropertyLevel: jest.fn().mockReturnValue(true),
    allowsBathroomsAtPropertyLevel: jest.fn().mockReturnValue(true),
    getRules: jest.fn().mockReturnValue({
      requiredFields: [],
      isMultiUnit: false,
      minUnits: 1,
    }),
    getMinUnits: jest.fn().mockReturnValue(1),
  },
}));

// Mock EventTypes
jest.mock('@interfaces/events.interface', () => ({
  EventTypes: {
    UPLOAD_COMPLETED: 'UPLOAD_COMPLETED',
    UPLOAD_FAILED: 'UPLOAD_FAILED',
    UNIT_CREATED: 'UNIT_CREATED',
    UNIT_UPDATED: 'UNIT_UPDATED',
    UNIT_ARCHIVED: 'UNIT_ARCHIVED',
    UNIT_UNARCHIVED: 'UNIT_UNARCHIVED',
    UNIT_STATUS_CHANGED: 'UNIT_STATUS_CHANGED',
    UNIT_BATCH_CREATED: 'UNIT_BATCH_CREATED',
    DELETE_LOCAL_ASSET: 'DELETE_LOCAL_ASSET',
  },
}));

describe('PropertyService', () => {
  let propertyService: PropertyService;
  let mockPropertyDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockPropertyUnitDAO: any;
  let mockGeoCoderService: any;
  let mockEventEmitterService: any;
  let mockPropertyCache: any;
  let mockPropertyQueue: any;
  let mockUploadQueue: any;
  let mockPropertyCsvProcessor: any;

  beforeEach(() => {
    mockPropertyDAO = createMockPropertyDAO();
    mockClientDAO = createMockClientDAO();
    mockProfileDAO = createMockProfileDAO();
    mockPropertyUnitDAO = createMockPropertyUnitDAO();
    mockGeoCoderService = createMockGeoCoderService();
    mockEventEmitterService = createMockEventEmitterService();
    mockPropertyCache = createMockPropertyCache();
    mockPropertyQueue = createMockPropertyQueue();
    mockUploadQueue = createMockUploadQueue();
    mockPropertyCsvProcessor = createMockPropertyCsvProcessor();

    propertyService = new PropertyService({
      propertyDAO: mockPropertyDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
      geoCoderService: mockGeoCoderService,
      emitterService: mockEventEmitterService,
      propertyCache: mockPropertyCache,
      propertyQueue: mockPropertyQueue,
      uploadQueue: mockUploadQueue,
      propertyCsvProcessor: mockPropertyCsvProcessor,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addProperty', () => {
    it('should call DAO methods for property creation', async () => {
      // Arrange
      const mockContext = createMockRequestContext({
        request: {
          params: { cuid: 'test-cuid' },
          url: '/test',
          path: '/test',
          method: 'POST',
          query: {},
        },
        currentuser: createMockCurrentUser(),
      });
      const propertyData = createMockNewProperty({
        name: 'Test Property',
        fullAddress: '123 Main Street, Test City, Test State',
        propertyType: 'house',
        maxAllowedUnits: 1,
        occupancyStatus: 'vacant',
      });
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();

      mockPropertyDAO.startSession.mockReturnValue('mock-session');
      mockPropertyDAO.withTransaction.mockImplementation(async (_session: any, callback: any) => {
        return await callback(_session);
      });
      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findPropertyByAddress.mockResolvedValue(null);
      mockPropertyDAO.createProperty.mockResolvedValue(mockProperty);
      mockPropertyCache.cacheProperty.mockResolvedValue({ success: true });

      // Act
      const result = await propertyService.addProperty(mockContext, propertyData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockProperty);
      expect(mockPropertyDAO.createProperty).toHaveBeenCalled();
      expect(mockPropertyCache.cacheProperty).toHaveBeenCalledWith(
        'test-cuid',
        mockProperty.id,
        mockProperty
      );
    });
  });

  describe('getClientProperties', () => {
    it('should successfully retrieve client properties with filters', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const mockClient = createMockClient();
      const mockProperties = [createMockProperty(), createMockProperty()];
      const mockQueryParams = {
        filters: { propertyType: 'house', status: 'available' as const },
        pagination: { page: 1, limit: 10, sort: { createdAt: 1 as const } },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyCache.getClientProperties.mockResolvedValue({ success: false });
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({
        items: mockProperties,
        pagination: { page: 1, limit: 10, total: 2 },
      });
      mockPropertyCache.saveClientProperties.mockResolvedValue({ success: true });

      // Act
      const result = await propertyService.getClientProperties(cuid, mockQueryParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.items).toEqual(mockProperties);
      expect(mockPropertyDAO.getPropertiesByClientId).toHaveBeenCalled();
    });

    it('should return cached properties when available', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const mockClient = createMockClient();
      const mockCachedProperties = [createMockProperty()];
      const mockQueryParams = {
        filters: null,
        pagination: { page: 1, limit: 10, sort: { createdAt: 1 as const } },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyCache.getClientProperties.mockResolvedValue({
        success: true,
        data: {
          properties: mockCachedProperties,
          pagination: { page: 1, limit: 10, total: 1 },
        },
      });

      // Act
      const result = await propertyService.getClientProperties(cuid, mockQueryParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.items).toEqual(mockCachedProperties);
      expect(mockPropertyDAO.getPropertiesByClientId).not.toHaveBeenCalled();
    });
  });

  describe('getClientProperty', () => {
    it('should successfully retrieve a single property with unit info', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const pid = 'test-pid';
      const mockCurrentUser = createMockCurrentUser();
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();
      const mockUnitInfo = {
        canAddUnit: true,
        maxAllowedUnits: 10,
        currentUnits: 5,
        availableSpaces: 5,
        unitStats: {
          occupied: 3,
          vacant: 2,
          maintenance: 0,
          available: 2,
          reserved: 0,
          inactive: 0,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      jest.spyOn(propertyService, 'getUnitInfoForProperty').mockResolvedValue(mockUnitInfo);

      // Act
      const result = await propertyService.getClientProperty(cuid, pid, mockCurrentUser);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.unitInfo).toEqual(mockUnitInfo);
      expect(mockPropertyDAO.findFirst).toHaveBeenCalledWith({
        pid,
        cuid,
        deletedAt: null,
      });
    });

    it('should throw NotFoundError when property not found', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const pid = 'invalid-pid';
      const mockCurrentUser = createMockCurrentUser();
      const mockClient = createMockClient();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyService.getClientProperty(cuid, pid, mockCurrentUser)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('updateClientProperty', () => {
    it('should successfully update a property', async () => {
      // Arrange
      const ctx = {
        cuid: 'test-cuid',
        pid: 'test-pid',
        currentuser: createMockCurrentUser(),
      };
      const updateData = { name: 'Updated Property Name' };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();
      const mockUpdatedProperty = { ...mockProperty, ...updateData };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.update.mockResolvedValue(mockUpdatedProperty);
      mockPropertyCache.invalidateProperty.mockResolvedValue({ success: true });

      // Act
      const result = await propertyService.updateClientProperty(ctx, updateData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProperty);
      expect(mockPropertyDAO.update).toHaveBeenCalled();
      expect(mockPropertyCache.invalidateProperty).toHaveBeenCalledWith(
        'test-cuid',
        mockProperty.id
      );
    });
  });

  describe('archiveClientProperty', () => {
    it('should successfully archive a property', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const pid = 'test-pid';
      const mockCurrentUser = createMockCurrentUser();
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.archiveProperty.mockResolvedValue(true);
      mockPropertyCache.invalidateProperty.mockResolvedValue({ success: true });
      mockPropertyCache.invalidatePropertyLists.mockResolvedValue({ success: true });

      // Act
      const result = await propertyService.archiveClientProperty(cuid, pid, mockCurrentUser);

      // Assert
      expect(result.success).toBe(true);
      expect(mockPropertyDAO.archiveProperty).toHaveBeenCalledWith(
        mockProperty.id,
        mockCurrentUser.sub
      );
      expect(mockPropertyCache.invalidateProperty).toHaveBeenCalledWith(cuid, mockProperty.id);
      expect(mockPropertyCache.invalidatePropertyLists).toHaveBeenCalledWith(cuid);
    });
  });

  describe('validateCsv', () => {
    it('should successfully validate CSV file', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const csvFile = {
        originalFileName: 'test.csv',
        fieldName: 'csvFile',
        mimeType: 'text/csv',
        path: '/tmp/test.csv',
        url: '/tmp/test.csv',
        key: 'csv-files/test.csv',
        status: 'pending' as const,
        filename: 'test.csv',
        fileSize: 1024,
        uploadedAt: new Date(),
        uploadedBy: 'user-123',
      };
      const mockCurrentUser = createMockCurrentUser();
      const mockClient = createMockClient();
      const mockJob = { id: 'job-123' };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyQueue.addCsvValidationJob.mockResolvedValue(mockJob);

      // Act
      const result = await propertyService.validateCsv(cuid, csvFile, mockCurrentUser);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processId).toBe('job-123');
      expect(mockPropertyQueue.addCsvValidationJob).toHaveBeenCalled();
    });
  });

  describe('getUnitInfoForProperty', () => {
    it('should calculate unit info for multi-unit property', async () => {
      // Arrange
      // Mock is already set up at the top of the file
      (PropertyTypeManager.supportsMultipleUnits as jest.Mock).mockReturnValue(true);

      const mockProperty = createMockProperty({
        propertyType: 'apartment',
        maxAllowedUnits: 10,
      });
      const mockUnitData = {
        currentUnits: 6,
        unitStats: {
          occupied: 4,
          vacant: 2,
          maintenance: 0,
          available: 2,
          reserved: 0,
          inactive: 0,
        },
      };

      mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(mockUnitData);
      mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({ canAdd: true });
      mockPropertyUnitDAO.getExistingUnitNumbers.mockResolvedValue(['1', '2', '3', '4', '5', '6']);
      mockPropertyUnitDAO.getNextAvailableUnitNumber.mockResolvedValue('7');

      // Act
      const result = await propertyService.getUnitInfoForProperty(mockProperty);

      // Assert
      expect(result.maxAllowedUnits).toBe(10);
      expect(result.currentUnits).toBe(6);
      expect(result.availableSpaces).toBe(4);
      expect(result.canAddUnit).toBe(true);
      expect(result.suggestedNextUnitNumber).toBe('7');
      expect(result.unitStats).toEqual(mockUnitData.unitStats);
    });
  });

  describe('updatePropertyDocuments', () => {
    it('should successfully update property documents', async () => {
      // Arrange
      const propertyId = 'prop-123';
      const uploadResult = [
        {
          url: 'https://example.com/doc1.pdf',
          key: 'documents/doc1.pdf',
          filename: 'doc1.pdf',
          resourceId: 'prop-123',
          fieldName: 'documents',
          publicuid: 'public-uid-123',
          mediatype: 'document' as const,
        },
      ];
      const userId = 'user-123';
      const mockProperty = createMockProperty();
      const mockUpdatedProperty = { ...mockProperty, documents: uploadResult };

      mockPropertyDAO.findById.mockResolvedValue(mockProperty);
      mockPropertyDAO.updatePropertyDocument.mockResolvedValue(mockUpdatedProperty);

      // Act
      const result = await propertyService.updatePropertyDocuments(
        propertyId,
        uploadResult,
        userId
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedProperty);
      expect(mockPropertyDAO.updatePropertyDocument).toHaveBeenCalledWith(
        propertyId,
        uploadResult,
        userId
      );
    });

    it('should throw BadRequestError when property not found', async () => {
      // Arrange
      const propertyId = 'invalid-prop';
      const uploadResult = [
        {
          url: 'test.pdf',
          key: 'test',
          filename: 'test.pdf',
          resourceId: 'invalid-prop',
          fieldName: 'documents',
          publicuid: 'test-uid',
        },
      ];
      const userId = 'user-123';

      mockPropertyDAO.findById.mockResolvedValue(null);

      // Act & Assert
      await expect(
        propertyService.updatePropertyDocuments(propertyId, uploadResult, userId)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('addPropertiesFromCsv', () => {
    it('should successfully start CSV import job', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const csvFilePath = '/tmp/properties.csv';
      const actorId = 'user-123';
      const mockClient = createMockClient();
      const mockJob = { id: 'csv-job-123' };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyQueue.addCsvImportJob.mockResolvedValue(mockJob);

      // Act
      const result = await propertyService.addPropertiesFromCsv(cuid, csvFilePath, actorId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.processId).toBe('csv-job-123');
      expect(mockPropertyQueue.addCsvImportJob).toHaveBeenCalledWith({
        csvFilePath,
        userId: actorId,
        clientInfo: { cuid, displayName: mockClient.displayName, id: mockClient.id },
      });
    });
  });

  describe('validateCsv - additional tests', () => {
    it('should throw BadRequestError for oversized CSV file', async () => {
      // Arrange
      const cuid = 'test-cuid';
      const csvFile = {
        originalFileName: 'test.csv',
        fieldName: 'csvFile',
        mimeType: 'text/csv',
        path: '/tmp/test.csv',
        url: '/tmp/test.csv',
        key: 'csv-files/test.csv',
        status: 'pending' as const,
        filename: 'test.csv',
        fileSize: 15 * 1024 * 1024, // 15MB - too large
        uploadedAt: new Date(),
        uploadedBy: 'user-123',
      };
      const mockCurrentUser = createMockCurrentUser();
      const mockClient = createMockClient();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockEventEmitterService.emit.mockReturnValue(true);

      // Act & Assert
      await expect(propertyService.validateCsv(cuid, csvFile, mockCurrentUser)).rejects.toThrow(
        BadRequestError
      );
      expect(mockEventEmitterService.emit).toHaveBeenCalledWith('DELETE_LOCAL_ASSET', [
        csvFile.path,
      ]);
    });
  });

  describe('getUnitInfoForProperty - additional tests', () => {
    it('should handle single-unit property unit info calculation', async () => {
      // Arrange
      (PropertyTypeManager.supportsMultipleUnits as jest.Mock).mockReturnValue(false);

      const mockProperty = createMockProperty({
        propertyType: 'house',
        maxAllowedUnits: 1,
        occupancyStatus: 'occupied',
      });

      mockPropertyUnitDAO.getSuggestedStartingUnitNumber.mockReturnValue('1');

      // Act
      const result = await propertyService.getUnitInfoForProperty(mockProperty);

      // Assert
      expect(result.maxAllowedUnits).toBe(1);
      expect(result.currentUnits).toBe(1);
      expect(result.availableSpaces).toBe(0);
      expect(result.canAddUnit).toBe(false);
      expect(result.unitStats.occupied).toBe(1);
    });

  });

  describe('markDocumentsAsFailed', () => {
    it('should mark pending documents as failed', async () => {
      // Arrange
      const propertyId = new Types.ObjectId().toString();
      const errorMessage = 'Upload failed';
      const mockProperty = createMockProperty({
        documents: [
          { status: 'pending', documentName: 'doc1.pdf' },
          { status: 'active', documentName: 'doc2.pdf' },
        ],
      });

      mockPropertyDAO.findById.mockResolvedValue(mockProperty);
      mockPropertyDAO.update.mockResolvedValue(mockProperty);

      // Act
      await propertyService.markDocumentsAsFailed(propertyId, errorMessage);

      // Assert
      expect(mockPropertyDAO.update).toHaveBeenCalled();
    });

    it('should handle property not found when marking documents as failed', async () => {
      // Arrange
      const propertyId = 'invalid-prop';
      const errorMessage = 'Upload failed';

      mockPropertyDAO.findById.mockResolvedValue(null);

      // Act - Should not throw error, just return silently
      await propertyService.markDocumentsAsFailed(propertyId, errorMessage);

      // Assert
      expect(mockPropertyDAO.update).not.toHaveBeenCalled();
    });
  });

  describe('error handling and edge cases', () => {
    it('should handle missing parameters in getClientProperty', async () => {
      // Act & Assert
      await expect(
        propertyService.getClientProperty('', 'pid', createMockCurrentUser())
      ).rejects.toThrow(BadRequestError);
      await expect(
        propertyService.getClientProperty('cuid', '', createMockCurrentUser())
      ).rejects.toThrow(BadRequestError);
    });

    it('should handle failed property update operation', async () => {
      // Arrange
      const ctx = {
        cuid: 'test-cuid',
        pid: 'test-pid',
        currentuser: createMockCurrentUser(),
      };
      const updateData = { name: 'Updated Name' };
      const mockClient = createMockClient();
      const mockProperty = createMockProperty();

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.update.mockResolvedValue(null); // Failed

      // Act & Assert
      await expect(propertyService.updateClientProperty(ctx, updateData)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('destroy', () => {
    it('should cleanup event listeners on destroy', async () => {
      // Act
      await propertyService.destroy();

      // Assert
      expect(mockEventEmitterService.off).toHaveBeenCalledTimes(8); // Number of event listeners
    });
  });
});
