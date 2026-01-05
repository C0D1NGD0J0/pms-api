import { Types } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { PropertyUnit, Property, Client } from '@models/index';
import { PropertyUnitService } from '@services/property/propertyUnit.service';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import { mockQueueFactory, mockEventEmitter } from '@tests/setup/externalMocks';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO } from '@dao/index';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import {
  createTestPropertyUnit,
  createTestAdminUser,
  createTestProperty,
  setupTestDatabase,
  clearTestDatabase,
  createTestClient,
} from '@tests/helpers';

// Mock PropertyCache
const mockPropertyCache = {
  invalidateProperty: jest.fn().mockResolvedValue(undefined),
  invalidatePropertyLists: jest.fn().mockResolvedValue(undefined),
  getProperty: jest.fn().mockResolvedValue(null),
  setProperty: jest.fn().mockResolvedValue(undefined),
};

describe('PropertyUnitService Integration Tests', () => {
  let propertyUnitService: PropertyUnitService;
  let propertyUnitDAO: PropertyUnitDAO;
  let propertyDAO: PropertyDAO;
  let profileDAO: ProfileDAO;
  let clientDAO: ClientDAO;
  let unitNumberingService: UnitNumberingService;

  const createMockContext = (cuid: string, pid: string, unitId?: string, currentuser?: any) => ({
    request: {
      params: { cuid, pid, unitId },
      url: `/clients/${cuid}/properties/${pid}/units${unitId ? `/${unitId}` : ''}`,
      method: 'GET',
      path: `/clients/${cuid}/properties/${pid}/units${unitId ? `/${unitId}` : ''}`,
      query: {},
    },
    userAgent: {
      browser: 'Chrome',
      version: '120.0',
      os: 'MacOS',
      raw: 'test',
      isMobile: false,
      isBot: false,
    },
    langSetting: { lang: 'en', t: jest.fn((key: string) => key) },
    timing: { startTime: Date.now() },
    currentuser: currentuser || { sub: new Types.ObjectId().toString() },
    service: { env: 'test' },
    source: 'WEB' as any,
    requestId: 'req-123',
    timestamp: new Date(),
  });

  beforeAll(async () => {
    await setupTestDatabase();

    // Initialize REAL DAOs (not mocks)
    propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
    profileDAO = new ProfileDAO({ profileModel: null as any });
    clientDAO = new ClientDAO({ clientModel: Client, userModel: null as any });
    unitNumberingService = new UnitNumberingService();

    // Initialize service with real DAOs
    propertyUnitService = new PropertyUnitService({
      propertyUnitDAO,
      propertyDAO,
      profileDAO,
      clientDAO,
      queueFactory: mockQueueFactory as any,
      propertyCache: mockPropertyCache as any,
      emitterService: mockEventEmitter as any,
      unitNumberingService,
    });
  });

  // =========================================================================
  // WRITE TESTS - Create fresh data for each test (mutations)
  // =========================================================================
  describe('Write Operations', () => {
    let testClient: any;
    let testProperty: any;
    let adminUser: any;

    beforeEach(async () => {
      await clearTestDatabase();
      jest.clearAllMocks();

      // Create fresh test data for mutations
      testClient = await createTestClient();
      adminUser = await createTestAdminUser(testClient.cuid);
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        maxAllowedUnits: 10,
        status: 'active',
      });
    });

    describe('addPropertyUnit', () => {
      it('should create single unit and persist to database', async () => {
        const unitData = {
          units: [
            {
              unitNumber: '101',
              unitType: 'residential',
              floor: 1,
              specifications: {
                totalArea: 850,
                rooms: 2,
                bathrooms: 1,
              },
              fees: {
                rentAmount: 1500,
                currency: 'USD',
              },
              status: 'available' as const,
            },
          ],
          cuid: testClient.cuid,
          pid: testProperty.pid,
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.addPropertyUnit(context as any, unitData as any);

        // Assert: Verify result structure
        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(1);
        expect((result.data as any)[0].unitNumber).toBe('101');
        expect((result.data as any)[0].status).toBe('available');

        // Assert: Verify data is actually in database
        const savedUnit = await PropertyUnit.findOne({
          unitNumber: '101',
          propertyId: testProperty._id,
        });
        expect(savedUnit).not.toBeNull();
        expect(savedUnit!.unitNumber).toBe('101');
        expect(savedUnit!.specifications.bedrooms).toBe(2);
        expect(savedUnit!.fees.rentAmount).toBe(1500);
        expect(savedUnit!.propertyId.toString()).toBe(testProperty._id.toString());
      });

      it('should create multiple units (up to 5) directly', async () => {
        const unitData = {
          units: [
            {
              unitNumber: '101',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, rooms: 1, bathrooms: 1 },
              fees: { rentAmount: 1200, currency: 'USD' },
              status: 'available' as const,
            },
            {
              unitNumber: '102',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 850, rooms: 2, bathrooms: 1 },
              fees: { rentAmount: 1500, currency: 'USD' },
              status: 'available' as const,
            },
            {
              unitNumber: '103',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 950, rooms: 2, bathrooms: 2 },
              fees: { rentAmount: 1700, currency: 'USD' },
              status: 'available' as const,
            },
          ],
          cuid: testClient.cuid,
          pid: testProperty.pid,
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.addPropertyUnit(context as any, unitData as any);

        expect(result.success).toBe(true);
        expect(result.data).toHaveLength(3);

        // Verify all units in database
        const savedUnits = await PropertyUnit.find({ propertyId: testProperty._id });
        expect(savedUnits).toHaveLength(3);
        expect(savedUnits.map((u) => u.unitNumber).sort()).toEqual(['101', '102', '103']);
      });

      it('should reject duplicate unit numbers', async () => {
        // Create first unit
        await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '101',
          floor: 1,
        });

        const unitData = {
          units: [
            {
              unitNumber: '101', // Duplicate
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 850, rooms: 2, bathrooms: 1 },
              fees: { rentAmount: 1500, currency: 'USD' },
              status: 'available' as const,
            },
          ],
          cuid: testClient.cuid,
          pid: testProperty.pid,
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.addPropertyUnit(context as any, unitData as any);

        // Should return with errors
        expect(result.success).toBe(true);
        expect((result as any).errors).toBeDefined();
        expect(Object.keys((result as any).errors)).toHaveLength(1);
        expect(result.data).toHaveLength(0);
      });

      it('should enforce maxAllowedUnits limit', async () => {
        // Create property with max 2 units
        const limitedProperty = await createTestProperty(testClient.cuid, testClient._id, {
          maxAllowedUnits: 2,
          status: 'active',
        });

        // Try to add 3 units
        const unitData = {
          units: [
            {
              unitNumber: '101',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, rooms: 1, bathrooms: 1 },
              fees: { rentAmount: 1200, currency: 'USD' },
              status: 'available' as const,
            },
            {
              unitNumber: '102',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, rooms: 1, bathrooms: 1 },
              fees: { rentAmount: 1200, currency: 'USD' },
              status: 'available' as const,
            },
            {
              unitNumber: '103',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, rooms: 1, bathrooms: 1 },
              fees: { rentAmount: 1200, currency: 'USD' },
              status: 'available' as const,
            },
          ],
          cuid: testClient.cuid,
          pid: limitedProperty.pid,
        };

        const context = createMockContext(testClient.cuid, limitedProperty.pid, undefined, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        await expect(
          propertyUnitService.addPropertyUnit(context as any, unitData as any)
        ).rejects.toThrow(BadRequestError);

        // Verify no units were created
        const savedUnits = await PropertyUnit.find({ propertyId: limitedProperty._id });
        expect(savedUnits).toHaveLength(0);
      });

      it('should queue job for more than 5 units', async () => {
        const unitData = {
          units: Array.from({ length: 6 }, (_, i) => ({
            unitNumber: `${101 + i}`,
            unitType: '2BR',
            floor: 1,
            specifications: { totalArea: 850, bedrooms: 2, bathrooms: 1 },
            fees: { rentAmount: 1500, currency: 'USD' },
            status: 'available' as const,
          })),
          cuid: testClient.cuid,
          pid: testProperty.pid,
        };

        const mockPropertyUnitQueue = {
          addUnitBatchCreationJob: jest.fn().mockResolvedValue(new Types.ObjectId()),
        };
        (mockQueueFactory.getQueue as any) = jest.fn().mockReturnValue(mockPropertyUnitQueue);

        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.addPropertyUnit(context as any, unitData as any);

        expect(result.success).toBe(true);
        expect(result.data).toHaveProperty('jobId');
        expect(mockPropertyUnitQueue.addUnitBatchCreationJob).toHaveBeenCalled();
      });
    });

    describe('updatePropertyUnit', () => {
      it('should update unit and persist to database', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '201',
          floor: 2,
          monthlyRent: 1500,
        });

        const updateData = {
          fees: {
            rentAmount: 1800,
            currency: 'USD' as any,
          },
          specifications: {
            totalArea: 1200,
            bedrooms: 3,
            bathrooms: 2,
          },
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, unit._id.toString(), {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.updatePropertyUnit(
          context as any,
          updateData as any
        );

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();

        // Verify database was updated
        const updatedUnit = await PropertyUnit.findById(unit._id);
        expect(updatedUnit).not.toBeNull();
        expect(updatedUnit!.fees.rentAmount).toBe(1800);
        expect(updatedUnit!.specifications.bedrooms).toBe(3);
        expect(updatedUnit!.specifications.bathrooms).toBe(2);
      });

      it('should validate rental amount is non-negative', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '201',
          floor: 2,
        });

        const updateData = {
          fees: {
            rentAmount: -100, // Invalid negative amount
            securityDeposit: 500,
            currency: 'USD' as any,
          },
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, unit._id.toString(), {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        await expect(
          propertyUnitService.updatePropertyUnit(context as any, updateData as any)
        ).rejects.toThrow(ValidationRequestError);
      });

      it('should prevent updates to inactive property', async () => {
        const inactiveProperty = await createTestProperty(testClient.cuid, testClient._id, {
          status: 'inactive',
        });
        const unit = await createTestPropertyUnit(testClient.cuid, inactiveProperty._id);

        const updateData = {
          fees: {
            rentAmount: 2000,
            currency: 'USD' as any,
          },
        };

        const context = createMockContext(
          testClient.cuid,
          inactiveProperty.pid,
          unit._id.toString(),
          {
            sub: adminUser._id.toString(),
            client: { role: ROLES.ADMIN },
            fullname: 'Admin User',
          }
        );

        await expect(
          propertyUnitService.updatePropertyUnit(context as any, updateData as any)
        ).rejects.toThrow(BadRequestError);
      });

      it('should handle unit number change with validation', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '201',
          floor: 2,
        });

        const updateData = {
          unitNumber: '202',
          floor: 2,
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, unit._id.toString(), {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.updatePropertyUnit(context as any, updateData);

        expect(result.success).toBe(true);

        // Verify unit number was updated in database
        const updatedUnit = await PropertyUnit.findById(unit._id);
        expect(updatedUnit!.unitNumber).toBe('202');
      });

      it('should reject unit number conflict on update', async () => {
        // Create two units
        const unit1 = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '201',
          floor: 2,
        });
        await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '202',
          floor: 2,
        });

        // Try to change unit1's number to conflict with unit2
        const updateData = {
          unitNumber: '202', // Already exists
          floor: 2,
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, unit1._id.toString(), {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        await expect(
          propertyUnitService.updatePropertyUnit(context as any, updateData)
        ).rejects.toThrow(ValidationRequestError);

        // Verify unit number was NOT changed
        const unchangedUnit = await PropertyUnit.findById(unit1._id);
        expect(unchangedUnit!.unitNumber).toBe('201');
      });
    });

    describe('archiveUnit', () => {
      it('should archive unit and persist to database', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '301',
          status: 'available',
        });

        const context = createMockContext(testClient.cuid, testProperty.pid, unit._id.toString(), {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.archiveUnit(context as any);

        expect(result.success).toBe(true);

        // Verify unit is archived in database
        const archivedUnit = await PropertyUnit.findById(unit._id);
        expect(archivedUnit!.deletedAt).not.toBeNull();
      });

      it('should prevent archiving unit with active lease', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '301',
          status: 'occupied',
        });

        // Simulate active lease
        await PropertyUnit.findByIdAndUpdate(unit._id, {
          currentLease: new Types.ObjectId(),
        });

        const context = createMockContext(testClient.cuid, testProperty.pid, unit._id.toString(), {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        await expect(propertyUnitService.archiveUnit(context as any)).rejects.toThrow(
          ValidationRequestError
        );

        // Verify unit was NOT archived
        const unchangedUnit = await PropertyUnit.findById(unit._id);
        expect(unchangedUnit!.deletedAt).toBeNull();
      });
    });
  }); // End Write Operations

  // =========================================================================
  // READ TESTS - Use existing data (queries - no mutations)
  // =========================================================================
  describe('Read Operations', () => {
    let testClient: any;
    let testProperty: any;
    let adminUser: any;
    let unit1: any;
    let _unit2: any;
    let _unit3: any;

    beforeAll(async () => {
      await clearTestDatabase();

      // Create test data once for all read tests
      testClient = await createTestClient();
      adminUser = await createTestAdminUser(testClient.cuid);
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        maxAllowedUnits: 20,
        status: 'active',
      });

      // Create multiple units
      unit1 = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
        unitNumber: '101',
        floor: 1,
        status: 'available',
        bedrooms: 1,
        bathrooms: 1,
        monthlyRent: 1200,
      });

      _unit2 = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
        unitNumber: '102',
        floor: 1,
        status: 'occupied',
        bedrooms: 2,
        bathrooms: 1,
        monthlyRent: 1500,
      });

      _unit3 = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
        unitNumber: '201',
        floor: 2,
        status: 'available',
        bedrooms: 2,
        bathrooms: 2,
        monthlyRent: 1800,
      });
    });

    afterAll(async () => {
      await clearTestDatabase();
    });

    describe('getPropertyUnit', () => {
      it('should retrieve single unit by ID', async () => {
        const context = createMockContext(testClient.cuid, testProperty.pid, unit1._id.toString(), {
          sub: adminUser._id.toString(),
        });

        const result = await propertyUnitService.getPropertyUnit(context as any);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.puid).toBe(unit1.puid);
        expect(result.data.unitNumber).toBe('101');
        expect(result.data.specifications.bedrooms).toBe(1);
      });

      it('should return error for non-existent unit', async () => {
        const fakeUnitId = new Types.ObjectId().toString();
        const context = createMockContext(testClient.cuid, testProperty.pid, fakeUnitId, {
          sub: adminUser._id.toString(),
        });

        await expect(propertyUnitService.getPropertyUnit(context as any)).rejects.toThrow(
          BadRequestError
        );
      });

      it('should return error when property not found', async () => {
        const context = createMockContext(testClient.cuid, 'fake-pid', unit1._id.toString(), {
          sub: adminUser._id.toString(),
        });

        await expect(propertyUnitService.getPropertyUnit(context as any)).rejects.toThrow(
          BadRequestError
        );
      });
    });

    describe('getPropertyUnits', () => {
      it('should return all units for a property', async () => {
        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
        });

        const pagination = {
          page: 1,
          limit: 10,
          sortBy: 'unitNumber',
          sort: 'asc' as const,
        };

        const result = await propertyUnitService.getPropertyUnits(context as any, pagination);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.items).toHaveLength(3);
        expect(result.data.pagination!.total).toBe(3);
      });

      it('should paginate results correctly', async () => {
        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
        });

        const pagination = {
          page: 1,
          limit: 2,
          sortBy: 'unitNumber',
          sort: 'asc' as const,
        };

        const result = await propertyUnitService.getPropertyUnits(context as any, pagination);

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(2);
        expect(result.data.pagination!.currentPage).toBe(1);
        expect(result.data.pagination!.perPage).toBe(2);
        expect(result.data.pagination!.total).toBe(3);
      });

      it('should sort units by floor and unit number', async () => {
        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
        });

        const pagination = {
          page: 1,
          limit: 10,
          sortBy: 'floor',
          sort: 'asc' as const,
        };

        const result = await propertyUnitService.getPropertyUnits(context as any, pagination);

        expect(result.success).toBe(true);
        const unitNumbers = result.data.items.map((u: any) => u.unitNumber);
        // Should be sorted by floor first, then unit number
        expect(unitNumbers).toEqual(['101', '102', '201']);
      });
    });
  }); // End Read Operations
});
