import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { UserService } from '@services/user/user.service';
import { ROLES } from '@shared/constants/roles.constants';
import { UserController } from '@controllers/UserController';
import { ClientService } from '@services/client/client.service';
import { VendorService } from '@services/vendor/vendor.service';
import { ClientController } from '@controllers/ClientController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { ProfileService } from '@services/profile/profile.service';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { PropertyUnit, Property, Profile, Client, Vendor, User } from '@models/index';
import { disconnectTestDatabase, setupTestDatabase, clearTestDatabase } from '@tests/helpers';
import { createTestProfile, createTestClient, createTestUser } from '@tests/setup/testFactories';
import {
  PropertyUnitDAO,
  PropertyDAO,
  ProfileDAO,
  ClientDAO,
  VendorDAO,
  UserDAO,
} from '@dao/index';

describe('UserController Integration Tests', () => {
  let app: Application;
  let userController: UserController;
  let clientController: ClientController;
  let testClient: any;
  let adminUser: any;
  let managerUser: any;
  let staffUser: any;
  let tenantUser: any;

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
      queueFactory: {} as any,
      emitterService: {} as any,
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
      userCache,
      permissionService,
      vendorService,
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
      vendorService,
      userService,
      emitterService: mockEmitterService,
      mediaUploadService: mockMediaUploadService,
    });

    const authCache = {
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
    } as any;

    const clientService = new ClientService({
      clientDAO,
      userDAO,
      profileDAO,
      propertyDAO,
      authCache,
    });

    userController = new UserController({
      userService,
      profileService,
      mediaUploadService: mockMediaUploadService,
    });

    clientController = new ClientController({ clientService });

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, res, next) => {
      req.container = {} as any;
      next();
    });

    // Setup routes matching users.routes.ts
    app.get('/api/v1/users/:cuid/users', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getFilteredUsers(req as any, res);
    });

    app.get('/api/v1/users/:cuid/users/stats', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getUserStats(req as any, res);
    });

    app.get('/api/v1/users/:cuid/profile_details', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getUserProfile(req as any, res);
    });

    app.get('/api/v1/users/:cuid/user_details/:uid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getClientUserInfo(req as any, res);
    });

    app.patch('/api/v1/users/:cuid/update_profile', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.updateUserProfile(req as any, res);
    });

    app.get('/api/v1/users/:cuid/notification-preferences', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getNotificationPreferences(req as any, res);
    });

    app.get('/api/v1/users/:cuid/filtered-tenants', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getFilteredTenants(req as any, res);
    });

    app.get('/api/v1/users/:cuid/available-tenants', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getAvailableTenantsForLease(req as any, res);
    });

    app.get('/api/v1/users/:cuid/stats', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getTenantsStats(req as any, res);
    });

    app.get('/api/v1/users/:cuid/tenant_details/:uid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getTenantUserInfo(req as any, res);
    });

    app.patch('/api/v1/users/:cuid/tenant_details/:uid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.updateTenantProfile(req as any, res);
    });

    app.delete('/api/v1/users/:cuid/tenant_details/:uid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.deactivateTenant(req as any, res);
    });

    app.delete('/api/v1/users/:cuid/:uid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.archiveUser(req as any, res);
    });

    app.get('/api/v1/users/:cuid/client_tenant/:uid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await userController.getClientTenantDetails(req as any, res);
    });

    // Client controller routes
    app.get('/api/v1/users/:cuid/users/:uid/roles', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.getUserRoles(req as any, res);
    });

    app.post('/api/v1/users/:cuid/users/:uid/roles', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.assignUserRole(req as any, res);
    });

    app.delete('/api/v1/users/:cuid/users/:uid/roles/:role', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.removeUserRole(req as any, res);
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();

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

  afterAll(async () => {
    await disconnectTestDatabase();
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
      expect(typeof response.body.data.total).toBe('number');
    });
  });

  describe('GET /users/:cuid/user_details/:uid - getClientUserInfo', () => {
    it('should return user details by UID', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/user_details/${adminUser.uid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.uid).toBe(adminUser.uid);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/user_details/nonexistent-uid`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /users/:cuid/profile_details - getUserProfile', () => {
    it('should return current user profile when no uid provided', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/profile_details`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should return specific user profile when uid provided', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/profile_details`)
        .query({ uid: adminUser.uid })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('PATCH /users/:cuid/update_profile - updateUserProfile', () => {
    it('should update user profile successfully', async () => {
      const updateData = {
        personalInfo: {
          firstName: 'UpdatedFirstName',
          lastName: 'UpdatedLastName',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/users/${testClient.cuid}/update_profile`)
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

  describe('GET /users/:cuid/tenant_details/:uid - getTenantUserInfo', () => {
    it('should return tenant user information', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/tenant_details/${tenantUser.uid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });
  });

  describe('PATCH /users/:cuid/tenant_details/:uid - updateTenantProfile', () => {
    it('should update tenant profile successfully', async () => {
      const updateData = {
        personalInfo: {
          firstName: 'UpdatedTenant',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/users/${testClient.cuid}/tenant_details/${tenantUser.uid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('DELETE /users/:cuid/tenant_details/:uid - deactivateTenant', () => {
    it('should deactivate tenant successfully', async () => {
      const response = await request(app)
        .delete(`/api/v1/users/${testClient.cuid}/tenant_details/${tenantUser.uid}`)
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

  describe('GET /users/:cuid/client_tenant/:uid - getClientTenantDetails', () => {
    it('should return detailed tenant information', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/client_tenant/${tenantUser.uid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support include parameter for related data', async () => {
      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/client_tenant/${tenantUser.uid}`)
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

    it('should handle database errors gracefully', async () => {
      // Disconnect database temporarily to simulate error
      await disconnectTestDatabase();

      const response = await request(app)
        .get(`/api/v1/users/${testClient.cuid}/users`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);

      // Reconnect for other tests
      await setupTestDatabase();
    });
  });
});
