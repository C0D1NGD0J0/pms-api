/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { PropertyUnit } from '@models/index';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';
import { Types } from 'mongoose';
import { PropertyUnitStatusEnum } from '@interfaces/propertyUnit.interface';

import { setupDAOTestMocks } from '@tests/mocks/dao/commonMocks';

// Setup centralized mocks
setupDAOTestMocks();

describe('PropertyUnitDAO - Unit Tests', () => {
  let propertyUnitDAO: PropertyUnitDAO;
  let mockPropertyUnitModel: any;
  let mockLogger: any;

  beforeAll(() => {
    mockPropertyUnitModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    propertyUnitDAO = new PropertyUnitDAO({ 
      propertyUnitModel: mockPropertyUnitModel 
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('findUnitsByProperty', () => {
    describe('Successful units retrieval', () => {
      it('should find all units for a property', async () => {
        // Arrange
        const propertyId = 'property-123';
        const opts = { page: 1, limit: 10 };
        const units = [
          TestDataFactory.createPropertyUnit({ propertyId, unitNumber: '101' }),
          TestDataFactory.createPropertyUnit({ propertyId, unitNumber: '102' }),
          TestDataFactory.createPropertyUnit({ propertyId, unitNumber: '103' }),
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

        propertyUnitDAO.list = jest.fn().mockResolvedValue(paginatedResult);

        // Act
        const result = await propertyUnitDAO.findUnitsByProperty(propertyId, opts);

        // Assert
        expect(result).toEqual(units);
        expect(propertyUnitDAO.list).toHaveBeenCalledWith(
          {
            propertyId: expect.any(Types.ObjectId),
            deletedAt: null,
          },
          opts
        );
      });

      it('should handle empty units list', async () => {
        // Arrange
        const propertyId = 'property-empty';
        const opts = { page: 1, limit: 10 };

        const emptyResult = {
          data: [],
          pagination: {
            page: 1,
            limit: 10,
            total: 0,
            pages: 0,
          },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(emptyResult);

        // Act
        const result = await propertyUnitDAO.findUnitsByProperty(propertyId, opts);

        // Assert
        expect(result).toEqual([]);
        expect(result).toHaveLength(0);
      });
    });

    describe('Units retrieval errors', () => {
      it('should throw error for missing property ID', async () => {
        // Arrange
        const propertyId = '';
        const opts = { page: 1, limit: 10 };

        // Act & Assert
        await expect(propertyUnitDAO.findUnitsByProperty(propertyId, opts))
          .rejects.toThrow('Property ID is required');
      });

      it('should handle database query errors', async () => {
        // Arrange
        const propertyId = 'property-error';
        const opts = { page: 1, limit: 10 };
        const dbError = new Error('Database connection failed');

        propertyUnitDAO.list = jest.fn().mockRejectedValue(dbError);
        propertyUnitDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(propertyUnitDAO.findUnitsByProperty(propertyId, opts))
          .rejects.toThrow('Database connection failed');

        expect(propertyUnitDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });

  describe('findUnitByNumberAndProperty', () => {
    describe('Successful unit retrieval', () => {
      it('should find unit by number and property', async () => {
        // Arrange
        const unitNumber = '101';
        const propertyId = 'property-123';
        const unit = TestDataFactory.createPropertyUnit({
          unitNumber,
          propertyId,
        });

        propertyUnitDAO.findFirst = jest.fn().mockResolvedValue(unit);

        // Act
        const result = await propertyUnitDAO.findUnitByNumberAndProperty(unitNumber, propertyId);

        // Assert
        expect(result).toEqual(unit);
        expect(propertyUnitDAO.findFirst).toHaveBeenCalledWith({
          unitNumber,
          propertyId: expect.any(Types.ObjectId),
          deletedAt: null,
        });
      });

      it('should return null for non-existent unit', async () => {
        // Arrange
        const unitNumber = '999';
        const propertyId = 'property-123';

        propertyUnitDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await propertyUnitDAO.findUnitByNumberAndProperty(unitNumber, propertyId);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Unit retrieval validation errors', () => {
      it('should throw error for missing unit number', async () => {
        // Arrange
        const unitNumber = '';
        const propertyId = 'property-123';

        // Act & Assert
        await expect(propertyUnitDAO.findUnitByNumberAndProperty(unitNumber, propertyId))
          .rejects.toThrow('Unit number and property ID are required');
      });

      it('should throw error for missing property ID', async () => {
        // Arrange
        const unitNumber = '101';
        const propertyId = '';

        // Act & Assert
        await expect(propertyUnitDAO.findUnitByNumberAndProperty(unitNumber, propertyId))
          .rejects.toThrow('Unit number and property ID are required');
      });
    });
  });

  describe('findAvailableUnits', () => {
    describe('Successful available units retrieval', () => {
      it('should find all available units without property filter', async () => {
        // Arrange
        const availableUnits = [
          TestDataFactory.createPropertyUnit({ status: PropertyUnitStatusEnum.AVAILABLE }),
          TestDataFactory.createPropertyUnit({ status: PropertyUnitStatusEnum.AVAILABLE }),
        ];

        const result = {
          data: availableUnits,
          pagination: { page: 1, limit: 10, total: 2, pages: 1 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(result);

        // Act
        const units = await propertyUnitDAO.findAvailableUnits();

        // Assert
        expect(units).toEqual(availableUnits);
        expect(propertyUnitDAO.list).toHaveBeenCalledWith({
          status: PropertyUnitStatusEnum.AVAILABLE,
          isActive: true,
          deletedAt: null,
        });
      });

      it('should find available units for specific property', async () => {
        // Arrange
        const propertyId = 'property-123';
        const availableUnits = [
          TestDataFactory.createPropertyUnit({ 
            propertyId,
            status: PropertyUnitStatusEnum.AVAILABLE 
          }),
        ];

        const result = {
          data: availableUnits,
          pagination: { page: 1, limit: 10, total: 1, pages: 1 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(result);

        // Act
        const units = await propertyUnitDAO.findAvailableUnits(propertyId);

        // Assert
        expect(units).toEqual(availableUnits);
        expect(propertyUnitDAO.list).toHaveBeenCalledWith({
          status: PropertyUnitStatusEnum.AVAILABLE,
          isActive: true,
          deletedAt: null,
          propertyId: expect.any(Types.ObjectId),
        });
      });

      it('should handle no available units', async () => {
        // Arrange
        const emptyResult = {
          data: [],
          pagination: { page: 1, limit: 10, total: 0, pages: 0 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(emptyResult);

        // Act
        const units = await propertyUnitDAO.findAvailableUnits();

        // Assert
        expect(units).toEqual([]);
        expect(units).toHaveLength(0);
      });
    });
  });

  describe('findUnitsByStatus', () => {
    describe('Successful units by status retrieval', () => {
      it('should find units by status without property filter', async () => {
        // Arrange
        const status = PropertyUnitStatusEnum.OCCUPIED;
        const occupiedUnits = [
          TestDataFactory.createPropertyUnit({ status }),
          TestDataFactory.createPropertyUnit({ status }),
        ];

        const result = {
          data: occupiedUnits,
          pagination: { page: 1, limit: 10, total: 2, pages: 1 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(result);

        // Act
        const units = await propertyUnitDAO.findUnitsByStatus(status);

        // Assert
        expect(units).toEqual(occupiedUnits);
        expect(propertyUnitDAO.list).toHaveBeenCalledWith({
          status,
          isActive: true,
          deletedAt: null,
        });
      });

      it('should find units by status for specific property', async () => {
        // Arrange
        const status = PropertyUnitStatusEnum.MAINTENANCE;
        const propertyId = 'property-123';
        const maintenanceUnits = [
          TestDataFactory.createPropertyUnit({ 
            propertyId,
            status 
          }),
        ];

        const result = {
          data: maintenanceUnits,
          pagination: { page: 1, limit: 10, total: 1, pages: 1 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(result);

        // Act
        const units = await propertyUnitDAO.findUnitsByStatus(status, propertyId);

        // Assert
        expect(units).toEqual(maintenanceUnits);
        expect(propertyUnitDAO.list).toHaveBeenCalledWith({
          status,
          isActive: true,
          deletedAt: null,
          propertyId: expect.any(Types.ObjectId),
        });
      });
    });

    describe('Units by status validation errors', () => {
      it('should throw error for missing status', async () => {
        // Arrange
        const status = '';

        // Act & Assert
        await expect(propertyUnitDAO.findUnitsByStatus(status))
          .rejects.toThrow('Status is required');
      });
    });
  });

  describe('getUnitCountsByStatus', () => {
    describe('Successful unit counts retrieval', () => {
      it('should get unit counts by status without property filter', async () => {
        // Arrange
        const aggregationResults = [
          { _id: PropertyUnitStatusEnum.AVAILABLE, count: 5 },
          { _id: PropertyUnitStatusEnum.OCCUPIED, count: 3 },
          { _id: PropertyUnitStatusEnum.MAINTENANCE, count: 1 },
        ];

        propertyUnitDAO.aggregate = jest.fn().mockResolvedValue(aggregationResults);

        // Act
        const result = await propertyUnitDAO.getUnitCountsByStatus();

        // Assert
        expect(result).toEqual({
          [PropertyUnitStatusEnum.AVAILABLE]: 5,
          [PropertyUnitStatusEnum.OCCUPIED]: 3,
          [PropertyUnitStatusEnum.RESERVED]: 0,
          [PropertyUnitStatusEnum.MAINTENANCE]: 1,
          [PropertyUnitStatusEnum.INACTIVE]: 0,
        });

        expect(propertyUnitDAO.aggregate).toHaveBeenCalledWith([
          {
            $match: {
              isActive: true,
              deletedAt: null,
            },
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
        ]);
      });

      it('should get unit counts by status for specific property', async () => {
        // Arrange
        const propertyId = 'property-123';
        const aggregationResults = [
          { _id: PropertyUnitStatusEnum.AVAILABLE, count: 2 },
          { _id: PropertyUnitStatusEnum.OCCUPIED, count: 1 },
        ];

        propertyUnitDAO.aggregate = jest.fn().mockResolvedValue(aggregationResults);

        // Act
        const result = await propertyUnitDAO.getUnitCountsByStatus(propertyId);

        // Assert
        expect(result).toEqual({
          [PropertyUnitStatusEnum.AVAILABLE]: 2,
          [PropertyUnitStatusEnum.OCCUPIED]: 1,
          [PropertyUnitStatusEnum.RESERVED]: 0,
          [PropertyUnitStatusEnum.MAINTENANCE]: 0,
          [PropertyUnitStatusEnum.INACTIVE]: 0,
        });

        expect(propertyUnitDAO.aggregate).toHaveBeenCalledWith([
          {
            $match: {
              isActive: true,
              deletedAt: null,
              propertyId: expect.any(Types.ObjectId),
            },
          },
          {
            $group: {
              _id: '$status',
              count: { $sum: 1 },
            },
          },
        ]);
      });

      it('should handle empty aggregation results', async () => {
        // Arrange
        propertyUnitDAO.aggregate = jest.fn().mockResolvedValue([]);

        // Act
        const result = await propertyUnitDAO.getUnitCountsByStatus();

        // Assert
        expect(result).toEqual({
          [PropertyUnitStatusEnum.AVAILABLE]: 0,
          [PropertyUnitStatusEnum.OCCUPIED]: 0,
          [PropertyUnitStatusEnum.RESERVED]: 0,
          [PropertyUnitStatusEnum.MAINTENANCE]: 0,
          [PropertyUnitStatusEnum.INACTIVE]: 0,
        });
      });
    });
  });

  describe('updateUnitStatus', () => {
    describe('Successful status update', () => {
      it('should update unit status successfully', async () => {
        // Arrange
        const unitId = 'unit-123';
        const status = PropertyUnitStatusEnum.AVAILABLE;
        const userId = 'user-456';

        const existingUnit = TestDataFactory.createPropertyUnit({
          _id: unitId,
          status: PropertyUnitStatusEnum.MAINTENANCE,
        });

        const updatedUnit = {
          ...existingUnit,
          status,
          lastModifiedBy: new Types.ObjectId(userId),
        };

        propertyUnitDAO.findById = jest.fn().mockResolvedValue(existingUnit);
        propertyUnitDAO.updateById = jest.fn().mockResolvedValue(updatedUnit);

        // Act
        const result = await propertyUnitDAO.updateUnitStatus(unitId, status, userId);

        // Assert
        expect(result).toEqual(updatedUnit);
        expect(propertyUnitDAO.updateById).toHaveBeenCalledWith(
          unitId,
          {
            $set: {
              status,
              lastModifiedBy: expect.any(Types.ObjectId),
            },
          }
        );
      });

      it('should allow occupied to available status change', async () => {
        // Arrange
        const unitId = 'unit-occupied';
        const status = PropertyUnitStatusEnum.AVAILABLE;
        const userId = 'user-456';

        const existingUnit = TestDataFactory.createPropertyUnit({
          _id: unitId,
          status: PropertyUnitStatusEnum.OCCUPIED,
          currentLease: null, // No active lease
        });

        const updatedUnit = {
          ...existingUnit,
          status,
        };

        propertyUnitDAO.findById = jest.fn().mockResolvedValue(existingUnit);
        propertyUnitDAO.updateById = jest.fn().mockResolvedValue(updatedUnit);

        // Act
        const result = await propertyUnitDAO.updateUnitStatus(unitId, status, userId);

        // Assert
        expect(result).toEqual(updatedUnit);
        expect(result.status).toBe(PropertyUnitStatusEnum.AVAILABLE);
      });
    });

    describe('Status update validation errors', () => {
      it('should throw error for missing parameters', async () => {
        // Arrange
        const unitId = '';
        const status = PropertyUnitStatusEnum.AVAILABLE;
        const userId = 'user-456';

        // Act & Assert
        await expect(propertyUnitDAO.updateUnitStatus(unitId, status, userId))
          .rejects.toThrow('Property unit ID, status, and user ID are required');
      });

      it('should throw error for non-existent unit', async () => {
        // Arrange
        const unitId = 'non-existent-unit';
        const status = PropertyUnitStatusEnum.AVAILABLE;
        const userId = 'user-456';

        propertyUnitDAO.findById = jest.fn().mockResolvedValue(null);

        // Act & Assert
        await expect(propertyUnitDAO.updateUnitStatus(unitId, status, userId))
          .rejects.toThrow('Property unit not found');
      });

      it('should throw error for occupied unit with active lease', async () => {
        // Arrange
        const unitId = 'unit-with-lease';
        const status = PropertyUnitStatusEnum.MAINTENANCE;
        const userId = 'user-456';

        const existingUnit = TestDataFactory.createPropertyUnit({
          _id: unitId,
          status: PropertyUnitStatusEnum.OCCUPIED,
          currentLease: { _id: 'lease-123' }, // Has active lease
        });

        propertyUnitDAO.findById = jest.fn().mockResolvedValue(existingUnit);

        // Act & Assert
        await expect(propertyUnitDAO.updateUnitStatus(unitId, status, userId))
          .rejects.toThrow('Cannot change status of occupied unit with active lease');
      });
    });
  });

  describe('addInspection', () => {
    describe('Successful inspection addition', () => {
      it('should add inspection successfully', async () => {
        // Arrange
        const unitId = 'unit-123';
        const userId = 'user-456';
        const inspectionData = {
          status: 'passed',
          notes: 'Unit is in good condition',
          inspector: {
            name: 'John Inspector',
            contact: 'john@example.com',
          },
        };

        const updatedUnit = TestDataFactory.createPropertyUnit({
          _id: unitId,
          inspections: [inspectionData],
          lastInspectionDate: new Date(),
        });

        propertyUnitDAO.updateById = jest.fn().mockResolvedValue(updatedUnit);

        // Act
        const result = await propertyUnitDAO.addInspection(unitId, inspectionData, userId);

        // Assert
        expect(result).toEqual(updatedUnit);
        expect(propertyUnitDAO.updateById).toHaveBeenCalledWith(
          unitId,
          {
            $push: { inspections: expect.any(Object) },
            $set: {
              lastInspectionDate: expect.any(Date),
              lastModifiedBy: expect.any(Types.ObjectId),
            },
          }
        );
      });

      it('should add inspection with default values', async () => {
        // Arrange
        const unitId = 'unit-123';
        const userId = 'user-456';
        const inspectionData = {
          status: 'failed',
        };

        const updatedUnit = TestDataFactory.createPropertyUnit({
          _id: unitId,
          inspections: [inspectionData],
        });

        propertyUnitDAO.updateById = jest.fn().mockResolvedValue(updatedUnit);

        // Act
        const result = await propertyUnitDAO.addInspection(unitId, inspectionData, userId);

        // Assert
        expect(result).toEqual(updatedUnit);
        expect(propertyUnitDAO.updateById).toHaveBeenCalledWith(
          unitId,
          expect.objectContaining({
            $push: { 
              inspections: expect.objectContaining({
                status: 'failed',
                inspectionDate: expect.any(Date),
                inspector: {
                  name: 'System User',
                  contact: 'system',
                },
              }),
            },
          })
        );
      });
    });

    describe('Inspection addition validation errors', () => {
      it('should throw error for missing parameters', async () => {
        // Arrange
        const unitId = '';
        const userId = 'user-456';
        const inspectionData = { status: 'passed' };

        // Act & Assert
        await expect(propertyUnitDAO.addInspection(unitId, inspectionData, userId))
          .rejects.toThrow('Property unit ID, inspection data, and user ID are required');
      });

      it('should throw error for missing inspection status', async () => {
        // Arrange
        const unitId = 'unit-123';
        const userId = 'user-456';
        const inspectionData = {}; // Missing status

        // Act & Assert
        await expect(propertyUnitDAO.addInspection(unitId, inspectionData, userId))
          .rejects.toThrow('Inspection status is required');
      });
    });
  });

  describe('getPropertyUnitInfo', () => {
    describe('Successful unit info retrieval', () => {
      it('should get comprehensive unit information', async () => {
        // Arrange
        const propertyId = 'property-123';
        const units = [
          TestDataFactory.createPropertyUnit({ status: PropertyUnitStatusEnum.AVAILABLE }),
          TestDataFactory.createPropertyUnit({ status: PropertyUnitStatusEnum.AVAILABLE }),
          TestDataFactory.createPropertyUnit({ status: PropertyUnitStatusEnum.OCCUPIED }),
          TestDataFactory.createPropertyUnit({ status: PropertyUnitStatusEnum.MAINTENANCE }),
          TestDataFactory.createPropertyUnit({ status: PropertyUnitStatusEnum.RESERVED }),
        ];

        const listResult = {
          data: units,
          pagination: { page: 1, limit: 1000, total: 5, pages: 1 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(listResult);

        // Act
        const result = await propertyUnitDAO.getPropertyUnitInfo(propertyId);

        // Assert
        expect(result).toEqual({
          currentUnits: 5,
          unitStats: {
            occupied: 1,
            vacant: 0,
            maintenance: 1,
            available: 2,
            reserved: 1,
            inactive: 0,
          },
        });

        expect(propertyUnitDAO.list).toHaveBeenCalledWith(
          {
            propertyId: expect.any(Types.ObjectId),
            deletedAt: null,
          },
          { limit: 1000 }
        );
      });

      it('should handle property with no units', async () => {
        // Arrange
        const propertyId = 'property-empty';

        const emptyResult = {
          data: [],
          pagination: { page: 1, limit: 1000, total: 0, pages: 0 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(emptyResult);

        // Act
        const result = await propertyUnitDAO.getPropertyUnitInfo(propertyId);

        // Assert
        expect(result).toEqual({
          currentUnits: 0,
          unitStats: {
            occupied: 0,
            vacant: 0,
            maintenance: 0,
            available: 0,
            reserved: 0,
            inactive: 0,
          },
        });
      });
    });

    describe('Unit info validation errors', () => {
      it('should throw error for missing property ID', async () => {
        // Arrange
        const propertyId = '';

        // Act & Assert
        await expect(propertyUnitDAO.getPropertyUnitInfo(propertyId))
          .rejects.toThrow('Property ID is required');
      });
    });
  });

  describe('getExistingUnitNumbers', () => {
    describe('Successful unit numbers retrieval', () => {
      it('should get existing unit numbers for property', async () => {
        // Arrange
        const propertyId = 'property-123';
        const units = [
          { unitNumber: '101' },
          { unitNumber: '102' },
          { unitNumber: '201' },
          { unitNumber: 'A-1001' },
        ];

        const listResult = {
          data: units,
          pagination: { page: 1, limit: 1000, total: 4, pages: 1 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(listResult);

        // Act
        const result = await propertyUnitDAO.getExistingUnitNumbers(propertyId);

        // Assert
        expect(result).toEqual(['101', '102', '201', 'A-1001']);
        expect(propertyUnitDAO.list).toHaveBeenCalledWith(
          {
            propertyId: expect.any(Types.ObjectId),
            deletedAt: null,
          },
          { limit: 1000, projection: 'unitNumber' }
        );
      });

      it('should filter out empty unit numbers', async () => {
        // Arrange
        const propertyId = 'property-456';
        const units = [
          { unitNumber: '101' },
          { unitNumber: null },
          { unitNumber: '102' },
          { unitNumber: '' },
          { unitNumber: '103' },
        ];

        const listResult = {
          data: units,
          pagination: { page: 1, limit: 1000, total: 5, pages: 1 },
        };

        propertyUnitDAO.list = jest.fn().mockResolvedValue(listResult);

        // Act
        const result = await propertyUnitDAO.getExistingUnitNumbers(propertyId);

        // Assert
        expect(result).toEqual(['101', '102', '103']);
      });
    });
  });

  describe('getNextAvailableUnitNumber', () => {
    describe('Successful unit number generation', () => {
      it('should generate sequential unit number', async () => {
        // Arrange
        const propertyId = 'property-123';
        const existingNumbers = ['101', '102', '103'];

        propertyUnitDAO.getExistingUnitNumbers = jest.fn().mockResolvedValue(existingNumbers);

        // Act
        const result = await propertyUnitDAO.getNextAvailableUnitNumber(propertyId, 'sequential');

        // Assert
        expect(result).toBe('104');
        expect(propertyUnitDAO.getExistingUnitNumbers).toHaveBeenCalledWith(propertyId);
      });

      it('should generate floor-based unit number', async () => {
        // Arrange
        const propertyId = 'property-456';
        const existingNumbers = ['101', '102', '201'];

        propertyUnitDAO.getExistingUnitNumbers = jest.fn().mockResolvedValue(existingNumbers);

        // Act
        const result = await propertyUnitDAO.getNextAvailableUnitNumber(propertyId, 'floorBased');

        // Assert
        expect(result).toBe('103');
        expect(propertyUnitDAO.getExistingUnitNumbers).toHaveBeenCalledWith(propertyId);
      });

      it('should generate custom pattern unit number', async () => {
        // Arrange
        const propertyId = 'property-789';
        const existingNumbers = ['A-1001', 'A-1002', 'B-1001'];

        propertyUnitDAO.getExistingUnitNumbers = jest.fn().mockResolvedValue(existingNumbers);

        // Act
        const result = await propertyUnitDAO.getNextAvailableUnitNumber(propertyId, 'custom');

        // Assert
        expect(result).toBe('A-1003');
        expect(propertyUnitDAO.getExistingUnitNumbers).toHaveBeenCalledWith(propertyId);
      });

      it('should default to sequential pattern', async () => {
        // Arrange
        const propertyId = 'property-default';
        const existingNumbers = ['101'];

        propertyUnitDAO.getExistingUnitNumbers = jest.fn().mockResolvedValue(existingNumbers);

        // Act
        const result = await propertyUnitDAO.getNextAvailableUnitNumber(propertyId);

        // Assert
        expect(result).toBe('102');
      });
    });

    describe('Unit number generation validation errors', () => {
      it('should throw error for missing property ID', async () => {
        // Arrange
        const propertyId = '';

        // Act & Assert
        await expect(propertyUnitDAO.getNextAvailableUnitNumber(propertyId))
          .rejects.toThrow('Property ID is required');
      });
    });
  });

  describe('getSuggestedStartingUnitNumber', () => {
    describe('Suggested unit number by property type', () => {
      it('should suggest floor-based numbering for apartments', () => {
        // Act
        const result = propertyUnitDAO.getSuggestedStartingUnitNumber('apartment');

        // Assert
        expect(result).toBe('101');
      });

      it('should suggest floor-based numbering for condominiums', () => {
        // Act
        const result = propertyUnitDAO.getSuggestedStartingUnitNumber('condominium');

        // Assert
        expect(result).toBe('101');
      });

      it('should suggest letter prefix for commercial properties', () => {
        // Act
        const result = propertyUnitDAO.getSuggestedStartingUnitNumber('commercial');

        // Assert
        expect(result).toBe('A-1001');
      });

      it('should suggest letter prefix for industrial properties', () => {
        // Act
        const result = propertyUnitDAO.getSuggestedStartingUnitNumber('industrial');

        // Assert
        expect(result).toBe('A-1001');
      });

      it('should suggest simple sequential for houses', () => {
        // Act
        const result = propertyUnitDAO.getSuggestedStartingUnitNumber('house');

        // Assert
        expect(result).toBe('1');
      });

      it('should suggest simple sequential for townhouses', () => {
        // Act
        const result = propertyUnitDAO.getSuggestedStartingUnitNumber('townhouse');

        // Assert
        expect(result).toBe('1');
      });

      it('should default to floor-based for unknown types', () => {
        // Act
        const result = propertyUnitDAO.getSuggestedStartingUnitNumber('unknown');

        // Assert
        expect(result).toBe('101');
      });
    });
  });
});