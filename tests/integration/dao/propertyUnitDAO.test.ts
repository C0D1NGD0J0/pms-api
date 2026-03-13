import { Types } from 'mongoose';
import { PropertyUnit } from '@models/index';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { clearTestDatabase } from '@tests/helpers';
import {
  PropertyUnitStatusEnum,
  PropertyUnitTypeEnum,
  InspectionStatusEnum,} from '@interfaces/propertyUnit.interface';

describe('PropertyUnitDAO Integration Tests', () => {
  let propertyUnitDAO: PropertyUnitDAO;
  let testPropertyId: Types.ObjectId;
  let testUserId: Types.ObjectId;
  let testCuid: string;

  beforeAll(async () => {
    propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
  });
  beforeEach(async () => {
    await clearTestDatabase();
    testPropertyId = new Types.ObjectId();
    testUserId = new Types.ObjectId();
    testCuid = 'TEST_CLIENT';

    // Create test units
    await PropertyUnit.insertMany([
      {
        propertyId: testPropertyId,
        cuid: testCuid,
        unitNumber: '101',
        floor: 1,
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.AVAILABLE,
        fees: { rentAmount: 1000, currency: 'USD', securityDeposit: 1000 },
        specifications: { totalArea: 500, bathrooms: 1 },
        utilities: { water: true, heating: true, gas: false, trash: false, centralAC: false },
        amenities: {
          parking: true,
          cableTV: false,
          storage: false,
          internet: false,
          dishwasher: false,
          washerDryer: false,
        },
        isActive: true,
        createdBy: testUserId,
        managedBy: testUserId,
      },
      {
        propertyId: testPropertyId,
        cuid: testCuid,
        unitNumber: '102',
        floor: 1,
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.OCCUPIED,
        fees: { rentAmount: 1200, currency: 'USD', securityDeposit: 1200 },
        specifications: { totalArea: 600, bathrooms: 1 },
        utilities: { water: true, heating: true, gas: false, trash: false, centralAC: false },
        amenities: {
          parking: false,
          cableTV: false,
          storage: false,
          internet: false,
          dishwasher: false,
          washerDryer: false,
        },
        isActive: true,
        createdBy: testUserId,
        managedBy: testUserId,
        currentLease: new Types.ObjectId(),
      },
      {
        propertyId: testPropertyId,
        cuid: testCuid,
        unitNumber: '201',
        floor: 2,
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.MAINTENANCE,
        fees: { rentAmount: 1500, currency: 'USD', securityDeposit: 1500 },
        specifications: { totalArea: 750, bathrooms: 2 },
        utilities: { water: true, heating: true, gas: true, trash: true, centralAC: true },
        amenities: {
          parking: true,
          cableTV: true,
          storage: true,
          internet: true,
          dishwasher: true,
          washerDryer: true,
        },
        isActive: true,
        createdBy: testUserId,
        managedBy: testUserId,
      },
    ]);
  });

  describe('findUnitsByPropertyId', () => {
    it('should find all units for a property', async () => {
      const result = await propertyUnitDAO.findUnitsByPropertyId(testPropertyId.toString());

      expect(result.items.length).toBe(3);
      expect(result.pagination?.total).toBe(3);
    });

    it('should sort units by floor and unitNumber ascending', async () => {
      const result = await propertyUnitDAO.findUnitsByPropertyId(testPropertyId.toString());

      expect(result.items[0].unitNumber).toBe('101');
      expect(result.items[1].unitNumber).toBe('102');
      expect(result.items[2].unitNumber).toBe('201');
    });

    it('should support pagination', async () => {
      const result = await propertyUnitDAO.findUnitsByPropertyId(testPropertyId.toString(), {
        page: 1,
        limit: 2,
      });

      expect(result.items.length).toBe(2);
      expect(result.pagination?.total).toBe(3);
    });

    it('should support custom sorting', async () => {
      const result = await propertyUnitDAO.findUnitsByPropertyId(testPropertyId.toString(), {
        page: 1,
        limit: 10,
        sortBy: 'fees.rentAmount',
        sort: 'desc',
      });

      expect(result.items[0].fees.rentAmount).toBe(1500);
      expect(result.items[2].fees.rentAmount).toBe(1000);
    });

    it('should exclude soft-deleted units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { deletedAt: new Date() });

      const result = await propertyUnitDAO.findUnitsByPropertyId(testPropertyId.toString());

      expect(result.items.length).toBe(2);
      expect(result.items.find((u) => u.unitNumber === '101')).toBeUndefined();
    });

    it('should throw error if property ID is missing', async () => {
      await expect(propertyUnitDAO.findUnitsByPropertyId('')).rejects.toThrow();
    });

    it('should return empty array for non-existent property', async () => {
      const nonExistentId = new Types.ObjectId().toString();
      const result = await propertyUnitDAO.findUnitsByPropertyId(nonExistentId);

      expect(result.items.length).toBe(0);
    });
  });

  describe('findUnitByNumberAndProperty', () => {
    it('should find unit by unit number and property ID', async () => {
      const unit = await propertyUnitDAO.findUnitByNumberAndProperty(
        '101',
        testPropertyId.toString()
      );

      expect(unit).not.toBeNull();
      expect(unit?.unitNumber).toBe('101');
      expect(unit?.propertyId.toString()).toBe(testPropertyId.toString());
    });

    it('should return null for non-existent unit number', async () => {
      const unit = await propertyUnitDAO.findUnitByNumberAndProperty(
        '999',
        testPropertyId.toString()
      );

      expect(unit).toBeNull();
    });

    it('should return null for soft-deleted unit', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { deletedAt: new Date() });

      const unit = await propertyUnitDAO.findUnitByNumberAndProperty(
        '101',
        testPropertyId.toString()
      );

      expect(unit).toBeNull();
    });

    it('should throw error if unit number is missing', async () => {
      await expect(
        propertyUnitDAO.findUnitByNumberAndProperty('', testPropertyId.toString())
      ).rejects.toThrow();
    });

    it('should throw error if property ID is missing', async () => {
      await expect(propertyUnitDAO.findUnitByNumberAndProperty('101', '')).rejects.toThrow();
    });
  });

  describe('findAvailableUnits', () => {
    it('should find all available units across all properties', async () => {
      const result = await propertyUnitDAO.findAvailableUnits();

      expect(result.items.length).toBe(1);
      expect(result.items[0].status).toBe(PropertyUnitStatusEnum.AVAILABLE);
    });

    it('should find available units for specific property', async () => {
      const result = await propertyUnitDAO.findAvailableUnits(testPropertyId.toString());

      expect(result.items.length).toBe(1);
      expect(result.items[0].unitNumber).toBe('101');
    });

    it('should only return active units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { isActive: false });

      const result = await propertyUnitDAO.findAvailableUnits(testPropertyId.toString());

      expect(result.items.length).toBe(0);
    });

    it('should exclude soft-deleted units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { deletedAt: new Date() });

      const result = await propertyUnitDAO.findAvailableUnits(testPropertyId.toString());

      expect(result.items.length).toBe(0);
    });

    it('should return empty array if no available units', async () => {
      await PropertyUnit.updateMany({}, { status: PropertyUnitStatusEnum.OCCUPIED });

      const result = await propertyUnitDAO.findAvailableUnits(testPropertyId.toString());

      expect(result.items.length).toBe(0);
    });

    it('should sort results by floor and unit number', async () => {
      await PropertyUnit.create({
        propertyId: testPropertyId,
        cuid: testCuid,
        unitNumber: '103',
        floor: 1,
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.AVAILABLE,
        fees: { rentAmount: 900, currency: 'USD' },
        specifications: { totalArea: 400, bathrooms: 1 },
        utilities: { water: true, heating: true, gas: false, trash: false, centralAC: false },
        amenities: {
          parking: false,
          cableTV: false,
          storage: false,
          internet: false,
          dishwasher: false,
          washerDryer: false,
        },
        isActive: true,
        createdBy: testUserId,
        managedBy: testUserId,
      });

      const result = await propertyUnitDAO.findAvailableUnits(testPropertyId.toString());

      expect(result.items.length).toBe(2);
      expect(result.items[0].unitNumber).toBe('101');
      expect(result.items[1].unitNumber).toBe('103');
    });
  });

  describe('findUnitsByStatus', () => {
    it('should find units by occupied status', async () => {
      const result = await propertyUnitDAO.findUnitsByStatus(PropertyUnitStatusEnum.OCCUPIED);

      expect(result.items.length).toBe(1);
      expect(result.items[0].unitNumber).toBe('102');
    });

    it('should find units by maintenance status for specific property', async () => {
      const result = await propertyUnitDAO.findUnitsByStatus(
        PropertyUnitStatusEnum.MAINTENANCE,
        testPropertyId.toString()
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].unitNumber).toBe('201');
    });

    it('should throw error if status is missing', async () => {
      await expect(propertyUnitDAO.findUnitsByStatus('' as any)).rejects.toThrow();
    });

    it('should only return active units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '201' }, { isActive: false });

      const result = await propertyUnitDAO.findUnitsByStatus(
        PropertyUnitStatusEnum.MAINTENANCE,
        testPropertyId.toString()
      );

      expect(result.items.length).toBe(0);
    });

    it('should exclude soft-deleted units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '102' }, { deletedAt: new Date() });

      const result = await propertyUnitDAO.findUnitsByStatus(PropertyUnitStatusEnum.OCCUPIED);

      expect(result.items.length).toBe(0);
    });

    it('should return empty array for status with no matches', async () => {
      const result = await propertyUnitDAO.findUnitsByStatus(PropertyUnitStatusEnum.RESERVED);

      expect(result.items.length).toBe(0);
    });
  });

  describe('getUnitCountsByStatus', () => {
    it('should return counts for all statuses', async () => {
      const result = await propertyUnitDAO.getUnitCountsByStatus(testPropertyId.toString());

      expect(result[PropertyUnitStatusEnum.AVAILABLE]).toBe(1);
      expect(result[PropertyUnitStatusEnum.OCCUPIED]).toBe(1);
      expect(result[PropertyUnitStatusEnum.MAINTENANCE]).toBe(1);
      expect(result[PropertyUnitStatusEnum.RESERVED]).toBe(0);
      expect(result[PropertyUnitStatusEnum.INACTIVE]).toBe(0);
    });

    it('should only count active units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { isActive: false });

      const result = await propertyUnitDAO.getUnitCountsByStatus(testPropertyId.toString());

      expect(result[PropertyUnitStatusEnum.AVAILABLE]).toBe(0);
    });

    it('should exclude soft-deleted units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '102' }, { deletedAt: new Date() });

      const result = await propertyUnitDAO.getUnitCountsByStatus(testPropertyId.toString());

      expect(result[PropertyUnitStatusEnum.OCCUPIED]).toBe(0);
    });

    it('should return all zeros for property with no units', async () => {
      const emptyPropertyId = new Types.ObjectId().toString();
      const result = await propertyUnitDAO.getUnitCountsByStatus(emptyPropertyId);

      expect(result[PropertyUnitStatusEnum.AVAILABLE]).toBe(0);
      expect(result[PropertyUnitStatusEnum.OCCUPIED]).toBe(0);
      expect(result[PropertyUnitStatusEnum.MAINTENANCE]).toBe(0);
      expect(result[PropertyUnitStatusEnum.RESERVED]).toBe(0);
      expect(result[PropertyUnitStatusEnum.INACTIVE]).toBe(0);
    });

    it('should handle multiple units with same status', async () => {
      await PropertyUnit.create({
        propertyId: testPropertyId,
        cuid: testCuid,
        unitNumber: '103',
        floor: 1,
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.AVAILABLE,
        fees: { rentAmount: 1100, currency: 'USD' },
        specifications: { totalArea: 550, bathrooms: 1 },
        utilities: { water: true, heating: true, gas: false, trash: false, centralAC: false },
        amenities: {
          parking: false,
          cableTV: false,
          storage: false,
          internet: false,
          dishwasher: false,
          washerDryer: false,
        },
        isActive: true,
        createdBy: testUserId,
        managedBy: testUserId,
      });

      const result = await propertyUnitDAO.getUnitCountsByStatus(testPropertyId.toString());

      expect(result[PropertyUnitStatusEnum.AVAILABLE]).toBe(2);
    });
  });

  describe('updateUnitStatus', () => {
    it('should update unit status successfully', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      const result = await propertyUnitDAO.updateUnitStatus(
        unit!._id.toString(),
        PropertyUnitStatusEnum.RESERVED,
        testUserId.toString()
      );

      expect(result?.status).toBe(PropertyUnitStatusEnum.RESERVED);
      expect(result?.lastModifiedBy?.toString()).toBe(testUserId.toString());
    });

    it('should allow changing occupied unit to available', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '102' });
      const result = await propertyUnitDAO.updateUnitStatus(
        unit!._id.toString(),
        PropertyUnitStatusEnum.AVAILABLE,
        testUserId.toString()
      );

      expect(result?.status).toBe(PropertyUnitStatusEnum.AVAILABLE);
    });

    it('should throw error when changing occupied unit with active lease to other status', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '102' });

      await expect(
        propertyUnitDAO.updateUnitStatus(
          unit!._id.toString(),
          PropertyUnitStatusEnum.MAINTENANCE,
          testUserId.toString()
        )
      ).rejects.toThrow();
    });

    it('should throw error if unit ID is missing', async () => {
      await expect(
        propertyUnitDAO.updateUnitStatus('', PropertyUnitStatusEnum.AVAILABLE, testUserId.toString())
      ).rejects.toThrow();
    });

    it('should throw error if status is missing', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      await expect(
        propertyUnitDAO.updateUnitStatus(unit!._id.toString(), '' as any, testUserId.toString())
      ).rejects.toThrow();
    });

    it('should throw error if user ID is missing', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      await expect(
        propertyUnitDAO.updateUnitStatus(unit!._id.toString(), PropertyUnitStatusEnum.AVAILABLE, '')
      ).rejects.toThrow();
    });

    it('should throw error for non-existent unit', async () => {
      const fakeId = new Types.ObjectId().toString();
      await expect(
        propertyUnitDAO.updateUnitStatus(
          fakeId,
          PropertyUnitStatusEnum.AVAILABLE,
          testUserId.toString()
        )
      ).rejects.toThrow();
    });
  });

  describe('addInspection', () => {
    it('should add inspection to unit successfully', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      const inspectionData = {
        inspectionDate: new Date(),
        status: InspectionStatusEnum.PASSED,
        inspector: { name: 'John Doe', contact: '555-0100' },
        notes: 'Unit in good condition',
      };

      const result = await propertyUnitDAO.addInspection(
        unit!._id.toString(),
        inspectionData,
        testUserId.toString()
      );

      expect(result?.inspections).toHaveLength(1);
      expect(result?.inspections?.[0].status).toBe(InspectionStatusEnum.PASSED);
      expect(result?.lastInspectionDate).toBeDefined();
    });

    it('should use current date if inspection date not provided', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      const inspectionData = {
        status: InspectionStatusEnum.SCHEDULED,
        inspector: { name: 'Jane Smith', contact: '555-0200' },
      };

      const result = await propertyUnitDAO.addInspection(
        unit!._id.toString(),
        inspectionData,
        testUserId.toString()
      );

      expect(result?.inspections?.[0].inspectionDate).toBeDefined();
    });

    it('should throw error if status is missing', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      const inspectionData = {
        inspector: { name: 'Test Inspector', contact: '555-0300' },
      };

      await expect(
        propertyUnitDAO.addInspection(unit!._id.toString(), inspectionData, testUserId.toString())
      ).rejects.toThrow();
    });

    it('should use system user if inspector not provided', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      const inspectionData = {
        status: InspectionStatusEnum.NEEDS_REPAIR,
        notes: 'Minor repairs needed',
      };

      const result = await propertyUnitDAO.addInspection(
        unit!._id.toString(),
        inspectionData,
        testUserId.toString()
      );

      expect(result?.inspections?.[0].inspector.name).toBe('System User');
    });

    it('should throw error if unit ID is missing', async () => {
      await expect(
        propertyUnitDAO.addInspection('', { status: InspectionStatusEnum.PASSED }, testUserId.toString())
      ).rejects.toThrow();
    });

    it('should throw error if inspection data is missing', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      await expect(
        propertyUnitDAO.addInspection(unit!._id.toString(), null as any, testUserId.toString())
      ).rejects.toThrow();
    });

    it('should throw error if user ID is missing', async () => {
      const unit = await PropertyUnit.findOne({ unitNumber: '101' });
      await expect(
        propertyUnitDAO.addInspection(unit!._id.toString(), { status: InspectionStatusEnum.PASSED }, '')
      ).rejects.toThrow();
    });
  });

  describe('getPropertyUnitInfo', () => {
    it('should return unit count and statistics', async () => {
      const result = await propertyUnitDAO.getPropertyUnitInfo(testPropertyId.toString());

      expect(result.currentUnits).toBe(3);
      expect(result.unitStats.available).toBe(1);
      expect(result.unitStats.occupied).toBe(1);
      expect(result.unitStats.maintenance).toBe(1);
      expect(result.unitStats.reserved).toBe(0);
    });

    it('should include soft-deleted units in total count', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { deletedAt: new Date() });

      const result = await propertyUnitDAO.getPropertyUnitInfo(testPropertyId.toString());

      expect(result.currentUnits).toBe(3);
      expect(result.unitStats.available).toBe(0); // Should not count in stats
    });

    it('should return zero counts for property with no units', async () => {
      const emptyPropertyId = new Types.ObjectId().toString();
      const result = await propertyUnitDAO.getPropertyUnitInfo(emptyPropertyId);

      expect(result.currentUnits).toBe(0);
      expect(result.unitStats.available).toBe(0);
      expect(result.unitStats.occupied).toBe(0);
    });

    it('should throw error if property ID is missing', async () => {
      await expect(propertyUnitDAO.getPropertyUnitInfo('')).rejects.toThrow();
    });

    it('should handle units with inactive status', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { status: PropertyUnitStatusEnum.INACTIVE });

      const result = await propertyUnitDAO.getPropertyUnitInfo(testPropertyId.toString());

      expect(result.unitStats.inactive).toBe(1);
      expect(result.unitStats.available).toBe(0);
    });

    it('should handle units with reserved status', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { status: PropertyUnitStatusEnum.RESERVED });

      const result = await propertyUnitDAO.getPropertyUnitInfo(testPropertyId.toString());

      expect(result.unitStats.reserved).toBe(1);
      expect(result.unitStats.available).toBe(0);
    });
  });

  describe('getExistingUnitNumbers', () => {
    it('should return all existing unit numbers for property', async () => {
      const result = await propertyUnitDAO.getExistingUnitNumbers(testPropertyId.toString());

      expect(result).toHaveLength(3);
      expect(result).toContain('101');
      expect(result).toContain('102');
      expect(result).toContain('201');
    });

    it('should exclude soft-deleted units', async () => {
      await PropertyUnit.updateOne({ unitNumber: '101' }, { deletedAt: new Date() });

      const result = await propertyUnitDAO.getExistingUnitNumbers(testPropertyId.toString());

      expect(result).toHaveLength(2);
      expect(result).not.toContain('101');
    });

    it('should return empty array for property with no units', async () => {
      const emptyPropertyId = new Types.ObjectId().toString();
      const result = await propertyUnitDAO.getExistingUnitNumbers(emptyPropertyId);

      expect(result).toHaveLength(0);
    });

    it('should throw error if property ID is missing', async () => {
      await expect(propertyUnitDAO.getExistingUnitNumbers('')).rejects.toThrow();
    });
  });

  describe('getNextAvailableUnitNumber', () => {
    it('should generate sequential number by default', async () => {
      const result = await propertyUnitDAO.getNextAvailableUnitNumber(
        testPropertyId.toString(),
        'sequential'
      );

      expect(result).toBe('103');
    });

    it('should generate floor-based number', async () => {
      await PropertyUnit.deleteMany({});
      const newPropertyId = new Types.ObjectId();

      const result = await propertyUnitDAO.getNextAvailableUnitNumber(
        newPropertyId.toString(),
        'floorBased'
      );

      expect(result).toBe('101');
    });

    it('should generate custom pattern number', async () => {
      await PropertyUnit.deleteMany({});
      const newPropertyId = new Types.ObjectId();

      const result = await propertyUnitDAO.getNextAvailableUnitNumber(
        newPropertyId.toString(),
        'custom'
      );

      expect(result).toBe('A-1001');
    });

    it('should skip existing unit numbers', async () => {
      await PropertyUnit.create({
        propertyId: testPropertyId,
        cuid: testCuid,
        unitNumber: '103',
        floor: 1,
        unitType: PropertyUnitTypeEnum.RESIDENTIAL,
        status: PropertyUnitStatusEnum.AVAILABLE,
        fees: { rentAmount: 1100, currency: 'USD' },
        specifications: { totalArea: 550, bathrooms: 1 },
        utilities: { water: true, heating: true, gas: false, trash: false, centralAC: false },
        amenities: {
          parking: false,
          cableTV: false,
          storage: false,
          internet: false,
          dishwasher: false,
          washerDryer: false,
        },
        isActive: true,
        createdBy: testUserId,
        managedBy: testUserId,
      });

      const result = await propertyUnitDAO.getNextAvailableUnitNumber(
        testPropertyId.toString(),
        'sequential'
      );

      expect(result).toBe('104');
    });

    it('should throw error if property ID is missing', async () => {
      await expect(propertyUnitDAO.getNextAvailableUnitNumber('', 'sequential')).rejects.toThrow();
    });
  });

  describe('getSuggestedStartingUnitNumber', () => {
    it('should suggest 101 for condominium', () => {
      const result = propertyUnitDAO.getSuggestedStartingUnitNumber('condominium');
      expect(result).toBe('101');
    });

    it('should suggest 101 for apartment', () => {
      const result = propertyUnitDAO.getSuggestedStartingUnitNumber('apartment');
      expect(result).toBe('101');
    });

    it('should suggest A-1001 for commercial', () => {
      const result = propertyUnitDAO.getSuggestedStartingUnitNumber('commercial');
      expect(result).toBe('A-1001');
    });

    it('should suggest A-1001 for industrial', () => {
      const result = propertyUnitDAO.getSuggestedStartingUnitNumber('industrial');
      expect(result).toBe('A-1001');
    });

    it('should suggest 1 for townhouse', () => {
      const result = propertyUnitDAO.getSuggestedStartingUnitNumber('townhouse');
      expect(result).toBe('1');
    });

    it('should suggest 1 for house', () => {
      const result = propertyUnitDAO.getSuggestedStartingUnitNumber('house');
      expect(result).toBe('1');
    });

    it('should suggest 101 for unknown property type', () => {
      const result = propertyUnitDAO.getSuggestedStartingUnitNumber('unknown');
      expect(result).toBe('101');
    });
  });
});
