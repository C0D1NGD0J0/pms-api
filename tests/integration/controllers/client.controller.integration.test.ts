import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { UserService } from '@services/user/user.service';
import { ROLES } from '@shared/constants/roles.constants';
import { ClientService } from '@services/client/client.service';
import { VendorService } from '@services/vendor/vendor.service';
import { ClientController } from '@controllers/ClientController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
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

describe('ClientController Integration Tests', () => {
  let app: Application;
  let clientController: ClientController;
  let testClient: any;
  let adminUser: any;
  let managerUser: any;
  let staffUser: any;

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

    const _userService = new UserService({
      clientDAO,
      userDAO,
      propertyDAO,
      profileDAO,
      userCache,
      permissionService,
      vendorService,
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

    clientController = new ClientController({ clientService });

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, res, next) => {
      req.container = {} as any;
      next();
    });

    // Setup routes matching client.routes.ts
    app.get('/api/v1/clients/:cuid/client_details', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.getClient(req as any, res);
    });

    app.patch('/api/v1/clients/:cuid/client_details', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.updateClientProfile(req as any, res);
    });

    app.post('/api/v1/clients/:cuid/users/:uid/disconnect', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.disconnectUser(req as any, res);
    });

    app.post('/api/v1/clients/:cuid/users/:uid/reconnect', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.reconnectUser(req as any, res);
    });

    app.get('/api/v1/clients/:cuid/users/:uid/roles', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.getUserRoles(req as any, res);
    });

    app.post('/api/v1/clients/:cuid/users/:uid/roles', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.assignUserRole(req as any, res);
    });

    app.delete('/api/v1/clients/:cuid/users/:uid/roles/:role', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.removeUserRole(req as any, res);
    });

    app.patch('/api/v1/clients/:cuid/users/:uid/department', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await clientController.assignDepartment(req as any, res);
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();

    // Create test client and users
    testClient = await createTestClient();
    adminUser = await createTestUser(testClient.cuid, { roles: [ROLES.ADMIN] });
    managerUser = await createTestUser(testClient.cuid, { roles: [ROLES.MANAGER] });
    staffUser = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });

    // Create profiles for users
    await createTestProfile(adminUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(managerUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(staffUser._id, testClient._id, { type: 'employee' });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('GET /clients/:cuid/client_details - getClient', () => {
    it('should return complete client information', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}/client_details`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.cuid).toBe(testClient.cuid);
      expect(response.body.data.displayName).toBe(testClient.displayName);
      expect(response.body.message).toBeDefined();
    });

    it('should return 404 for non-existent client', async () => {
      const response = await request(app)
        .get('/api/v1/clients/nonexistent-cuid/client_details')
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should include client settings in response', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}/client_details`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.settings).toBeDefined();
      expect(response.body.data.settings.timezone).toBeDefined();
      expect(response.body.data.settings.currency).toBeDefined();
    });
  });

  describe('PATCH /clients/:cuid/client_details - updateClientProfile', () => {
    it('should update client profile successfully', async () => {
      const updateData = {
        displayName: 'Updated Company Name',
        settings: {
          timezone: 'America/Los_Angeles',
          currency: 'USD',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/client_details`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.message).toBeDefined();

      // Verify update persisted
      const client = await Client.findOne({ cuid: testClient.cuid });
      expect(client?.displayName).toBe(updateData.displayName);
    });

    it('should update only provided fields', async () => {
      const originalName = testClient.displayName;
      const updateData = {
        settings: {
          timezone: 'Europe/London',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/client_details`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify displayName was not changed
      const client = await Client.findOne({ cuid: testClient.cuid });
      expect(client?.displayName).toBe(originalName);
    });

    it('should reject invalid update data', async () => {
      const invalidData = {
        status: 'invalid-status',
      };

      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/client_details`)
        .send(invalidData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /clients/:cuid/users/:uid/roles - getUserRoles', () => {
    it('should return user roles for the client', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/roles`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data.roles)).toBe(true);
      expect(response.body.data.roles).toContain(ROLES.MANAGER);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}/users/nonexistent-uid/roles`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /clients/:cuid/users/:uid/roles - assignUserRole', () => {
    it('should assign new role to user successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/roles`)
        .send({ role: ROLES.MANAGER })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();

      // Verify role was added
      const user = await User.findOne({ uid: staffUser.uid });
      const clientRoles = user?.cuids.find((c) => c.cuid === testClient.cuid)?.roles;
      expect(clientRoles).toContain(ROLES.MANAGER);
      expect(clientRoles).toContain(ROLES.STAFF); // Original role should still be there
    });

    it('should not duplicate existing roles', async () => {
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/roles`)
        .send({ role: ROLES.MANAGER })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify role is not duplicated
      const user = await User.findOne({ uid: managerUser.uid });
      const clientRoles = user?.cuids.find((c) => c.cuid === testClient.cuid)?.roles;
      const managerCount = clientRoles?.filter((r) => r === ROLES.MANAGER).length;
      expect(managerCount).toBe(1);
    });

    it('should reject invalid role', async () => {
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/roles`)
        .send({ role: 'invalid-role' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /clients/:cuid/users/:uid/roles/:role - removeUserRole', () => {
    it('should remove role from user successfully', async () => {
      // First assign an additional role
      await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/roles`)
        .send({ role: ROLES.STAFF });

      // Then remove it
      const response = await request(app)
        .delete(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/roles/${ROLES.STAFF}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify role was removed
      const user = await User.findOne({ uid: managerUser.uid });
      const clientRoles = user?.cuids.find((c) => c.cuid === testClient.cuid)?.roles;
      expect(clientRoles).not.toContain(ROLES.STAFF);
      expect(clientRoles).toContain(ROLES.MANAGER); // Original role should remain
    });

    it('should prevent removing last role', async () => {
      const response = await request(app)
        .delete(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/roles/${ROLES.STAFF}`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('at least one role');
    });

    it('should return 404 for non-existent role', async () => {
      const response = await request(app)
        .delete(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/roles/${ROLES.VENDOR}`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /clients/:cuid/users/:uid/disconnect - disconnectUser', () => {
    it('should disconnect user from client successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/disconnect`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify user is disconnected
      const user = await User.findOne({ uid: staffUser.uid });
      const clientConnection = user?.cuids.find((c) => c.cuid === testClient.cuid);
      expect(clientConnection?.isConnected).toBe(false);
    });

    it('should not allow disconnecting account admin', async () => {
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${adminUser.uid}/disconnect`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('account admin');
    });

    it('should handle already disconnected user', async () => {
      // Disconnect first time
      await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/disconnect`)
        .expect(httpStatusCodes.OK);

      // Try to disconnect again
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/disconnect`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /clients/:cuid/users/:uid/reconnect - reconnectUser', () => {
    beforeEach(async () => {
      // Disconnect user first
      await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/disconnect`)
        .expect(httpStatusCodes.OK);
    });

    it('should reconnect disconnected user successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/reconnect`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify user is reconnected
      const user = await User.findOne({ uid: staffUser.uid });
      const clientConnection = user?.cuids.find((c) => c.cuid === testClient.cuid);
      expect(clientConnection?.isConnected).toBe(true);
    });

    it('should handle already connected user', async () => {
      // Reconnect first time
      await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/reconnect`)
        .expect(httpStatusCodes.OK);

      // Try to reconnect again
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/reconnect`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for user not in client', async () => {
      const otherClient = await createTestClient();
      const otherUser = await createTestUser(otherClient.cuid, { roles: [ROLES.STAFF] });

      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${otherUser.uid}/reconnect`)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /clients/:cuid/users/:uid/department - assignDepartment', () => {
    it('should assign department to user successfully', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/department`)
        .send({ department: 'maintenance' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify department was assigned
      const profile = await Profile.findOne({ user: managerUser._id });
      expect(profile?.employeeInfo?.department).toBe('maintenance');
    });

    it('should update existing department', async () => {
      // Set initial department
      await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/department`)
        .send({ department: 'maintenance' });

      // Update to new department
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/department`)
        .send({ department: 'management' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify department was updated
      const profile = await Profile.findOne({ user: managerUser._id });
      expect(profile?.employeeInfo?.department).toBe('management');
    });

    it('should reject invalid department', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/users/${managerUser.uid}/department`)
        .send({ department: 'invalid-department' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 404 for non-existent user', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/users/nonexistent-uid/department`)
        .send({ department: 'maintenance' })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle unauthorized client access', async () => {
      const otherClient = await createTestClient();

      const response = await request(app)
        .get(`/api/v1/clients/${otherClient.cuid}/client_details`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });

    it('should validate required fields in requests', async () => {
      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/roles`)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should handle malformed request data', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/client_details`)
        .send({ settings: 'not-an-object' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should handle concurrent role assignments', async () => {
      const promises = [
        request(app)
          .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/roles`)
          .send({ role: ROLES.MANAGER }),
        request(app)
          .post(`/api/v1/clients/${testClient.cuid}/users/${staffUser.uid}/roles`)
          .send({ role: ROLES.MANAGER }),
      ];

      await Promise.all(promises);

      // Both should succeed, but role should not be duplicated
      const user = await User.findOne({ uid: staffUser.uid });
      const roles = user?.cuids.find((c) => c.cuid === testClient.cuid)?.roles || [];
      const managerCount = roles.filter((r) => r === ROLES.MANAGER).length;
      expect(managerCount).toBe(1);
    });
  });
});
