/* eslint-disable @typescript-eslint/no-unused-vars */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { Application } from 'express';
import { envVariables } from '@shared/config';
import { ROLES } from '@shared/constants/roles.constants';
import { clearTestDatabase } from '@tests/setup/testDatabase';
import { PropertyUnit, Subscription, Property, Lease } from '@models/index';
import { PropertyApprovalStatusEnum } from '@interfaces/property.interface';
import {
  createControllerTestApp,
  createTestProperty,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

// Mock heavy middleware to skip real auth/subscription/file/validation flow
// These mocks are still needed because the DI container imports modules that reference them
jest.mock('@shared/middlewares', () => {
  const actual = jest.requireActual('@shared/middlewares');
  const passthrough = (_req: any, _res: any, next: any) => next();
  const passthroughFactory = () => passthrough;
  return {
    ...actual,
    isAuthenticated: passthrough,
    requireActiveSubscription: passthrough,
    requireNotSuspended: passthrough,
    requireVerification: passthrough,
    subscriptionEntitlements: passthrough,
    idempotency: passthrough,
    diskUpload: passthroughFactory,
    scanFile: passthrough,
    basicLimiter: passthroughFactory,
    requirePermission: passthroughFactory,
    requirePermissionWithContext: () => passthrough,
    requirePropertyPermission: passthroughFactory,
    requireAnyPermission: passthroughFactory,
    requireAllPermissions: passthroughFactory,
    requirePrimaryVendor: passthrough,
    requireVerifiedClient: passthrough,
  };
});

jest.mock('@shared/validations/setup', () => ({
  validateRequest: () => (_req: any, _res: any, next: any) => next(),
}));

// Import DI container
let container: any;
let PropertyController: any;

// Lazy load DI container to avoid initialization issues
beforeAll(async () => {
  const diModule = await import('@di/index');
  container = diModule.container;

  const controllerModule = await import('@controllers/PropertyController');
  PropertyController = controllerModule.PropertyController;
});

describe('PropertyController Integration Tests', () => {
  let app: Application;
  let testClient: any;
  let adminUser: any;
  let staffUser: any;
  let tenantUser: any;

  let setContextUser: ReturnType<typeof createControllerTestApp>['setContextUser'];
  let resetContextOverrides: ReturnType<typeof createControllerTestApp>['resetContextOverrides'];

  // Route path constants
  const ADD_PROPERTY_PATH = '/api/v1/properties/:cuid';
  const CLIENT_PROPERTIES_PATH = '/api/v1/properties/:cuid';
  const CLIENT_PROPERTY_PATH = '/api/v1/properties/:cuid/:pid';
  const UPDATE_PROPERTY_PATH = '/api/v1/properties/:cuid/:pid';
  const APPROVE_PROPERTY_PATH = '/api/v1/properties/:cuid/properties/:pid/approve';
  const REJECT_PROPERTY_PATH = '/api/v1/properties/:cuid/properties/:pid/reject';
  const LEASEABLE_PATH = '/api/v1/properties/:cuid/leaseable';
  const DELETE_PROPERTY_PATH = '/api/v1/properties/:cuid/:pid';

  beforeAll(async () => {
    // Resolve controller from DI container (uses scoped resolution)
    const scope = container.createScope();
    const propertyController = scope.resolve('propertyController') as InstanceType<
      typeof PropertyController
    >;

    const testApp = createControllerTestApp({
      routes: [
        {
          method: 'post',
          path: ADD_PROPERTY_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.create(req, res);
          },
        },
        {
          method: 'get',
          path: CLIENT_PROPERTIES_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.getClientProperties(req, res);
          },
        },
        // Literal 2-segment GET routes must come before the /:cuid/:pid catch-all
        {
          method: 'get',
          path: LEASEABLE_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.getLeaseableProperties(req, res);
          },
        },
        {
          method: 'get',
          path: CLIENT_PROPERTY_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.getProperty(req, res);
          },
        },
        {
          method: 'patch',
          path: UPDATE_PROPERTY_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.updateClientProperty(req, res);
          },
        },
        {
          method: 'post',
          path: APPROVE_PROPERTY_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.approveProperty(req, res);
          },
        },
        {
          method: 'post',
          path: REJECT_PROPERTY_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.rejectProperty(req, res);
          },
        },
        {
          method: 'delete',
          path: DELETE_PROPERTY_PATH,
          contextUser: () => adminUser,
          handler: (req: any, res: any) => {
            req.container = container;
            return propertyController.archiveProperty(req, res);
          },
        },
      ],
    });

    app = testApp.app;
    setContextUser = testApp.setContextUser;
    resetContextOverrides = testApp.resetContextOverrides;

    // Create test data
    testClient = await createTestClient();

    // Create subscription for the client
    await Subscription.create({
      cuid: testClient.cuid,
      client: testClient._id,
      planName: 'portfolio' as any,
      status: 'active' as any,
      startDate: new Date(),
      billingInterval: 'monthly' as any,
      billing: {
        customerId: 'cus_test',
        subscriberId: 'sub_test',
        provider: 'none' as any,
        planId: 'price_test',
      },
      entitlements: {
        eSignature: true,
        maintenanceRequestService: true,
        guestPassService: true,
        reportingAnalytics: true,
        leaseTemplates: true,
        vendorManagement: true,
        smsService: false,
        aiTriage: false,
        aiInvoiceScanning: false,
      },
      totalMonthlyPrice: 4900,
      currentProperties: 0,
      currentUnits: 0,
      currentSeats: 1,
    });

    // Create admin user
    adminUser = await createTestUser(testClient.cuid, {
      roles: [ROLES.ADMIN],
      email: `admin-controller-${Date.now()}@test.com`,
    });
    await createTestProfile(adminUser._id, testClient._id, { type: 'employee' });

    // Create staff user with Operations department
    staffUser = await createTestUser(testClient.cuid, {
      roles: [ROLES.STAFF],
      email: `staff-controller-${Date.now()}@test.com`,
    });
    const staffProfile = await createTestProfile(staffUser._id, testClient._id, {
      type: 'employee',
    });
    await staffProfile.updateOne({
      $set: {
        employeeInfo: {
          department: 'operations',
          jobTitle: 'Property Manager',
        },
      },
    });

    // Create tenant user
    tenantUser = await createTestUser(testClient.cuid, {
      roles: [ROLES.TENANT],
      email: `tenant-controller-${Date.now()}@test.com`,
    });
    await createTestProfile(tenantUser._id, testClient._id, { type: 'tenant' });
  });

  afterAll(async () => {
    await clearTestDatabase();
  });

  beforeEach(async () => {
    resetContextOverrides();
    // Clear only properties, not users/clients
    await Property.deleteMany({});
    await PropertyUnit.deleteMany({});
    await Lease.deleteMany({});
  });

  describe('POST /api/v1/properties/:cuid', () => {
    it('should create property and return 200 (admin user)', async () => {
      const propertyData = {
        name: `Test Property ${Date.now()}`,
        propertyType: 'apartment',
        maxAllowedUnits: 10,
        fullAddress: '123 Main St, New York, NY 10001',
        address: {
          street: '123 Main St',
          streetNumber: '123',
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
          rentAmount: '850',
          currency: 'USD',
        },
        occupancyStatus: 'vacant',
        computedLocation: {
          type: 'Point',
          coordinates: [-74.006, 40.7128],
        },
      };

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}`)
        .send(propertyData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.name).toBe(propertyData.name);
      expect(response.body.data.pid).toBeDefined();
      expect(response.body.data.approvalStatus).toBe(PropertyApprovalStatusEnum.APPROVED);

      // Verify in database
      const savedProperty = await Property.findOne({ pid: response.body.data.pid });
      expect(savedProperty).not.toBeNull();
      expect(savedProperty!.cuid).toBe(testClient.cuid);
    });

    it('should return 401 when not authenticated', async () => {
      setContextUser(ADD_PROPERTY_PATH, null, 'post');

      const propertyData = {
        name: 'Unauthorized Property',
        propertyType: 'apartment',
        maxAllowedUnits: 5,
      };

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}`)
        .send(propertyData);

      // The controller reads req.context.currentuser — when null, it should error
      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/properties/:cuid', () => {
    beforeEach(async () => {
      // Create test properties
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Apartment Complex A',
        propertyType: 'apartment',
      });
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Single Family Home',
        propertyType: 'house',
      });
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Commercial Building',
        propertyType: 'commercial',
      });

      // Approve all properties
      await Property.updateMany(
        { cuid: testClient.cuid },
        { approvalStatus: PropertyApprovalStatusEnum.APPROVED }
      );
    });

    it('should return all properties for client', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}`)
        .query({ 'pagination[page]': 1, 'pagination[limit]': 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(3);
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.total).toBe(3);
    });

    it('should filter properties by type', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}`)
        .query({
          'pagination[page]': 1,
          'pagination[limit]': 10,
          'filter[propertyType]': 'apartment',
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(1);
      expect(response.body.data.items[0].propertyType).toBe('apartment');
    });
  });

  describe('GET /api/v1/properties/:cuid/:pid', () => {
    let testProperty: any;

    beforeEach(async () => {
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Test Property for Get',
        propertyType: 'apartment',
      });
      await Property.findByIdAndUpdate(testProperty._id, {
        approvalStatus: PropertyApprovalStatusEnum.APPROVED,
      });
    });

    it('should return single property with details', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.property).toBeDefined();
      expect(response.body.data.property.pid).toBe(testProperty.pid);
      expect(response.body.data.property.name).toBe('Test Property for Get');
    });

    it('should return 404 for non-existent property', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}/non-existent-pid`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /api/v1/properties/:cuid/:pid', () => {
    let testProperty: any;

    beforeEach(async () => {
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Original Property Name',
      });
      await Property.findByIdAndUpdate(testProperty._id, {
        approvalStatus: PropertyApprovalStatusEnum.APPROVED,
      });
    });

    it('should update property directly (admin user)', async () => {
      const updateData = {
        name: 'Updated Property Name',
        description: {
          text: 'Updated description',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Updated Property Name');

      // Verify database update
      const updatedProperty = await Property.findById(testProperty._id);
      expect(updatedProperty!.name).toBe('Updated Property Name');
      expect(updatedProperty!.approvalStatus).toBe('approved');
    });

    it('should return 404 for non-existent property', async () => {
      const updateData = { name: 'Non-existent Property' };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/non-existent-pid`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should successfully add notes to property', async () => {
      const updateData = {
        notes: [
          {
            text: 'This is a test note',
            html: '<p>This is a test note</p>',
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin User',
            },
            createdAt: new Date().toISOString(),
          },
          {
            text: 'Another important note about the property',
            html: '<p>Another important note about the property</p>',
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin User',
            },
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.notes).toBeDefined();
      expect(response.body.data.notes.length).toBe(2);
      expect(response.body.data.notes[0].text).toBe('This is a test note');
      expect(response.body.data.notes[1].text).toBe('Another important note about the property');

      // Verify database update
      const updatedProperty = await Property.findById(testProperty._id);
      expect(updatedProperty!.notes).toBeDefined();
      expect(updatedProperty!.notes!.length).toBe(2);
    });

    it('should handle notes with long text (validation delegated to middleware)', async () => {
      const longText = 'a'.repeat(500);
      const updateData = {
        notes: [
          {
            text: longText,
            html: `<p>${longText}</p>`,
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin User',
            },
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.notes).toBeDefined();
      expect(response.body.data.notes[0].text).toBe(longText);
    });

    it('should accept notes with minimal author information', async () => {
      const updateData = {
        notes: [
          {
            text: 'Note with minimal author',
            html: '<p>Note with minimal author</p>',
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin',
            },
          },
        ],
      };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
    });

    it('should update existing notes', async () => {
      // First add a note
      await Property.findByIdAndUpdate(testProperty._id, {
        notes: [
          {
            text: 'Original note',
            html: '<p>Original note</p>',
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin User',
            },
            createdAt: new Date(),
          },
        ],
      });

      // Then update with new notes
      const updateData = {
        notes: [
          {
            text: 'Updated note',
            html: '<p>Updated note</p>',
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin User',
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.notes.length).toBe(1);
      expect(response.body.data.notes[0].text).toBe('Updated note');
      expect(response.body.data.notes[0].updatedAt).toBeDefined();
    });
  });

  describe('POST /api/v1/properties/:cuid/properties/:pid/approve', () => {
    let pendingProperty: any;

    beforeEach(async () => {
      pendingProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Pending Property',
      });
      await Property.findByIdAndUpdate(pendingProperty._id, {
        approvalStatus: PropertyApprovalStatusEnum.PENDING,
        pendingChanges: {
          name: 'Approved Name',
          updatedBy: staffUser._id,
          updatedAt: new Date(),
          displayName: `${staffUser.firstName} ${staffUser.lastName}`,
        },
      });
    });

    it('should approve property and apply pending changes', async () => {
      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/properties/${pendingProperty.pid}/approve`)
        .send({ notes: 'Looks good' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.name).toBe('Approved Name');

      // Verify database state
      const approvedProperty = await Property.findById(pendingProperty._id);
      expect(approvedProperty!.approvalStatus).toBe('approved');
      expect(approvedProperty!.pendingChanges).toBeNull();
      expect(approvedProperty!.name).toBe('Approved Name');
    });

    it('should return error when unauthenticated user tries to approve', async () => {
      setContextUser(APPROVE_PROPERTY_PATH, null, 'post');

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/properties/${pendingProperty.pid}/approve`)
        .send({ notes: 'Trying to approve' });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /api/v1/properties/:cuid/properties/:pid/reject', () => {
    let pendingProperty: any;

    beforeEach(async () => {
      pendingProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Property to Reject',
      });
      await Property.findByIdAndUpdate(pendingProperty._id, {
        approvalStatus: PropertyApprovalStatusEnum.PENDING,
        pendingChanges: {
          name: 'Rejected Name',
          updatedBy: staffUser._id,
          updatedAt: new Date(),
        },
      });
    });

    it('should reject property and clear pending changes', async () => {
      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/properties/${pendingProperty.pid}/reject`)
        .send({ reason: 'Does not meet standards' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('preserved');

      // Verify database state
      const rejectedProperty = await Property.findById(pendingProperty._id);
      expect(rejectedProperty!.name).toBe('Property to Reject'); // Original name
      expect(rejectedProperty!.pendingChanges).toBeNull();
    });

    it('should return 400 when reason is missing', async () => {
      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/properties/${pendingProperty.pid}/reject`)
        .send({ reason: '' })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/properties/:cuid/leaseable', () => {
    beforeEach(async () => {
      // Create available properties
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Available Property 1',
        propertyType: 'apartment',
      });
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Available Property 2',
        propertyType: 'house',
      });

      // Approve all properties
      await Property.updateMany(
        { cuid: testClient.cuid },
        { status: 'available', approvalStatus: PropertyApprovalStatusEnum.APPROVED }
      );
    });

    it('should return available properties for leasing', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}/leaseable`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThan(0);
      expect(response.body.data.metadata).toBeDefined();
    });
  });

  describe('DELETE /api/v1/properties/:cuid/:pid', () => {
    let testProperty: any;

    beforeEach(async () => {
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Property to Archive',
      });
    });

    it('should archive property without active leases', async () => {
      const response = await request(app)
        .delete(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .expect(200);

      expect(response.body.success).toBe(true);

      // Verify property is archived (soft delete via deletedAt)
      const archivedProperty = await Property.findById(testProperty._id);
      expect(archivedProperty!.deletedAt).toBeDefined();
      expect(archivedProperty!.deletedAt).not.toBeNull();
    });
  });

  describe('Authorization Tests', () => {
    let testProperty: any;

    beforeEach(async () => {
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Authorization Test Property',
      });
    });

    it('should deny unauthenticated access to create property', async () => {
      setContextUser(ADD_PROPERTY_PATH, null, 'post');

      const propertyData = {
        name: 'Unauthenticated Property',
        propertyType: 'apartment',
        maxAllowedUnits: 5,
      };

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}`)
        .send(propertyData);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });

    it('should deny unauthenticated access to approve property', async () => {
      setContextUser(APPROVE_PROPERTY_PATH, null, 'post');

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/properties/${testProperty.pid}/approve`)
        .send({ notes: 'Approval attempt' });

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });

    it('should successfully add notes with HTML content', async () => {
      const updateData = {
        notes: [
          {
            text: 'First note about the property',
            html: '<p>First note about the <b>property</b></p>',
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin User',
            },
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.notes).toBeDefined();
      expect(response.body.data.notes.length).toBe(1);
      expect(response.body.data.notes[0].text).toBe('First note about the property');
      expect(response.body.data.notes[0].html).toBe('<p>First note about the <b>property</b></p>');
    });

    it('should accept notes with HTML content of reasonable length', async () => {
      const updateData = {
        notes: [
          {
            text: 'Note with HTML',
            html: '<p>Some HTML content</p>',
            author: {
              uid: adminUser._id.toString(),
              name: 'Admin User',
            },
            createdAt: new Date().toISOString(),
          },
        ],
      };

      const response = await request(app)
        .patch(`/api/v1/properties/${testClient.cuid}/${testProperty.pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.notes).toBeDefined();
    });
  });
});
