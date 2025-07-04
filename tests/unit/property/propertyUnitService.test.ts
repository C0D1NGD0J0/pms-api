/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { PropertyUnitService } from '@services/property/propertyUnit.service';
import { 
  mockPropertyDAO,
  mockPropertyUnitDAO,
  mockClientDAO,
  mockProfileDAO,
  mockPropertyCache,
  mockEventEmitterService,
  mockPropertyQueue,
  mockPropertyUnitQueue,
  mockJobTracker,
  mockUnitNumberingService,
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

jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
  getRequestDuration: jest.fn(() => ({ durationInMs: 100 })),
  generateShortUID: jest.fn(() => 'unit-123'),
}));

describe('PropertyUnitService - Unit Tests', () => {
  let propertyUnitService: PropertyUnitService;

  beforeAll(() => {
    propertyUnitService = new PropertyUnitService({
      propertyDAO: mockPropertyDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      propertyCache: mockPropertyCache,
      emitterService: mockEventEmitterService,
      propertyQueue: mockPropertyQueue,
      propertyUnitQueue: mockPropertyUnitQueue,
      jobTracker: mockJobTracker,
      unitNumberingService: mockUnitNumberingService,
    });
  });

  beforeEach(() => {
    resetTestContainer();
    jest.clearAllMocks();
  });

  describe('addPropertyUnit', () => {
    it('should create property unit successfully', async () => {
      // Arrange
      const context = {
        request: { 
          params: { cid: 'client-123', pid: 'property-456' },
          url: '/api/properties/property-456/units'
        },
        currentuser: TestDataFactory.createUser({ sub: '60f5e5b2a47c123456789013' }),
        requestId: 'req-123',
      };

      const unitData = {
        units: [TestDataFactory.createPropertyUnit({
          unitNumber: '101',
          rent: 1200,
          deposit: 1200,
          bedrooms: 2,
          bathrooms: 1,
          squareFeet: 800,
        })],
        pid: 'property-456',
        cid: 'client-123'
      };

      const mockProperty = TestDataFactory.createProperty({
        _id: '60f5e5b2a47c123456789012',
        cid: 'client-123',
      });

      const createdUnit = {
        ...unitData.units[0],
        _id: 'unit-101',
        propertyId: 'property-456',
      };

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({ canAdd: true, currentCount: 0, maxCapacity: 100 });
      mockPropertyDAO.getPropertyUnits.mockResolvedValue({ items: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } });
      mockPropertyUnitDAO.startSession.mockResolvedValue({});
      mockPropertyUnitDAO.withTransaction.mockImplementation((session, callback) => callback(session));
      mockPropertyUnitDAO.insert.mockResolvedValue(createdUnit);
      mockPropertyCache.invalidateProperty.mockResolvedValue(true);
      mockPropertyDAO.syncPropertyOccupancyWithUnits.mockResolvedValue(mockProperty);
      mockUnitNumberingService.validateUnitNumberUpdate.mockReturnValue({ isValid: true, message: 'Valid' });

      // Act
      const result = await propertyUnitService.addPropertyUnit(context, unitData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toContain('units created successfully');
      expect(result.data).toHaveLength(1);
      expect(mockPropertyDAO.findFirst).toHaveBeenCalledWith({ pid: 'property-456', cid: 'client-123', deletedAt: null });
      expect(mockPropertyUnitDAO.insert).toHaveBeenCalled();
    });

    it('should auto-generate unit number when not provided', async () => {
      // Arrange
      const context = {
        request: { 
          params: { cid: 'client-123', pid: 'property-789' },
          url: '/api/properties/property-789/units'
        },
        currentuser: TestDataFactory.createUser({ sub: '60f5e5b2a47c123456789013' }),
        requestId: 'req-456',
      };

      const unitData = {
        units: [TestDataFactory.createPropertyUnit({
          unitNumber: undefined, // No unit number provided
          rent: 1500,
          bedrooms: 3,
        })],
        pid: 'property-789',
        cid: 'client-123'
      };

      const mockProperty = TestDataFactory.createProperty({
        _id: '60f5e5b2a47c123456789014',
        cid: 'client-123',
      });

      const createdUnit = {
        ...unitData.units[0],
        _id: 'unit-auto',
        unitNumber: '102', // Auto-generated
        propertyId: '60f5e5b2a47c123456789014',
      };

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({ canAdd: true, currentCount: 0, maxCapacity: 100 });
      mockPropertyDAO.getPropertyUnits.mockResolvedValue({ items: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } });
      mockPropertyUnitDAO.startSession.mockResolvedValue({});
      mockPropertyUnitDAO.withTransaction.mockImplementation((session, callback) => callback(session));
      mockPropertyUnitDAO.getNextAvailableUnitNumber.mockResolvedValue('102');
      mockPropertyUnitDAO.insert.mockResolvedValue(createdUnit);
      mockPropertyCache.invalidateProperty.mockResolvedValue(true);
      mockPropertyDAO.syncPropertyOccupancyWithUnits.mockResolvedValue(mockProperty);
      mockUnitNumberingService.validateUnitNumberUpdate.mockReturnValue({ isValid: true, message: 'Valid' });

      // Act
      const result = await propertyUnitService.addPropertyUnit(context, unitData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data[0].unitNumber).toBe('102');
      expect(mockPropertyUnitDAO.getNextAvailableUnitNumber).toHaveBeenCalled();
    });

    it('should handle property not found', async () => {
      // Arrange
      const context = {
        request: { 
          params: { cid: 'client-123', pid: 'nonexistent-property' },
          url: '/api/properties/nonexistent-property/units'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123',
      };

      const unitData = {
        units: [TestDataFactory.createPropertyUnit()],
        pid: 'nonexistent-property',
        cid: 'client-123'
      };

      mockPropertyDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyUnitService.addPropertyUnit(context, unitData))
        .rejects.toThrow(BadRequestError);
    });

    it('should handle property at capacity', async () => {
      // Arrange
      const context = {
        request: { 
          params: { cid: 'client-123', pid: 'property-full' },
          url: '/api/properties/property-full/units'
        },
        currentuser: TestDataFactory.createUser(),
        requestId: 'req-123',
      };

      const unitData = {
        units: [TestDataFactory.createPropertyUnit()],
        pid: 'property-full',
        cid: 'client-123'
      };

      const mockProperty = TestDataFactory.createProperty({
        _id: '60f5e5b2a47c123456789016',
        cid: 'client-123',
      });

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyDAO.canAddUnitToProperty.mockResolvedValue({ canAdd: false, currentCount: 100, maxCapacity: 100 });

      // Act & Assert
      await expect(propertyUnitService.addPropertyUnit(context, unitData))
        .rejects.toThrow(BadRequestError);
    });
  });

  describe('getPropertyUnit', () => {
    it('should get property unit successfully', async () => {
      // Arrange
      const context = {
        request: { 
          params: { 
            cid: 'client-123', 
            pid: 'property-456', 
            puid: 'unit-789' 
          },
          url: '/api/properties/property-456/units/unit-789'
        },
        currentuser: TestDataFactory.createUser(),
      };

      const mockProperty = TestDataFactory.createProperty({
        _id: '60f5e5b2a47c123456789019',
        cid: 'client-123',
      });

      const mockUnit = TestDataFactory.createPropertyUnit({
        _id: 'unit-789',
        propertyId: 'property-456',
        unitNumber: '101',
      });

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(mockUnit);

      // Act
      const result = await propertyUnitService.getPropertyUnit(context);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUnit);
      expect(mockPropertyDAO.findFirst).toHaveBeenCalledWith({ pid: 'property-456', cid: 'client-123', deletedAt: null });
    });

    it('should handle unit not found', async () => {
      // Arrange
      const context = {
        request: { 
          params: { 
            cid: 'client-123', 
            pid: 'property-456', 
            puid: 'nonexistent-unit' 
          },
          url: '/api/properties/property-456/units/nonexistent-unit'
        },
        currentuser: TestDataFactory.createUser(),
      };

      const mockProperty = TestDataFactory.createProperty({
        _id: '60f5e5b2a47c123456789021',
        cid: 'client-123',
      });

      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyUnitService.getPropertyUnit(context))
        .rejects.toThrow(BadRequestError);
    });
  });

  describe('getPropertyUnits', () => {
    it('should get property units list successfully', async () => {
      // Arrange
      const context = {
        request: { 
          params: { cid: 'client-123', pid: 'property-456' },
          url: '/api/properties/property-456/units'
        },
        currentuser: TestDataFactory.createUser(),
      };

      const queryParams = {
        page: 1,
        limit: 10,
        status: 'available',
      };

      const units = [
        TestDataFactory.createPropertyUnit({ unitNumber: '101', status: 'available' }),
        TestDataFactory.createPropertyUnit({ unitNumber: '102', status: 'available' }),
      ];

      const paginatedResult = {
        data: units,
        pagination: {
          page: 1,
          limit: 10,
          total: 2,
          pages: 1,
        },
      };

      mockPropertyDAO.findFirst.mockResolvedValue(TestDataFactory.createProperty({ _id: 'property-456', cid: 'client-123' }));
      mockPropertyDAO.getPropertyUnits.mockResolvedValue(paginatedResult);

      // Act
      const result = await propertyUnitService.getPropertyUnits(context, queryParams);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Units retrieved successfully.');
      expect(result.data.data).toHaveLength(2);
    });

    it('should handle empty units list', async () => {
      // Arrange
      const context = {
        request: { 
          params: { cid: 'client-empty', pid: 'property-empty' },
          url: '/api/properties/property-empty/units'
        },
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

      mockPropertyDAO.findFirst.mockResolvedValue(TestDataFactory.createProperty({ _id: 'property-empty', cid: 'client-empty' }));
      mockPropertyDAO.getPropertyUnits.mockResolvedValue(emptyResult);

      // Act
      const result = await propertyUnitService.getPropertyUnits(context, queryParams);

      // Assert
      expect(result.data.data).toHaveLength(0);
      expect(result.data.pagination.total).toBe(0);
    });
  });

  describe('updatePropertyUnit', () => {
    it('should update property unit successfully', async () => {
      // Arrange
      const context = {
        request: { 
          params: { 
            cid: 'client-123', 
            pid: 'property-456', 
            puid: 'unit-789' 
          },
          url: '/api/properties/property-456/units/unit-789'
        },
        currentuser: TestDataFactory.createUser(),
      };

      const updateData = {
        rent: 1300,
        deposit: 1300,
        amenities: ['parking', 'balcony'],
        status: 'available',
      };

      const existingUnit = TestDataFactory.createPropertyUnit({
        _id: 'unit-789',
        rent: 1200,
        status: 'maintenance',
      });

      const updatedUnit = {
        ...existingUnit,
        ...updateData,
      };

      mockPropertyDAO.findFirst.mockResolvedValue(TestDataFactory.createProperty({ _id: 'property-456', cid: 'client-123' }));
      mockPropertyUnitDAO.findFirst.mockResolvedValue(existingUnit);
      mockPropertyUnitDAO.startSession.mockResolvedValue({});
      mockPropertyUnitDAO.withTransaction.mockImplementation((session, callback) => callback(session));
      mockPropertyUnitDAO.update.mockResolvedValue(updatedUnit);
      mockPropertyCache.invalidateProperty.mockResolvedValue(true);
      mockPropertyDAO.syncPropertyOccupancyWithUnits.mockResolvedValue({});

      // Act
      const result = await propertyUnitService.updatePropertyUnit(context, updateData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.message).toBe('Unit updated successfully');
      expect(result.data.rent).toBe(1300);
    });

    it('should handle unit not found for update', async () => {
      // Arrange
      const context = {
        request: { 
          params: { 
            cid: 'client-123', 
            pid: 'property-456', 
            puid: 'nonexistent-unit' 
          },
          url: '/api/properties/property-456/units/nonexistent-unit'
        },
        currentuser: TestDataFactory.createUser(),
      };

      const updateData = { rent: 1500 };

      const mockProperty = TestDataFactory.createProperty({ _id: '60f5e5b2a47c123456789022', cid: 'client-123' });
      mockPropertyDAO.findFirst.mockResolvedValue(mockProperty);
      mockPropertyUnitDAO.findFirst.mockResolvedValue(null);

      // Act & Assert
      await expect(propertyUnitService.updatePropertyUnit(context, updateData))
        .rejects.toThrow(BadRequestError);
    });
  });
});