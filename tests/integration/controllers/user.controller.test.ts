import request from 'supertest';
import { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { ROLES } from '@shared/constants/roles.constants';
import { UserService } from '@services/user/user.service';
import { UserController } from '@controllers/UserController';
import { ClientService } from '@services/client/client.service';
import { VendorService } from '@services/vendor/vendor.service';
import { ClientController } from '@controllers/ClientController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { ProfileService } from '@services/profile/profile.service';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, describe, expect, it } from '@jest/globals';
import { PropertyUnit, Property, Profile, Client, Vendor, User } from '@models/index';
import {
  PropertyUnitDAO,
  PropertyDAO,
  ProfileDAO,
  ClientDAO,
  VendorDAO,
  UserDAO,
} from '@dao/index';
import {
  createControllerTestApp,
  clearTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

describe('UserController Integration Tests', () => {
  let app: Application;
  let userController: UserController;
  let clientController: ClientController;
  let testClient: any;
  let adminUser: any;
  let managerUser: any;
  let staffUser: any;
  let tenantUser: any;

  let _setContextUser: ReturnType<typeof createControllerTestApp>['setContextUser'];
  let resetContextOverrides: ReturnType<typeof createControllerTestApp>['resetContextOverrides'];

  // Route path constants
  const FILTERED_USERS_PATH = '/api/v1/users/:cuid/users';
  const USER_STATS_PATH = '/api/v1/users/:cuid/users/stats';
  const PROFILE_DETAILS_PATH = '/api/v1/users/:cuid/profile';
  const USER_DETAILS_PATH = '/api/v1/users/:cuid/:uid';
  const UPDATE_PROFILE_PATH = '/api/v1/users/:cuid/profile';
  const NOTIF_PREFS_PATH = '/api/v1/users/:cuid/notification-preferences';
  const FILTERED_TENANTS_PATH = '/api/v1/users/:cuid/filtered-tenants';
  const AVAILABLE_TENANTS_PATH = '/api/v1/users/:cuid/available-tenants';
  const TENANTS_STATS_PATH = '/api/v1/users/:cuid/stats';
  const TENANT_DETAILS_PATH = '/api/v1/users/:cuid/tenants/:uid';
  const ARCHIVE_USER_PATH = '/api/v1/users/:cuid/:uid';
  const CLIENT_TENANT_PATH = '/api/v1/users/:cuid/tenants/:uid/details';
  const USER_ROLES_PATH = '/api/v1/users/:cuid/users/:uid/roles';
  const REMOVE_ROLE_PATH = '/api/v1/users/:cuid/users/:uid/roles/:role';

  beforeAll(async () => {
    setupAllExternalMocks();

    // Initialize DAOs
    const userDAO = new UserDAO({ userModel: User });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });
    const vendorDAO = new VendorDAO({ vendorModel: Vendor });
    const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    const propertyDAO = new PropertyDAO({
      propertyModel: Property,
      propertyUnitDAO,
    });

    const permissionService = new PermissionService();

    const vendorService = new VendorService({
      vendorDAO,
      clientDAO,
      userDAO,
      profileDAO,
      permissionService,
      vendorCache: {
        getVendorDetail: jest.fn().mockResolvedValue({ success: false }),
        cacheVendorDetail: jest.fn(),
        invalidateVendor: jest.fn(),
      } as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined) } as any,
      geoCoderService: {} as any,
      paymentProcessorDAO: {} as any,
      maintenanceRequestDAO: {} as any,
      paymentGatewayService: {} as any,
      payoutAccountService: {} as any,
    } as any);

    const userCache = {
      getUserDetail: jest.fn().mockResolvedValue({ success: false, data: null }),
      cacheUserDetail: jest.fn().mockResolvedValue(undefined),
      getFilteredUsers: jest.fn().mockResolvedValue({ success: false, data: null }),
      saveFilteredUsers: jest.fn().mockResolvedValue(undefined),
      invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
      invalidateUserLists: jest.fn().mockResolvedValue(undefined),
    } as any;

    const userService = new UserService({
      clientDAO,
      userDAO,
      propertyDAO,
      profileDAO,
      propertyUnitDAO,
      userCache,
      permissionService,
      vendorService,
      emitterService: { emit: jest.fn(), on: jest.fn(), off: jest.fn() } as any,
      paymentDAO: {
        getTenantPaymentMetrics: jest.fn().mockResolvedValue({
          metrics: { totalRentPaid: 0, onTimePaymentRate: 0, averagePaymentDelay: 0 },
          payments: [],
        }),
      } as any,
      leaseDAO: {
        list: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0 } }),
        getActiveLeaseByTenant: jest.fn().mockResolvedValue(null),
      } as any,
      maintenanceRequestDAO: {
        getStats: jest.fn().mockResolvedValue({ total: 0, open: 0, closed: 0, inProgress: 0 }),
      } as any,
      inspectionDAO: {
        getStats: jest.fn().mockResolvedValue({ total: 0, scheduled: 0, completed: 0, overdue: 0 }),
        countDocuments: jest.fn().mockResolvedValue(0),
      } as any,
      paymentProcessorDAO: {} as any,
      subscriptionDAO: {} as any,
      queueFactory: { getQueue: jest.fn().mockReturnValue({ addToEmailQueue: jest.fn() }) } as any,
    });

    const mockMediaUploadService = {
      handleFiles: jest.fn().mockResolvedValue({ hasFiles: false }),
      handleMediaDeletion: jest.fn(),
      handleAvatarDeletion: jest.fn(),
    } as any;

    const mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn(),
      off: jest.fn(),
      once: jest.fn(),
      removeAllListeners: jest.fn(),
      listenerCount: jest.fn(),
      destroy: jest.fn(),
    } as any;

    const profileService = new ProfileService({
      profileDAO,
      clientDAO,
      userDAO,
      vendorDAO,
      vendorService,
      userService,
      emitterService: mockEmitterService,
      mediaUploadService: mockMediaUploadService,
      authCache: {
        invalidateUserCache: jest.fn().mockResolvedValue(undefined),
        invalidateCurrentUser: jest.fn().mockResolvedValue(undefined),
        saveCurrentUser: jest.fn().mockResolvedValue({ success: true }),
      } as any,
      userCache: {
        invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
        invalidateUserLists: jest.fn().mockResolvedValue(undefined),
      } as any,
      paymentProcessorDAO: {} as any,
      subscriptionDAO: {} as any,
      leaseDAO: {
        list: jest.fn().mockResolvedValue({ items: [], pagination: { total: 0 } }),
        getActiveLeaseByTenant: jest.fn().mockResolvedValue(null),
      } as any,
    });

    const authCache = {
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
    } as any;

    const clientService = new ClientService({
      clientDAO,
      userDAO,
      profileDAO,
      propertyDAO,
      propertyUnitDAO,
      authCache,
      userCache: {
        invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
        invalidateUserLists: jest.fn().mockResolvedValue(undefined),
      } as any,
      subscriptionDAO: {} as any,
      subscriptionService: {} as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
      notificationService: {} as any,
      sseService: {} as any,
      paymentGatewayService: {} as any,
      paymentProcessorDAO: {} as any,
      featureFlagService: { isEnabled: jest.fn().mockReturnValue(true) } as any,
      vendorDAO: {} as any,
      queueFactory: { getQueue: jest.fn().mockReturnValue({ addToEmailQueue: jest.fn() }) } as any,
    });

    userController = new UserController({
      userService,
      profileService,
      mediaUploadService: mockMediaUploadService,
      queueFactory: {} as any,
      smsService: {} as any,
    });

    clientController = new ClientController({ clientService });

    const testApp = createControllerTestApp({
      routes: [
        {
          method: 'get',
          path: FILTERED_USERS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getFilteredUsers(req, res),
        },
        {
          method: 'get',
          path: USER_STATS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getUserStats(req, res),
        },
        {
          method: 'get',
          path: PROFILE_DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getUserProfile(req, res),
        },
        {
          method: 'get',
          path: USER_DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getClientUserInfo(req, res),
        },
        {
          method: 'patch',
          path: UPDATE_PROFILE_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.updateUserProfile(req, res),
        },
        {
          method: 'get',
          path: NOTIF_PREFS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getNotificationPreferences(req, res),
        },
        {
          method: 'get',
          path: FILTERED_TENANTS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getFilteredTenants(req, res),
        },
        {
          method: 'get',
          path: AVAILABLE_TENANTS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getAvailableTenantsForLease(req, res),
        },
        {
          method: 'get',
          path: TENANTS_STATS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getTenantsStats(req, res),
        },
        {
          method: 'get',
          path: TENANT_DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getTenantUserInfo(req, res),
        },
        {
          method: 'patch',
          path: TENANT_DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.updateTenantProfile(req, res),
        },
        {
          method: 'delete',
          path: TENANT_DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.deactivateTenant(req, res),
        },
        {
          method: 'delete',
          path: ARCHIVE_USER_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.archiveUser(req, res),
        },
        {
          method: 'get',
          path: CLIENT_TENANT_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => userController.getClientTenantDetails(req, res),
        },
        // Client controller routes
        {
          method: 'get',
          path: USER_ROLES_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.getUserRoles(req, res),
        },
        {
          method: 'post',
          path: USER_ROLES_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.assignUserRole(req, res),
        },
        {
          method: 'delete',
          path: REMOVE_ROLE_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.removeUserRole(req, res),
        },
      ],
    });

    app = testApp.app;
    _setContextUser = testApp.setContextUser;
    resetContextOverrides = testApp.resetContextOverrides;
  });

  beforeEach(async () => {
    await clearTestDatabase();
    resetContextOverrides();

    // Create test client and users
    testClient = await createTestClient();
    adminUser = await createTestUser(testClient.cuid, { roles: [ROLES.ADMIN] });
    managerUser = await createTestUser(testClient.cuid, { roles: [ROLES.MANAGER] });
    staffUser = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });
    tenantUser = await createTestUser(testClient.cuid, { roles: [ROLES.TENANT] });

    // Create profiles for users
    await createTestProfile(adminUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(managerUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(staffUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(tenantUser._id, testClient._id, { type: 'tenant' });
  });

  describe('GET /users/:cuid/users - getFilteredUsers', () => {
    it('should return list of users for the client', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/users`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.items)).toBe(true);
      expect(response.body.data.pagination).toBeDefined();
    });

    it('should filter users by role', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/users`)
        .query({ filter: { role: ROLES.TENANT } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.items).toBeDefined();
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/users`)
        .query({ pagination: { page: 1, limit: 10 } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pagination.page).toBe(1);
      expect(response.body.data.pagination.limit).toBe(10);
    });
  });

  describe('GET /users/:cuid/users/stats - getUserStats', () => {
    it('should return user statistics for the client', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/users/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.totalFilteredUsers).toBe('number');
    });
  });

  describe('GET /users/:cuid/:uid - getClientUserInfo', () => {
    it('should return user details by UID', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/${adminUser.uid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.profile.uid).toBe(adminUser.uid);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/nonexistent-uid`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /users/:cuid/profile - getUserProfile', () => {
    it('should return current user profile when no uid provided', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/profile`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return specific user profile when uid provided', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/profile`)
        .query({ uid: adminUser.uid })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('PATCH /users/:cuid/profile - updateUserProfile', () => {
    it('should update user profile successfully', async () => {
      const updateData = {
        personalInfo: {
          firstName: 'UpdatedFirstName',
          lastName: 'UpdatedLastName',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/users/${testClient.cuid}/profile`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /users/:cuid/notification-preferences - getNotificationPreferences', () => {
    it('should return notification preferences', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/notification-preferences`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return notification preferences for specific user', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/notification-preferences`)
        .query({ userId: adminUser._id.toString() })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('GET /users/:cuid/filtered-tenants - getFilteredTenants', () => {
    it('should return list of tenants', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/filtered-tenants`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.items)).toBe(true);
    });
  });

  describe('GET /users/:cuid/available-tenants - getAvailableTenantsForLease', () => {
    it('should return available tenants for lease', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/available-tenants`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('GET /users/:cuid/stats - getTenantsStats', () => {
    it('should return tenant statistics', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('GET /users/:cuid/tenants/:uid - getTenantUserInfo', () => {
    it('should return tenant user information', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/tenants/${tenantUser.uid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('PATCH /users/:cuid/tenants/:uid - updateTenantProfile', () => {
    it('should update tenant profile successfully', async () => {
      const updateData = {
        personalInfo: {
          firstName: 'UpdatedTenant',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/users/${testClient.cuid}/tenants/${tenantUser.uid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /users/:cuid/tenants/:uid - deactivateTenant', () => {
    it('should deactivate tenant successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/users/${testClient.cuid}/tenants/${tenantUser.uid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /users/:cuid/:uid - archiveUser', () => {
    it('should archive user successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/users/${testClient.cuid}/${staffUser.uid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /users/:cuid/tenants/:uid/details - getClientTenantDetails', () => {
    it('should return detailed tenant information', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/tenants/${tenantUser.uid}/details`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support include parameter for related data', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/tenants/${tenantUser.uid}/details`)
        .query({ include: 'leases' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /users/:cuid/users/:uid/roles - getUserRoles', () => {
    it('should return user roles', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/users/${managerUser.uid}/roles`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('POST /users/:cuid/users/:uid/roles - assignUserRole', () => {
    it('should assign new role to user', async () => {
      const response = await request(app)
        .post(`/api/v1/users/${testClient.cuid}/users/${staffUser.uid}/roles`)
        .send({ role: ROLES.MANAGER })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /users/:cuid/users/:uid/roles/:role - removeUserRole', () => {
    it('should remove role from user', async () => {
      // First assign a second role
      await request(app)
        .post(`/api/v1/users/${testClient.cuid}/users/${managerUser.uid}/roles`)
        .send({ role: ROLES.STAFF });

      // Then remove it
      const response = await request(app)
        .delete(`/api/v1/users/${testClient.cuid}/users/${managerUser.uid}/roles/${ROLES.STAFF}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid cuid gracefully', async () => {
      const response = await request(app)
        .get('/api/v1/users/invalid-cuid/users')
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should return valid response for existing client cuid', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/users`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });
});
