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
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';

// Mock utilities
jest.mock('@utils/index', () => ({
  getRequestDuration: jest.fn(() => ({ durationInMs: 100 })),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
}));

describe('PropertyUnitService - Unit Tests', () => {
  let propertyUnitService: PropertyUnitService;

  beforeAll(() => {
    // Initialize service with mocked dependencies
    propertyUnitService = new PropertyUnitService({
      propertyDAO: mockPropertyDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      propertyCache: mockPropertyCache,
      emitterService: mockEventEmitterService,
      propertyQueue: mockPropertyQueue,
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

  describe('addPropertyUnit', () => {
    describe('Successful unit creation', () => {
      it('should create a property unit successfully', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'property-456' },
            url: '/api/properties/property-456/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const unitData = TestDataFactory.createPropertyUnit({
          unitNumber: '101',
          rent: 1200,
          deposit: 1200,
          bedrooms: 2,
          bathrooms: 1,
          squareFeet: 800,
        });

        const mockProperty = TestDataFactory.createProperty({
          _id: 'property-456',
          cid: 'client-123',
        });

        const createdUnit = {
          ...unitData,
          _id: 'unit-101',
          propertyId: 'property-456',
        };

        // Mock dependencies
        mockPropertyDAO.canAddUnitToProperty.mockResolvedValue(true);
        mockPropertyDAO.getClientProperty.mockResolvedValue(mockProperty);
        mockPropertyUnitDAO.getNextAvailableUnitNumber.mockResolvedValue('101');
        mockPropertyUnitDAO.createPropertyUnit.mockResolvedValue(createdUnit);
        mockPropertyCache.invalidateProperty.mockResolvedValue(true);

        // Act
        const result = await propertyUnitService.addPropertyUnit(context, unitData);

        // Assert
        expect(result).toEqual({
          success: true,
          message: 'Property unit added successfully.',
          data: createdUnit,
        });

        expect(mockPropertyDAO.canAddUnitToProperty).toHaveBeenCalledWith('property-456');
        expect(mockPropertyDAO.getClientProperty).toHaveBeenCalledWith('client-123', 'property-456');
        expect(mockPropertyUnitDAO.createPropertyUnit).toHaveBeenCalledWith(
          expect.objectContaining({
            ...unitData,
            propertyId: 'property-456',
            unitNumber: '101',
          })
        );
        expect(mockPropertyCache.invalidateProperty).toHaveBeenCalledWith('property-456');
      });

      it('should auto-generate unit number when not provided', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'property-789' },
            url: '/api/properties/property-789/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-456',
        };

        const unitDataWithoutNumber = TestDataFactory.createPropertyUnit({
          unitNumber: undefined, // No unit number provided
          rent: 1500,
          bedrooms: 3,
        });

        const mockProperty = TestDataFactory.createProperty({
          _id: 'property-789',
          cid: 'client-123',
        });

        const createdUnit = {
          ...unitDataWithoutNumber,
          _id: 'unit-auto',
          unitNumber: '102', // Auto-generated
          propertyId: 'property-789',
        };

        mockPropertyDAO.canAddUnitToProperty.mockResolvedValue(true);
        mockPropertyDAO.getClientProperty.mockResolvedValue(mockProperty);
        mockPropertyUnitDAO.getNextAvailableUnitNumber.mockResolvedValue('102');
        mockPropertyUnitDAO.createPropertyUnit.mockResolvedValue(createdUnit);
        mockPropertyCache.invalidateProperty.mockResolvedValue(true);

        // Act
        const result = await propertyUnitService.addPropertyUnit(context, unitDataWithoutNumber);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data.unitNumber).toBe('102');
        expect(mockPropertyUnitDAO.getNextAvailableUnitNumber).toHaveBeenCalledWith('property-789');
      });

      it('should handle complex unit data with amenities', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-456', pid: 'property-101' },
            url: '/api/properties/property-101/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-789',
        };

        const complexUnitData = TestDataFactory.createPropertyUnit({
          unitNumber: 'A1',
          rent: 2000,
          deposit: 2000,
          bedrooms: 3,
          bathrooms: 2,
          squareFeet: 1200,
          amenities: ['parking', 'balcony', 'in_unit_laundry'],
          petPolicy: {
            allowed: true,
            deposit: 500,
            restrictions: ['no_aggressive_breeds'],
          },
        });

        const mockProperty = TestDataFactory.createProperty();
        const createdUnit = { ...complexUnitData, _id: 'unit-a1' };

        mockPropertyDAO.canAddUnitToProperty.mockResolvedValue(true);
        mockPropertyDAO.getClientProperty.mockResolvedValue(mockProperty);
        mockPropertyUnitDAO.getNextAvailableUnitNumber.mockResolvedValue('A1');
        mockPropertyUnitDAO.createPropertyUnit.mockResolvedValue(createdUnit);
        mockPropertyCache.invalidateProperty.mockResolvedValue(true);

        // Act
        const result = await propertyUnitService.addPropertyUnit(context, complexUnitData);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data.amenities).toEqual(['parking', 'balcony', 'in_unit_laundry']);
        expect(result.data.petPolicy.allowed).toBe(true);
      });
    });

    describe('Unit creation validation errors', () => {
      it('should throw BadRequestError for missing property ID', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123' }, // Missing pid
            url: '/api/properties/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const unitData = TestDataFactory.createPropertyUnit();

        // Act & Assert
        await expect(propertyUnitService.addPropertyUnit(context, unitData))
          .rejects.toThrow(BadRequestError);
      });

      it('should throw BadRequestError for missing client ID', async () => {
        // Arrange
        const context = {
          request: { 
            params: { pid: 'property-456' }, // Missing cid
            url: '/api/properties/property-456/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const unitData = TestDataFactory.createPropertyUnit();

        // Act & Assert
        await expect(propertyUnitService.addPropertyUnit(context, unitData))
          .rejects.toThrow(BadRequestError);
      });

      it('should throw BadRequestError when property cannot accommodate more units', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'property-full' },
            url: '/api/properties/property-full/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const unitData = TestDataFactory.createPropertyUnit();

        mockPropertyDAO.canAddUnitToProperty.mockResolvedValue(false);

        // Act & Assert
        await expect(propertyUnitService.addPropertyUnit(context, unitData))
          .rejects.toThrow(BadRequestError);

        expect(mockPropertyDAO.canAddUnitToProperty).toHaveBeenCalledWith('property-full');
      });

      it('should throw NotFoundError for non-existent property', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'non-existent-property' },
            url: '/api/properties/non-existent-property/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const unitData = TestDataFactory.createPropertyUnit();

        mockPropertyDAO.canAddUnitToProperty.mockResolvedValue(true);
        mockPropertyDAO.getClientProperty.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyUnitService.addPropertyUnit(context, unitData))
          .rejects.toThrow(NotFoundError);

        expect(mockPropertyDAO.getClientProperty).toHaveBeenCalledWith('client-123', 'non-existent-property');
      });
    });

    describe('Unit creation edge cases', () => {
      it('should handle duplicate unit number error', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'property-456' },
            url: '/api/properties/property-456/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const unitData = TestDataFactory.createPropertyUnit({ unitNumber: '101' });
        const mockProperty = TestDataFactory.createProperty();

        mockPropertyDAO.canAddUnitToProperty.mockResolvedValue(true);
        mockPropertyDAO.getClientProperty.mockResolvedValue(mockProperty);
        mockPropertyUnitDAO.getNextAvailableUnitNumber.mockResolvedValue('101');
        
        const duplicateError = new Error('Unit number already exists');
        duplicateError.code = 11000; // MongoDB duplicate key error
        mockPropertyUnitDAO.createPropertyUnit.mockRejectedValue(duplicateError);

        // Act & Assert
        await expect(propertyUnitService.addPropertyUnit(context, unitData))
          .rejects.toThrow('Unit number already exists');
      });

      it('should handle database transaction failures', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'property-456' },
            url: '/api/properties/property-456/units'
          },
          currentuser: TestDataFactory.createUser(),
          requestId: 'req-123',
        };

        const unitData = TestDataFactory.createPropertyUnit();
        const mockProperty = TestDataFactory.createProperty();

        mockPropertyDAO.canAddUnitToProperty.mockResolvedValue(true);
        mockPropertyDAO.getClientProperty.mockResolvedValue(mockProperty);
        mockPropertyUnitDAO.getNextAvailableUnitNumber.mockResolvedValue('101');
        mockPropertyUnitDAO.createPropertyUnit.mockRejectedValue(
          new Error('Database transaction failed')
        );

        // Act & Assert
        await expect(propertyUnitService.addPropertyUnit(context, unitData))
          .rejects.toThrow('Database transaction failed');
      });
    });
  });

  describe('getPropertyUnit', () => {
    describe('Successful unit retrieval', () => {
      it('should get specific property unit by ID', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-123', 
              pid: 'property-456', 
              unitId: 'unit-789' 
            },
            url: '/api/properties/property-456/units/unit-789'
          },
          currentuser: TestDataFactory.createUser(),
        };

        const mockUnit = TestDataFactory.createPropertyUnit({
          _id: 'unit-789',
          propertyId: 'property-456',
          unitNumber: '101',
        });

        mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(mockUnit);

        // Act
        const result = await propertyUnitService.getPropertyUnit(context);

        // Assert
        expect(result).toEqual({
          success: true,
          data: mockUnit,
        });

        expect(mockPropertyUnitDAO.getPropertyUnitInfo).toHaveBeenCalledWith(
          'client-123',
          'property-456',
          'unit-789'
        );
      });

      it('should get unit with detailed information', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-456', 
              pid: 'property-101', 
              unitId: 'unit-202' 
            },
            url: '/api/properties/property-101/units/unit-202'
          },
          currentuser: TestDataFactory.createUser(),
        };

        const detailedUnit = TestDataFactory.createPropertyUnit({
          _id: 'unit-202',
          propertyId: 'property-101',
          unitNumber: '202',
          tenant: {
            _id: 'tenant-123',
            name: 'John Doe',
            email: 'john@example.com',
            leaseStartDate: new Date('2024-01-01'),
            leaseEndDate: new Date('2024-12-31'),
          },
          maintenanceRequests: [
            {
              _id: 'req-1',
              type: 'plumbing',
              status: 'pending',
              description: 'Leaky faucet',
            },
          ],
        });

        mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(detailedUnit);

        // Act
        const result = await propertyUnitService.getPropertyUnit(context);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data.tenant).toBeDefined();
        expect(result.data.maintenanceRequests).toHaveLength(1);
        expect(result.data.tenant.name).toBe('John Doe');
      });
    });

    describe('Unit retrieval errors', () => {
      it('should throw NotFoundError for non-existent unit', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-123', 
              pid: 'property-456', 
              unitId: 'non-existent-unit' 
            },
            url: '/api/properties/property-456/units/non-existent-unit'
          },
          currentuser: TestDataFactory.createUser(),
        };

        mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyUnitService.getPropertyUnit(context))
          .rejects.toThrow(NotFoundError);

        expect(mockPropertyUnitDAO.getPropertyUnitInfo).toHaveBeenCalledWith(
          'client-123',
          'property-456',
          'non-existent-unit'
        );
      });

      it('should handle database query errors', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-123', 
              pid: 'property-456', 
              unitId: 'unit-789' 
            },
            url: '/api/properties/property-456/units/unit-789'
          },
          currentuser: TestDataFactory.createUser(),
        };

        mockPropertyUnitDAO.getPropertyUnitInfo.mockRejectedValue(
          new Error('Database connection failed')
        );

        // Act & Assert
        await expect(propertyUnitService.getPropertyUnit(context))
          .rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('getPropertyUnits', () => {
    describe('Successful units retrieval', () => {
      it('should get all units for a property with pagination', async () => {
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
          TestDataFactory.createPropertyUnit({ unitNumber: '103', status: 'available' }),
        ];

        const paginatedResult = {
          data: units,
          pagination: {
            page: 1,
            limit: 10,
            total: 3,
            pages: 1,
          },
        };

        mockPropertyUnitDAO.findUnitsByProperty.mockResolvedValue(paginatedResult);

        // Act
        const result = await propertyUnitService.getPropertyUnits(context, queryParams);

        // Assert
        expect(result).toEqual({
          success: true,
          data: paginatedResult.data,
          pagination: paginatedResult.pagination,
        });

        expect(mockPropertyUnitDAO.findUnitsByProperty).toHaveBeenCalledWith(
          'client-123',
          'property-456',
          expect.objectContaining({
            page: 1,
            limit: 10,
            status: 'available',
          })
        );
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

        mockPropertyUnitDAO.findUnitsByProperty.mockResolvedValue(emptyResult);

        // Act
        const result = await propertyUnitService.getPropertyUnits(context, queryParams);

        // Assert
        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });

      it('should filter units by status and other criteria', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'property-456' },
            url: '/api/properties/property-456/units'
          },
          currentuser: TestDataFactory.createUser(),
        };

        const filterParams = {
          page: 1,
          limit: 5,
          status: 'occupied',
          minRent: 1000,
          maxRent: 2000,
          bedrooms: 2,
        };

        const filteredUnits = [
          TestDataFactory.createPropertyUnit({ 
            unitNumber: '201', 
            status: 'occupied',
            rent: 1500,
            bedrooms: 2,
          }),
        ];

        const filteredResult = {
          data: filteredUnits,
          pagination: {
            page: 1,
            limit: 5,
            total: 1,
            pages: 1,
          },
        };

        mockPropertyUnitDAO.findUnitsByProperty.mockResolvedValue(filteredResult);

        // Act
        const result = await propertyUnitService.getPropertyUnits(context, filterParams);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(result.data[0].status).toBe('occupied');
        expect(result.data[0].rent).toBe(1500);
        expect(result.data[0].bedrooms).toBe(2);
      });
    });

    describe('Units retrieval errors', () => {
      it('should handle database query errors', async () => {
        // Arrange
        const context = {
          request: { 
            params: { cid: 'client-123', pid: 'property-456' },
            url: '/api/properties/property-456/units'
          },
          currentuser: TestDataFactory.createUser(),
        };

        const queryParams = { page: 1, limit: 10 };

        mockPropertyUnitDAO.findUnitsByProperty.mockRejectedValue(
          new Error('Database connection failed')
        );

        // Act & Assert
        await expect(propertyUnitService.getPropertyUnits(context, queryParams))
          .rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('updatePropertyUnit', () => {
    describe('Successful unit update', () => {
      it('should update property unit successfully', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-123', 
              pid: 'property-456', 
              unitId: 'unit-789' 
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

        mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(existingUnit);
        mockPropertyUnitDAO.updatePropertyUnit.mockResolvedValue(updatedUnit);
        mockPropertyCache.invalidateProperty.mockResolvedValue(true);

        // Act
        const result = await propertyUnitService.updatePropertyUnit(context, updateData);

        // Assert
        expect(result).toEqual({
          success: true,
          message: 'Property unit updated successfully.',
          data: updatedUnit,
        });

        expect(mockPropertyUnitDAO.updatePropertyUnit).toHaveBeenCalledWith(
          'unit-789',
          updateData
        );
        expect(mockPropertyCache.invalidateProperty).toHaveBeenCalledWith('property-456');
      });

      it('should handle status change validations', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-123', 
              pid: 'property-456', 
              unitId: 'unit-occupied' 
            },
            url: '/api/properties/property-456/units/unit-occupied'
          },
          currentuser: TestDataFactory.createUser(),
        };

        const statusChangeData = {
          status: 'available',
          availableDate: new Date('2024-06-01'),
        };

        const occupiedUnit = TestDataFactory.createPropertyUnit({
          _id: 'unit-occupied',
          status: 'occupied',
          tenant: {
            _id: 'tenant-123',
            leaseEndDate: new Date('2024-05-31'),
          },
        });

        const availableUnit = {
          ...occupiedUnit,
          ...statusChangeData,
          tenant: null,
        };

        mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(occupiedUnit);
        mockPropertyUnitDAO.updatePropertyUnit.mockResolvedValue(availableUnit);
        mockPropertyCache.invalidateProperty.mockResolvedValue(true);

        // Act
        const result = await propertyUnitService.updatePropertyUnit(context, statusChangeData);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data.status).toBe('available');
        expect(result.data.tenant).toBeNull();
      });
    });

    describe('Unit update errors', () => {
      it('should throw NotFoundError for non-existent unit', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-123', 
              pid: 'property-456', 
              unitId: 'non-existent-unit' 
            },
            url: '/api/properties/property-456/units/non-existent-unit'
          },
          currentuser: TestDataFactory.createUser(),
        };

        const updateData = { rent: 1500 };

        mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyUnitService.updatePropertyUnit(context, updateData))
          .rejects.toThrow(NotFoundError);
      });

      it('should handle invalid status transitions', async () => {
        // Arrange
        const context = {
          request: { 
            params: { 
              cid: 'client-123', 
              pid: 'property-456', 
              unitId: 'unit-maintenance' 
            },
            url: '/api/properties/property-456/units/unit-maintenance'
          },
          currentuser: TestDataFactory.createUser(),
        };

        const invalidStatusChange = {
          status: 'occupied', // Can't go directly from maintenance to occupied
        };

        const maintenanceUnit = TestDataFactory.createPropertyUnit({
          _id: 'unit-maintenance',
          status: 'maintenance',
        });

        mockPropertyUnitDAO.getPropertyUnitInfo.mockResolvedValue(maintenanceUnit);
        mockPropertyUnitDAO.updatePropertyUnit.mockRejectedValue(
          new BadRequestError('Invalid status transition')
        );

        // Act & Assert
        await expect(propertyUnitService.updatePropertyUnit(context, invalidStatusChange))
          .rejects.toThrow(BadRequestError);
      });
    });
  });
});