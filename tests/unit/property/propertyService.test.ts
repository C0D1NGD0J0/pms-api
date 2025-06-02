/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { PropertyService } from '@services/property/property.service';
import { 
  mockPropertyDAO,
  mockPropertyUnitDAO,
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError,
  ForbiddenError,
  UnauthorizedError 
} from '@shared/customErrors';

describe('PropertyService - Unit Tests', () => {
  let propertyService: PropertyService;

  beforeAll(() => {
    // Initialize service with mocked dependencies
    propertyService = new PropertyService({
      propertyDAO: mockPropertyDAO,
      propertyUnitDAO: mockPropertyUnitDAO,
    });
  });

  beforeEach(() => {
    // Reset all mocks and container state
    resetTestContainer();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('addProperty', () => {
    describe('Successful property creation', () => {
      it('should create a residential property successfully', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyData = TestDataFactory.createProperty({
          propertyType: 'RESIDENTIAL',
          units: [
            TestDataFactory.createPropertyUnit({ unitNumber: '101' }),
            TestDataFactory.createPropertyUnit({ unitNumber: '102' }),
          ],
        });

        const createdProperty = {
          ...propertyData,
          _id: 'property-123',
          ownerId: context.currentuser._id,
        };

        mockPropertyDAO.create.mockResolvedValue(createdProperty);

        // Act
        const result = await propertyService.addProperty(context, propertyData);

        // Assert
        expect(result).toEqual(createdProperty);
        expect(mockPropertyDAO.create).toHaveBeenCalledWith(
          expect.objectContaining({
            ...propertyData,
            ownerId: context.currentuser._id,
          })
        );
      });

      it('should create a commercial property successfully', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyData = TestDataFactory.createProperty({
          propertyType: 'COMMERCIAL',
          totalSquareFeet: 5000,
          amenities: ['parking', 'conference_room'],
        });

        const createdProperty = {
          ...propertyData,
          _id: 'property-456',
          ownerId: context.currentuser._id,
        };

        mockPropertyDAO.create.mockResolvedValue(createdProperty);

        // Act
        const result = await propertyService.addProperty(context, propertyData);

        // Assert
        expect(result).toEqual(createdProperty);
        expect(mockPropertyDAO.create).toHaveBeenCalledWith(
          expect.objectContaining({
            propertyType: 'COMMERCIAL',
            totalSquareFeet: 5000,
            amenities: ['parking', 'conference_room'],
          })
        );
      });

      it('should handle property with multiple units', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const units = [
          TestDataFactory.createPropertyUnit({ unitNumber: '101', rent: 1200 }),
          TestDataFactory.createPropertyUnit({ unitNumber: '102', rent: 1300 }),
          TestDataFactory.createPropertyUnit({ unitNumber: '201', rent: 1400 }),
        ];
        const propertyData = TestDataFactory.createProperty({ units });

        const createdProperty = {
          ...propertyData,
          _id: 'property-789',
          units: units.map(unit => ({ ...unit, _id: `unit-${unit.unitNumber}` })),
        };

        mockPropertyDAO.create.mockResolvedValue(createdProperty);

        // Act
        const result = await propertyService.addProperty(context, propertyData);

        // Assert
        expect(result.units).toHaveLength(3);
        expect(result.units.every(unit => unit._id)).toBe(true);
      });
    });

    describe('Property creation errors', () => {
      it('should handle unauthorized user', async () => {
        // Arrange
        const context = { currentuser: null };
        const propertyData = TestDataFactory.createProperty();

        // Act & Assert
        await expect(propertyService.addProperty(context, propertyData))
          .rejects.toThrow(UnauthorizedError);

        expect(mockPropertyDAO.create).not.toHaveBeenCalled();
      });

      it('should handle invalid property data', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const invalidPropertyData = {
          name: '', // Invalid empty name
          address: {}, // Invalid incomplete address
        };

        mockPropertyDAO.create.mockRejectedValue(
          new BadRequestError('Property validation failed')
        );

        // Act & Assert
        await expect(propertyService.addProperty(context, invalidPropertyData))
          .rejects.toThrow(BadRequestError);
      });

      it('should handle database creation failure', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyData = TestDataFactory.createProperty();

        mockPropertyDAO.create.mockRejectedValue(
          new Error('Database connection failed')
        );

        // Act & Assert
        await expect(propertyService.addProperty(context, propertyData))
          .rejects.toThrow('Database connection failed');
      });
    });
  });

  describe('getAllProperties', () => {
    describe('Successful property retrieval', () => {
      it('should get all properties for authenticated user', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const queryParams = {
          page: 1,
          limit: 10,
        };

        const properties = [
          TestDataFactory.createProperty({ name: 'Property 1' }),
          TestDataFactory.createProperty({ name: 'Property 2' }),
          TestDataFactory.createProperty({ name: 'Property 3' }),
        ];

        const expectedResult = {
          success: true,
          data: properties,
          pagination: {
            page: 1,
            limit: 10,
            total: 3,
            pages: 1,
          },
        };

        mockPropertyDAO.findByOwner.mockResolvedValue(expectedResult);

        // Act
        const result = await propertyService.getAllProperties(context, queryParams);

        // Assert
        expect(result).toEqual(expectedResult);
        expect(mockPropertyDAO.findByOwner).toHaveBeenCalledWith(
          context.currentuser._id,
          queryParams
        );
      });

      it('should handle property filtering by type', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const queryParams = {
          propertyType: 'RESIDENTIAL',
          page: 1,
          limit: 10,
        };

        const residentialProperties = [
          TestDataFactory.createProperty({ 
            propertyType: 'RESIDENTIAL',
            name: 'Residential Property 1' 
          }),
        ];

        mockPropertyDAO.findByOwner.mockResolvedValue({
          success: true,
          data: residentialProperties,
          pagination: { page: 1, limit: 10, total: 1, pages: 1 },
        });

        // Act
        const result = await propertyService.getAllProperties(context, queryParams);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(result.data[0].propertyType).toBe('RESIDENTIAL');
        expect(mockPropertyDAO.findByOwner).toHaveBeenCalledWith(
          context.currentuser._id,
          queryParams
        );
      });

      it('should handle empty property list', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const queryParams = { page: 1, limit: 10 };

        mockPropertyDAO.findByOwner.mockResolvedValue({
          success: true,
          data: [],
          pagination: { page: 1, limit: 10, total: 0, pages: 0 },
        });

        // Act
        const result = await propertyService.getAllProperties(context, queryParams);

        // Assert
        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });
    });

    describe('Property retrieval errors', () => {
      it('should handle unauthorized user', async () => {
        // Arrange
        const context = { currentuser: null };
        const queryParams = { page: 1, limit: 10 };

        // Act & Assert
        await expect(propertyService.getAllProperties(context, queryParams))
          .rejects.toThrow(UnauthorizedError);

        expect(mockPropertyDAO.findByOwner).not.toHaveBeenCalled();
      });

      it('should handle database query failure', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const queryParams = { page: 1, limit: 10 };

        mockPropertyDAO.findByOwner.mockRejectedValue(
          new Error('Database query failed')
        );

        // Act & Assert
        await expect(propertyService.getAllProperties(context, queryParams))
          .rejects.toThrow('Database query failed');
      });
    });
  });

  describe('getPropertyById', () => {
    describe('Successful property retrieval', () => {
      it('should get property by ID for owner', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-123';
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: context.currentuser._id,
        });

        mockPropertyDAO.findById.mockResolvedValue(property);

        // Act
        const result = await propertyService.getPropertyById(context, propertyId);

        // Assert
        expect(result).toEqual({
          success: true,
          data: property,
        });
        expect(mockPropertyDAO.findById).toHaveBeenCalledWith(propertyId);
      });

      it('should get property with populated units', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-456';
        const units = [
          TestDataFactory.createPropertyUnit({ unitNumber: '101' }),
          TestDataFactory.createPropertyUnit({ unitNumber: '102' }),
        ];
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: context.currentuser._id,
          units,
        });

        mockPropertyDAO.findById.mockResolvedValue(property);

        // Act
        const result = await propertyService.getPropertyById(context, propertyId);

        // Assert
        expect(result.data.units).toHaveLength(2);
        expect(result.data.units[0].unitNumber).toBe('101');
        expect(result.data.units[1].unitNumber).toBe('102');
      });
    });

    describe('Property retrieval errors', () => {
      it('should handle property not found', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'non-existent-property';

        mockPropertyDAO.findById.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyService.getPropertyById(context, propertyId))
          .rejects.toThrow(NotFoundError);

        expect(mockPropertyDAO.findById).toHaveBeenCalledWith(propertyId);
      });

      it('should handle unauthorized access to property', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-123';
        const property = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: 'different-owner-id', // Different owner
        });

        mockPropertyDAO.findById.mockResolvedValue(property);

        // Act & Assert
        await expect(propertyService.getPropertyById(context, propertyId))
          .rejects.toThrow(ForbiddenError);
      });

      it('should handle unauthenticated user', async () => {
        // Arrange
        const context = { currentuser: null };
        const propertyId = 'property-123';

        // Act & Assert
        await expect(propertyService.getPropertyById(context, propertyId))
          .rejects.toThrow(UnauthorizedError);

        expect(mockPropertyDAO.findById).not.toHaveBeenCalled();
      });
    });
  });

  describe('updateProperty', () => {
    describe('Successful property update', () => {
      it('should update property successfully', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-123';
        const updateData = {
          name: 'Updated Property Name',
          description: 'Updated description',
        };

        const existingProperty = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: context.currentuser._id,
        });

        const updatedProperty = {
          ...existingProperty,
          ...updateData,
        };

        mockPropertyDAO.findById.mockResolvedValue(existingProperty);
        mockPropertyDAO.updateById.mockResolvedValue(updatedProperty);

        // Act
        const result = await propertyService.updateProperty(context, propertyId, updateData);

        // Assert
        expect(result).toEqual({
          success: true,
          data: updatedProperty,
        });
        expect(mockPropertyDAO.updateById).toHaveBeenCalledWith(propertyId, updateData);
      });

      it('should update property units', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-456';
        const updateData = {
          units: [
            TestDataFactory.createPropertyUnit({ unitNumber: '101', rent: 1500 }),
            TestDataFactory.createPropertyUnit({ unitNumber: '103', rent: 1600 }),
          ],
        };

        const existingProperty = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: context.currentuser._id,
        });

        mockPropertyDAO.findById.mockResolvedValue(existingProperty);
        mockPropertyDAO.updateById.mockResolvedValue({
          ...existingProperty,
          ...updateData,
        });

        // Act
        const result = await propertyService.updateProperty(context, propertyId, updateData);

        // Assert
        expect(result.success).toBe(true);
        expect(result.data.units).toHaveLength(2);
      });
    });

    describe('Property update errors', () => {
      it('should handle property not found', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'non-existent-property';
        const updateData = { name: 'New Name' };

        mockPropertyDAO.findById.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyService.updateProperty(context, propertyId, updateData))
          .rejects.toThrow(NotFoundError);

        expect(mockPropertyDAO.updateById).not.toHaveBeenCalled();
      });

      it('should handle unauthorized property update', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-123';
        const updateData = { name: 'New Name' };

        const property = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: 'different-owner-id',
        });

        mockPropertyDAO.findById.mockResolvedValue(property);

        // Act & Assert
        await expect(propertyService.updateProperty(context, propertyId, updateData))
          .rejects.toThrow(ForbiddenError);

        expect(mockPropertyDAO.updateById).not.toHaveBeenCalled();
      });

      it('should handle validation errors', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-123';
        const invalidUpdateData = {
          name: '', // Invalid empty name
          rent: -100, // Invalid negative rent
        };

        const existingProperty = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: context.currentuser._id,
        });

        mockPropertyDAO.findById.mockResolvedValue(existingProperty);
        mockPropertyDAO.updateById.mockRejectedValue(
          new BadRequestError('Validation failed')
        );

        // Act & Assert
        await expect(propertyService.updateProperty(context, propertyId, invalidUpdateData))
          .rejects.toThrow(BadRequestError);
      });
    });
  });

  describe('deleteProperty', () => {
    describe('Successful property deletion', () => {
      it('should delete property successfully', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-123';

        const property = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: context.currentuser._id,
        });

        mockPropertyDAO.findById.mockResolvedValue(property);
        mockPropertyDAO.deleteById.mockResolvedValue(true);

        // Act
        const result = await propertyService.deleteProperty(context, propertyId);

        // Assert
        expect(result).toEqual({
          success: true,
          message: 'Property deleted successfully',
        });
        expect(mockPropertyDAO.deleteById).toHaveBeenCalledWith(propertyId);
      });
    });

    describe('Property deletion errors', () => {
      it('should handle property not found', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'non-existent-property';

        mockPropertyDAO.findById.mockResolvedValue(null);

        // Act & Assert
        await expect(propertyService.deleteProperty(context, propertyId))
          .rejects.toThrow(NotFoundError);

        expect(mockPropertyDAO.deleteById).not.toHaveBeenCalled();
      });

      it('should handle unauthorized property deletion', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-123';

        const property = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: 'different-owner-id',
        });

        mockPropertyDAO.findById.mockResolvedValue(property);

        // Act & Assert
        await expect(propertyService.deleteProperty(context, propertyId))
          .rejects.toThrow(ForbiddenError);

        expect(mockPropertyDAO.deleteById).not.toHaveBeenCalled();
      });

      it('should handle property with active tenants', async () => {
        // Arrange
        const context = {
          currentuser: TestDataFactory.createUser(),
        };
        const propertyId = 'property-with-tenants';

        const property = TestDataFactory.createProperty({
          _id: propertyId,
          ownerId: context.currentuser._id,
          hasActiveTenants: true,
        });

        mockPropertyDAO.findById.mockResolvedValue(property);
        mockPropertyDAO.deleteById.mockRejectedValue(
          new BadRequestError('Cannot delete property with active tenants')
        );

        // Act & Assert
        await expect(propertyService.deleteProperty(context, propertyId))
          .rejects.toThrow(BadRequestError);
      });
    });
  });
});