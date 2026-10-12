import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { ClientDAO } from '@dao/index';
import { faker } from '@faker-js/faker';
import { LeaseDAO } from '@dao/leaseDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { InvoiceDAO } from '@dao/invoiceDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import InvoiceModel from '@models/invoice/invoice.model';
import { ROLES } from '@shared/constants/roles.constants';
import PaymentModel from '@models/payments/payments.model';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';
import { VendorSuggestionService } from '@services/maintenanceRequest/vendorSuggestion.service';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';
import { MaintenanceInvoiceService } from '@services/maintenanceRequest/maintenanceInvoice.service';
import {
  MaintenanceRequest,
  PropertyUnit,
  Property,
  Vendor,
  Client,
  Lease,
  User,
} from '@models/index';
import {
  MaintenanceRequestPriority,
  MaintenanceRequestStatus,
  MaintenanceCategory,
  InvoiceStatus,
} from '@interfaces/maintenanceRequest.interface';

import { mockRequestContext } from '../../helpers/mockRequestContext';
import { disconnectTestDatabase, setupTestDatabase } from '../../setup/testDatabase';
import {
  createTestPropertyUnit,
  setupAllExternalMocks,
  createTestProperty,
  clearTestDatabase,
  createTestClient,
  createTestVendor,
  createTestUser,
} from '../../helpers';

const setupService = () => {
  const userDAO = new UserDAO({ userModel: User });
  const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
  const propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
  const leaseDAO = new LeaseDAO({ leaseModel: Lease });
  const vendorDAO = new VendorDAO({ vendorModel: Vendor });
  const maintenanceRequestDAO = new MaintenanceRequestDAO({
    maintenanceRequestModel: MaintenanceRequest,
  });

  const eventsRegistry = {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    getEventLog: jest.fn().mockResolvedValue([]),
    registerEvent: jest.fn().mockResolvedValue(undefined),
    registerEvents: jest.fn().mockResolvedValue(undefined),
  } as any;

  const emitterService = new EventEmitterService({ eventsRegistry });
  const invoiceDAO = new InvoiceDAO({ invoiceModel: InvoiceModel });
  const paymentDAO = new PaymentDAO({ paymentModel: PaymentModel });
  const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
  const smsService = {
    sendToUser: jest.fn().mockReturnValue(Promise.resolve({ success: true })),
  } as any;

  const maintenanceInvoiceService = new MaintenanceInvoiceService({
    maintenancePaymentService: {
      quoteTenantMaintenanceCharge: jest.fn((_cuid: string, amount: number) =>
        Promise.resolve({ serviceFeeCents: 0, totalAmount: amount })
      ),
    } as any,
    maintenanceRequestDAO,
    emitterService,
    invoiceDAO,
    vendorDAO,
    smsService,
    clientDAO,
  });

  return new MaintenanceRequestService({
    s3Service: {
      signFileUrls: jest.fn(async (items: any) => items),
      getSignedUrl: jest.fn(),
    } as any,
    maintenanceRequestDAO,
    propertyDAO,
    propertyUnitDAO,
    invoiceDAO,
    paymentDAO,
    userDAO,
    leaseDAO,
    vendorDAO,
    emitterService,
    smsService,
    vendorSuggestionService: {
      runAITriage: jest.fn().mockReturnValue(Promise.resolve()),
      suggestVendor: jest.fn().mockReturnValue(Promise.resolve(null)),
      acceptAISuggestion: jest.fn(),
      dismissAISuggestion: jest.fn(),
    } as unknown as VendorSuggestionService,
    maintenanceInvoiceService,
  });
};

/**
 * Create a minimal valid Lease for a tenant on a property.
 * The Lease model requires: cuid, tenantId, property.id, property.address,
 * duration.startDate/endDate, fees.rentAmount/securityDeposit/acceptedPaymentMethod/currency
 */
const createActiveLease = async (
  cuid: string,
  tenantId: Types.ObjectId,
  propertyId: Types.ObjectId,
  propertyUnitId?: Types.ObjectId
) => {
  // Use validateBeforeSave: false to bypass the Lease model's complex
  // business-logic validations (documents, signing, etc.) since we only need
  // a queryable record to satisfy the service's leaseDAO.findFirst() check.
  const lease = new Lease({
    luid: `lease-${faker.string.alphanumeric(12)}`,
    cuid,
    tenantId,
    property: {
      id: propertyId,
      ...(propertyUnitId ? { unitId: propertyUnitId } : {}),
      address: faker.location.streetAddress(),
    },
    status: 'active',
    approvalStatus: 'approved',
    type: 'fixed_term',
    duration: {
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      endDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000),
    },
    fees: {
      rentAmount: 150000,
      securityDeposit: 150000,
      rentDueDay: 1,
      currency: 'USD',
      acceptedPaymentMethod: 'bank_transfer',
    },
  });
  return lease.save({ validateBeforeSave: false });
};

beforeAll(async () => {
  await setupTestDatabase();
});

afterAll(async () => {
  await disconnectTestDatabase();
});

beforeEach(async () => {
  await clearTestDatabase();
  setupAllExternalMocks();
});

describe('MaintenanceRequestService', () => {
  describe('createRequest', () => {
    it('assigns a vendor with schedule and estimate when created by staff', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);
      const scheduledDate = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const result = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Create with vendor test',
        description: { text: 'Request created with vendor, schedule and estimate' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
        vendorVuid: vendorRecord.vuid,
        scheduledDate: scheduledDate as any,
        estimatedCost: 120.5,
      });

      const stored = await MaintenanceRequest.findOne({ mruid: result.data.mruid }).lean();
      expect(stored?.status).toBe(MaintenanceRequestStatus.ASSIGNED);
      expect(stored?.vendorId?.toString()).toBe(vendorUser._id.toString());
      expect(stored?.estimatedCost).toBe(12050);
      expect(stored?.scheduledDate?.toISOString()).toBe(scheduledDate);
    });

    it('should create a maintenance request with valid pid', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const result = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Leaking faucet in bathroom',
        description: { text: 'The bathroom faucet has been dripping for two days' },
        category: MaintenanceCategory.PLUMBING,
        priority: MaintenanceRequestPriority.MEDIUM,
        permissionToEnter: true,
        media: [],
      });

      expect(result.success).toBe(true);
      expect(result.data.mruid).toBeDefined();
      expect(result.data.status).toBe(MaintenanceRequestStatus.OPEN);
      expect(result.data.propertyId.toString()).toBe(property._id.toString());
    });

    it('records the creating user as createdBy', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const result = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Squeaky front door',
        description: { text: 'The front door hinge squeaks every time it opens' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      const stored = await MaintenanceRequest.findOne({ mruid: result.data.mruid }).lean();
      expect(stored?.createdBy?.toString()).toBe(managerUser._id.toString());
    });

    it("should set managedBy from the property's manager", async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const result = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Broken window latch',
        description: { text: 'The living room window latch no longer closes' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });

      const stored = await MaintenanceRequest.findOne({ mruid: result.data.mruid }).lean();
      expect(stored?.managedBy?.toString()).toBe(property.managedBy?.toString());
    });

    it('should create a maintenance request with pid and puid', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const unit = await createTestPropertyUnit(client.cuid, property._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const result = await service.createRequest(ctx, {
        pid: property.pid,
        puid: unit.puid,
        title: 'Broken window latch',
        description: { text: 'The window latch in the bedroom is broken and cannot be locked' },
        category: MaintenanceCategory.STRUCTURAL,
        permissionToEnter: false,
        media: [],
      });

      expect(result.success).toBe(true);
      expect(result.data.propertyUnitId?.toString()).toBe(unit._id.toString());
    });

    it('should throw NotFoundError when property pid does not exist', async () => {
      const client = await createTestClient();
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      await expect(
        service.createRequest(ctx, {
          pid: 'nonexistent-pid',
          title: 'Test request',
          description: { text: 'This property does not exist in this client' },
          category: MaintenanceCategory.GENERAL,
          permissionToEnter: true,
          media: [],
        })
      ).rejects.toThrow();
    });

    it('should reject request for property in different client', async () => {
      const client1 = await createTestClient();
      const client2 = await createTestClient();
      const property2 = await createTestProperty(client2.cuid, client2._id);
      const managerUser = await createTestUser(client1.cuid, { roles: [ROLES.MANAGER] });

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client1.cuid) as any;

      await expect(
        service.createRequest(ctx, {
          pid: property2.pid, // property belongs to client2
          title: 'Cross-tenant request',
          description: { text: 'This should not be allowed' },
          category: MaintenanceCategory.GENERAL,
          permissionToEnter: true,
          media: [],
        })
      ).rejects.toThrow();
    });

    it('should store tenantId when tenant creates a request with an active lease', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenantUser = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      await createActiveLease(client.cuid, tenantUser._id, property._id);

      const service = setupService();
      const ctx = mockRequestContext(tenantUser, client.cuid) as any;

      const result = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Tenant maintenance request',
        description: { text: 'Something needs fixing in my unit' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });

      expect(result.success).toBe(true);
      expect(result.data.tenantId?.toString()).toBe(tenantUser._id.toString());
    });

    it('should throw ForbiddenError when tenant has no active lease', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenantUser = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      // No lease created for this tenant
      const service = setupService();
      const ctx = mockRequestContext(tenantUser, client.cuid) as any;

      await expect(
        service.createRequest(ctx, {
          pid: property.pid,
          title: 'Tenant request without lease',
          description: { text: 'This should fail because no active lease' },
          category: MaintenanceCategory.GENERAL,
          permissionToEnter: true,
          media: [],
        })
      ).rejects.toThrow();
    });

    it('should throw ForbiddenError when staff is a primary tenant on the property', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      // User has staff role in the system but also has an active lease on this property
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      await createActiveLease(client.cuid, staffUser._id, property._id);

      const service = setupService();
      const ctx = mockRequestContext(staffUser, client.cuid) as any;

      await expect(
        service.createRequest(ctx, {
          pid: property.pid,
          title: 'Staff gaming the system',
          description: { text: 'Staff member trying to file MR on their own unit' },
          category: MaintenanceCategory.PLUMBING,
          permissionToEnter: true,
          media: [],
        })
      ).rejects.toThrow();
    });

    it('should throw ForbiddenError when staff is a co-tenant on the property', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const primaryTenant = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      const staffUser = await createTestUser(client.cuid, {
        roles: [ROLES.STAFF],
        email: 'staff-cotenant@test.com',
      });

      // Staff user appears as a co-tenant by email on the lease
      const lease = new Lease({
        luid: `lease-${Math.random().toString(36).slice(2)}`,
        cuid: client.cuid,
        tenantId: primaryTenant._id,
        property: { id: property._id, address: '123 Test St' },
        status: 'active',
        approvalStatus: 'approved',
        type: 'fixed_term',
        duration: {
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          endDate: new Date(Date.now() + 335 * 24 * 60 * 60 * 1000),
        },
        fees: {
          rentAmount: 150000,
          securityDeposit: 150000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'bank_transfer',
        },
        coTenants: [{ name: 'Staff User', email: staffUser.email, phone: '555-0000' }],
      });
      await lease.save({ validateBeforeSave: false });

      const service = setupService();
      const ctx = mockRequestContext(staffUser, client.cuid) as any;

      await expect(
        service.createRequest(ctx, {
          pid: property.pid,
          title: 'Co-tenant staff gaming the system',
          description: { text: 'Staff member is a co-tenant trying to file MR' },
          category: MaintenanceCategory.GENERAL,
          permissionToEnter: true,
          media: [],
        })
      ).rejects.toThrow();
    });

    it('should allow staff to create MR on a property they do not occupy', async () => {
      const client = await createTestClient();
      const propertyStaffLivesIn = await createTestProperty(client.cuid, client._id);
      const otherProperty = await createTestProperty(client.cuid, client._id);
      const staffUser = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      // Staff has a lease on one property but not the one they're filing for
      await createActiveLease(client.cuid, staffUser._id, propertyStaffLivesIn._id);

      const service = setupService();
      const ctx = mockRequestContext(staffUser, client.cuid) as any;

      const result = await service.createRequest(ctx, {
        pid: otherProperty.pid,
        title: 'Staff filing for different property',
        description: { text: 'This is a valid request on a property staff does not occupy' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });

      expect(result.success).toBe(true);
    });
  });

  describe('listRequests', () => {
    it('should list all requests for a client', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Request one',
        description: { text: 'First maintenance request description' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Request two',
        description: { text: 'Second maintenance request description' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: false,
        media: [],
      });

      const result = await service.listRequests(ctx, {}, { page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data.items.length).toBe(2);
    });

    it('should filter by status', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Open request',
        description: { text: 'This is an open maintenance request' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.listRequests(
        ctx,
        { status: MaintenanceRequestStatus.OPEN },
        { page: 1, limit: 10 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items.length).toBe(1);
      expect(result.data.items[0].status).toBe(MaintenanceRequestStatus.OPEN);
    });

    it('should filter by pid (property resource UID)', async () => {
      const client = await createTestClient();
      const property1 = await createTestProperty(client.cuid, client._id);
      const property2 = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      await service.createRequest(ctx, {
        pid: property1.pid,
        title: 'Property1 request',
        description: { text: 'Request for property one maintenance' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.createRequest(ctx, {
        pid: property2.pid,
        title: 'Property2 request',
        description: { text: 'Request for property two maintenance' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.listRequests(
        ctx,
        { pid: property1.pid },
        { page: 1, limit: 10 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items.length).toBe(1);
      expect((result.data.items[0].propertyId as any)._id.toString()).toBe(
        property1._id.toString()
      );
    });

    it('should return only own requests for tenant role', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const tenant1 = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });
      const tenant2 = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      await createActiveLease(client.cuid, tenant1._id, property._id);
      await createActiveLease(client.cuid, tenant2._id, property._id);

      const service = setupService();
      const ctx1 = mockRequestContext(tenant1, client.cuid) as any;
      const ctx2 = mockRequestContext(tenant2, client.cuid) as any;

      await service.createRequest(ctx1, {
        pid: property.pid,
        title: 'Tenant1 request',
        description: { text: 'Maintenance request from tenant one' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });
      await service.createRequest(ctx2, {
        pid: property.pid,
        title: 'Tenant2 request',
        description: { text: 'Maintenance request from tenant two' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.listRequests(ctx1, {}, { page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data.items.length).toBe(1);
      expect((result.data.items[0].tenantId as any)?._id.toString()).toBe(tenant1._id.toString());
    });
  });

  describe('listRequests — server-side pagination and sort', () => {
    const seedRequests = (cuid: string, propertyId: Types.ObjectId, count: number) =>
      MaintenanceRequest.insertMany(
        Array.from({ length: count }, (_, i) => ({
          cuid,
          propertyId,
          title: `Request ${String(i).padStart(2, '0')}`,
          description: { text: 'Seeded maintenance request description' },
          category: MaintenanceCategory.GENERAL,
          priority: MaintenanceRequestPriority.MEDIUM,
          status: MaintenanceRequestStatus.OPEN,
          permissionToEnter: true,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
        }))
      );

    it('returns the requested page and matching pagination metadata', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const ctx = mockRequestContext(managerUser, client.cuid) as any;
      await seedRequests(client.cuid, property._id, 25);
      const service = setupService();

      const page1 = await service.listRequests(ctx, {}, { page: 1, limit: 10 });
      const page2 = await service.listRequests(ctx, {}, { page: 2, limit: 10 });
      const page3 = await service.listRequests(ctx, {}, { page: 3, limit: 10 });

      expect(page1.data.items).toHaveLength(10);
      expect(page2.data.items).toHaveLength(10);
      expect(page3.data.items).toHaveLength(5);
      const allMruids = [...page1.data.items, ...page2.data.items, ...page3.data.items].map(
        (item: any) => item.mruid
      );
      expect(new Set(allMruids).size).toBe(25);
      expect(page2.data.pagination).toMatchObject({
        total: 25,
        perPage: 10,
        totalPages: 3,
        currentPage: 2,
        hasMoreResource: true,
      });
      expect(page3.data.pagination.hasMoreResource).toBe(false);
    });

    it('reports the page size actually used when no limit is sent', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const ctx = mockRequestContext(managerUser, client.cuid) as any;
      await seedRequests(client.cuid, property._id, 25);
      const service = setupService();

      const result = await service.listRequests(ctx, {}, {});

      expect(result.data.items).toHaveLength(20);
      expect(result.data.pagination).toMatchObject({ perPage: 20, totalPages: 2, currentPage: 1 });
    });

    it('applies the requested sort', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const ctx = mockRequestContext(managerUser, client.cuid) as any;
      await seedRequests(client.cuid, property._id, 25);
      const service = setupService();

      const oldestFirst = await service.listRequests(
        ctx,
        {},
        { page: 1, limit: 5, sort: 'createdAt' }
      );
      const titleDesc = await service.listRequests(ctx, {}, { page: 1, limit: 5, sort: '-title' });

      expect(oldestFirst.data.items[0].title).toBe('Request 00');
      expect(titleDesc.data.items[0].title).toBe('Request 24');
    });
  });

  describe('staff visibility (assigned technician, assigned by them, or created by them)', () => {
    const insertRequest = (cuid: string, propertyId: Types.ObjectId, extra: object) =>
      MaintenanceRequest.create({
        cuid,
        propertyId,
        title: 'Staff visibility request',
        description: { text: 'Staff visibility request description' },
        category: MaintenanceCategory.GENERAL,
        priority: MaintenanceRequestPriority.MEDIUM,
        status: MaintenanceRequestStatus.IN_PROGRESS,
        permissionToEnter: true,
        ...extra,
      });

    it('lists and opens only requests where the staff member is the technician or the assigner', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, {
        roles: [ROLES.STAFF],
        email: 'staff-visibility@test.com',
      });
      const otherStaff = await createTestUser(client.cuid, {
        roles: [ROLES.STAFF],
        email: 'other-staff-visibility@test.com',
      });
      const ctx = mockRequestContext(staff, client.cuid) as any;

      const asTechnician = await insertRequest(client.cuid, property._id, {
        title: 'Fix the boiler',
        assignedTechnician: { userId: staff._id, name: 'Staff Tech' },
      });
      const assignedByStaff = await insertRequest(client.cuid, property._id, {
        title: 'Fix the fence',
        assignedBy: staff._id,
      });
      const someoneElses = await insertRequest(client.cuid, property._id, {
        title: 'Fix the boiler too',
        assignedBy: otherStaff._id,
        assignedTechnician: { userId: otherStaff._id, name: 'Other Tech' },
      });
      const service = setupService();

      const listed = await service.listRequests(ctx, {}, { page: 1, limit: 10 });
      expect(listed.data.items.map((i: any) => i.mruid).sort()).toEqual(
        [asTechnician.mruid, assignedByStaff.mruid].sort()
      );

      // A search adds its own $or — it must not replace the visibility filter
      const searched = await service.listRequests(
        ctx,
        { search: 'boiler' },
        { page: 1, limit: 10 }
      );
      expect(searched.data.items.map((i: any) => i.mruid)).toEqual([asTechnician.mruid]);

      await expect(service.getRequest(ctx, asTechnician.mruid)).resolves.toMatchObject({
        success: true,
      });
      await expect(service.getRequest(ctx, assignedByStaff.mruid)).resolves.toMatchObject({
        success: true,
      });
      await expect(service.getRequest(ctx, someoneElses.mruid)).rejects.toThrow();
    });

    it('lists and opens requests the staff member created, but not ones other staff created', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, {
        roles: [ROLES.STAFF],
        email: 'staff-creator@test.com',
      });
      const otherStaff = await createTestUser(client.cuid, {
        roles: [ROLES.STAFF],
        email: 'other-staff-creator@test.com',
      });
      const service = setupService();
      const ctx = mockRequestContext(staff, client.cuid) as any;
      const otherCtx = mockRequestContext(otherStaff, client.cuid) as any;
      const newRequest = (title: string) => ({
        pid: property.pid,
        title,
        description: { text: `${title} — reported during a walkthrough` },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      const created = await service.createRequest(ctx, newRequest('Hallway light out'));
      const createdByOther = await service.createRequest(otherCtx, newRequest('Lobby door stuck'));

      const listed = await service.listRequests(ctx, {}, { page: 1, limit: 10 });
      expect(listed.data.items.map((i: any) => i.mruid)).toEqual([created.data.mruid]);

      await expect(service.getRequest(ctx, created.data.mruid)).resolves.toMatchObject({
        success: true,
      });
      await expect(service.getRequest(ctx, createdByOther.data.mruid)).rejects.toThrow();
    });
  });

  describe('getRequest', () => {
    it('should return a single maintenance request by mruid', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const created = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Get by mruid test',
        description: { text: 'Testing getRequest by mruid functionality' },
        category: MaintenanceCategory.HVAC,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.getRequest(ctx, created.data.mruid);

      expect(result.success).toBe(true);
      expect(result.data.mruid).toBe(created.data.mruid);
      expect(result.data.title).toBe('Get by mruid test');
    });

    it('should throw NotFoundError for non-existent mruid', async () => {
      const client = await createTestClient();
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      await expect(service.getRequest(ctx, 'nonexistent-mruid')).rejects.toThrow();
    });
  });

  describe('assignVendor', () => {
    it('should assign vendor by vuid and transition status to assigned', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const created = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Assign vendor test',
        description: { text: 'Request that will be assigned to a vendor' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.assignVendor(ctx, created.data.mruid, {
        vuid: vendorRecord.vuid,
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(MaintenanceRequestStatus.ASSIGNED);
      expect(result.data.vendorId?.toString()).toBe(vendorUser._id.toString());
    });

    it('should throw NotFoundError when vendor vuid does not exist', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const created = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Assign nonexistent vendor',
        description: { text: 'Attempting to assign vendor with invalid vuid' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      await expect(
        service.assignVendor(ctx, created.data.mruid, { vuid: 'nonexistent-vuid' })
      ).rejects.toThrow();
    });

    it('should set scheduledDate when provided', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;
      const scheduled = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

      const created = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Scheduled vendor assignment',
        description: { text: 'Request with specific scheduled date for vendor' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.assignVendor(ctx, created.data.mruid, {
        vuid: vendorRecord.vuid,
        scheduledDate: scheduled,
      });

      expect(result.success).toBe(true);
      expect(result.data.scheduledDate).toBeDefined();
    });

    it('should store estimatedCost in cents when given dollars', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const created = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Vendor assignment with budget',
        description: { text: 'Request assigned with an estimated budget in dollars' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });

      await service.assignVendor(ctx, created.data.mruid, {
        vuid: vendorRecord.vuid,
        estimatedCost: 250.5,
      });

      const stored = await MaintenanceRequest.findOne({ mruid: created.data.mruid }).lean();
      expect(stored?.estimatedCost).toBe(25050);
    });
  });

  describe('acceptAssignment / declineAssignment', () => {
    const setupAssignedRequest = async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Technician selection test',
        description: { text: 'Request to test technician selection on accept' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });

      return { client, service, vendorCtx, vendorRecord, vendorUser, mruid: created.data.mruid };
    };

    it('assigns the selected team member as technician on accept', async () => {
      const { client, service, vendorCtx, vendorRecord, mruid } = await setupAssignedRequest();
      const teamMember = await createTestUser(client.cuid, {
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.VENDOR],
            isConnected: true,
            clientDisplayName: 'Vendor Tech',
            linkedVendorUid: vendorRecord.vuid,
          },
        ] as any,
      });

      await service.acceptAssignment(vendorCtx, mruid, {
        action: 'accept',
        technician: { name: 'Team Tech', userId: teamMember._id.toString() },
      });

      const stored = await MaintenanceRequest.findOne({ mruid }).lean();
      expect(stored?.assignedTechnician?.userId?.toString()).toBe(teamMember._id.toString());
      expect(stored?.assignedTechnician?.name).toBe('Team Tech');
    });

    it('rejects a technician who is not on the vendor team', async () => {
      const { client, service, vendorCtx, mruid } = await setupAssignedRequest();
      const otherVendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const otherVendor = await createTestVendor(client.cuid, otherVendorUser._id);
      const outsider = await createTestUser(client.cuid, {
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.VENDOR],
            isConnected: true,
            clientDisplayName: 'Vendor Tech',
            linkedVendorUid: otherVendor.vuid,
          },
        ] as any,
      });

      await expect(
        service.acceptAssignment(vendorCtx, mruid, {
          action: 'accept',
          technician: { name: 'Outsider', userId: outsider._id.toString() },
        })
      ).rejects.toThrow('Selected technician is not a member of your team');

      const stored = await MaintenanceRequest.findOne({ mruid }).lean();
      expect(stored?.status).toBe(MaintenanceRequestStatus.ASSIGNED);
    });

    it('accepts the primary vendor user as technician', async () => {
      const { service, vendorCtx, vendorUser, mruid } = await setupAssignedRequest();

      await service.acceptAssignment(vendorCtx, mruid, {
        action: 'accept',
        technician: { name: 'Owner', userId: vendorUser._id.toString() },
      });

      const stored = await MaintenanceRequest.findOne({ mruid }).lean();
      expect(stored?.assignedTechnician?.userId?.toString()).toBe(vendorUser._id.toString());
    });

    it('vendor should accept assignment and transition to in_progress', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Accept assignment test',
        description: { text: 'Request to test vendor acceptance workflow' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });

      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });

      const result = await service.acceptAssignment(vendorCtx, created.data.mruid, {
        action: 'accept',
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(MaintenanceRequestStatus.IN_PROGRESS);
    });

    it('vendor should decline assignment and return request to open', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Decline assignment test',
        description: { text: 'Request to test vendor decline workflow' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });
      const result = await service.declineAssignment(vendorCtx, created.data.mruid, {
        reason: 'Schedule conflict',
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(MaintenanceRequestStatus.OPEN);
      expect(result.data.vendorId).toBeUndefined();
    });

    it('wrong vendor cannot accept assignment', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser1 = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorUser2 = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord1 = await createTestVendor(client.cuid, vendorUser1._id);
      await createTestVendor(client.cuid, vendorUser2._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendor2Ctx = mockRequestContext(vendorUser2, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Wrong vendor test',
        description: { text: 'Testing that wrong vendor cannot accept assignment' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord1.vuid });

      await expect(
        service.acceptAssignment(vendor2Ctx, created.data.mruid, { action: 'accept' })
      ).rejects.toThrow();
    });
  });

  describe('respondToAssignment', () => {
    it('should accept assignment via unified method and transition to in_progress', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Unified accept test',
        description: { text: 'Testing unified respondToAssignment accept path' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });

      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });

      const result = await service.respondToAssignment(vendorCtx, created.data.mruid, {
        action: 'accept',
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(MaintenanceRequestStatus.IN_PROGRESS);
    });

    it('should decline assignment via unified method and return request to open', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Unified decline test',
        description: { text: 'Testing unified respondToAssignment decline path' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });

      const result = await service.respondToAssignment(vendorCtx, created.data.mruid, {
        action: 'decline',
        reason: 'Schedule conflict',
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(MaintenanceRequestStatus.OPEN);
      expect(result.data.vendorId).toBeUndefined();
    });
  });

  describe('reviewInvoice', () => {
    it('should approve invoice via unified method', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Unified invoice approve test',
        description: { text: 'Testing unified reviewInvoice approve path' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });
      await service.acceptAssignment(vendorCtx, created.data.mruid, { action: 'accept' });

      // Work order must be submitted and approved before invoice submission
      await (service as any).maintenanceInvoiceService.submitWorkOrder(
        vendorCtx,
        created.data.mruid,
        {
          scope: 'Fixed the plumbing issue',
          estimatedCostInCents: 30000,
        }
      );
      await (service as any).maintenanceInvoiceService.reviewWorkOrder(
        managerCtx,
        created.data.mruid,
        {
          action: 'approve',
        }
      );

      await (service as any).maintenanceInvoiceService.submitInvoice(
        vendorCtx,
        created.data.mruid,
        {
          amount: 30000,
          description: 'Fixed the issue',
        }
      );

      const result = await (service as any).maintenanceInvoiceService.reviewInvoice(
        managerCtx,
        created.data.mruid,
        {
          action: 'approve',
          isBillable: true,
        }
      );

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(InvoiceStatus.APPROVED);
    });

    it('should reject invoice via unified method', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Unified invoice reject test',
        description: { text: 'Testing unified reviewInvoice reject path' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });
      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });
      await service.acceptAssignment(vendorCtx, created.data.mruid, { action: 'accept' });

      // Work order must be submitted and approved before invoice submission
      await (service as any).maintenanceInvoiceService.submitWorkOrder(
        vendorCtx,
        created.data.mruid,
        {
          scope: 'Extensive electrical work needed',
          estimatedCostInCents: 90000,
        }
      );
      await (service as any).maintenanceInvoiceService.reviewWorkOrder(
        managerCtx,
        created.data.mruid,
        {
          action: 'approve',
        }
      );

      await (service as any).maintenanceInvoiceService.submitInvoice(
        vendorCtx,
        created.data.mruid,
        {
          amount: 90000,
          description: 'Extensive electrical work',
        }
      );

      const result = await (service as any).maintenanceInvoiceService.reviewInvoice(
        managerCtx,
        created.data.mruid,
        {
          action: 'reject',
          rejectionReason: 'Amount exceeds pre-approved budget',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(InvoiceStatus.REJECTED);
      expect(result.data.review.rejectionReason).toBe('Amount exceeds pre-approved budget');
    });
  });

  describe('submitInvoice / approveInvoice / rejectInvoice', () => {
    it('persists the invoice attachment', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Invoice attachment test',
        description: { text: 'Request to test invoice attachment persistence' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });
      await service.acceptAssignment(vendorCtx, created.data.mruid, { action: 'accept' });
      await (service as any).maintenanceInvoiceService.submitWorkOrder(
        vendorCtx,
        created.data.mruid,
        { scope: 'Fixed the plumbing issue', estimatedCostInCents: 25000 }
      );
      await (service as any).maintenanceInvoiceService.reviewWorkOrder(
        managerCtx,
        created.data.mruid,
        { action: 'approve' }
      );

      const attachment = {
        url: 'https://bucket.s3.amazonaws.com/invoices/inv-1.pdf',
        key: 'invoices/inv-1.pdf',
      };
      const result = await (service as any).maintenanceInvoiceService.submitInvoice(
        vendorCtx,
        created.data.mruid,
        { amount: 25000, description: 'Fixed the plumbing issue', attachment }
      );

      const stored = await InvoiceModel.findById(result.data._id).lean();
      expect(stored?.attachment).toEqual(attachment);
    });

    it('vendor should submit invoice and manager should approve it', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Invoice approval test',
        description: { text: 'Request to test invoice submission and approval flow' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });
      await service.acceptAssignment(vendorCtx, created.data.mruid, { action: 'accept' });

      // Work order must be submitted and approved before invoice submission
      await (service as any).maintenanceInvoiceService.submitWorkOrder(
        vendorCtx,
        created.data.mruid,
        {
          scope: 'Fixed the plumbing issue',
          estimatedCostInCents: 25000,
        }
      );
      await (service as any).maintenanceInvoiceService.reviewWorkOrder(
        managerCtx,
        created.data.mruid,
        {
          action: 'approve',
        }
      );

      const invoiceResult = await (service as any).maintenanceInvoiceService.submitInvoice(
        vendorCtx,
        created.data.mruid,
        {
          amount: 25000, // $250 in cents
          currency: 'usd',
          description: 'Fixed the plumbing issue',
        }
      );

      expect(invoiceResult.success).toBe(true);
      expect(invoiceResult.data.status).toBe(InvoiceStatus.PENDING);

      const approveResult = await (service as any).maintenanceInvoiceService.approveInvoice(
        managerCtx,
        created.data.mruid
      );

      expect(approveResult.success).toBe(true);
      expect(approveResult.data.status).toBe(InvoiceStatus.APPROVED);
    });

    it('manager should reject invoice with a reason', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Invoice rejection test',
        description: { text: 'Request to test invoice rejection flow' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });
      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });
      await service.acceptAssignment(vendorCtx, created.data.mruid, { action: 'accept' });

      // Work order must be submitted and approved before invoice submission
      await (service as any).maintenanceInvoiceService.submitWorkOrder(
        vendorCtx,
        created.data.mruid,
        {
          scope: 'Electrical repairs needed',
          estimatedCostInCents: 75000,
        }
      );
      await (service as any).maintenanceInvoiceService.reviewWorkOrder(
        managerCtx,
        created.data.mruid,
        {
          action: 'approve',
        }
      );

      await (service as any).maintenanceInvoiceService.submitInvoice(
        vendorCtx,
        created.data.mruid,
        {
          amount: 75000,
          description: 'Electrical repairs',
        }
      );

      const result = await (service as any).maintenanceInvoiceService.rejectInvoice(
        managerCtx,
        created.data.mruid,
        {
          rejectionReason: 'Amount is higher than the pre-approved estimate',
        }
      );

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(InvoiceStatus.REJECTED);
      expect(result.data.review.rejectionReason).toBe(
        'Amount is higher than the pre-approved estimate'
      );
    });
  });

  describe('cancelRequest', () => {
    it('should cancel an open request', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      const created = await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Cancel test request',
        description: { text: 'This request will be cancelled' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.cancelRequest(ctx, created.data.mruid, {
        reason: 'Issue resolved by tenant',
      });

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(MaintenanceRequestStatus.CANCELLED);
    });

    it('should reject invalid status transitions (completed → cancel)', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      // const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      // const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      // const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Invalid transition test',
        description: { text: 'Testing that invalid status transitions are rejected' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });
      // Force status to COMPLETED directly — the full in_progress → awaiting_invoice → completed
      // flow requires work orders and invoices which are tested in dedicated suites.
      await MaintenanceRequest.findOneAndUpdate(
        { mruid: created.data.mruid },
        { $set: { status: MaintenanceRequestStatus.COMPLETED } }
      );

      // completed → cancel is not allowed
      await expect(service.cancelRequest(managerCtx, created.data.mruid, {})).rejects.toThrow();
    });
  });

  describe('getStats', () => {
    it('should return stats for all requests in a client', async () => {
      const client = await createTestClient();
      const property = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Stats test request one',
        description: { text: 'First request for stats testing' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.createRequest(ctx, {
        pid: property.pid,
        title: 'Stats test request two',
        description: { text: 'Second request for stats testing' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.getStats(ctx);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(2);
      expect(result.data.open).toBe(2);
    });

    it('should filter stats by pid', async () => {
      const client = await createTestClient();
      const property1 = await createTestProperty(client.cuid, client._id);
      const property2 = await createTestProperty(client.cuid, client._id);
      const managerUser = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });
      const service = setupService();
      const ctx = mockRequestContext(managerUser, client.cuid) as any;

      await service.createRequest(ctx, {
        pid: property1.pid,
        title: 'Property1 stats request',
        description: { text: 'Stats filtering test for property one' },
        category: MaintenanceCategory.PLUMBING,
        permissionToEnter: true,
        media: [],
      });
      await service.createRequest(ctx, {
        pid: property2.pid,
        title: 'Property2 stats request',
        description: { text: 'Stats filtering test for property two' },
        category: MaintenanceCategory.ELECTRICAL,
        permissionToEnter: true,
        media: [],
      });

      const result = await service.getStats(ctx, property1.pid);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(1);
    });
  });
});
