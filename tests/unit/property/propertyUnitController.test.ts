import { Response } from 'express';
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { PropertyUnitService } from '@services/property';
import { httpStatusCodes } from '@utils/constants';
import { AppRequest } from '@interfaces/utils.interface';
import { createMockCurrentUser } from '@tests/helpers';

describe('PropertyUnitController', () => {
  let propertyUnitController: PropertyUnitController;
  let mockPropertyUnitService: jest.Mocked<PropertyUnitService>;
  let mockRequest: Partial<AppRequest>;
  let mockResponse: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    // Create mock service
    mockPropertyUnitService = {
      getPropertyUnits: jest.fn(),
      addPropertyUnit: jest.fn(),
      getPropertyUnit: jest.fn(),
      updatePropertyUnit: jest.fn(),
      archiveUnit: jest.fn(),
      updateUnitStatus: jest.fn(),
    } as any;

    // Create mock response
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnThis();

    mockResponse = {
      status: statusMock,
      json: jsonMock,
    };

    // Create controller instance
    propertyUnitController = new PropertyUnitController({
      propertyUnitService: mockPropertyUnitService,
    });

    // Reset request with default context
    const mockCurrentUser = createMockCurrentUser({
      sub: 'user-123',
      cuid: 'client-123',
    });

    mockRequest = {
      params: { pid: 'property-123' },
      query: {},
      body: {},
      context: {
        currentuser: mockCurrentUser,
        params: { pid: 'property-123' },
      },
    } as AppRequest;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /properties/:pid/units', () => {
    it('should list units with pagination', async () => {
      // Arrange
      mockRequest.query = {
        page: '1',
        limit: '10',
        sortBy: 'unitNumber',
        sort: 'asc',
      };

      const mockUnits = {
        success: true,
        data: {
          units: [
            { uid: 'unit-1', unitNumber: '101', status: 'available' },
            { uid: 'unit-2', unitNumber: '102', status: 'occupied' },
          ],
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
          },
        },
      };

      mockPropertyUnitService.getPropertyUnits.mockResolvedValue(mockUnits);

      // Act
      await propertyUnitController.getPropertyUnits(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockPropertyUnitService.getPropertyUnits).toHaveBeenCalledWith(mockRequest.context, {
        page: 1,
        limit: 10,
        sortBy: 'unitNumber',
        sort: 'asc',
      });
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockUnits);
    });

    it('should filter units by status', async () => {
      // Arrange
      mockRequest.query = {
        status: 'available',
        page: '1',
        limit: '20',
      };

      const mockUnits = {
        success: true,
        data: {
          units: [{ uid: 'unit-1', status: 'available' }],
          pagination: { page: 1, limit: 20, total: 1 },
        },
      };

      mockPropertyUnitService.getPropertyUnits.mockResolvedValue(mockUnits);

      // Act
      await propertyUnitController.getPropertyUnits(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockPropertyUnitService.getPropertyUnits).toHaveBeenCalled();
      expect(jsonMock).toHaveBeenCalledWith(mockUnits);
    });

    it('should return empty list for property with no units', async () => {
      // Arrange
      mockRequest.query = {};

      const mockUnits = {
        success: true,
        data: {
          units: [],
          pagination: { page: 1, limit: 10, total: 0 },
        },
      };

      mockPropertyUnitService.getPropertyUnits.mockResolvedValue(mockUnits);

      // Act
      await propertyUnitController.getPropertyUnits(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(jsonMock).toHaveBeenCalledWith(mockUnits);
      expect(mockUnits.data.units).toHaveLength(0);
    });

    it('should return 404 for property not found', async () => {
      // Arrange
      mockRequest.params = { pid: 'nonexistent-property' };
      mockRequest.context!.params = { pid: 'nonexistent-property' };

      const error = new Error('Property not found');
      (error as any).statusCode = 404;
      mockPropertyUnitService.getPropertyUnits.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.getPropertyUnits(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Property not found');
    });

    it('should check permissions before listing units', async () => {
      // Arrange
      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockPropertyUnitService.getPropertyUnits.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.getPropertyUnits(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('POST /properties/:pid/units', () => {
    it('should create unit successfully', async () => {
      // Arrange
      mockRequest.body = {
        unitNumber: '201',
        floor: 2,
        bedrooms: 2,
        bathrooms: 1,
        squareFeet: 850,
        rentAmount: 1500,
      };

      const mockResult = {
        success: true,
        message: 'Unit created successfully',
        data: {
          uid: 'new-unit-123',
          unitNumber: '201',
          status: 'available',
        },
      };

      mockPropertyUnitService.addPropertyUnit.mockResolvedValue(mockResult);

      // Act
      await propertyUnitController.addUnit(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockPropertyUnitService.addPropertyUnit).toHaveBeenCalledWith(
        mockRequest.context,
        mockRequest.body
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should return 400 for unit capacity exceeded', async () => {
      // Arrange
      mockRequest.body = {
        unitNumber: '999',
        floor: 9,
      };

      const error = new Error('Property has reached maximum unit capacity');
      (error as any).statusCode = 400;
      mockPropertyUnitService.addPropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.addUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Property has reached maximum unit capacity');
    });

    it('should return 409 for duplicate unit number', async () => {
      // Arrange
      mockRequest.body = {
        unitNumber: '101', // Already exists
        floor: 1,
      };

      const error = new Error('Unit number already exists');
      (error as any).statusCode = 409;
      mockPropertyUnitService.addPropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.addUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Unit number already exists');
    });

    it('should return 400 for validation error', async () => {
      // Arrange
      mockRequest.body = {
        unitNumber: '', // Empty unit number
        floor: -1, // Invalid floor
      };

      const error = new Error('Validation failed');
      (error as any).statusCode = 400;
      mockPropertyUnitService.addPropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.addUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Validation failed');
    });

    it('should return 404 for property not found', async () => {
      // Arrange
      mockRequest.body = {
        unitNumber: '101',
        floor: 1,
      };

      const error = new Error('Property not found');
      (error as any).statusCode = 404;
      mockPropertyUnitService.addPropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.addUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Property not found');
    });
  });

  describe('GET /properties/:pid/units/:uid', () => {
    it('should get unit details successfully', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };

      const mockUnit = {
        success: true,
        data: {
          uid: 'unit-456',
          unitNumber: '305',
          floor: 3,
          status: 'available',
          bedrooms: 2,
          bathrooms: 2,
          squareFeet: 950,
          rentAmount: 1800,
          amenities: ['balcony', 'parking'],
        },
      };

      mockPropertyUnitService.getPropertyUnit.mockResolvedValue(mockUnit);

      // Act
      await propertyUnitController.getPropertyUnit(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockPropertyUnitService.getPropertyUnit).toHaveBeenCalledWith(mockRequest.context);
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockUnit);
    });

    it('should return 404 for unit not found', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'nonexistent-unit' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'nonexistent-unit' };

      const error = new Error('Unit not found');
      (error as any).statusCode = 404;
      mockPropertyUnitService.getPropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.getPropertyUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Unit not found');
    });

    it('should return 404 for unit belonging to different property', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-from-other-property' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-from-other-property' };

      const error = new Error('Unit does not belong to this property');
      (error as any).statusCode = 404;
      mockPropertyUnitService.getPropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.getPropertyUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Unit does not belong to this property');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockPropertyUnitService.getPropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.getPropertyUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });

    it('should validate response structure', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };

      const mockUnit = {
        success: true,
        data: {
          uid: 'unit-456',
          unitNumber: '305',
          status: 'available',
        },
      };

      mockPropertyUnitService.getPropertyUnit.mockResolvedValue(mockUnit);

      // Act
      await propertyUnitController.getPropertyUnit(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      const response = jsonMock.mock.calls[0][0];
      expect(response).toHaveProperty('success', true);
      expect(response).toHaveProperty('data');
      expect(response.data).toHaveProperty('uid');
      expect(response.data).toHaveProperty('unitNumber');
    });
  });

  describe('PUT /properties/:pid/units/:uid', () => {
    it('should update unit successfully', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.body = {
        rentAmount: 1900,
        amenities: ['balcony', 'parking', 'washer'],
        description: 'Updated unit description',
      };

      const mockResult = {
        success: true,
        message: 'Unit updated successfully',
        data: {
          uid: 'unit-456',
          unitNumber: '305',
          rentAmount: 1900,
        },
      };

      mockPropertyUnitService.updatePropertyUnit.mockResolvedValue(mockResult);

      // Act
      await propertyUnitController.updateUnit(mockRequest as AppRequest, mockResponse as Response);

      // Assert
      expect(mockPropertyUnitService.updatePropertyUnit).toHaveBeenCalledWith(
        mockRequest.context,
        mockRequest.body
      );
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should validate status change restrictions', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.body = {
        status: 'occupied', // Cannot directly change to occupied
      };

      const error = new Error('Invalid status transition');
      (error as any).statusCode = 400;
      mockPropertyUnitService.updatePropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.updateUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Invalid status transition');
    });

    it('should return 409 for unit number conflict', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.body = {
        unitNumber: '101', // Already taken
      };

      const error = new Error('Unit number already exists');
      (error as any).statusCode = 409;
      mockPropertyUnitService.updatePropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.updateUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Unit number already exists');
    });

    it('should return 400 for validation error', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.body = {
        rentAmount: -100, // Invalid rent amount
        squareFeet: 0, // Invalid square footage
      };

      const error = new Error('Validation failed');
      (error as any).statusCode = 400;
      mockPropertyUnitService.updatePropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.updateUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Validation failed');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.body = {
        rentAmount: 2000,
      };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockPropertyUnitService.updatePropertyUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.updateUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });
  });

  describe('DELETE /properties/:pid/units/:uid', () => {
    it('should soft delete unit successfully', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };

      const mockResult = {
        success: true,
        message: 'Unit archived successfully',
        data: {
          uid: 'unit-456',
          isArchived: true,
        },
      };

      mockPropertyUnitService.archiveUnit.mockResolvedValue(mockResult);

      // Act
      await propertyUnitController.archiveUnit(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockPropertyUnitService.archiveUnit).toHaveBeenCalledWith(mockRequest.context);
      expect(statusMock).toHaveBeenCalledWith(httpStatusCodes.OK);
      expect(jsonMock).toHaveBeenCalledWith(mockResult);
    });

    it('should return 404 for unit not found', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'nonexistent-unit' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'nonexistent-unit' };

      const error = new Error('Unit not found');
      (error as any).statusCode = 404;
      mockPropertyUnitService.archiveUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.archiveUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Unit not found');
    });

    it('should return 400 for occupied unit', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };

      const error = new Error('Cannot archive occupied unit');
      (error as any).statusCode = 400;
      mockPropertyUnitService.archiveUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.archiveUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Cannot archive occupied unit');
    });

    it('should return 403 for permission denied', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };

      const error = new Error('Permission denied');
      (error as any).statusCode = 403;
      mockPropertyUnitService.archiveUnit.mockRejectedValue(error);

      // Act & Assert
      await expect(
        propertyUnitController.archiveUnit(mockRequest as AppRequest, mockResponse as Response)
      ).rejects.toThrow('Permission denied');
    });

    it('should sync property occupancy after archiving unit', async () => {
      // Arrange
      mockRequest.params = { pid: 'property-123', uid: 'unit-456' };
      mockRequest.context!.params = { pid: 'property-123', uid: 'unit-456' };

      const mockResult = {
        success: true,
        message: 'Unit archived and property occupancy updated',
        data: {
          uid: 'unit-456',
          isArchived: true,
          propertyOccupancyUpdated: true,
        },
      };

      mockPropertyUnitService.archiveUnit.mockResolvedValue(mockResult);

      // Act
      await propertyUnitController.archiveUnit(
        mockRequest as AppRequest,
        mockResponse as Response
      );

      // Assert
      expect(mockPropertyUnitService.archiveUnit).toHaveBeenCalled();
      const response = jsonMock.mock.calls[0][0];
      expect(response.success).toBe(true);
    });
  });
});
