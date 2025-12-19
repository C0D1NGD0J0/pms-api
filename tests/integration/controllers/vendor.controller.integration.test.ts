import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { ROLES } from '@shared/constants/roles.constants';
import { Profile, Client, Vendor, User } from '@models/index';
import { VendorService } from '@services/vendor/vendor.service';
import { VendorController } from '@controllers/VendorController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { ProfileDAO, ClientDAO, VendorDAO, UserDAO } from '@dao/index';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { disconnectTestDatabase, setupTestDatabase, clearTestDatabase } from '@tests/helpers';
import { createTestProfile, createTestClient, createTestUser } from '@tests/setup/testFactories';

describe('VendorController Integration Tests', () => {
  let app: Application;
  let vendorController: VendorController;
  let testClient: any;
  let adminUser: any;
  let vendorUser: any;
  let testVendor: any;

  const mockContext = (user: any, cuid: string) => ({
    currentuser: {
      sub: user._id.toString(),
      uid: user.uid,
      email: user.email,
      activecuid: cuid,
      client: {
        cuid,
        role: user.cuids.find((c: any) => c.cuid === cuid)?.roles[0] || ROLES.STAFF,
      },
    },
  });

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();

    // Initialize DAOs
    const userDAO = new UserDAO({ userModel: User });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });
    const vendorDAO = new VendorDAO({ vendorModel: Vendor });

    const permissionService = new PermissionService();

    const vendorService = new VendorService({
      vendorDAO,
      clientDAO,
      userDAO,
      profileDAO,
      permissionService,
      queueFactory: {} as any,
      emitterService: {} as any,
    } as any);

    vendorController = new VendorController({ vendorService });

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, res, next) => {
      req.container = {} as any;
      next();
    });

    // Setup routes matching vendors.routes.ts
    app.get('/api/v1/vendors/:cuid/vendors/stats', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await vendorController.getVendorStats(req as any, res);
    });

    app.get('/api/v1/vendors/:cuid/filteredVendors', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await vendorController.getFilteredVendors(req as any, res);
    });

    app.get('/api/v1/vendors/:cuid/vendor_details/:vuid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await vendorController.getSingleVendor(req as any, res);
    });

    app.get('/api/v1/vendors/:cuid/team_members/:vuid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await vendorController.getVendorTeamMembers(req as any, res);
    });

    app.get('/api/v1/vendors/:cuid/vendor/:vuid/edit', async (req, res) => {
      req.context = mockContext(vendorUser, req.params.cuid) as any;
      await vendorController.getVendorForEdit(req as any, res);
    });

    app.patch('/api/v1/vendors/:cuid/vendor/:vuid', async (req, res) => {
      req.context = mockContext(vendorUser, req.params.cuid) as any;
      await vendorController.updateVendorDetails(req as any, res);
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();

    // Create test client and users
    testClient = await createTestClient();
    adminUser = await createTestUser(testClient.cuid, { roles: [ROLES.ADMIN] });
    vendorUser = await createTestUser(testClient.cuid, { roles: [ROLES.VENDOR] });

    // Create profiles
    await createTestProfile(adminUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(vendorUser._id, testClient._id, { type: 'vendor' });

    // Create a test vendor
    testVendor = await Vendor.create({
      vuid: `vendor-${Date.now()}`,
      companyName: 'Test Plumbing Services',
      businessType: 'Plumber',
      registrationNumber: 'REG123456',
      taxId: 'TAX789',
      servicesOffered: ['Plumbing', 'Repairs', 'Installation'],
      address: {
        street: '123 Main St',
        city: 'New York',
        state: 'NY',
        postCode: '10001',
        country: 'USA',
      },
      contactPerson: {
        name: 'John Vendor',
        phone: '+1234567890',
        email: vendorUser.email,
      },
      connectedClients: [
        {
          cuid: testClient.cuid,
          isConnected: true,
          primaryAccountHolder: vendorUser._id,
        },
      ],
      yearsInBusiness: 5,
    });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('GET /vendors/:cuid/vendors/stats - getVendorStats', () => {
    it('should return vendor statistics for the client', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendors/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.total).toBe('number');
      expect(response.body.data.total).toBeGreaterThanOrEqual(1);
    });

    it('should filter stats by status', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendors/stats`)
        .query({ status: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return zero stats for client with no vendors', async () => {
      const otherClient = await createTestClient();
      const otherAdmin = await createTestUser(otherClient.cuid, { roles: [ROLES.ADMIN] });

      app.use((req, res, next) => {
        req.context = mockContext(otherAdmin, otherClient.cuid) as any;
        next();
      });

      const response = await request(app)
        .get(`/api/v1/vendors/${otherClient.cuid}/vendors/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBe(0);
    });
  });

  describe('GET /vendors/:cuid/filteredVendors - getFilteredVendors', () => {
    it('should return list of vendors for the client', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/filteredVendors`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.items)).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThan(0);
      expect(response.body.data.pagination).toBeDefined();
    });

    it('should filter vendors by business type', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/filteredVendors`)
        .query({ businessType: 'Plumber' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toBeDefined();
      response.body.data.items.forEach((vendor: any) => {
        expect(vendor.businessType).toBe('Plumber');
      });
    });

    it('should filter vendors by status', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/filteredVendors`)
        .query({ status: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/filteredVendors`)
        .query({ page: 1, limit: 5 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(5);
    });

    it('should support sorting', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/filteredVendors`)
        .query({ sortBy: 'companyName', sort: 'asc' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toBeDefined();
    });
  });

  describe('GET /vendors/:cuid/vendor_details/:vuid - getSingleVendor', () => {
    it('should return vendor details by vuid', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor_details/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.vuid).toBe(testVendor.vuid);
      expect(response.body.data.companyName).toBe('Test Plumbing Services');
      expect(response.body.data.businessType).toBe('Plumber');
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor_details/nonexistent-vuid`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should include vendor contact information', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor_details/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.contactPerson).toBeDefined();
      expect(response.body.data.contactPerson.name).toBe('John Vendor');
      expect(response.body.data.contactPerson.phone).toBe('+1234567890');
    });

    it('should include services offered', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor_details/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.servicesOffered).toBeDefined();
      expect(Array.isArray(response.body.data.servicesOffered)).toBe(true);
      expect(response.body.data.servicesOffered).toContain('Plumbing');
    });
  });

  describe('GET /vendors/:cuid/team_members/:vuid - getVendorTeamMembers', () => {
    beforeEach(async () => {
      // Add a team member to the vendor
      const teamMember = await createTestUser(testClient.cuid, {
        roles: [ROLES.VENDOR],
        email: `team.member.${Date.now()}@test.com`,
      });
      await createTestProfile(teamMember._id, testClient._id, { type: 'vendor' });

      // Add team member to vendor's connected clients
      await Vendor.findByIdAndUpdate(testVendor._id, {
        $push: {
          'connectedClients.0.teamMembers': teamMember._id,
        },
      });
    });

    it('should return list of vendor team members', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/team_members/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.items)).toBe(true);
    });

    it('should support pagination for team members', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/team_members/${testVendor.vuid}`)
        .query({ page: 1, limit: 10 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination).toBeDefined();
    });

    it('should filter team members by status', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/team_members/${testVendor.vuid}`)
        .query({ status: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/team_members/nonexistent-vuid`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /vendors/:cuid/vendor/:vuid/edit - getVendorForEdit', () => {
    it('should return vendor data for editing when user is primary account holder', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}/edit`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.vuid).toBe(testVendor.vuid);
      expect(response.body.data.companyName).toBe('Test Plumbing Services');
      expect(response.body.data.businessType).toBe('Plumber');
      expect(response.body.data.registrationNumber).toBe('REG123456');
    });

    it('should return 403 when user is not primary account holder', async () => {
      const otherVendorUser = await createTestUser(testClient.cuid, { roles: [ROLES.VENDOR] });

      // Override context for this test
      app.use((req, res, next) => {
        req.context = mockContext(otherVendorUser, testClient.cuid) as any;
        next();
      });

      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}/edit`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('primary account holder');
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor/nonexistent-vuid/edit`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should include all editable vendor fields', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}/edit`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.taxId).toBeDefined();
      expect(response.body.data.servicesOffered).toBeDefined();
      expect(response.body.data.address).toBeDefined();
      expect(response.body.data.contactPerson).toBeDefined();
    });
  });

  describe('PATCH /vendors/:cuid/vendor/:vuid - updateVendorDetails', () => {
    it('should update vendor details when user is primary account holder', async () => {
      const updateData = {
        companyName: 'Updated Plumbing Services Inc',
        businessType: 'Electrician',
        servicesOffered: ['Electrical', 'Repairs', 'Installation'],
        yearsInBusiness: 7,
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify update persisted
      const vendor = await Vendor.findOne({ vuid: testVendor.vuid });
      expect(vendor?.companyName).toBe(updateData.companyName);
      expect(vendor?.businessType).toBe(updateData.businessType);
      expect(vendor?.yearsInBusiness).toBe(updateData.yearsInBusiness);
    });

    it('should update only provided fields', async () => {
      const originalCompanyName = testVendor.companyName;
      const updateData = {
        yearsInBusiness: 10,
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify companyName was not changed
      const vendor = await Vendor.findOne({ vuid: testVendor.vuid });
      expect(vendor?.companyName).toBe(originalCompanyName);
      expect(vendor?.yearsInBusiness).toBe(10);
    });

    it('should update vendor address', async () => {
      const updateData = {
        address: {
          street: '456 New Street',
          city: 'Los Angeles',
          state: 'CA',
          postCode: '90001',
          country: 'USA',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      const vendor = await Vendor.findOne({ vuid: testVendor.vuid });
      expect(vendor?.address?.city).toBe('Los Angeles');
      expect(vendor?.address?.state).toBe('CA');
    });

    it('should update contact person information', async () => {
      const updateData = {
        contactPerson: {
          name: 'Jane Vendor',
          phone: '+9876543210',
          email: 'jane@vendor.com',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      const vendor = await Vendor.findOne({ vuid: testVendor.vuid });
      expect(vendor?.contactPerson?.name).toBe('Jane Vendor');
      expect(vendor?.contactPerson?.phone).toBe('+9876543210');
    });

    it('should return 403 when user is not primary account holder', async () => {
      const otherVendorUser = await createTestUser(testClient.cuid, { roles: [ROLES.VENDOR] });

      app.use((req, res, next) => {
        req.context = mockContext(otherVendorUser, testClient.cuid) as any;
        next();
      });

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send({ companyName: 'Hacked Name' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('primary account holder');
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/nonexistent-vuid`)
        .send({ companyName: 'New Name' })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should reject invalid update data', async () => {
      const invalidData = {
        yearsInBusiness: -5, // Negative years
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send(invalidData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should validate required fields in address update', async () => {
      const invalidData = {
        address: {
          street: '123 Street',
          // Missing city, state, postCode
        },
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send(invalidData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle vendor not connected to client', async () => {
      const otherClient = await createTestClient();
      const otherAdmin = await createTestUser(otherClient.cuid, { roles: [ROLES.ADMIN] });

      app.use((req, res, next) => {
        req.context = mockContext(otherAdmin, otherClient.cuid) as any;
        next();
      });

      const response = await request(app)
        .get(`/api/v1/vendors/${otherClient.cuid}/vendor_details/${testVendor.vuid}`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should handle malformed vuid', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor_details/invalid-vuid-format`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should handle empty filtered vendors list', async () => {
      // Clear all vendors
      await Vendor.deleteMany({});

      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/filteredVendors`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(0);
      expect(response.body.data.pagination.total).toBe(0);
    });

    it('should validate pagination parameters', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/filteredVendors`)
        .query({ page: 0, limit: -5 }) // Invalid pagination
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should handle concurrent vendor updates', async () => {
      const updates = [
        request(app)
          .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
          .send({ yearsInBusiness: 8 }),
        request(app)
          .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
          .send({ yearsInBusiness: 9 }),
      ];

      const responses = await Promise.all(updates);

      // Both should succeed (last write wins)
      responses.forEach((res) => {
        expect(res.status).toBe(httpStatusCodes.OK);
      });

      // Verify final state
      const vendor = await Vendor.findOne({ vuid: testVendor.vuid });
      expect(vendor?.yearsInBusiness).toBeGreaterThanOrEqual(8);
    });
  });

  describe('Authorization and Permissions', () => {
    it('should allow admin to view vendor details', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendor_details/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should allow vendor primary account holder to edit vendor', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send({ yearsInBusiness: 6 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should prevent non-vendor users from editing vendor details', async () => {
      const staffUser = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });

      app.use((req, res, next) => {
        req.context = mockContext(staffUser, testClient.cuid) as any;
        next();
      });

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/vendor/${testVendor.vuid}`)
        .send({ companyName: 'Hacked' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });
});
