/* eslint-disable @typescript-eslint/no-unused-vars */
import jwt from 'jsonwebtoken';
import request from 'supertest';
import { envVariables } from '@shared/config';
import { ROLES } from '@shared/constants/roles.constants';
import { PropertyUnit, Property, Lease } from '@models/index';
import { PropertyApprovalStatusEnum } from '@interfaces/property.interface';
import express, { NextFunction, Application, Response, Request } from 'express';
import {
  disconnectTestDatabase,
  setupTestDatabase,
  clearTestDatabase,
} from '@tests/setup/testDatabase';
import {
  createTestProperty,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/setup/testFactories';

// Import DI container and services
let container: any;
let PropertyController: any;
let propertyRoutes: any;

// Lazy load DI container to avoid initialization issues
beforeAll(async () => {
  // Import container after test environment is set up
  const diModule = await import('@di/index');
  container = diModule.container;

  // Import controller and routes
  const controllerModule = await import('@controllers/PropertyController');
  PropertyController = controllerModule.PropertyController;

  const routesModule = await import('@routes/property.routes');
  propertyRoutes = routesModule.default;
});

describe('PropertyController Integration Tests', () => {
  let app: Application;
  let testClient: any;
  let adminUser: any;
  let staffUser: any;
  let tenantUser: any;
  let adminToken: string;
  let tenantToken: string;

  // Helper to generate JWT tokens for testing
  const generateTestToken = (userId: string, cuid: string): string => {
    const payload = {
      data: {
        sub: userId,
        cuid,
        rememberMe: false,
      },
    };
    return jwt.sign(payload, envVariables.JWT.SECRET, { expiresIn: '1h' });
  };

  // Mock container resolver middleware
  const containerMiddleware = (req: Request, _res: Response, next: NextFunction) => {
    (req as any).container = container;
    next();
  };

  // Mock context builder middleware
  const mockContextBuilder = (req: Request, _res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    let currentuser = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded: any = jwt.verify(token, envVariables.JWT.SECRET);
        const userId = decoded.data.sub;
        const cuid = decoded.data.cuid;

        // Find user to get role
        let role: string = ROLES.STAFF;
        if (userId === adminUser?._id.toString()) {
          role = ROLES.ADMIN;
        } else if (userId === tenantUser?._id.toString()) {
          role = ROLES.TENANT;
        }

        currentuser = {
          sub: userId,
          displayName: 'Test User',
          fullname: 'Test User',
          client: { cuid, role },
        };
      } catch (error) {
        // Invalid token, leave currentuser as null
      }
    }

    (req as any).context = {
      currentuser,
      request: {
        params: req.params,
        url: req.url,
        method: req.method,
        path: req.path,
        query: req.query,
      },
      userAgent: {
        browser: 'Chrome',
        version: '120.0',
        os: 'MacOS',
        raw: 'test',
        isMobile: false,
        isBot: false,
      },
      langSetting: { lang: 'en', t: (key: string) => key },
      timing: { startTime: Date.now() },
      service: { env: 'test' },
      source: 'WEB',
      requestId: 'req-test-123',
      timestamp: new Date(),
    };
    next();
  };

  beforeAll(async () => {
    await setupTestDatabase();

    // Setup Express app with minimal middleware
    app = express();
    app.use(express.json({ limit: '200mb' }));
    app.use(express.urlencoded({ extended: true, limit: '200mb' }));
    app.use(containerMiddleware);
    app.use(mockContextBuilder);

    // Mount property routes
    app.use('/api/v1/properties', propertyRoutes);

    // Error handler
    app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
      res.status(err.statusCode || 500).json({
        success: false,
        message: err.message || 'Internal Server Error',
        errorInfo: err.errorInfo || undefined,
      });
    });

    // Create test data
    testClient = await createTestClient();

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

    // Generate tokens
    adminToken = generateTestToken(adminUser._id.toString(), testClient.cuid);
    tenantToken = generateTestToken(tenantUser._id.toString(), testClient.cuid);
  });

  afterAll(async () => {
    await clearTestDatabase();
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    // Clear only properties, not users/clients
    await Property.deleteMany({});
    await PropertyUnit.deleteMany({});
    await Lease.deleteMany({});
  });

  describe('POST /api/v1/properties/:cuid/add_property', () => {
    it('should create property and return 200 (admin user)', async () => {
      const propertyData = {
        name: `Test Property ${Date.now()}`,
        propertyType: 'apartment',
        maxAllowedUnits: 10,
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
        occupancyStatus: 'vacant',
        computedLocation: {
          type: 'Point',
          coordinates: [-74.006, 40.7128],
        },
      };

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/add_property`)
        .set('Authorization', `Bearer ${adminToken}`)
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
      const propertyData = {
        name: 'Unauthorized Property',
        propertyType: 'apartment',
        maxAllowedUnits: 5,
      };

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/add_property`)
        .send(propertyData)
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/properties/:cuid/client_properties', () => {
    beforeEach(async () => {
      // Create test properties
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Apartment Complex A',
        propertyType: 'apartment',
        status: 'active',
      });
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Single Family Home',
        propertyType: 'single_family',
        status: 'active',
      });
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Commercial Building',
        propertyType: 'commercial',
        status: 'active',
      });

      // Approve all properties
      await Property.updateMany(
        { cuid: testClient.cuid },
        { approvalStatus: PropertyApprovalStatusEnum.APPROVED }
      );
    });

    it('should return all properties for client', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}/client_properties`)
        .set('Authorization', `Bearer ${adminToken}`)
        .query({ 'pagination[page]': 1, 'pagination[limit]': 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(3);
      expect(response.body.data.pagination).toBeDefined();
      expect(response.body.data.pagination.total).toBe(3);
    });

    it('should filter properties by type', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}/client_properties`)
        .set('Authorization', `Bearer ${adminToken}`)
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

  describe('GET /api/v1/properties/:cuid/client_property/:pid', () => {
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
        .get(`/api/v1/properties/${testClient.cuid}/client_property/${testProperty.pid}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.property).toBeDefined();
      expect(response.body.data.property.pid).toBe(testProperty.pid);
      expect(response.body.data.property.name).toBe('Test Property for Get');
    });

    it('should return 404 for non-existent property', async () => {
      const response = await request(app)
        .get(`/api/v1/properties/${testClient.cuid}/client_property/non-existent-pid`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /api/v1/properties/:cuid/client_properties/:pid', () => {
    let testProperty: any;

    beforeEach(async () => {
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Original Property Name',
        status: 'active',
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
        .patch(`/api/v1/properties/${testClient.cuid}/client_properties/${testProperty.pid}`)
        .set('Authorization', `Bearer ${adminToken}`)
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
        .patch(`/api/v1/properties/${testClient.cuid}/client_properties/non-existent-pid`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
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
        .set('Authorization', `Bearer ${adminToken}`)
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

    it('should return 403 when non-admin tries to approve', async () => {
      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/properties/${pendingProperty.pid}/approve`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ notes: 'Trying to approve' })
        .expect(403);

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
        .set('Authorization', `Bearer ${adminToken}`)
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
        .set('Authorization', `Bearer ${adminToken}`)
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
        status: 'active',
      });
      await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Available Property 2',
        propertyType: 'single_family',
        status: 'active',
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
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThan(0);
      expect(response.body.data.metadata).toBeDefined();
    });
  });

  describe('DELETE /api/v1/properties/:cuid/delete_properties/:pid', () => {
    let testProperty: any;

    beforeEach(async () => {
      testProperty = await createTestProperty(testClient.cuid, testClient._id, {
        name: 'Property to Archive',
      });
    });

    it('should archive property without active leases', async () => {
      const response = await request(app)
        .delete(`/api/v1/properties/${testClient.cuid}/delete_properties/${testProperty.pid}`)
        .set('Authorization', `Bearer ${adminToken}`)
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

    it('should deny tenant access to create property', async () => {
      const propertyData = {
        name: 'Tenant Property',
        propertyType: 'apartment',
        maxAllowedUnits: 5,
      };

      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/add_property`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send(propertyData)
        .expect(403);

      expect(response.body.success).toBe(false);
    });

    it('should deny tenant access to approve property', async () => {
      const response = await request(app)
        .post(`/api/v1/properties/${testClient.cuid}/properties/${testProperty.pid}/approve`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send({ notes: 'Approval attempt' })
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });
});
