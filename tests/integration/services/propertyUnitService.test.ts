import { Types } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { PropertyUnit, Property, Client, User } from '@models/index';
import { PropertyUnitService } from '@services/property/propertyUnit.service';
import { mockQueueFactory, mockEventEmitter } from '@tests/setup/externalMocks';
import { UnitNumberingService } from '@services/unitNumbering/unitNumbering.service';
import { PropertyApprovalService } from '@services/property/propertyApproval.service';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
import { ValidationRequestError, BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  createTestPropertyUnit,
  createTestManagerUser,
  createTestTenantUser,
  createTestAdminUser,
  createTestProperty,
  clearTestDatabase,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

// Mock PropertyCache
const mockPropertyCache = {
  invalidateProperty: jest.fn().mockResolvedValue(undefined),
  invalidatePropertyLists: jest.fn().mockResolvedValue(undefined),
  getProperty: jest.fn().mockResolvedValue(null),
  setProperty: jest.fn().mockResolvedValue(undefined),
};

const mockNotificationService = {
  notifyApprovalNeeded: jest.fn().mockResolvedValue(undefined),
  notifyApprovalDecision: jest.fn().mockResolvedValue(undefined),
  notifyPendingChangesOverridden: jest.fn().mockResolvedValue(undefined),
};

describe('PropertyUnitService Integration Tests', () => {
  let propertyUnitService: PropertyUnitService;
  let propertyUnitDAO: PropertyUnitDAO;
  let propertyDAO: PropertyDAO;
  let profileDAO: ProfileDAO;
  let clientDAO: ClientDAO;
  let unitNumberingService: UnitNumberingService;

  const createMockContext = (cuid: string, pid: string, puid?: string, currentuser?: any) => ({
    request: {
      params: { cuid, pid, puid },
      url: `/clients/${cuid}/properties/${pid}/units${puid ? `/${puid}` : ''}`,
      method: 'GET',
      path: `/clients/${cuid}/properties/${pid}/units${puid ? `/${puid}` : ''}`,
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
      userDAO: new UserDAO({ userModel: User }),
      queueFactory: mockQueueFactory as any,
      propertyCache: mockPropertyCache as any,
      emitterService: mockEventEmitter as any,
      notificationService: mockNotificationService as any,
      unitNumberingService,
      subscriptionDAO: {
        findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
      } as any,
      leaseDAO: {
        list: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
        findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
        hasNonDraftLeaseForUnit: jest.fn().mockReturnValue(Promise.resolve(false)),
      } as any,
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
        operationalStatus: 'available',
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
                bedrooms: 2,
                bathrooms: 1,
              },
              fees: {
                rentAmount: 1500,
                currency: 'USD',
              },
              status: 'available' as const,
              managedBy: adminUser.uid,
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
        // Typed in dollars, stored in cents
        expect(savedUnit!.fees.rentAmount).toBe(150000);
        expect(savedUnit!.propertyId.toString()).toBe(testProperty._id.toString());
      });

      it("prices the unit in the property's currency, not the one sent", async () => {
        await Property.updateOne({ _id: testProperty._id }, { 'fees.currency': 'CAD' });
        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        await propertyUnitService.addPropertyUnit(
          context as any,
          {
            units: [
              {
                unitNumber: '101',
                unitType: 'residential',
                floor: 1,
                specifications: { totalArea: 850 },
                fees: { rentAmount: 1500, currency: 'USD' },
                status: 'available',
                managedBy: adminUser.uid,
              },
            ],
            cuid: testClient.cuid,
            pid: testProperty.pid,
          } as any
        );

        const savedUnit = await PropertyUnit.findOne({ propertyId: testProperty._id }).lean();
        expect(savedUnit?.fees.currency).toBe('CAD');
      });

      it('should create multiple units (up to 5) directly', async () => {
        const unitData = {
          units: [
            {
              unitNumber: '101',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, bedrooms: 1, bathrooms: 1 },
              fees: { rentAmount: 1200, currency: 'USD' },
              status: 'available' as const,
              managedBy: adminUser.uid,
            },
            {
              unitNumber: '102',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 850, bedrooms: 2, bathrooms: 1 },
              fees: { rentAmount: 1500, currency: 'USD' },
              status: 'available' as const,
              managedBy: adminUser.uid,
            },
            {
              unitNumber: '103',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 950, bedrooms: 2, bathrooms: 2 },
              fees: { rentAmount: 1700, currency: 'USD' },
              status: 'available' as const,
              managedBy: adminUser.uid,
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
              specifications: { totalArea: 850, bedrooms: 2, bathrooms: 1 },
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

        // Every unit failed, so the request must fail rather than report success
        await expect(
          propertyUnitService.addPropertyUnit(context as any, unitData as any)
        ).rejects.toMatchObject({
          statusCode: 422,
          errorInfo: { 'units.0.unitNumber': [expect.stringContaining('101')] },
        });
        expect(await PropertyUnit.countDocuments({ propertyId: testProperty._id })).toBe(1);
      });

      it('should default managedBy to the property manager when omitted', async () => {
        const unitData = {
          units: [
            {
              unitNumber: '101',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 850, bedrooms: 2, bathrooms: 1 },
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

        expect(result.success).toBe(true);
        const savedUnit = await PropertyUnit.findOne({ propertyId: testProperty._id });
        expect(savedUnit!.managedBy.toString()).toBe(testProperty.managedBy.toString());
      });

      it('should reject a managedBy user who is not an employee of this client', async () => {
        const tenantUser = await createTestTenantUser(testClient.cuid);
        const otherClient = await createTestClient();
        const foreignAdmin = await createTestAdminUser(otherClient.cuid);
        const context = createMockContext(testClient.cuid, testProperty.pid, undefined, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        for (const managerId of [tenantUser._id, foreignAdmin._id]) {
          const unitData = {
            units: [
              {
                unitNumber: '101',
                unitType: 'residential',
                floor: 1,
                specifications: { totalArea: 850, bedrooms: 2, bathrooms: 1 },
                fees: { rentAmount: 1500, currency: 'USD' },
                status: 'available' as const,
                managedBy: managerId.toString(),
              },
            ],
            cuid: testClient.cuid,
            pid: testProperty.pid,
          };
          await expect(
            propertyUnitService.addPropertyUnit(context as any, unitData as any)
          ).rejects.toThrow(BadRequestError);
        }
        expect(await PropertyUnit.countDocuments({ propertyId: testProperty._id })).toBe(0);
      });

      it('should enforce maxAllowedUnits limit', async () => {
        // Create property with max 2 units
        const limitedProperty = await createTestProperty(testClient.cuid, testClient._id, {
          maxAllowedUnits: 2,
          operationalStatus: 'available',
        });

        // Try to add 3 units
        const unitData = {
          units: [
            {
              unitNumber: '101',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, bedrooms: 1, bathrooms: 1 },
              fees: { rentAmount: 1200, currency: 'USD' },
              status: 'available' as const,
            },
            {
              unitNumber: '102',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, bedrooms: 1, bathrooms: 1 },
              fees: { rentAmount: 1200, currency: 'USD' },
              status: 'available' as const,
            },
            {
              unitNumber: '103',
              unitType: 'residential',
              floor: 1,
              specifications: { totalArea: 650, bedrooms: 1, bathrooms: 1 },
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
          rentAmount: 1500,
        });

        const updateData = {
          fees: {
            rentAmount: 1800,
            currency: 'USD' as any,
          },
        };

        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
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
        expect(updatedUnit!.fees.rentAmount).toBe(180000);
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

        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
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
          operationalStatus: 'inactive',
        });
        const unit = await createTestPropertyUnit(testClient.cuid, inactiveProperty._id);

        const updateData = {
          fees: {
            rentAmount: 2000,
            currency: 'USD' as any,
          },
        };

        const context = createMockContext(testClient.cuid, inactiveProperty.pid, unit.puid, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

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

        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
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

      it('should accept an unchanged unit number resent by the edit form', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '201',
          floor: 2,
        });
        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        const result = await propertyUnitService.updatePropertyUnit(context as any, {
          unitNumber: '201',
          floor: 2,
          description: 'Corner unit',
        });

        expect(result.success).toBe(true);
        const updatedUnit = await PropertyUnit.findById(unit._id);
        expect(updatedUnit!.description).toBe('Corner unit');
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

        const context = createMockContext(testClient.cuid, testProperty.pid, unit1.puid, {
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

    describe('updatePropertyUnit - previously dropped fields', () => {
      const asUser = (puid: string, user: any, role: string) =>
        createMockContext(testClient.cuid, testProperty.pid, puid, {
          sub: user._id.toString(),
          client: { role },
          fullname: 'Test User',
        });

      it('saves unitType, isActive, maxOccupants, currency and managedBy', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '201',
          floor: 2,
        });
        const managerUser = await createTestManagerUser(testClient.cuid);

        await propertyUnitService.updatePropertyUnit(asUser(unit.puid, adminUser, ROLES.ADMIN), {
          unitType: 'commercial',
          isActive: false,
          specifications: { maxOccupants: 4 } as any,
          fees: { currency: 'USD' } as any,
          managedBy: managerUser.uid as any,
        });

        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.unitType).toBe('commercial');
        expect(saved!.isActive).toBe(false);
        expect(saved!.specifications.maxOccupants).toBe(4);
        expect(saved!.fees.currency).toBe('USD');
        expect(saved!.managedBy.toString()).toBe(managerUser._id.toString());
        // dot-notation update: sibling fields are untouched
        expect(saved!.specifications.totalArea).toBe(unit.specifications.totalArea);
        expect(saved!.fees.rentAmount).toBe(unit.fees.rentAmount);
      });

      it('lets a manager (non-admin approver) apply the same edit', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        const managerUser = await createTestManagerUser(testClient.cuid);

        await propertyUnitService.updatePropertyUnit(
          asUser(unit.puid, managerUser, ROLES.MANAGER),
          { unitType: 'storage', isActive: false }
        );

        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.unitType).toBe('storage');
        expect(saved!.isActive).toBe(false);
      });

      it('rejects a managedBy outside this client whatever the caller role', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        const tenantUser = await createTestTenantUser(testClient.cuid);
        const foreignAdmin = await createTestAdminUser((await createTestClient()).cuid);
        const managerUser = await createTestManagerUser(testClient.cuid);
        const staffUser = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });
        const callers = [
          [adminUser, ROLES.ADMIN],
          [managerUser, ROLES.MANAGER],
          [staffUser, ROLES.STAFF],
        ] as const;

        for (const [caller, role] of callers) {
          for (const outsider of [tenantUser, foreignAdmin, { uid: 'NOSUCHUSER01' }]) {
            await expect(
              propertyUnitService.updatePropertyUnit(asUser(unit.puid, caller, role), {
                managedBy: outsider.uid as any,
              })
            ).rejects.toThrow(BadRequestError);
          }
        }

        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.managedBy.toString()).toBe(unit.managedBy.toString());
        expect(saved!.pendingChanges).toBeFalsy();
      });

      it('rejects a currency that differs from the property currency', async () => {
        await Property.updateOne({ _id: testProperty._id }, { 'fees.currency': 'CAD' });
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);

        await expect(
          propertyUnitService.updatePropertyUnit(asUser(unit.puid, adminUser, ROLES.ADMIN), {
            fees: { currency: 'EUR' } as any,
          })
        ).rejects.toMatchObject({
          errorInfo: { 'fees.currency': [expect.stringContaining('CAD')] },
        });

        // aligning a legacy unit with the property currency is allowed
        await propertyUnitService.updatePropertyUnit(asUser(unit.puid, adminUser, ROLES.ADMIN), {
          fees: { currency: 'CAD' } as any,
        });
        expect((await PropertyUnit.findById(unit._id))!.fees.currency).toBe('CAD');
      });

      it('accepts the stored currency resent unchanged even if it differs from the property', async () => {
        await Property.updateOne({ _id: testProperty._id }, { 'fees.currency': 'CAD' });
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id); // USD

        const result = await propertyUnitService.updatePropertyUnit(
          asUser(unit.puid, adminUser, ROLES.ADMIN),
          { fees: { currency: 'USD', rentAmount: 2100 } as any }
        );

        expect(result.success).toBe(true);
        expect((await PropertyUnit.findById(unit._id))!.fees.rentAmount).toBe(210000);
      });

      it('does not apply the new high-impact fields directly for staff', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        const staffUser = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });

        await propertyUnitService.updatePropertyUnit(asUser(unit.puid, staffUser, ROLES.STAFF), {
          unitType: 'commercial',
        });

        const saved = await PropertyUnit.findById(unit._id);
        // staff high-impact edits go through the approval path, not straight to the unit
        expect(saved!.unitType).toBe('residential');
      });
    });

    describe('staff high-impact edits — approval workflow', () => {
      let staffUser: any;
      let otherStaffUser: any;
      let managerUser: any;

      const asUser = (puid: string, user: any, role: string, fullname: string) =>
        createMockContext(testClient.cuid, testProperty.pid, puid, {
          sub: user._id.toString(),
          client: { cuid: testClient.cuid, role },
          fullname,
          displayName: fullname,
        }) as any;
      const asStaff = (puid: string) => asUser(puid, staffUser, ROLES.STAFF, 'Sam Staff');
      const asManager = (puid: string) => asUser(puid, managerUser, ROLES.MANAGER, 'Mia Manager');

      beforeEach(async () => {
        staffUser = await createTestUser(testClient.cuid, {
          roles: [ROLES.STAFF],
          email: 'staff-one@test.com',
        });
        otherStaffUser = await createTestUser(testClient.cuid, {
          roles: [ROLES.STAFF],
          email: 'staff-two@test.com',
        });
        managerUser = await createTestUser(testClient.cuid, {
          roles: [ROLES.MANAGER],
          email: 'manager@test.com',
        });
      });

      const submitStaffEdit = async (unit: any) =>
        propertyUnitService.updatePropertyUnit(asStaff(unit.puid), {
          unitType: 'commercial',
          fees: { rentAmount: 1850, currency: 'USD' } as any,
          description: 'Freshly painted',
        });

      it('stores a staff high-impact edit as pending without applying it', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          rentAmount: 1500,
        });

        const result = await submitStaffEdit(unit);

        expect(result.message).toBe('Unit changes submitted for approval');
        const saved = await PropertyUnit.findById(unit._id).lean();
        expect(saved!.unitType).toBe('residential');
        expect(saved!.approvalStatus).toBe('pending');
        expect(saved!.pendingChanges).toMatchObject({
          unitType: 'commercial',
          fees: { rentAmount: 185000 },
          displayName: 'Sam Staff',
        });
        expect(saved!.pendingChanges!.updatedBy.toString()).toBe(staffUser._id.toString());
        // the unchanged currency resent by the form is not held for approval
        expect(saved!.pendingChanges!.fees).not.toHaveProperty('currency');
        // operational fields still apply straight away
        expect(saved!.description).toBe('Freshly painted');
        expect(mockNotificationService.notifyApprovalNeeded).toHaveBeenCalledWith(
          expect.objectContaining({ resourceUid: testProperty.pid }),
          staffUser._id.toString(),
          'Sam Staff',
          testClient.cuid,
          expect.anything(),
          expect.objectContaining({ puid: unit.puid })
        );
      });

      it('does not create pending changes when staff resend unchanged values', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '305',
          floor: 3,
        });

        await propertyUnitService.updatePropertyUnit(asStaff(unit.puid), {
          unitNumber: '305',
          floor: 3,
          unitType: 'residential',
          fees: { currency: 'USD' } as any,
        });

        const saved = await PropertyUnit.findById(unit._id).lean();
        expect(saved!.pendingChanges).toBeNull();
        expect(saved!.approvalStatus).toBe('approved');
        expect(mockNotificationService.notifyApprovalNeeded).not.toHaveBeenCalled();
      });

      it('returns the pending changes to approvers and the submitter, not other staff', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        await submitStaffEdit(unit);

        const forManager = await propertyUnitService.getPropertyUnit(asManager(unit.puid));
        expect(forManager.data).toMatchObject({
          approvalStatus: 'pending',
          pendingChanges: expect.objectContaining({ unitType: 'commercial' }),
          pendingChangesPreview: {
            changes: { unitType: 'commercial', 'fees.rentAmount': '1850.00' },
            displayName: 'Sam Staff',
          },
        });

        const forSubmitter = await propertyUnitService.getPropertyUnit(asStaff(unit.puid));
        expect((forSubmitter.data as any).pendingChangesPreview).toBeDefined();

        const forOtherStaff = await propertyUnitService.getPropertyUnit(
          asUser(unit.puid, otherStaffUser, ROLES.STAFF, 'Olive Other')
        );
        expect((forOtherStaff.data as any).pendingChangesPreview).toBeUndefined();

        const list = await propertyUnitService.getPropertyUnits(
          createMockContext(testClient.cuid, testProperty.pid, undefined, {
            sub: managerUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.MANAGER },
          }) as any,
          { page: 1, limit: 10 } as any
        );
        const listed = (list.data.items as any[]).find((item) => item.puid === unit.puid);
        expect(listed.approvalStatus).toBe('pending');
        expect(listed.pendingChangesPreview.updatedFields).toEqual(
          expect.arrayContaining(['unitType', 'fees.rentAmount'])
        );
      });

      it('lists units with pending changes alongside pending properties', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        await submitStaffEdit(unit);
        const propertyApprovalService = new PropertyApprovalService({
          propertyDAO,
          propertyUnitDAO,
          propertyCache: mockPropertyCache as any,
          notificationService: mockNotificationService as any,
          mediaUploadService: {} as any,
        });

        const result = await propertyApprovalService.getPendingApprovals(
          testClient.cuid,
          { sub: managerUser._id.toString(), client: { role: ROLES.MANAGER } } as any,
          { page: 1, limit: 10 }
        );

        expect(result.data.pendingUnits.map((u: any) => u.puid)).toEqual([unit.puid]);
        expect((result.data.pendingUnits[0] as any).propertyId.pid).toBe(testProperty.pid);
      });

      it('applies the pending changes when an approver approves them', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          rentAmount: 1500,
        });
        await submitStaffEdit(unit);

        const result = await propertyUnitService.approveUnitChanges(
          asManager(unit.puid),
          'Matches the new lease rates'
        );

        expect(result.success).toBe(true);
        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.unitType).toBe('commercial');
        expect(saved!.fees.rentAmount).toBe(185000);
        expect(saved!.pendingChanges).toBeNull();
        expect(saved!.approvalStatus).toBe('approved');
        const approval = saved!.approvalDetails!.at(-1)!;
        expect(approval).toMatchObject({
          action: 'approved',
          notes: 'Matches the new lease rates',
        });
        expect(approval.actor.toString()).toBe(managerUser._id.toString());
        expect(mockNotificationService.notifyApprovalDecision).toHaveBeenCalledWith(
          expect.objectContaining({ resourceUid: testProperty.pid }),
          managerUser._id.toString(),
          testClient.cuid,
          'approved',
          staffUser._id.toString(),
          'Matches the new lease rates',
          expect.objectContaining({ puid: unit.puid })
        );
      });

      it('re-validates pending changes on approval and keeps them if they no longer pass', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '101',
          floor: 1,
        });
        await propertyUnitService.updatePropertyUnit(asStaff(unit.puid), { unitNumber: '102' });
        // another unit takes the number while the change waits for approval
        await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '102',
          floor: 1,
        });

        await expect(propertyUnitService.approveUnitChanges(asManager(unit.puid))).rejects.toThrow(
          ValidationRequestError
        );

        const saved = await PropertyUnit.findById(unit._id).lean();
        expect(saved!.unitNumber).toBe('101');
        expect(saved!.pendingChanges).toMatchObject({ unitNumber: '102' });
      });

      it('re-applies the lease lock on approval', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        await submitStaffEdit(unit);
        // a lease was signed for the unit while the unitType change waited for approval
        (propertyUnitService as any).leaseDAO.hasNonDraftLeaseForUnit.mockReturnValueOnce(
          Promise.resolve(true)
        );

        await expect(propertyUnitService.approveUnitChanges(asManager(unit.puid))).rejects.toThrow(
          /structural fields/
        );
        expect((await PropertyUnit.findById(unit._id))!.unitType).toBe('residential');
      });

      it('re-checks the unit manager is still an employee on approval', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        await propertyUnitService.updatePropertyUnit(asStaff(unit.puid), {
          managedBy: otherStaffUser.uid as any,
        });
        await User.updateOne(
          { _id: otherStaffUser._id, 'cuids.cuid': testClient.cuid },
          { $set: { 'cuids.$.isConnected': false } }
        );

        await expect(propertyUnitService.approveUnitChanges(asManager(unit.puid))).rejects.toThrow(
          BadRequestError
        );
        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.managedBy.toString()).toBe(unit.managedBy.toString());
      });

      it('clears the pending changes and records the reason when rejected', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          rentAmount: 1500,
        });
        await submitStaffEdit(unit);

        await propertyUnitService.rejectUnitChanges(asManager(unit.puid), 'Rent is above market');

        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.unitType).toBe('residential');
        expect(saved!.fees.rentAmount).toBe(1500);
        expect(saved!.pendingChanges).toBeNull();
        expect(saved!.approvalStatus).toBe('approved');
        expect(saved!.approvalDetails!.at(-1)).toMatchObject({
          action: 'rejected',
          rejectionReason: 'Rent is above market',
        });
        expect(mockNotificationService.notifyApprovalDecision).toHaveBeenCalledWith(
          expect.anything(),
          managerUser._id.toString(),
          testClient.cuid,
          'rejected',
          staffUser._id.toString(),
          'Rent is above market',
          expect.anything()
        );
      });

      it('blocks another staff member from overwriting pending changes', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        await submitStaffEdit(unit);

        await expect(
          propertyUnitService.updatePropertyUnit(
            asUser(unit.puid, otherStaffUser, ROLES.STAFF, 'Olive Other'),
            { unitType: 'storage' }
          )
        ).rejects.toThrow(/locked for editing/);

        // the submitter may revise their own pending changes
        await propertyUnitService.updatePropertyUnit(asStaff(unit.puid), { unitType: 'storage' });
        const saved = await PropertyUnit.findById(unit._id).lean();
        expect(saved!.pendingChanges).toMatchObject({ unitType: 'storage' });
        expect(saved!.pendingChanges!.updatedBy.toString()).toBe(staffUser._id.toString());
      });

      it("lets a manager's direct edit override pending changes", async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        await submitStaffEdit(unit);

        const result = await propertyUnitService.updatePropertyUnit(asManager(unit.puid), {
          unitType: 'storage',
        });

        expect(result.message).toContain('overriding pending changes from Sam Staff');
        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.unitType).toBe('storage');
        expect(saved!.pendingChanges).toBeNull();
        expect(saved!.approvalStatus).toBe('approved');
        expect(saved!.approvalDetails!.at(-1)!.action).toBe('overridden');
        expect(mockNotificationService.notifyPendingChangesOverridden).toHaveBeenCalledWith(
          testProperty.pid,
          expect.stringContaining(`Unit ${unit.unitNumber}`),
          managerUser._id.toString(),
          'Mia Manager',
          staffUser._id.toString(),
          testClient.cuid,
          expect.anything()
        );
      });

      it('refuses to review a unit without pending changes', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);

        await expect(propertyUnitService.approveUnitChanges(asManager(unit.puid))).rejects.toThrow(
          BadRequestError
        );
      });
    });

    describe('setupInspection', () => {
      const inspection = (date: string, status: string) => ({
        inspectionDate: new Date(date),
        inspector: { name: 'Jane Inspector', contact: '416-555-0100' },
        status,
      });

      it('appends inspections, keeping history and the latest inspection date', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id);
        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });

        await propertyUnitService.setupInspection(
          context as any,
          inspection('2026-06-01', 'passed')
        );
        await propertyUnitService.setupInspection(
          context as any,
          inspection('2026-09-01', 'needs_repair')
        );
        // back-filled older record must not move lastInspectionDate backwards
        await propertyUnitService.setupInspection(
          context as any,
          inspection('2026-01-15', 'failed')
        );

        const saved = await PropertyUnit.findById(unit._id);
        expect(saved!.inspections!.map((i: any) => i.status)).toEqual([
          'passed',
          'needs_repair',
          'failed',
        ]);
        expect(saved!.lastInspectionDate!.toISOString()).toBe(new Date('2026-09-01').toISOString());
      });

      it('rejects a unit from another property', async () => {
        const otherProperty = await createTestProperty(testClient.cuid, testClient._id);
        const unit = await createTestPropertyUnit(testClient.cuid, otherProperty._id);
        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
        });

        await expect(
          propertyUnitService.setupInspection(context as any, inspection('2026-06-01', 'passed'))
        ).rejects.toThrow(NotFoundError);
      });
    });

    describe('basement and ground floors', () => {
      const adminContext = (puid?: string) =>
        createMockContext(testClient.cuid, testProperty.pid, puid, {
          sub: adminUser._id.toString(),
          client: { role: ROLES.ADMIN },
          fullname: 'Admin User',
        });
      const unitInput = (unitNumber: string, floor: number) => ({
        unitNumber,
        unitType: 'residential',
        floor,
        specifications: { totalArea: 500, bedrooms: 1, bathrooms: 1 },
        fees: { rentAmount: 900, currency: 'USD' },
        status: 'available' as const,
      });

      it('creates units on basement and ground floors', async () => {
        const result = await propertyUnitService.addPropertyUnit(
          adminContext() as any,
          {
            units: [unitInput('B1-01', -1), unitInput('G-01', 0), unitInput('101', 1)],
            cuid: testClient.cuid,
            pid: testProperty.pid,
          } as any
        );

        expect(result.data).toHaveLength(3);
        const saved = await PropertyUnit.find({ propertyId: testProperty._id }).sort({
          floor: 1,
        });
        expect(saved.map((u) => [u.unitNumber, u.floor])).toEqual([
          ['B1-01', -1],
          ['G-01', 0],
          ['101', 1],
        ]);
      });

      it('moves a unit to the ground floor (0 is not treated as missing)', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '7',
          floor: 2,
        });

        await propertyUnitService.updatePropertyUnit(adminContext(unit.puid) as any, { floor: 0 });

        expect((await PropertyUnit.findById(unit._id))!.floor).toBe(0);
      });

      it('suggests a basement label when a floor-encoded number is moved below grade', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: 'A-101',
          floor: 1,
        });

        await expect(
          propertyUnitService.updatePropertyUnit(adminContext(unit.puid) as any, { floor: -1 })
        ).rejects.toMatchObject({
          errorInfo: { unitNumber: expect.arrayContaining(['Suggested unit number: B1-01']) },
        });
      });
    });

    describe('archiveUnit', () => {
      it('should archive unit and persist to database', async () => {
        const unit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
          unitNumber: '301',
          status: 'available',
        });

        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
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
        const leaseId = new Types.ObjectId();
        await PropertyUnit.findByIdAndUpdate(unit._id, {
          currentLease: leaseId,
        });

        // Mock leaseDAO.list to return a blocking lease for this call
        const leaseDAOMock = (propertyUnitService as any).leaseDAO;
        leaseDAOMock.list.mockReturnValueOnce(
          Promise.resolve({ items: [{ _id: leaseId, status: 'active' }] })
        );

        const context = createMockContext(testClient.cuid, testProperty.pid, unit.puid, {
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
        operationalStatus: 'available',
      });

      // Create multiple units
      unit1 = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
        unitNumber: '101',
        floor: 1,
        status: 'available',
        bedrooms: 1,
        bathrooms: 1,
        rentAmount: 1200,
      });

      _unit2 = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
        unitNumber: '102',
        floor: 1,
        status: 'occupied',
        bedrooms: 2,
        bathrooms: 1,
        rentAmount: 1500,
      });

      _unit3 = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
        unitNumber: '201',
        floor: 2,
        status: 'available',
        bedrooms: 2,
        bathrooms: 2,
        rentAmount: 1800,
      });
    });

    afterAll(async () => {
      await clearTestDatabase();
    });

    describe('getPropertyUnit', () => {
      it('should retrieve single unit by puid', async () => {
        const context = createMockContext(testClient.cuid, testProperty.pid, unit1.puid, {
          sub: adminUser._id.toString(),
        });

        const result = await propertyUnitService.getPropertyUnit(context as any);

        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
        expect(result.data.puid).toBe(unit1.puid);
        expect(result.data.unitNumber).toBe('101');
        expect(result.data.specifications.bedrooms).toBe(1);
      });

      it('should return error for non-existent puid', async () => {
        const context = createMockContext(testClient.cuid, testProperty.pid, 'non-existent-puid', {
          sub: adminUser._id.toString(),
        });

        await expect(propertyUnitService.getPropertyUnit(context as any)).rejects.toThrow(
          BadRequestError
        );
      });

      it('should return error when property not found', async () => {
        const context = createMockContext(testClient.cuid, 'fake-pid', unit1.puid, {
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
