import { Types } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { ICurrentUser } from '@interfaces/user.interface';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { IPropertyDocument } from '@interfaces/property.interface';
import { PropertyService } from '@services/property/property.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PropertyStatsService } from '@services/property/propertyStats.service';
import { mockQueueFactory, mockEventEmitter } from '@tests/setup/externalMocks';
import { filterPropertyByDepartment } from '@services/property/propertyHelpers';
import { PropertyUnit, Property, Profile, Client, Lease, User } from '@models/index';
import { PropertyApprovalService } from '@services/property/propertyApproval.service';
import { PropertyUnitDAO, PropertyDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import {
  createTestProperty,
  clearTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

// ── External service mocks ──────────────────────────────────────────────────
const mockMediaUploadService = {
  handleMediaDeletion: jest.fn().mockResolvedValue(undefined),
  handleAvatarDeletion: jest.fn().mockResolvedValue(undefined),
  uploadFile: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockGeoCoderService = {
  geocode: jest.fn().mockResolvedValue({
    success: true,
    data: { latitude: 40.7128, longitude: -74.006, formattedAddress: '123 Test St' },
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
  invalidateLeaseableProperties: jest.fn().mockResolvedValue({ success: true }),
} as any;

const mockPropertyCsvProcessor = {
  validateCsv: jest.fn().mockResolvedValue({ success: true }),
  processCsv: jest.fn().mockResolvedValue({ success: true }),
} as any;

// ── Helpers ─────────────────────────────────────────────────────────────────
const buildStaffCtx = (
  cuid: string,
  pid: string,
  userId: string,
  role: string = ROLES.ADMIN,
  employeeInfo?: { department: string }
) => ({
  cuid,
  pid,
  currentuser: {
    sub: userId,
    uid: `uid-${userId.slice(-6)}`,
    email: `user-${userId.slice(-6)}@test.com`,
    activecuid: cuid,
    displayName: 'Test User',
    fullname: 'Test User',
    client: { cuid, role },
    ...(employeeInfo && { employeeInfo }),
  } as unknown as ICurrentUser,
});

const buildCurrentUser = (
  userId: string,
  cuid: string,
  role: string = ROLES.ADMIN,
  employeeInfo?: { department: string }
): ICurrentUser =>
  ({
    sub: userId,
    uid: `uid-${userId.slice(-6)}`,
    email: `user-${userId.slice(-6)}@test.com`,
    activecuid: cuid,
    displayName: 'Test User',
    fullname: 'Test User',
    client: { cuid, role },
    ...(employeeInfo && { employeeInfo }),
  }) as unknown as ICurrentUser;

const buildRequestContext = (
  cuid: string,
  userId: string,
  role: string = ROLES.ADMIN,
  employeeInfo?: { department: string }
) => ({
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
  currentuser: buildCurrentUser(userId, cuid, role, employeeInfo),
  service: { env: 'test' },
  source: 'WEB' as any,
  requestId: 'req-123',
  timestamp: new Date(),
});

// ── Test suite ──────────────────────────────────────────────────────────────
describe('PropertyService — assignedStaff & department filtering', () => {
  let propertyService: PropertyService;
  let propertyDAO: PropertyDAO;
  let propertyUnitDAO: PropertyUnitDAO;
  let clientDAO: ClientDAO;
  let profileDAO: ProfileDAO;
  let userDAO: UserDAO;
  let leaseDAO: LeaseDAO;

  beforeAll(async () => {
    propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
    clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    profileDAO = new ProfileDAO({ profileModel: Profile });
    userDAO = new UserDAO({ userModel: User });
    leaseDAO = new LeaseDAO({ leaseModel: Lease });

    const propertyApprovalService = new PropertyApprovalService({
      propertyDAO,
      propertyCache: mockPropertyCache,
      notificationService: mockNotificationService,
    });

    const propertyStatsService = new PropertyStatsService({
      propertyUnitDAO,
      propertyDAO,
    });

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
      propertyApprovalService,
      propertyStatsService,
      notificationService: mockNotificationService,
      subscriptionDAO: {} as any,
      paymentDAO: {} as any,
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // assignStaff
  // ═══════════════════════════════════════════════════════════════════════════
  describe('assignStaff', () => {
    it('should assign a staff user to a property successfully', async () => {
      const client = await createTestClient();
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const property = await createTestProperty(client.cuid, client._id);

      const ctx = buildStaffCtx(client.cuid, property.pid, adminUser._id.toString());
      const result = await propertyService.assignStaff(ctx, staffUser._id.toString());

      expect(result.success).toBe(true);

      // Verify in DB
      const updated = await Property.findById(property._id);
      expect(updated!.assignedStaff).toHaveLength(1);
      expect(updated!.assignedStaff![0].toString()).toBe(staffUser._id.toString());
    });

    it('should reject if property is not found', async () => {
      const client = await createTestClient();
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const ctx = buildStaffCtx(client.cuid, 'non-existent-pid', adminUser._id.toString());

      await expect(propertyService.assignStaff(ctx, staffUser._id.toString())).rejects.toThrow(
        NotFoundError
      );
    });

    it('should reject if user is not found or not in cuid', async () => {
      const client = await createTestClient();
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const property = await createTestProperty(client.cuid, client._id);

      // Use a valid ObjectId that doesn't belong to any user
      const fakeUserId = new Types.ObjectId().toString();
      const ctx = buildStaffCtx(client.cuid, property.pid, adminUser._id.toString());

      await expect(propertyService.assignStaff(ctx, fakeUserId)).rejects.toThrow(NotFoundError);
    });

    it('should reject if user is already the primary manager', async () => {
      const client = await createTestClient();
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const property = await createTestProperty(client.cuid, client._id);

      // Set managedBy to the manager
      await Property.findByIdAndUpdate(property._id, { managedBy: managerUser._id });

      const ctx = buildStaffCtx(client.cuid, property.pid, managerUser._id.toString());

      await expect(propertyService.assignStaff(ctx, managerUser._id.toString())).rejects.toThrow(
        BadRequestError
      );
    });

    it('should reject if user is already assigned', async () => {
      const client = await createTestClient();
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const property = await createTestProperty(client.cuid, client._id);

      // Pre-assign the staff user
      await Property.findByIdAndUpdate(property._id, {
        $addToSet: { assignedStaff: staffUser._id },
      });

      const ctx = buildStaffCtx(client.cuid, property.pid, adminUser._id.toString());

      await expect(propertyService.assignStaff(ctx, staffUser._id.toString())).rejects.toThrow(
        BadRequestError
      );
    });

    it('should reject when assignedStaff cap of 10 is reached', async () => {
      const client = await createTestClient();
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const property = await createTestProperty(client.cuid, client._id);

      // Fill up assignedStaff with 10 fake ObjectIds
      const tenIds = Array.from({ length: 10 }, () => new Types.ObjectId());
      await Property.findByIdAndUpdate(property._id, { assignedStaff: tenIds });

      // Create the 11th user
      const extraStaff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      const ctx = buildStaffCtx(client.cuid, property.pid, adminUser._id.toString());

      await expect(propertyService.assignStaff(ctx, extraStaff._id.toString())).rejects.toThrow(
        BadRequestError
      );
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // unassignStaff
  // ═══════════════════════════════════════════════════════════════════════════
  describe('unassignStaff', () => {
    it('should remove a staff user from assignedStaff', async () => {
      const client = await createTestClient();
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const property = await createTestProperty(client.cuid, client._id);

      // Pre-assign
      await Property.findByIdAndUpdate(property._id, {
        $addToSet: { assignedStaff: staffUser._id },
      });

      const ctx = buildStaffCtx(client.cuid, property.pid, adminUser._id.toString());
      const result = await propertyService.unassignStaff(ctx, staffUser._id.toString());

      expect(result.success).toBe(true);

      const updated = await Property.findById(property._id);
      expect(updated!.assignedStaff).toHaveLength(0);
    });

    it('should reject if property is not found', async () => {
      const client = await createTestClient();
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });

      const ctx = buildStaffCtx(client.cuid, 'missing-pid', adminUser._id.toString());

      await expect(
        propertyService.unassignStaff(ctx, new Types.ObjectId().toString())
      ).rejects.toThrow(NotFoundError);
    });

    it('should be a no-op when removing a user who is not in assignedStaff', async () => {
      const client = await createTestClient();
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const property = await createTestProperty(client.cuid, client._id);

      const ctx = buildStaffCtx(client.cuid, property.pid, adminUser._id.toString());
      const result = await propertyService.unassignStaff(ctx, new Types.ObjectId().toString());

      expect(result.success).toBe(true);

      // Array should remain empty / unchanged
      const updated = await Property.findById(property._id);
      expect(updated!.assignedStaff ?? []).toHaveLength(0);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // managedBy change cleanup
  // ═══════════════════════════════════════════════════════════════════════════
  describe('managedBy change removes new manager from assignedStaff', () => {
    it('should auto-remove the new manager from assignedStaff when managedBy changes', async () => {
      const client = await createTestClient();
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      const property = await createTestProperty(client.cuid, client._id);

      // Pre-assign staffUser to assignedStaff
      await Property.findByIdAndUpdate(property._id, {
        $addToSet: { assignedStaff: staffUser._id },
      });

      // Admin updates managedBy to the staff user
      const ctx = buildRequestContext(client.cuid, adminUser._id.toString(), ROLES.ADMIN);
      await propertyService.updateClientProperty(
        { cuid: client.cuid, pid: property.pid, currentuser: ctx.currentuser },
        { managedBy: staffUser._id } as any
      );

      // The staff user should have been pulled from assignedStaff
      const updated = await Property.findById(property._id);
      expect(updated!.managedBy!.toString()).toBe(staffUser._id.toString());
      expect(updated!.assignedStaff?.some((id) => id.toString() === staffUser._id.toString())).toBe(
        false
      );
    });

    it('should leave assignedStaff unchanged when new manager is not in the array', async () => {
      const client = await createTestClient();
      const adminUser = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      const newManager = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const property = await createTestProperty(client.cuid, client._id);

      // Pre-assign staffUser only
      await Property.findByIdAndUpdate(property._id, {
        $addToSet: { assignedStaff: staffUser._id },
      });

      const ctx = buildRequestContext(client.cuid, adminUser._id.toString(), ROLES.ADMIN);
      await propertyService.updateClientProperty(
        { cuid: client.cuid, pid: property.pid, currentuser: ctx.currentuser },
        { managedBy: newManager._id } as any
      );

      const updated = await Property.findById(property._id);
      expect(updated!.assignedStaff).toHaveLength(1);
      expect(updated!.assignedStaff![0].toString()).toBe(staffUser._id.toString());
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // Security department property scoping
  // ═══════════════════════════════════════════════════════════════════════════
  describe('Security department property scoping', () => {
    it('should only return properties where security staff is in assignedStaff', async () => {
      const client = await createTestClient();
      const secUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      // Create profile with security department
      const profile = await createTestProfile(secUser._id, client._id, { type: 'employee' });
      await Profile.findByIdAndUpdate(profile._id, {
        $set: { employeeInfo: { department: EmployeeDepartment.SECURITY } },
      });

      // Create two properties, assign security user to only one
      const assignedProp = await createTestProperty(client.cuid, client._id);
      const unassignedProp = await createTestProperty(client.cuid, client._id);

      await Property.findByIdAndUpdate(assignedProp._id, {
        $addToSet: { assignedStaff: secUser._id },
      });

      const currentuser = buildCurrentUser(secUser._id.toString(), client.cuid, ROLES.STAFF, {
        department: EmployeeDepartment.SECURITY,
      });

      const result = await propertyService.getClientProperties(client.cuid, currentuser, {
        pagination: { page: 1, sort: {} },
        filters: {},
      } as any);

      expect(result.success).toBe(true);
      const pids = result.data!.items.map((p: any) => p.pid);
      expect(pids).toContain(assignedProp.pid);
      expect(pids).not.toContain(unassignedProp.pid);
    });

    it('should also return properties where security staff is managedBy', async () => {
      const client = await createTestClient();
      const secUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const profile = await createTestProfile(secUser._id, client._id, { type: 'employee' });
      await Profile.findByIdAndUpdate(profile._id, {
        $set: { employeeInfo: { department: EmployeeDepartment.SECURITY } },
      });

      const managedProp = await createTestProperty(client.cuid, client._id);
      await Property.findByIdAndUpdate(managedProp._id, { managedBy: secUser._id });

      const currentuser = buildCurrentUser(secUser._id.toString(), client.cuid, ROLES.STAFF, {
        department: EmployeeDepartment.SECURITY,
      });

      const result = await propertyService.getClientProperties(client.cuid, currentuser, {
        pagination: { page: 1, sort: {} },
        filters: {},
      } as any);

      const pids = result.data!.items.map((p: any) => p.pid);
      expect(pids).toContain(managedProp.pid);
    });

    it('should return 404 for getClientProperty when security staff is not assigned', async () => {
      const client = await createTestClient();
      const secUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const profile = await createTestProfile(secUser._id, client._id, { type: 'employee' });
      await Profile.findByIdAndUpdate(profile._id, {
        $set: { employeeInfo: { department: EmployeeDepartment.SECURITY } },
      });

      const property = await createTestProperty(client.cuid, client._id);

      const currentuser = buildCurrentUser(secUser._id.toString(), client.cuid, ROLES.STAFF, {
        department: EmployeeDepartment.SECURITY,
      });

      await expect(
        propertyService.getClientProperty(client.cuid, property.pid, currentuser)
      ).rejects.toThrow(NotFoundError);
    });

    it('should allow non-security staff to see all properties', async () => {
      const client = await createTestClient();
      const opsUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });

      const profile = await createTestProfile(opsUser._id, client._id, { type: 'employee' });
      await Profile.findByIdAndUpdate(profile._id, {
        $set: { employeeInfo: { department: EmployeeDepartment.OPERATIONS } },
      });

      // Create two properties — user is not assigned to either
      await createTestProperty(client.cuid, client._id);
      await createTestProperty(client.cuid, client._id);

      const currentuser = buildCurrentUser(opsUser._id.toString(), client.cuid, ROLES.STAFF, {
        department: EmployeeDepartment.OPERATIONS,
      });

      const result = await propertyService.getClientProperties(client.cuid, currentuser, {
        pagination: { page: 1, sort: {} },
        filters: {},
      } as any);

      expect(result.data!.items.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // filterPropertyByDepartment (pure function, tested with real Mongoose doc)
  // ═══════════════════════════════════════════════════════════════════════════
  describe('filterPropertyByDepartment', () => {
    let property: IPropertyDocument;

    beforeEach(async () => {
      const client = await createTestClient();
      property = await createTestProperty(client.cuid, client._id);

      // Add fields that get filtered
      await Property.findByIdAndUpdate(property._id, {
        fees: { rentAmount: 150000, currency: 'USD' },
        financialDetails: { marketValue: 500000 },
        documents: [{ name: 'deed.pdf', url: 'https://s3.example.com/deed.pdf' }],
        specifications: { totalArea: 2000, bedrooms: 3, bathrooms: 2 },
      });

      property = (await Property.findById(property._id))!;
    });

    it('should strip fees, financialDetails, and documents for Security department', () => {
      const filtered = filterPropertyByDepartment(property, EmployeeDepartment.SECURITY) as any;

      // Should have basic fields
      expect(filtered.pid).toBe(property.pid);
      expect(filtered.name).toBe(property.name);
      expect(filtered.address).toBeDefined();
      expect(filtered.specifications).toBeDefined();

      // Should NOT have financials or documents
      expect(filtered.fees).toBeUndefined();
      expect(filtered.financialDetails).toBeUndefined();
      expect(filtered.documents).toBeUndefined();
    });

    it('should strip fees and financialDetails but keep specifications for Maintenance department', () => {
      const filtered = filterPropertyByDepartment(property, EmployeeDepartment.MAINTENANCE) as any;

      expect(filtered.pid).toBe(property.pid);
      expect(filtered.specifications).toBeDefined();

      // Maintenance is financially restricted
      expect(filtered.fees).toBeUndefined();
      expect(filtered.financialDetails).toBeUndefined();
    });

    it('should keep fees but strip documents for Accounting department', () => {
      const filtered = filterPropertyByDepartment(property, EmployeeDepartment.ACCOUNTING) as any;

      expect(filtered.pid).toBe(property.pid);
      // Accounting has full financial access
      expect(filtered.fees).toBeDefined();

      // Not in DOCUMENTS_ALLOWED_DEPTS
      expect(filtered.documents).toBeUndefined();
    });

    it('should return full property for Operations department', () => {
      const filtered = filterPropertyByDepartment(property, EmployeeDepartment.OPERATIONS) as any;

      expect(filtered.pid).toBe(property.pid);
      expect(filtered.fees).toBeDefined();
      expect(filtered.documents).toBeDefined();
      expect(filtered.specifications).toBeDefined();
    });

    it('should return full property when no department is provided', () => {
      const filtered = filterPropertyByDepartment(property, undefined) as any;

      // Should be the same object reference (no filtering)
      expect(filtered).toBe(property);
    });
  });
});
