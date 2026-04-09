import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { VendorDAO } from '@dao/vendorDAO';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';
import {
  MaintenanceCategory,
  MaintenanceRequestPriority,
  MaintenanceRequestStatus,
  InvoiceStatus,
} from '@interfaces/maintenanceRequest.interface';
import { ROLES } from '@shared/constants/roles.constants';
import {
  MaintenanceRequestModel,
  Property,
  PropertyUnit,
  User,
  Lease,
  Vendor,
} from '@models/index';
import {
  clearTestDatabase,
  createTestClient,
  createTestProperty,
  createTestPropertyUnit,
  createTestUser,
  createTestVendor,
  setupAllExternalMocks,
} from '../../helpers';
import { mockQueueFactory } from '../../setup/externalMocks';
import { mockRequestContext } from '../../helpers/mockRequestContext';
import { beforeAll, beforeEach, afterAll, describe, expect, it } from '@jest/globals';
import { setupTestDatabase, disconnectTestDatabase } from '../../setup/testDatabase';

const setupService = () => {
  const userDAO = new UserDAO({ userModel: User });
  const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
  const propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
  const leaseDAO = new LeaseDAO({ leaseModel: Lease });
  const vendorDAO = new VendorDAO({ vendorModel: Vendor });
  const maintenanceRequestDAO = new MaintenanceRequestDAO({
    maintenanceRequestModel: MaintenanceRequestModel,
  });

  const eventsRegistry = {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    getEventLog: jest.fn().mockResolvedValue([]),
    registerEvent: jest.fn().mockResolvedValue(undefined),
  } as any;

  const emitterService = new EventEmitterService({ eventsRegistry });
  const emailQueue = mockQueueFactory.getQueue('email');

  return new MaintenanceRequestService({
    maintenanceRequestDAO,
    propertyDAO,
    propertyUnitDAO,
    userDAO,
    leaseDAO,
    vendorDAO,
    emailQueue: emailQueue as any,
    emitterService,
  });
};

/**
 * Create a minimal valid Lease for a tenant on a property.
 * The Lease model requires: cuid, tenantId, property.id, property.address,
 * duration.startDate/endDate, fees.monthlyRent/securityDeposit/acceptedPaymentMethod/currency
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
      monthlyRent: 150000,
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
          monthlyRent: 150000,
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
      expect(result.data.items[0].propertyId.toString()).toBe(property1._id.toString());
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
      expect(result.data.items[0].tenantId?.toString()).toBe(tenant1._id.toString());
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
  });

  describe('acceptAssignment / declineAssignment', () => {
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

      const result = await service.acceptAssignment(vendorCtx, created.data.mruid, { action: 'accept' });

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

      await expect(service.acceptAssignment(vendor2Ctx, created.data.mruid, { action: 'accept' })).rejects.toThrow();
    });
  });

  describe('submitInvoice / approveInvoice / rejectInvoice', () => {
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

      const invoiceResult = await service.submitInvoice(vendorCtx, created.data.mruid, {
        amount: 25000, // $250 in cents
        currency: 'usd',
        description: 'Fixed the plumbing issue',
      });

      expect(invoiceResult.success).toBe(true);
      expect(invoiceResult.data.invoice.status).toBe(InvoiceStatus.PENDING);

      const approveResult = await service.approveInvoice(managerCtx, created.data.mruid);

      expect(approveResult.success).toBe(true);
      expect(approveResult.data.invoice.status).toBe(InvoiceStatus.APPROVED);
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
      await service.submitInvoice(vendorCtx, created.data.mruid, {
        amount: 75000,
        description: 'Electrical repairs',
      });

      const result = await service.rejectInvoice(managerCtx, created.data.mruid, {
        rejectionReason: 'Amount is higher than the pre-approved estimate',
      });

      expect(result.success).toBe(true);
      expect(result.data.invoice.status).toBe(InvoiceStatus.REJECTED);
      expect(result.data.invoice.rejectionReason).toBe(
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
      const vendorUser = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });
      const vendorRecord = await createTestVendor(client.cuid, vendorUser._id);

      const service = setupService();
      const managerCtx = mockRequestContext(managerUser, client.cuid) as any;
      const vendorCtx = mockRequestContext(vendorUser, client.cuid) as any;

      const created = await service.createRequest(managerCtx, {
        pid: property.pid,
        title: 'Invalid transition test',
        description: { text: 'Testing that invalid status transitions are rejected' },
        category: MaintenanceCategory.GENERAL,
        permissionToEnter: true,
        media: [],
      });
      await service.assignVendor(managerCtx, created.data.mruid, { vuid: vendorRecord.vuid });
      await service.acceptAssignment(vendorCtx, created.data.mruid, { action: 'accept' });
      await service.completeRequest(vendorCtx, created.data.mruid, {});

      // completed → cancel is not allowed
      await expect(
        service.cancelRequest(managerCtx, created.data.mruid, {})
      ).rejects.toThrow();
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
