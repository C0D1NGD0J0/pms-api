import { jest } from '@jest/globals';
import { PropertyTestFactory } from '@tests/utils/propertyTestHelpers';

/**
 * Comprehensive mocks for PropertyService dependencies
 */
export const createPropertyServiceMocks = () => {
  // DAO Mocks
  const mockPropertyDAO = {
    createProperty: jest.fn(),
    findById: jest.fn(),
    findFirst: jest.fn(),
    update: jest.fn(),
    archiveProperty: jest.fn(),
    getPropertiesByClientId: jest.fn(),
    findPropertyByAddress: jest.fn(),
    canAddUnitToProperty: jest.fn(),
    updatePropertyDocument: jest.fn(),
    startSession: jest.fn(),
    withTransaction: jest.fn()
  };

  const mockPropertyUnitDAO = {
    getPropertyUnitInfo: jest.fn(),
    getExistingUnitNumbers: jest.fn(),
    getNextAvailableUnitNumber: jest.fn(),
    getSuggestedStartingUnitNumber: jest.fn(),
    findUnitsByPropertyId: jest.fn(),
    findUnitsByStatus: jest.fn()
  };

  const mockClientDAO = {
    getClientByCid: jest.fn(),
    findById: jest.fn(),
    insert: jest.fn()
  };

  const mockProfileDAO = {
    findById: jest.fn(),
    createUserProfile: jest.fn(),
    generateCurrentUserInfo: jest.fn()
  };

  // Service Mocks
  const mockPropertyValidationService = {
    validateProperty: jest.fn()
  };

  const mockGeoCoderService = {
    geocode: jest.fn(),
    reverse: jest.fn()
  };

  const mockPropertyCsvProcessor = {
    validateCsv: jest.fn(),
    processCsv: jest.fn(),
    extractProperties: jest.fn()
  };

  // Cache Mocks
  const mockPropertyCache = {
    cacheProperty: jest.fn(),
    getProperty: jest.fn(),
    getClientProperties: jest.fn(),
    saveClientProperties: jest.fn(),
    invalidateProperty: jest.fn(),
    invalidatePropertyLists: jest.fn()
  };

  // Queue Mocks
  const mockPropertyQueue = {
    addCsvImportJob: jest.fn(),
    addCsvValidationJob: jest.fn(),
    getJobStatus: jest.fn()
  };

  const mockUploadQueue = {
    addToUploadQueue: jest.fn(),
    getJobStatus: jest.fn()
  };

  // Event Emitter Mock
  const mockEventEmitterService = {
    on: jest.fn(),
    emit: jest.fn(),
    off: jest.fn(),
    removeAllListeners: jest.fn()
  };

  // Setup default successful responses
  const setupDefaultMockResponses = () => {
    // DAO defaults
    mockPropertyDAO.startSession.mockResolvedValue({});
    mockPropertyDAO.withTransaction.mockImplementation(async (session, callback) => {
      return await callback(session);
    });
    
    mockClientDAO.getClientByCid.mockResolvedValue({
      cid: 'test-client-id',
      accountAdmin: 'user-id',
      displayName: 'Test Client'
    });

    // Cache defaults - simulate cache miss
    mockPropertyCache.getClientProperties.mockResolvedValue({
      success: false,
      data: null
    });
    mockPropertyCache.cacheProperty.mockResolvedValue({ success: true });
    mockPropertyCache.saveClientProperties.mockResolvedValue({ success: true });
    mockPropertyCache.invalidateProperty.mockResolvedValue({ success: true });
    mockPropertyCache.invalidatePropertyLists.mockResolvedValue({ success: true });

    // Queue defaults
    mockPropertyQueue.addCsvImportJob.mockResolvedValue({ id: 'job-123' });
    mockPropertyQueue.addCsvValidationJob.mockResolvedValue({ id: 'job-456' });
    mockUploadQueue.addToUploadQueue.mockResolvedValue({ id: 'upload-job-789' });

    // Validation service defaults
    mockPropertyValidationService.validateProperty.mockReturnValue({
      valid: true,
      errors: []
    });

    // PropertyUnit DAO defaults
    mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue({
      currentUnits: 0,
      unitStats: {
        occupied: 0,
        vacant: 0,
        maintenance: 0,
        available: 0,
        reserved: 0,
        inactive: 0
      }
    });
    
    mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({ canAdd: true });
    mockPropertyUnitDAO.getSuggestedStartingUnitNumber.mockReturnValue('1');

    // GeoCoderService defaults
    mockGeoCoderService.geocode.mockResolvedValue([{
      latitude: 40.7128,
      longitude: -74.0060,
      formattedAddress: 'New York, NY, USA'
    }]);
  };

  // Setup error scenarios
  const setupErrorScenarios = () => {
    return {
      databaseError: () => {
        mockPropertyDAO.createProperty.mockRejectedValue(new Error('Database connection failed'));
        mockPropertyDAO.findById.mockRejectedValue(new Error('Database connection failed'));
        mockPropertyDAO.update.mockRejectedValue(new Error('Database connection failed'));
      },
      
      validationError: () => {
        mockPropertyValidationService.validateProperty.mockReturnValue({
          valid: false,
          errors: [
            { field: 'name', message: 'Property name is required' },
            { field: 'address', message: 'Valid address is required' }
          ]
        });
      },
      
      clientNotFound: () => {
        mockClientDAO.getClientByCid.mockResolvedValue(null);
      },
      
      propertyNotFound: () => {
        mockPropertyDAO.findFirst.mockResolvedValue(null);
        mockPropertyDAO.findById.mockResolvedValue(null);
      },
      
      cacheError: () => {
        mockPropertyCache.cacheProperty.mockResolvedValue({ success: false, error: 'Cache error' });
        mockPropertyCache.getClientProperties.mockResolvedValue({ success: false, error: 'Cache error' });
      },
      
      queueError: () => {
        mockPropertyQueue.addCsvImportJob.mockRejectedValue(new Error('Queue connection failed'));
        mockUploadQueue.addToUploadQueue.mockRejectedValue(new Error('Upload queue failed'));
      },
      
      geocodingError: () => {
        mockGeoCoderService.geocode.mockRejectedValue(new Error('Geocoding service unavailable'));
      }
    };
  };

  // Helper to create property with transaction
  const setupTransactionScenario = (propertyData: any) => {
    const createdProperty = {
      ...propertyData,
      id: 'property-123',
      pid: 'prop-456',
      createdAt: new Date(),
      updatedAt: new Date()
    };

    mockPropertyDAO.createProperty.mockResolvedValue(createdProperty);
    return createdProperty;
  };

  // Helper to setup pagination scenario
  const setupPaginationScenario = (properties: any[], total: number, page: number, limit: number) => {
    mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({
      items: properties,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit)
      }
    });
  };

  // Reset all mocks
  const resetAllMocks = () => {
    Object.values({
      ...mockPropertyDAO,
      ...mockPropertyUnitDAO,
      ...mockClientDAO,
      ...mockProfileDAO,
      ...mockPropertyCache,
      ...mockPropertyQueue,
      ...mockUploadQueue,
      ...mockEventEmitterService,
      ...mockGeoCoderService,
      ...mockPropertyCsvProcessor,
      ...mockPropertyValidationService
    }).forEach(mock => {
      if (jest.isMockFunction(mock)) {
        mock.mockReset();
      }
    });
  };

  return {
    // DAOs
    mockPropertyDAO,
    mockPropertyUnitDAO,
    mockClientDAO,
    mockProfileDAO,
    
    // Services
    mockPropertyValidationService,
    mockGeoCoderService,
    mockPropertyCsvProcessor,
    
    // Cache & Queues
    mockPropertyCache,
    mockPropertyQueue,
    mockUploadQueue,
    
    // Event System
    mockEventEmitterService,
    
    // Helpers
    setupDefaultMockResponses,
    setupErrorScenarios,
    setupTransactionScenario,
    setupPaginationScenario,
    resetAllMocks
  };
};

/**
 * Mock data generators for different scenarios
 */
export const PropertyMockData = {
  // Success scenarios
  createSuccessfulPropertyResponse: (overrides = {}) => ({
    success: true,
    data: PropertyTestFactory.createPropertyData(overrides),
    message: 'Property created successfully.'
  }),

  createSuccessfulPropertiesListResponse: (count = 3) => {
    const properties = Array.from({ length: count }, () => 
      PropertyTestFactory.createPropertyData()
    );
    return {
      success: true,
      data: {
        items: properties,
        pagination: {
          page: 1,
          limit: 10,
          total: count,
          pages: 1
        }
      }
    };
  },

  // Error scenarios
  createValidationErrorResponse: (field: string, message: string) => ({
    valid: false,
    errors: [{ field, message }]
  }),

  createDatabaseErrorResponse: (operation: string) => 
    new Error(`Database ${operation} operation failed`),

  createCacheErrorResponse: () => ({
    success: false,
    error: 'Cache operation failed',
    data: null
  }),

  // Property scenarios with different types
  createResidentialProperty: () => PropertyTestFactory.createPropertyData({
    propertyType: 'house',
    totalUnits: 1,
    specifications: {
      bedrooms: 3,
      bathrooms: 2,
      totalArea: 1800,
      parkingSpaces: 2
    }
  }),

  createCommercialProperty: () => PropertyTestFactory.createPropertyData({
    propertyType: 'commercial',
    specifications: {
      totalArea: 3000,
      bedrooms: 0,
      bathrooms: 2,
      parkingSpaces: 20
    }
  }),

  createMultiUnitProperty: () => PropertyTestFactory.createPropertyData({
    propertyType: 'apartment',
    totalUnits: 12,
    specifications: {
      totalArea: 8000,
      parkingSpaces: 15
    }
  })
};