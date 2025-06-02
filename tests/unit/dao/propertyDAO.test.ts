/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { PropertyDAO } from '@dao/propertyDAO';
import { Property } from '@models/index';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';
import { setupDAOTestMocks } from '@tests/mocks/dao/commonMocks';

// Setup centralized mocks
setupDAOTestMocks();

describe('PropertyDAO - Unit Tests', () => {
  let propertyDAO: PropertyDAO;
  let mockLogger: any;
  let mockPropertyUnitDAO: any;

  beforeAll(() => {
    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    mockPropertyUnitDAO = {
      findUnitsByProperty: jest.fn(),
      getUnitCountsByProperty: jest.fn(),
    };

    propertyDAO = new PropertyDAO({ 
      logger: mockLogger,
      propertyUnitDAO: mockPropertyUnitDAO 
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createProperty', () => {
    describe('Successful property creation', () => {
      it('should create a property successfully', async () => {
        // Arrange
        const propertyData = TestDataFactory.createProperty({
          name: 'Test Property',
          cid: 'client-123',
          userId: 'user-456',
        });

        const mockSession = { commit: jest.fn(), abort: jest.fn() };
        const createdProperty = { ...propertyData, _id: 'property-789' };

        Property.create.mockResolvedValue([createdProperty]);

        // Act
        const result = await propertyDAO.createProperty(propertyData, mockSession);

        // Assert
        expect(result).toEqual(createdProperty);
        expect(Property.create).toHaveBeenCalledWith([propertyData], { session: mockSession });
      });

      it('should create property with full address geocoding', async () => {
        // Arrange
        const propertyData = TestDataFactory.createProperty({
          address: {
            street: '123 Main St',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
            fullAddress: '123 Main St, Test City, TS 12345',
            coordinates: {
              latitude: 40.7128,
              longitude: -74.0060,
            },
          },
        });

        const mockSession = { commit: jest.fn() };
        const createdProperty = { ...propertyData, _id: 'property-geo' };

        Property.create.mockResolvedValue([createdProperty]);

        // Act
        const result = await propertyDAO.createProperty(propertyData, mockSession);

        // Assert
        expect(result).toEqual(createdProperty);
        expect(result.address.coordinates).toBeDefined();
        expect(result.address.coordinates.latitude).toBe(40.7128);
        expect(result.address.coordinates.longitude).toBe(-74.0060);
      });

      it('should create property with units', async () => {
        // Arrange
        const units = [
          TestDataFactory.createPropertyUnit({ unitNumber: '101' }),
          TestDataFactory.createPropertyUnit({ unitNumber: '102' }),
        ];

        const propertyData = TestDataFactory.createProperty({
          units,
          totalUnits: 2,
        });

        const mockSession = { commit: jest.fn() };
        const createdProperty = { ...propertyData, _id: 'property-with-units' };

        Property.create.mockResolvedValue([createdProperty]);

        // Act
        const result = await propertyDAO.createProperty(propertyData, mockSession);

        // Assert
        expect(result.units).toHaveLength(2);
        expect(result.totalUnits).toBe(2);
      });
    });

    describe('Property creation errors', () => {
      it('should handle duplicate property name error', async () => {
        // Arrange
        const propertyData = TestDataFactory.createProperty({
          name: 'Duplicate Property',
          cid: 'client-123',
        });

        const mockSession = { abort: jest.fn() };
        const duplicateError = new Error('E11000 duplicate key error');
        duplicateError.code = 11000;

        Property.create.mockRejectedValue(duplicateError);

        // Act & Assert
        await expect(propertyDAO.createProperty(propertyData, mockSession))
          .rejects.toThrow();
      });

      it('should handle validation errors', async () => {
        // Arrange
        const invalidPropertyData = {
          name: '', // Invalid empty name
          cid: null, // Invalid null cid
        };

        const mockSession = { abort: jest.fn() };
        const validationError = new Error('Validation failed');
        validationError.name = 'ValidationError';

        Property.create.mockRejectedValue(validationError);

        // Act & Assert
        await expect(propertyDAO.createProperty(invalidPropertyData, mockSession))
          .rejects.toThrow('Validation failed');
      });
    });
  });

  describe('getFilteredProperties', () => {
    describe('Successful property retrieval', () => {
      it('should get properties with basic pagination', async () => {
        // Arrange
        const cid = 'client-123';
        const filters = { page: 1, limit: 10 };

        const properties = [
          TestDataFactory.createProperty({ name: 'Property 1', cid }),
          TestDataFactory.createProperty({ name: 'Property 2', cid }),
          TestDataFactory.createProperty({ name: 'Property 3', cid }),
        ];

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(properties),
        };

        Property.find.mockReturnValue(mockQuery);
        Property.countDocuments.mockResolvedValue(3);

        // Act
        const result = await propertyDAO.getFilteredProperties(cid, filters);

        // Assert
        expect(result).toEqual({
          data: properties,
          pagination: {
            page: 1,
            limit: 10,
            total: 3,
            pages: 1,
          },
        });

        expect(Property.find).toHaveBeenCalledWith(
          expect.objectContaining({ cid })
        );
        expect(mockQuery.skip).toHaveBeenCalledWith(0);
        expect(mockQuery.limit).toHaveBeenCalledWith(10);
      });

      it('should filter properties by type', async () => {
        // Arrange
        const cid = 'client-456';
        const filters = {
          page: 1,
          limit: 5,
          propertyType: 'RESIDENTIAL',
        };

        const residentialProperties = [
          TestDataFactory.createProperty({ 
            name: 'Residential 1', 
            cid,
            propertyType: 'RESIDENTIAL' 
          }),
        ];

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(residentialProperties),
        };

        Property.find.mockReturnValue(mockQuery);
        Property.countDocuments.mockResolvedValue(1);

        // Act
        const result = await propertyDAO.getFilteredProperties(cid, filters);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(Property.find).toHaveBeenCalledWith(
          expect.objectContaining({
            cid,
            propertyType: 'RESIDENTIAL',
          })
        );
      });

      it('should filter properties by multiple criteria', async () => {
        // Arrange
        const cid = 'client-789';
        const filters = {
          page: 1,
          limit: 10,
          propertyType: 'COMMERCIAL',
          minRent: 1000,
          maxRent: 3000,
          city: 'New York',
          bedrooms: 2,
        };

        const filteredProperties = [
          TestDataFactory.createProperty({
            name: 'Filtered Property',
            cid,
            propertyType: 'COMMERCIAL',
            rent: 2000,
            bedrooms: 2,
            address: { city: 'New York' },
          }),
        ];

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(filteredProperties),
        };

        Property.find.mockReturnValue(mockQuery);
        Property.countDocuments.mockResolvedValue(1);

        // Act
        const result = await propertyDAO.getFilteredProperties(cid, filters);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(Property.find).toHaveBeenCalledWith(
          expect.objectContaining({
            cid,
            propertyType: 'COMMERCIAL',
            rent: { $gte: 1000, $lte: 3000 },
            bedrooms: 2,
            'address.city': 'New York',
          })
        );
      });

      it('should handle search by property name', async () => {
        // Arrange
        const cid = 'client-search';
        const filters = {
          page: 1,
          limit: 10,
          search: 'Luxury Apartment',
        };

        const searchResults = [
          TestDataFactory.createProperty({
            name: 'Luxury Apartment Complex',
            cid,
          }),
        ];

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(searchResults),
        };

        Property.find.mockReturnValue(mockQuery);
        Property.countDocuments.mockResolvedValue(1);

        // Act
        const result = await propertyDAO.getFilteredProperties(cid, filters);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(Property.find).toHaveBeenCalledWith(
          expect.objectContaining({
            cid,
            name: { $regex: 'Luxury Apartment', $options: 'i' },
          })
        );
      });
    });

    describe('Property retrieval edge cases', () => {
      it('should handle empty result set', async () => {
        // Arrange
        const cid = 'client-empty';
        const filters = { page: 1, limit: 10 };

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue([]),
        };

        Property.find.mockReturnValue(mockQuery);
        Property.countDocuments.mockResolvedValue(0);

        // Act
        const result = await propertyDAO.getFilteredProperties(cid, filters);

        // Assert
        expect(result).toEqual({
          data: [],
          pagination: {
            page: 1,
            limit: 10,
            total: 0,
            pages: 0,
          },
        });
      });

      it('should handle pagination for large result sets', async () => {
        // Arrange
        const cid = 'client-large';
        const filters = { page: 3, limit: 25 };

        const properties = Array(25).fill(null).map((_, index) => 
          TestDataFactory.createProperty({ 
            name: `Property ${index + 51}`, // Page 3 would start at item 51
            cid 
          })
        );

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(properties),
        };

        Property.find.mockReturnValue(mockQuery);
        Property.countDocuments.mockResolvedValue(150); // Total 150 properties

        // Act
        const result = await propertyDAO.getFilteredProperties(cid, filters);

        // Assert
        expect(result.pagination).toEqual({
          page: 3,
          limit: 25,
          total: 150,
          pages: 6, // 150 / 25 = 6 pages
        });
        expect(mockQuery.skip).toHaveBeenCalledWith(50); // (3-1) * 25 = 50
        expect(mockQuery.limit).toHaveBeenCalledWith(25);
      });
    });

    describe('Property retrieval errors', () => {
      it('should handle database query errors', async () => {
        // Arrange
        const cid = 'client-error';
        const filters = { page: 1, limit: 10 };

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          sort: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          limit: jest.fn().mockReturnThis(),
          exec: jest.fn().mockRejectedValue(new Error('Database connection failed')),
        };

        Property.find.mockReturnValue(mockQuery);

        // Act & Assert
        await expect(propertyDAO.getFilteredProperties(cid, filters))
          .rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('getClientProperty', () => {
    describe('Successful property retrieval', () => {
      it('should get specific property by ID and client', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyId = 'property-456';
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          cid,
          name: 'Specific Property',
        });

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(property),
        };

        Property.findOne.mockReturnValue(mockQuery);

        // Act
        const result = await propertyDAO.getClientProperty(cid, propertyId);

        // Assert
        expect(result).toEqual(property);
        expect(Property.findOne).toHaveBeenCalledWith({
          _id: propertyId,
          cid,
          isArchived: { $ne: true },
        });
      });

      it('should get property with populated units', async () => {
        // Arrange
        const cid = 'client-789';
        const propertyId = 'property-101';
        const units = [
          TestDataFactory.createPropertyUnit({ unitNumber: '101' }),
          TestDataFactory.createPropertyUnit({ unitNumber: '102' }),
        ];
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          cid,
          units,
        });

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(property),
        };

        Property.findOne.mockReturnValue(mockQuery);

        // Act
        const result = await propertyDAO.getClientProperty(cid, propertyId);

        // Assert
        expect(result.units).toHaveLength(2);
        expect(mockQuery.populate).toHaveBeenCalledWith(
          expect.stringContaining('units')
        );
      });
    });

    describe('Property retrieval failures', () => {
      it('should return null for non-existent property', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyId = 'non-existent-property';

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(null),
        };

        Property.findOne.mockReturnValue(mockQuery);

        // Act
        const result = await propertyDAO.getClientProperty(cid, propertyId);

        // Assert
        expect(result).toBeNull();
      });

      it('should return null for archived property', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyId = 'archived-property';

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          exec: jest.fn().mockResolvedValue(null),
        };

        Property.findOne.mockReturnValue(mockQuery);

        // Act
        const result = await propertyDAO.getClientProperty(cid, propertyId);

        // Assert
        expect(result).toBeNull();
        expect(Property.findOne).toHaveBeenCalledWith(
          expect.objectContaining({
            isArchived: { $ne: true },
          })
        );
      });

      it('should handle database query errors', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyId = 'property-error';

        const mockQuery = {
          populate: jest.fn().mockReturnThis(),
          exec: jest.fn().mockRejectedValue(new Error('Query failed')),
        };

        Property.findOne.mockReturnValue(mockQuery);

        // Act & Assert
        await expect(propertyDAO.getClientProperty(cid, propertyId))
          .rejects.toThrow('Query failed');
      });
    });
  });

  describe('findPropertyByAddress', () => {
    describe('Successful address lookup', () => {
      it('should find property by full address', async () => {
        // Arrange
        const fullAddress = '123 Main St, Test City, TS 12345';
        const cid = 'client-123';
        const property = TestDataFactory.createProperty({
          address: { fullAddress },
          cid,
        });

        Property.findOne.mockResolvedValue(property);

        // Act
        const result = await propertyDAO.findPropertyByAddress(fullAddress, cid);

        // Assert
        expect(result).toEqual(property);
        expect(Property.findOne).toHaveBeenCalledWith({
          'address.fullAddress': fullAddress,
          cid,
          isArchived: { $ne: true },
        });
      });

      it('should return null for non-existent address', async () => {
        // Arrange
        const fullAddress = '999 Nonexistent St, Nowhere, NW 00000';
        const cid = 'client-123';

        Property.findOne.mockResolvedValue(null);

        // Act
        const result = await propertyDAO.findPropertyByAddress(fullAddress, cid);

        // Assert
        expect(result).toBeNull();
      });
    });
  });

  describe('updateClientProperty', () => {
    describe('Successful property update', () => {
      it('should update property successfully', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyId = 'property-456';
        const updateData = {
          name: 'Updated Property Name',
          description: 'Updated description',
          rent: 1600,
        };

        const updatedProperty = TestDataFactory.createProperty({
          _id: propertyId,
          cid,
          ...updateData,
        });

        Property.findByIdAndUpdate.mockResolvedValue(updatedProperty);

        // Act
        const result = await propertyDAO.updateClientProperty(cid, propertyId, updateData);

        // Assert
        expect(result).toEqual(updatedProperty);
        expect(Property.findByIdAndUpdate).toHaveBeenCalledWith(
          propertyId,
          { $set: updateData },
          { new: true, runValidators: true }
        );
      });

      it('should handle occupancy status updates', async () => {
        // Arrange
        const cid = 'client-789';
        const propertyId = 'property-occupancy';
        const updateData = {
          occupancyStatus: 'PARTIALLY_OCCUPIED',
          occupiedUnits: 3,
          totalUnits: 5,
        };

        const updatedProperty = TestDataFactory.createProperty({
          _id: propertyId,
          cid,
          ...updateData,
        });

        Property.findByIdAndUpdate.mockResolvedValue(updatedProperty);

        // Act
        const result = await propertyDAO.updateClientProperty(cid, propertyId, updateData);

        // Assert
        expect(result.occupancyStatus).toBe('PARTIALLY_OCCUPIED');
        expect(result.occupiedUnits).toBe(3);
        expect(result.totalUnits).toBe(5);
      });
    });

    describe('Property update errors', () => {
      it('should return null for non-existent property', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyId = 'non-existent-property';
        const updateData = { name: 'New Name' };

        Property.findByIdAndUpdate.mockResolvedValue(null);

        // Act
        const result = await propertyDAO.updateClientProperty(cid, propertyId, updateData);

        // Assert
        expect(result).toBeNull();
      });

      it('should handle validation errors', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyId = 'property-456';
        const invalidUpdateData = {
          rent: 'not-a-number',
        };

        const validationError = new Error('Validation failed');
        validationError.name = 'ValidationError';
        Property.findByIdAndUpdate.mockRejectedValue(validationError);

        // Act & Assert
        await expect(propertyDAO.updateClientProperty(cid, propertyId, invalidUpdateData))
          .rejects.toThrow('Validation failed');
      });
    });
  });

  describe('canAddUnitToProperty', () => {
    describe('Unit capacity validation', () => {
      it('should allow adding unit when under capacity', async () => {
        // Arrange
        const propertyId = 'property-123';
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          maxUnits: 10,
          totalUnits: 5,
        });

        Property.findById.mockResolvedValue(property);

        // Act
        const result = await propertyDAO.canAddUnitToProperty(propertyId);

        // Assert
        expect(result).toBe(true);
      });

      it('should prevent adding unit when at capacity', async () => {
        // Arrange
        const propertyId = 'property-full';
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          maxUnits: 5,
          totalUnits: 5,
        });

        Property.findById.mockResolvedValue(property);

        // Act
        const result = await propertyDAO.canAddUnitToProperty(propertyId);

        // Assert
        expect(result).toBe(false);
      });

      it('should allow unlimited units when maxUnits not set', async () => {
        // Arrange
        const propertyId = 'property-unlimited';
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          maxUnits: null,
          totalUnits: 100,
        });

        Property.findById.mockResolvedValue(property);

        // Act
        const result = await propertyDAO.canAddUnitToProperty(propertyId);

        // Assert
        expect(result).toBe(true);
      });

      it('should return false for non-existent property', async () => {
        // Arrange
        const propertyId = 'non-existent-property';

        Property.findById.mockResolvedValue(null);

        // Act
        const result = await propertyDAO.canAddUnitToProperty(propertyId);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('syncPropertyOccupancyWithUnits', () => {
    describe('Occupancy synchronization', () => {
      it('should sync occupancy status based on unit data', async () => {
        // Arrange
        const propertyId = 'property-sync';
        const unitCounts = {
          total: 10,
          occupied: 7,
          available: 3,
          maintenance: 0,
        };

        mockPropertyUnitDAO.getUnitCountsByProperty.mockResolvedValue(unitCounts);

        const updatedProperty = TestDataFactory.createProperty({
          _id: propertyId,
          totalUnits: 10,
          occupiedUnits: 7,
          occupancyStatus: 'PARTIALLY_OCCUPIED',
        });

        Property.findByIdAndUpdate.mockResolvedValue(updatedProperty);

        // Act
        const result = await propertyDAO.syncPropertyOccupancyWithUnits(propertyId);

        // Assert
        expect(result).toEqual(updatedProperty);
        expect(Property.findByIdAndUpdate).toHaveBeenCalledWith(
          propertyId,
          {
            $set: {
              totalUnits: 10,
              occupiedUnits: 7,
              availableUnits: 3,
              maintenanceUnits: 0,
              occupancyStatus: 'PARTIALLY_OCCUPIED',
            },
          },
          { new: true }
        );
      });

      it('should set status to FULLY_OCCUPIED when all units occupied', async () => {
        // Arrange
        const propertyId = 'property-full-occupied';
        const unitCounts = {
          total: 5,
          occupied: 5,
          available: 0,
          maintenance: 0,
        };

        mockPropertyUnitDAO.getUnitCountsByProperty.mockResolvedValue(unitCounts);

        const updatedProperty = TestDataFactory.createProperty({
          occupancyStatus: 'FULLY_OCCUPIED',
        });

        Property.findByIdAndUpdate.mockResolvedValue(updatedProperty);

        // Act
        await propertyDAO.syncPropertyOccupancyWithUnits(propertyId);

        // Assert
        expect(Property.findByIdAndUpdate).toHaveBeenCalledWith(
          propertyId,
          expect.objectContaining({
            $set: expect.objectContaining({
              occupancyStatus: 'FULLY_OCCUPIED',
            }),
          }),
          { new: true }
        );
      });

      it('should set status to VACANT when no units occupied', async () => {
        // Arrange
        const propertyId = 'property-vacant';
        const unitCounts = {
          total: 8,
          occupied: 0,
          available: 8,
          maintenance: 0,
        };

        mockPropertyUnitDAO.getUnitCountsByProperty.mockResolvedValue(unitCounts);

        Property.findByIdAndUpdate.mockResolvedValue(
          TestDataFactory.createProperty({ occupancyStatus: 'VACANT' })
        );

        // Act
        await propertyDAO.syncPropertyOccupancyWithUnits(propertyId);

        // Assert
        expect(Property.findByIdAndUpdate).toHaveBeenCalledWith(
          propertyId,
          expect.objectContaining({
            $set: expect.objectContaining({
              occupancyStatus: 'VACANT',
            }),
          }),
          { new: true }
        );
      });
    });
  });
});