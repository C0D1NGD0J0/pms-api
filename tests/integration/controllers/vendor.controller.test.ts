import request from 'supertest';
import { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { ROLES } from '@shared/constants/roles.constants';
import { Profile, Client, Vendor, User } from '@models/index';
import { VendorService } from '@services/vendor/vendor.service';
import { VendorController } from '@controllers/VendorController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { ProfileDAO, ClientDAO, VendorDAO, UserDAO } from '@dao/index';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, describe, expect, it } from '@jest/globals';
import {
  createControllerTestApp,
  clearTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

describe('VendorController Integration Tests', () => {
  let app: Application;
  let vendorController: VendorController;
  let testClient: any;
  let adminUser: any;
  let vendorUser: any;
  let testVendor: any;

  let setContextUser: ReturnType<typeof createControllerTestApp>['setContextUser'];
  let resetContextOverrides: ReturnType<typeof createControllerTestApp>['resetContextOverrides'];

  // Route path constants
  const STATS_PATH = '/api/v1/vendors/:cuid/vendors/stats';
  const FILTERED_PATH = '/api/v1/vendors/:cuid';
  const DETAILS_PATH = '/api/v1/vendors/:cuid/:vuid';
  const TEAM_PATH = '/api/v1/vendors/:cuid/:vuid/team';
  const EDIT_PATH = '/api/v1/vendors/:cuid/:vuid/form';
  const PATCH_PATH = '/api/v1/vendors/:cuid/:vuid';

  beforeAll(async () => {
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
      emitterService: { emit: jest.fn(), on: jest.fn(), off: jest.fn() } as any,
      vendorCache: {
        getVendorDetail: jest.fn().mockResolvedValue({ success: false }),
        cacheVendorDetail: jest.fn(),
        invalidateVendor: jest.fn(),
        getFilteredVendors: jest.fn().mockResolvedValue({ success: false, data: null }),
        saveFilteredVendors: jest.fn().mockResolvedValue(undefined),
      } as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
      geoCoderService: {
        parseLocation: jest.fn().mockResolvedValue({
          success: true,
          data: {
            formattedAddress: '123 Main St, New York, NY 10001, USA',
            street: '123 Main St',
            city: 'New York',
            state: 'NY',
            postCode: '10001',
            country: 'USA',
            coordinates: [40.7128, -74.006],
          },
        }),
      } as any,
      paymentProcessorDAO: {} as any,
      maintenanceRequestDAO: {
        getVendorAvgRatingBatch: jest.fn().mockResolvedValue(new Map()),
        getVendorAvgRating: jest.fn().mockResolvedValue(null),
        getVendorStats: jest
          .fn()
          .mockResolvedValue({ total: 0, assigned: 0, inProgress: 0, completed: 0 }),
        getStats: jest.fn().mockResolvedValue({
          total: 0,
          open: 0,
          assigned: 0,
          inProgress: 0,
          awaitingInvoice: 0,
          completed: 0,
          cancelled: 0,
          pending: 0,
          byCategory: {},
          byPriority: {},
          pendingInvoices: 0,
          avgResolutionDays: 0,
        }),
      } as any,
      paymentGatewayService: {} as any,
      payoutAccountService: {} as any,
    } as any);

    vendorController = new VendorController({ vendorService });

    const testApp = createControllerTestApp({
      routes: [
        {
          method: 'get',
          path: STATS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => vendorController.getVendorStats(req, res),
        },
        {
          method: 'get',
          path: FILTERED_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => vendorController.getFilteredVendors(req, res),
        },
        {
          method: 'get',
          path: DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => vendorController.getSingleVendor(req, res),
        },
        {
          method: 'get',
          path: TEAM_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => vendorController.getVendorTeamMembers(req, res),
        },
        {
          method: 'get',
          path: EDIT_PATH,
          contextUser: () => vendorUser,
          handler: (req, res) => vendorController.getVendorForEdit(req, res),
        },
        {
          method: 'patch',
          path: PATCH_PATH,
          contextUser: () => vendorUser,
          handler: (req, res) => vendorController.updateVendorDetails(req, res),
        },
      ],
    });

    app = testApp.app;
    setContextUser = testApp.setContextUser;
    resetContextOverrides = testApp.resetContextOverrides;
  });

  beforeEach(async () => {
    await clearTestDatabase();
    resetContextOverrides();

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
      servicesOffered: { plumbing: true, applianceRepair: true, maintenance: true },
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
          primaryAccountHolderUserId: vendorUser._id,
        },
      ],
      yearsInBusiness: 5,
    });
  });

  describe('GET /vendors/:cuid/vendors/stats - getVendorStats', () => {
    it('should return vendor statistics for the client', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/vendors/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.totalVendors).toBe('number');
      expect(response.body.data.totalVendors).toBeGreaterThanOrEqual(1);
      expect(typeof response.body.data.activeVendors).toBe('number');
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

      const { app: otherApp } = createControllerTestApp({
        routes: [
          {
            method: 'get',
            path: STATS_PATH,
            contextUser: () => otherAdmin,
            handler: (req, res) => vendorController.getVendorStats(req, res),
          },
        ],
      });

      const response = await request(otherApp)
        .get(`/api/v1/vendors/${otherClient.cuid}/vendors/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.totalVendors).toBe(0);
      expect(response.body.data.activeVendors).toBe(0);
    });
  });

  describe('GET /vendors/:cuid - getFilteredVendors', () => {
    it('should return list of vendors for the client', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.items)).toBe(true);
      expect(response.body.data.items.length).toBeGreaterThan(0);
      expect(response.body.data.pagination).toBeDefined();
    });

    it('should filter vendors by business type', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}`)
        .query({ businessType: 'Plumber' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toBeDefined();
      response.body.data.items.forEach((vendor: any) => {
        // getFilteredVendors returns FilteredUserTableData; businessType is nested under vendorInfo
        expect(vendor.vendorInfo.businessType).toBe('Plumber');
      });
    });

    it('should filter vendors by status', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}`)
        .query({ status: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}`)
        .query({ page: 1, limit: 5 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      // DAO returns { currentPage, perPage, total, totalPages, hasMoreResource }
      expect(response.body.data.pagination.currentPage).toBe(1);
      expect(response.body.data.pagination.perPage).toBe(5);
    });

    it('should support sorting', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}`)
        .query({ sortBy: 'companyName', sort: 'asc' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toBeDefined();
    });
  });

  describe('GET /vendors/:cuid/:vuid - getSingleVendor', () => {
    it('should return vendor details by vuid', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      // getVendorInfo returns IUserDetailResponse: { profile, vendorInfo, status }
      expect(response.body.data.vendorInfo.vuid).toBe(testVendor.vuid);
      expect(response.body.data.vendorInfo.companyName).toBe('Test Plumbing Services');
      expect(response.body.data.vendorInfo.businessType).toBe('Plumber');
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/nonexistent-vuid`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should include vendor contact information', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      // Contact info is nested under vendorInfo
      expect(response.body.data.vendorInfo.contactPerson).toBeDefined();
      expect(response.body.data.vendorInfo.contactPerson.name).toBe('John Vendor');
      expect(response.body.data.vendorInfo.contactPerson.phone).toBe('+1234567890');
    });

    it('should include services offered', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      // servicesOffered is nested under vendorInfo and stored as an object
      expect(response.body.data.vendorInfo.servicesOffered).toBeDefined();
      expect(typeof response.body.data.vendorInfo.servicesOffered).toBe('object');
    });
  });

  describe('GET /vendors/:cuid/:vuid/team - getVendorTeamMembers', () => {
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
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}/team`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.items)).toBe(true);
    });

    it('should support pagination for team members', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}/team`)
        .query({ page: 1, limit: 10 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination).toBeDefined();
    });

    it('should filter team members by status', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}/team`)
        .query({ status: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/nonexistent-vuid/team`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /vendors/:cuid/:vuid/form - getVendorForEdit', () => {
    it('should return vendor data for editing when user is primary account holder', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}/form`)
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

      setContextUser(EDIT_PATH, otherVendorUser);

      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}/form`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('primary account holder');
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/nonexistent-vuid/form`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should include all editable vendor fields', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}/form`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.taxId).toBeDefined();
      expect(response.body.data.servicesOffered).toBeDefined();
      expect(response.body.data.address).toBeDefined();
      expect(response.body.data.contactPerson).toBeDefined();
    });
  });

  describe('PATCH /vendors/:cuid/:vuid - updateVendorDetails', () => {
    it('should update vendor details when user is primary account holder', async () => {
      const updateData = {
        companyName: 'Updated Plumbing Services Inc',
        businessType: 'Electrician',
        servicesOffered: ['Electrical', 'Repairs', 'Installation'],
        yearsInBusiness: 7,
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
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
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
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
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
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
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      const vendor = await Vendor.findOne({ vuid: testVendor.vuid });
      expect(vendor?.contactPerson?.name).toBe('Jane Vendor');
      expect(vendor?.contactPerson?.phone).toBe('+9876543210');
    });

    it('should return 403 when user is not primary account holder', async () => {
      const otherVendorUser = await createTestUser(testClient.cuid, { roles: [ROLES.VENDOR] });

      setContextUser(PATCH_PATH, otherVendorUser, 'patch');

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .send({ companyName: 'Hacked Name' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent vendor', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/nonexistent-vuid`)
        .send({ companyName: 'New Name' })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should reject invalid update data', async () => {
      const invalidData = {
        yearsInBusiness: -5, // Negative years
      };

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .send(invalidData);

      // Mongoose validation errors surface as 422 via errorHandlerMiddleware
      expect(response.status).toBe(httpStatusCodes.UNPROCESSABLE);
      expect(response.body.success).toBe(false);
    });

    it('should update partial address fields', async () => {
      const partialAddress = {
        address: {
          street: '123 Street',
        },
      };

      // The service accepts partial address updates (no fullAddress → geocoding skipped)
      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .send(partialAddress)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      const vendor = await Vendor.findOne({ vuid: testVendor.vuid });
      expect(vendor?.address?.street).toBe('123 Street');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle vendor not connected to client', async () => {
      const otherClient = await createTestClient();
      const otherAdmin = await createTestUser(otherClient.cuid, { roles: [ROLES.ADMIN] });

      const { app: otherApp } = createControllerTestApp({
        routes: [
          {
            method: 'get',
            path: DETAILS_PATH,
            contextUser: () => otherAdmin,
            handler: (req, res) => vendorController.getSingleVendor(req, res),
          },
        ],
      });

      const response = await request(otherApp)
        .get(`/api/v1/vendors/${otherClient.cuid}/${testVendor.vuid}`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should handle malformed vuid', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}/invalid-vuid-format`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should handle empty filtered vendors list', async () => {
      // Clear all vendors
      await Vendor.deleteMany({});

      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toHaveLength(0);
      expect(response.body.data.pagination.total).toBe(0);
    });

    it('should handle invalid pagination parameters gracefully', async () => {
      const response = await request(app)
        .get(`/api/v1/vendors/${testClient.cuid}`)
        .query({ page: 0, limit: -5 }); // Invalid pagination

      // Without route-level validation middleware, the service/DAO receives raw values
      // and may error internally — expect a non-200 error response
      expect(response.body.success).toBe(false);
      expect(response.status).toBeGreaterThanOrEqual(400);
    });

    it('should handle concurrent vendor updates', async () => {
      const updates = [
        request(app)
          .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
          .send({ yearsInBusiness: 8 }),
        request(app)
          .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
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
        .get(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should allow vendor primary account holder to edit vendor', async () => {
      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .send({ yearsInBusiness: 6 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should prevent non-primary-account-holder from editing vendor details', async () => {
      const staffUser = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });

      setContextUser(PATCH_PATH, staffUser, 'patch');

      const response = await request(app)
        .patch(`/api/v1/vendors/${testClient.cuid}/${testVendor.vuid}`)
        .send({ companyName: 'Hacked' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });
});
