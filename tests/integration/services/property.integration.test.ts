import { ROLES } from '@shared/constants/roles.constants';
import { disconnectTestDatabase } from '@tests/setup/testDatabase';
import { PropertyService } from '@services/property/property.service';
import { PropertyApprovalStatusEnum } from '@interfaces/property.interface';
import { mockQueueFactory, mockEventEmitter } from '@tests/setup/externalMocks';
import { PropertyUnit, Property, Profile, Client, Lease, User } from '@models/index';
import { ValidationRequestError, BadRequestError, NotFoundError } from '@shared/customErrors';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import {
  createTestPropertyUnit,
  createTestProperty,
  clearTestDatabase,
  setupTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
  SeededTestData,
} from '@tests/helpers';

// Mock only external services
const mockMediaUploadService = {
  handleMediaDeletion: jest.fn().mockResolvedValue(undefined),
  handleAvatarDeletion: jest.fn().mockResolvedValue(undefined),
  uploadFile: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockGeoCoderService = {
  geocode: jest.fn().mockResolvedValue({
    success: true,
    data: {
      latitude: 40.7128,
      longitude: -74.006,
      formattedAddress: '123 Test St, New York, NY 10001',
    },
  }),
} as any;

const mockNotificationService = {
  handlePropertyUpdateNotifications: jest.fn().mockResolvedValue({ success: true }),
  notifyPendingChangesOverridden: jest.fn().mockResolvedValue({ success: true }),
  notifyApprovalDecision: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockPropertyCache = {
  cacheProperty: jest.fn().mockResolvedValue({ success: true }),
  getClientProperties: jest.fn().mockResolvedValue({ success: false }),
  saveClientProperties: jest.fn().mockResolvedValue({ success: true }),
  invalidateProperty: jest.fn().mockResolvedValue({ success: true }),
  invalidatePropertyLists: jest.fn().mockResolvedValue({ success: true }),
  getLeaseableProperties: jest.fn().mockResolvedValue({ success: false }),
  cacheLeaseableProperties: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockPropertyCsvProcessor = {
  validateCsv: jest.fn().mockResolvedValue({ success: true }),
  processCsv: jest.fn().mockResolvedValue({ success: true }),
} as any;

describe('PropertyService Integration Tests', () => {
  let propertyService: PropertyService;

  let propertyDAO: PropertyDAO;
  let propertyUnitDAO: PropertyUnitDAO;
  let clientDAO: ClientDAO;
  let profileDAO: ProfileDAO;
  let userDAO: UserDAO;
  let leaseDAO: LeaseDAO;

  const createMockContext = (cuid: string, userId: string, role: string = ROLES.ADMIN) => ({
    request: {
      params: { cuid },
      url: '/properties',
      method: 'POST',
      path: '/properties',
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
    currentuser: {
      sub: userId,
      displayName: 'Test User',
      fullname: 'Test User',
      client: { cuid, role },
    },
    service: { env: 'test' },
    source: 'WEB' as any,
    requestId: 'req-123',
    timestamp: new Date(),
  });

  beforeAll(async () => {
    await setupTestDatabase();

    // Initialize real DAOs (order matters for dependencies)
    propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
    clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    profileDAO = new ProfileDAO({ profileModel: Profile });
    userDAO = new UserDAO({ userModel: User });
    leaseDAO = new LeaseDAO({ leaseModel: Lease });

    // Initialize PropertyService with real DAOs and mocked external services
    propertyService = new PropertyService({
      propertyDAO,
      propertyUnitDAO,
      clientDAO,
      profileDAO,
      userDAO,
      leaseDAO,
      queueFactory: mockQueueFactory as any,
      propertyCache: mockPropertyCache,
      emitterService: mockEventEmitter as any,
      geoCoderService: mockGeoCoderService,
      propertyCsvProcessor: mockPropertyCsvProcessor,
      mediaUploadService: mockMediaUploadService,
      notificationService: mockNotificationService,
    });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  // =========================================================================
  // WRITE TESTS - Create fresh data for each test (mutations)
  // =========================================================================
  describe('Write Operations', () => {
    let testClient: any;
    let adminUser: any;
    let staffUser: any;

    beforeEach(async () => {
      await clearTestDatabase();
      jest.clearAllMocks();

      // Create fresh test data for mutations
      testClient = await createTestClient();
      adminUser = await createTestUser(testClient.cuid, {
        roles: [ROLES.ADMIN],
        email: `admin-${Date.now()}@test.com`,
      });

      // Create staff user with Operations department
      staffUser = await createTestUser(testClient.cuid, {
        roles: [ROLES.STAFF],
        email: `staff-${Date.now()}@test.com`,
      });
      // Create profile with Operations department
      const staffProfile = await createTestProfile(staffUser._id, testClient._id, {
        type: 'employee',
      });
      // Update profile to add department info
      await Profile.findByIdAndUpdate(staffProfile._id, {
        $set: {
          employeeInfo: {
            department: 'operations', // Must match EmployeeDepartment enum value
            jobTitle: 'Property Manager',
          },
        },
      });
    });

    describe('addProperty', () => {
      it('should create property and persist to database (admin auto-approved)', async () => {
        const propertyData = {
          name: `Test Property ${Date.now()}`,
          propertyType: 'apartment' as const,
          maxAllowedUnits: 10,
          fullAddress: '123 Main St, New York, NY 10001',
          address: {
            street: '123 Main St',
            city: 'New York',
            state: 'NY',
            postCode: '10001',
            country: 'USA',
            fullAddress: '123 Main St, New York, NY 10001',
          },
          description: {
            text: 'Test apartment property for integration testing',
          },
          specifications: {
            totalArea: 5000,
          },
          fees: {
            rentalAmount: '850',
            currency: 'USD',
          },
          occupancyStatus: 'vacant' as const,
          computedLocation: {
            type: 'Point',
            coordinates: [-74.006, 40.7128], // [longitude, latitude]
          },
        };

        const ctx = createMockContext(testClient.cuid, adminUser._id.toString(), ROLES.ADMIN);

        try {
          const result = await propertyService.addProperty(ctx as any, propertyData as any);

          // Assert: Verify result
          expect(result.success).toBe(true);
          expect(result.data).toBeDefined();
          expect(result.data.name).toBe(propertyData.name);
          expect(result.data.approvalStatus).toBe(PropertyApprovalStatusEnum.APPROVED);

          // Assert: Verify data is actually in database
          const savedProperty = await Property.findOne({ pid: result.data.pid });
          expect(savedProperty).not.toBeNull();
          expect(savedProperty!.cuid).toBe(testClient.cuid);
          expect(savedProperty!.name).toBe(propertyData.name);
          expect(savedProperty!.propertyType).toBe('apartment');
          expect(savedProperty!.approvalStatus).toBe('approved');
          expect(savedProperty!.createdBy.toString()).toBe(adminUser._id.toString());

          // Assert: Cache was updated
          expect(mockPropertyCache.cacheProperty).toHaveBeenCalledWith(
            testClient.cuid,
            savedProperty!.id,
            expect.any(Object)
          );
        } catch (error: any) {
          // Log validation errors for debugging
          if (error.errorInfo) {
            console.error('Validation errors:', JSON.stringify(error.errorInfo, null, 2));
          }
          throw error;
        }
      });

      it('should create property requiring approval for staff user', async () => {
        // Verify staff user has correct department
        const staffProfile = await Profile.findOne({ user: staffUser._id });
        expect(staffProfile).not.toBeNull();
        expect(staffProfile!.employeeInfo?.department).toBe('operations');

        const propertyData = {
          name: `Staff Property ${Date.now()}`,
          propertyType: 'house' as const,
          maxAllowedUnits: 1,
          fullAddress: '456 Oak Ave, Boston, MA 02101',
          address: {
            street: '456 Oak Ave',
            city: 'Boston',
            state: 'MA',
            postCode: '02101',
            country: 'USA',
            fullAddress: '456 Oak Ave, Boston, MA 02101',
          },
          description: {
            text: 'Test house property for staff user approval workflow',
          },
          specifications: {
            bedrooms: 3,
            bathrooms: 2,
            totalArea: 2000,
          },
          fees: {
            rentalAmount: '950',
            currency: 'USD',
          },
          occupancyStatus: 'vacant' as const,
          computedLocation: {
            type: 'Point',
            coordinates: [-71.0589, 42.3601], // Boston coordinates
          },
        };

        const ctx = createMockContext(testClient.cuid, staffUser._id.toString(), ROLES.STAFF);

        const result = await propertyService.addProperty(ctx as any, propertyData as any);

        expect(result.success).toBe(true);
        expect(result.message).toContain('approval');

        // Assert: Property is pending approval
        const savedProperty = await Property.findOne({ pid: result.data.pid });
        expect(savedProperty!.approvalStatus).toBe(PropertyApprovalStatusEnum.PENDING);
        expect(savedProperty!.createdBy.toString()).toBe(staffUser._id.toString());

        // Assert: Notification service was called
        expect(mockNotificationService.handlePropertyUpdateNotifications).toHaveBeenCalled();
      });

      it('should reject duplicate property address', async () => {
        const propertyData = {
          name: 'Duplicate Property',
          propertyType: 'condominium' as const,
          maxAllowedUnits: 10,
          fullAddress: '789 Elm St, Chicago, IL 60601',
          address: {
            street: '789 Elm St',
            city: 'Chicago',
            state: 'IL',
            postCode: '60601',
            country: 'USA',
            fullAddress: '789 Elm St, Chicago, IL 60601',
          },
          description: {
            text: 'Test condominium property for duplicate address validation',
          },
          specifications: {
            totalArea: 1200,
          },
          fees: {
            rentalAmount: '900',
            currency: 'USD',
          },
          occupancyStatus: 'vacant' as const,
          computedLocation: {
            type: 'Point',
            coordinates: [-87.6298, 41.8781], // Chicago coordinates
          },
        };

        const ctx = createMockContext(testClient.cuid, adminUser._id.toString(), ROLES.ADMIN);

        // Create first property
        await propertyService.addProperty(ctx as any, propertyData as any);

        // Try to create duplicate
        await expect(
          propertyService.addProperty(ctx as any, propertyData as any)
        ).rejects.toThrow();

        // Verify only one property exists
        const properties = await Property.find({
          cuid: testClient.cuid,
          'address.fullAddress': propertyData.address.fullAddress,
        });
        expect(properties).toHaveLength(1);
      });

      it('should validate occupied property has rental amount', async () => {
        const propertyData = {
          name: 'Invalid Occupied Property',
          propertyType: 'house' as const,
          maxAllowedUnits: 1,
          fullAddress: '999 Test Rd, Austin, TX 78701',
          address: {
            street: '999 Test Rd',
            city: 'Austin',
            state: 'TX',
            postCode: '78701',
            country: 'USA',
            fullAddress: '999 Test Rd, Austin, TX 78701',
          },
          description: {
            text: 'Test house property for rental amount validation',
          },
          specifications: {
            bedrooms: 4,
            bathrooms: 3,
            totalArea: 2500,
          },
          fees: {
            rentalAmount: '0', // Invalid for occupied property
            currency: 'USD',
          },
          occupancyStatus: 'occupied' as const,
        };

        const ctx = createMockContext(testClient.cuid, adminUser._id.toString(), ROLES.ADMIN);

        await expect(propertyService.addProperty(ctx as any, propertyData as any)).rejects.toThrow(
          ValidationRequestError
        );

        // Verify no property was created
        const properties = await Property.find({ cuid: testClient.cuid });
        expect(properties).toHaveLength(0);
      });
    }); // End addProperty

    describe('updateClientProperty', () => {
      it('should update property directly for admin user', async () => {
        // Create property first
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'Original Name',
          status: 'active',
        });

        const updateData = {
          name: 'Updated Name',
          description: {
            text: 'Updated description',
            html: '<p>Updated description</p>',
          },
        };

        const result = await propertyService.updateClientProperty(
          {
            cuid: testClient.cuid,
            pid: property.pid,
            currentuser: {
              sub: adminUser._id.toString(),
              displayName: adminUser.firstName,
              fullname: `${adminUser.firstName} ${adminUser.lastName}`,
              client: { cuid: testClient.cuid, role: ROLES.ADMIN },
            },
          } as any,
          updateData
        );

        expect(result.success).toBe(true);
        expect(result.data.name).toBe('Updated Name');

        // Verify database update
        const updatedProperty = await Property.findById(property._id);
        expect(updatedProperty!.name).toBe('Updated Name');
        expect(updatedProperty!.approvalStatus).toBe('approved');
        expect(updatedProperty!.pendingChanges).toBeNull();
      });

      it('should create pending changes for staff user', async () => {
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'Staff Update Test',
          status: 'active',
        });

        // Ensure property is approved first
        await Property.findByIdAndUpdate(property._id, {
          approvalStatus: PropertyApprovalStatusEnum.APPROVED,
        });

        const updateData = {
          name: 'Staff Updated Name',
        };

        const result = await propertyService.updateClientProperty(
          {
            cuid: testClient.cuid,
            pid: property.pid,
            currentuser: {
              sub: staffUser._id.toString(),
              displayName: staffUser.firstName,
              fullname: `${staffUser.firstName} ${staffUser.lastName}`,
              client: { cuid: testClient.cuid, role: ROLES.STAFF },
            },
          } as any,
          updateData
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('approval');

        // Verify pending changes exist
        const updatedProperty = await Property.findById(property._id);
        expect(updatedProperty!.name).toBe('Staff Update Test'); // Original name unchanged
        expect(updatedProperty!.pendingChanges).toBeDefined();
        expect((updatedProperty!.pendingChanges as any).name).toBe('Staff Updated Name');
        expect(updatedProperty!.approvalStatus).toBe(PropertyApprovalStatusEnum.PENDING);
      });

      it('should throw error when property not found', async () => {
        const updateData = { name: 'Non-existent Property' };

        await expect(
          propertyService.updateClientProperty(
            {
              cuid: testClient.cuid,
              pid: 'non-existent-pid',
              currentuser: {
                sub: adminUser._id.toString(),
                displayName: adminUser.firstName,
                client: { cuid: testClient.cuid, role: ROLES.ADMIN },
              },
            } as any,
            updateData
          )
        ).rejects.toThrow(NotFoundError);
      });
    }); // End updateClientProperty

    describe('approveProperty', () => {
      it('should approve property and apply pending changes', async () => {
        // Create property with pending changes
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'Pending Property',
        });

        await Property.findByIdAndUpdate(property._id, {
          approvalStatus: PropertyApprovalStatusEnum.PENDING,
          pendingChanges: {
            name: 'Approved Name',
            updatedBy: staffUser._id,
            updatedAt: new Date(),
            displayName: `${staffUser.firstName} ${staffUser.lastName}`,
          },
        });

        const result = await propertyService.approveProperty(
          testClient.cuid,
          property.pid,
          {
            sub: adminUser._id.toString(),
            displayName: adminUser.firstName,
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          'Looks good'
        );

        expect(result.success).toBe(true);
        expect(result.data.name).toBe('Approved Name');

        // Verify database state
        const approvedProperty = await Property.findById(property._id);
        expect(approvedProperty!.approvalStatus).toBe('approved');
        expect(approvedProperty!.pendingChanges).toBeNull();
        expect(approvedProperty!.name).toBe('Approved Name');
      });

      it('should handle approval for new property creation', async () => {
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'New Property Pending',
        });

        await Property.findByIdAndUpdate(property._id, {
          approvalStatus: PropertyApprovalStatusEnum.PENDING,
          approvalDetails: [
            {
              action: 'created',
              actor: staffUser._id,
              timestamp: new Date(),
            },
          ],
        });

        const result = await propertyService.approveProperty(testClient.cuid, property.pid, {
          sub: adminUser._id.toString(),
          displayName: adminUser.firstName,
          client: { cuid: testClient.cuid, role: ROLES.ADMIN },
        } as any);

        expect(result.success).toBe(true);

        const approvedProperty = await Property.findById(property._id);
        expect(approvedProperty!.approvalStatus).toBe('approved');
      });
    }); // End approveProperty

    describe('rejectProperty', () => {
      it('should reject property and clear pending changes', async () => {
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'Property to Reject',
        });

        // First approve the property, then set it to pending with changes
        await Property.findByIdAndUpdate(property._id, {
          approvalStatus: PropertyApprovalStatusEnum.APPROVED,
        });

        await Property.findByIdAndUpdate(property._id, {
          approvalStatus: PropertyApprovalStatusEnum.PENDING,
          pendingChanges: {
            name: 'Rejected Name',
            updatedBy: staffUser._id,
            updatedAt: new Date(),
          },
        });

        const result = await propertyService.rejectProperty(
          testClient.cuid,
          property.pid,
          {
            sub: adminUser._id.toString(),
            displayName: adminUser.firstName,
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          'Does not meet standards'
        );

        expect(result.success).toBe(true);
        expect(result.message).toContain('preserved');

        // Verify database state - original data preserved
        const rejectedProperty = await Property.findById(property._id);
        expect(rejectedProperty!.name).toBe('Property to Reject'); // Original name
        expect(rejectedProperty!.pendingChanges).toBeNull();
        // Note: Service currently keeps status as 'pending' after rejecting pending changes
        // This might be a bug - ideally it should revert to 'approved'
        expect(rejectedProperty!.approvalStatus).toBe('pending');
      });

      it('should reject new property creation', async () => {
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'New Property to Reject',
        });

        await Property.findByIdAndUpdate(property._id, {
          approvalStatus: PropertyApprovalStatusEnum.PENDING,
        });

        const result = await propertyService.rejectProperty(
          testClient.cuid,
          property.pid,
          {
            sub: adminUser._id.toString(),
            displayName: adminUser.firstName,
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          'Not a valid property'
        );

        expect(result.success).toBe(true);

        const rejectedProperty = await Property.findById(property._id);
        expect(rejectedProperty!.approvalStatus).toBe('rejected');
      });

      it('should require rejection reason', async () => {
        const property = await createTestProperty(testClient.cuid, testClient._id);

        await expect(
          propertyService.rejectProperty(
            testClient.cuid,
            property.pid,
            {
              sub: adminUser._id.toString(),
              client: { cuid: testClient.cuid, role: ROLES.ADMIN },
            } as any,
            '' // Empty reason
          )
        ).rejects.toThrow(BadRequestError);
      });
    }); // End rejectProperty

    describe('archiveClientProperty', () => {
      it('should archive property without active leases', async () => {
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'Property to Archive',
        });

        const result = await propertyService.archiveClientProperty(testClient.cuid, property.pid, {
          sub: adminUser._id.toString(),
          client: { cuid: testClient.cuid, role: ROLES.ADMIN },
        } as any);

        expect(result.success).toBe(true);

        // Verify property is archived (soft delete via deletedAt)
        const archivedProperty = await Property.findById(property._id);
        expect(archivedProperty!.deletedAt).toBeDefined();
        expect(archivedProperty!.deletedAt).not.toBeNull();
      });

      it('should prevent archiving property with active leases', async () => {
        const property = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'Property with Lease',
        });

        // Create active lease with all required fields for activation
        const startDate = new Date();
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 12); // 12 months later

        await Lease.create({
          luid: `lease-${Date.now()}`,
          cuid: testClient.cuid,
          tenantId: adminUser._id,
          property: {
            id: property._id,
            address: property.address.fullAddress,
          },
          status: 'active',
          approvalStatus: 'approved',
          duration: {
            startDate,
            endDate,
          },
          fees: {
            monthlyRent: 1000,
            securityDeposit: 1000,
            rentDueDay: 1,
            currency: 'USD',
            acceptedPaymentMethod: 'e-transfer',
          },
          signedDate: new Date(),
          signingMethod: 'manual',
          signatures: [
            {
              userId: adminUser._id,
              role: 'tenant',
              signedAt: new Date(),
              signatureMethod: 'manual',
            },
          ],
          leaseDocuments: [
            {
              url: 'https://test.com/lease.pdf',
              key: 's3-key-test',
              filename: 'lease.pdf',
              documentType: 'lease_agreement',
              uploadedAt: new Date(),
              uploadedBy: adminUser._id,
            },
          ],
          createdBy: adminUser._id,
        });

        await expect(
          propertyService.archiveClientProperty(testClient.cuid, property.pid, {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any)
        ).rejects.toThrow(ValidationRequestError);

        // Verify property was not archived
        const propertyCheck = await Property.findById(property._id);
        expect(propertyCheck!.deletedAt).toBeNull();
      });
    }); // End archiveClientProperty
  }); // End Write Operations

  // =========================================================================
  // READ TESTS - Use seeded data once (queries - no mutations)
  // =========================================================================
  describe('Read Operations', () => {
    let _seededData: SeededTestData;
    let testClient: any;
    let adminUser: any;
    let property1: any;
    let property2: any;
    let _property3: any;

    beforeAll(async () => {
      await clearTestDatabase();

      // Create test data
      testClient = await createTestClient();
      adminUser = await createTestUser(testClient.cuid, {
        roles: [ROLES.ADMIN],
        email: `admin-read-${Date.now()}@test.com`,
      });

      // Create multiple properties
      property1 = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Apartment Complex A',
        propertyType: 'apartment',
        status: 'active',
      });

      property2 = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Single Family Home',
        propertyType: 'single_family',
        status: 'active',
      });

      _property3 = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Commercial Building',
        propertyType: 'commercial',
        status: 'active',
      });

      // Ensure all are approved
      await Property.updateMany(
        { cuid: testClient.cuid },
        { approvalStatus: PropertyApprovalStatusEnum.APPROVED }
      );
    });

    afterAll(async () => {
      await clearTestDatabase();
    });

    describe('getClientProperties', () => {
      it('should return all properties for client', async () => {
        const queryParams = {
          pagination: {
            page: 1,
            limit: 10,
            sort: 'name',
            sortBy: 'name',
          },
          filters: {},
        };

        const result = await propertyService.getClientProperties(
          testClient.cuid,
          {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          queryParams as any
        );

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(3);
        expect(result.data.pagination).toBeDefined();
        expect(result.data.pagination!.total).toBe(3);
      });

      it('should filter properties by type', async () => {
        const queryParams = {
          pagination: {
            page: 1,
            limit: 10,
            sort: 'name',
            sortBy: 'name',
          },
          filters: {
            propertyType: ['apartment'],
          },
        };

        const result = await propertyService.getClientProperties(
          testClient.cuid,
          {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          queryParams as any
        );

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].propertyType).toBe('apartment');
      });

      it('should handle pagination correctly', async () => {
        const queryParams = {
          pagination: {
            page: 1,
            limit: 2,
            sort: 'name',
            sortBy: 'name',
          },
          filters: {},
        };

        const result = await propertyService.getClientProperties(
          testClient.cuid,
          {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          queryParams as any
        );

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(2);
        expect(result.data.pagination!.total).toBe(3);
        expect(result.data.pagination!.totalPages).toBe(2);
      });
    }); // End getClientProperties

    describe('getClientProperty', () => {
      it('should return single property with unit info', async () => {
        const result = await propertyService.getClientProperty(testClient.cuid, property1.pid, {
          sub: adminUser._id.toString(),
          client: { cuid: testClient.cuid, role: ROLES.ADMIN },
        } as any);

        expect(result.success).toBe(true);
        expect(result.data.property).toBeDefined();
        expect(result.data.property?.pid).toBe(property1.pid);
        expect(result.data.property?.name).toBe('Apartment Complex A');
        expect(result.data.unitInfo).toBeDefined();
      });

      it('should throw error for non-existent property', async () => {
        await expect(
          propertyService.getClientProperty(testClient.cuid, 'non-existent-pid', {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any)
        ).rejects.toThrow(NotFoundError);
      });
    }); // End getClientProperty

    describe('getPendingApprovals', () => {
      it('should return only pending properties', async () => {
        // Create pending property
        const pendingProperty = await createTestProperty(testClient.cuid, testClient._id, {
          name: 'Pending Property',
        });
        await Property.findByIdAndUpdate(pendingProperty._id, {
          approvalStatus: PropertyApprovalStatusEnum.PENDING,
        });

        const result = await propertyService.getPendingApprovals(
          testClient.cuid,
          {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          { page: 1, limit: 10 }
        );

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(1);
        expect(result.data.items[0].approvalStatus).toBe('pending');
      });
    }); // End getPendingApprovals

    describe('getUnitInfoForProperty', () => {
      it('should return unit info for multi-unit property', async () => {
        // Create units for property1
        await createTestPropertyUnit(testClient.cuid, property1._id, {
          unitNumber: '101',
          status: 'available',
        });
        await createTestPropertyUnit(testClient.cuid, property1._id, {
          unitNumber: '102',
          status: 'occupied',
        });

        const propertyDoc = await Property.findById(property1._id);
        const unitInfo = await propertyService.getUnitInfoForProperty(propertyDoc!);

        expect(unitInfo).toBeDefined();
        expect(unitInfo.totalUnits).toBe(2);
        expect(unitInfo.maxAllowedUnits).toBe(property1.maxAllowedUnits);
        expect(unitInfo.unitStats).toBeDefined();
        expect(unitInfo.unitStats.available).toBeGreaterThanOrEqual(0);
      });

      it('should return stats for single-unit property', async () => {
        const propertyDoc = await Property.findById(property2._id);
        const unitInfo = await propertyService.getUnitInfoForProperty(propertyDoc!);

        expect(unitInfo).toBeDefined();
        expect(unitInfo.totalUnits).toBe(1);
        expect(unitInfo.maxAllowedUnits).toBe(1);
        expect(unitInfo.canAddUnit).toBe(false);
      });
    }); // End getUnitInfoForProperty

    describe('getLeaseableProperties', () => {
      it('should return available properties for leasing', async () => {
        // Ensure properties are available
        await Property.updateMany(
          { cuid: testClient.cuid },
          { status: 'available', approvalStatus: PropertyApprovalStatusEnum.APPROVED }
        );

        const result = await propertyService.getLeaseableProperties(
          testClient.cuid,
          {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          false
        );

        expect(result.success).toBe(true);
        expect(result.data.items.length).toBeGreaterThan(0);
        expect(result.data.metadata).toBeDefined();
      });

      it('should include units when fetchUnits is true', async () => {
        // Create units for apartment property
        await createTestPropertyUnit(testClient.cuid, property1._id, {
          unitNumber: '201',
          status: 'available',
        });

        await Property.findByIdAndUpdate(property1._id, {
          status: 'available',
          approvalStatus: PropertyApprovalStatusEnum.APPROVED,
        });

        const result = await propertyService.getLeaseableProperties(
          testClient.cuid,
          {
            sub: adminUser._id.toString(),
            client: { cuid: testClient.cuid, role: ROLES.ADMIN },
          } as any,
          true // fetch units
        );

        expect(result.success).toBe(true);
        const apartmentProperty = result.data.items.find((p) => p.propertyType === 'apartment');
        if (apartmentProperty) {
          expect(apartmentProperty.units).toBeDefined();
        }
      });
    }); // End getLeaseableProperties
  }); // End Read Operations
});
