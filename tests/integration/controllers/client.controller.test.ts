import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { clearTestDatabase } from '@tests/helpers';
import { UserService } from '@services/user/user.service';
import { ROLES } from '@shared/constants/roles.constants';
import { ClientService } from '@services/client/client.service';
import { VendorService } from '@services/vendor/vendor.service';
import { ClientController } from '@controllers/ClientController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, describe, expect, it } from '@jest/globals';
import { PropertyUnit, Property, Profile, Client, Vendor, User } from '@models/index';
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

  const mockContext = (user: any, cuid: string, req?: any) => ({
    requestId: 'test-request-id',
    userAgent: { isMobile: false, isBot: false, raw: 'test-agent' },
    request: {
      path: req?.path ?? '/',
      method: req?.method ?? 'GET',
      params: req?.params ?? {},
      url: req?.url ?? '/',
      query: req?.query ?? {},
    },
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
      vendorCache: { getVendorDetail: jest.fn().mockResolvedValue({ success: false }), cacheVendorDetail: jest.fn(), invalidateVendor: jest.fn() } as any,
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

    const _userService = new UserService({
      clientDAO,
      userDAO,
      propertyDAO,
      profileDAO,
      userCache,
      permissionService,
      vendorService,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
      paymentDAO: {} as any,
      leaseDAO: {} as any,
      maintenanceRequestDAO: {} as any,
      paymentProcessorDAO: {} as any,
      subscriptionDAO: {} as any,
      queueFactory: { getQueue: jest.fn().mockReturnValue({ addToEmailQueue: jest.fn() }) } as any,
    });

    const authCache = {
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
      invalidateUserSession: jest.fn().mockResolvedValue(undefined),
    } as any;

    const subscriptionDAO = {
      findFirst: jest.fn().mockResolvedValue({
        planName: 'growth',
        currentSeats: 3,
        additionalSeatsCount: 2,
        additionalSeatsCost: 799,
      }),
    } as any;

    const clientService = new ClientService({
      clientDAO,
      userDAO,
      profileDAO,
      propertyDAO,
      propertyUnitDAO,
      vendorDAO: {} as any,
      authCache,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue(undefined), invalidateUserLists: jest.fn().mockResolvedValue(undefined) } as any,
      subscriptionDAO,
      subscriptionService: {} as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
      notificationService: {} as any,
      sseService: {} as any,
      paymentGatewayService: {} as any,
      paymentProcessorDAO: {} as any,
      featureFlagService: { isEnabled: jest.fn().mockReturnValue(true) } as any,
      queueFactory: { getQueue: jest.fn().mockReturnValue({ addToEmailQueue: jest.fn() }) } as any,
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

    const handle =
      (getCuid: ((req: any) => string) | 'param', fn: (req: any, res: any) => Promise<void>) =>
      async (req: any, res: any, next: any) => {
        const cuid = getCuid === 'param' ? req.params.cuid : getCuid(req);
        req.context = mockContext(adminUser, cuid, req) as any;
        try {
          await fn(req, res);
        } catch (err) {
          next(err);
        }
      };

    // Setup routes matching client.routes.ts
    app.get(
      '/api/v1/clients/:cuid/client_details',
      handle(
        (req) => testClient?.cuid ?? req.params.cuid,
        (req, res) => clientController.getClient(req, res)
      )
    );

    app.patch(
      '/api/v1/clients/:cuid/client_details',
      handle('param', (req, res) => clientController.updateClientProfile(req, res))
    );

    app.post(
      '/api/v1/clients/:cuid/users/:uid/disconnect',
      handle('param', (req, res) => clientController.disconnectUser(req, res))
    );

    app.post(
      '/api/v1/clients/:cuid/users/:uid/reconnect',
      handle('param', (req, res) => clientController.reconnectUser(req, res))
    );

    app.get(
      '/api/v1/clients/:cuid/users/:uid/roles',
      handle('param', (req, res) => clientController.getUserRoles(req, res))
    );

    app.post(
      '/api/v1/clients/:cuid/users/:uid/roles',
      handle('param', (req, res) => clientController.assignUserRole(req, res))
    );

    app.delete(
      '/api/v1/clients/:cuid/users/:uid/roles/:role',
      handle('param', (req, res) => clientController.removeUserRole(req, res))
    );

    app.patch(
      '/api/v1/clients/:cuid/users/:uid/department',
      handle('param', (req, res) => clientController.assignDepartment(req, res))
    );

    app.post(
      '/api/v1/clients/:cuid/verify-account',
      handle('param', (req, res) => clientController.verifyAccount(req, res))
    );

    app.patch(
      '/api/v1/clients/:cuid/settings/tenant-features',
      handle('param', (req, res) => clientController.updateTenantFeatures(req, res))
    );

    // Error handler — converts thrown errors to JSON responses
    app.use((err: any, _req: any, res: any, _next: any) => {
      const statusCode = err.statusCode || err.status || 500;
      res.status(statusCode).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(err.errorInfo && { errorInfo: err.errorInfo }),
      });
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();

    // createTestClient already creates an admin user (accountAdmin) with ROLES.ADMIN
    testClient = await createTestClient();
    // Reuse the account admin created by createTestClient — avoids having 2 admins which
    // breaks the "cannot disconnect last admin" guard (connectedAdmins.length would be 2)
    adminUser = await User.findById(testClient.accountAdmin);
    managerUser = await createTestUser(testClient.cuid, { roles: [ROLES.MANAGER] });
    staffUser = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });

    // adminUser already has a profile from createTestClient; create profiles for the others
    await createTestProfile(managerUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(staffUser._id, testClient._id, { type: 'employee' });
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
      expect(response.body.data.settings.timeZone).toBeDefined();
      expect(response.body.data.settings.lang).toBeDefined();
    });

    it('should include subscription seat information in response', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}/client_details`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.seatInfo).toBeDefined();
      expect(response.body.data.seatInfo).toMatchObject({
        includedSeats: expect.any(Number),
        additionalSeats: expect.any(Number),
        totalAvailable: expect.any(Number),
        maxAdditionalSeats: expect.any(Number),
        availableForPurchase: expect.any(Number),
        additionalSeatCost: expect.any(Number),
      });
    });

    it('should return correct currentSeats from subscription not total users', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}/client_details`)
        .expect(httpStatusCodes.OK);

      // Test setup has 3 employee profiles, subscription mock returns currentSeats: 3
      expect(response.body.data.currentSeats).toBe(3);
    });
  });

  describe('PATCH /clients/:cuid/client_details - updateClientProfile', () => {
    it('should update client profile successfully', async () => {
      const updateData = {
        displayName: 'Updated Company Name',
        settings: {
          timeZone: 'America/Los_Angeles',
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
          timeZone: 'Europe/London',
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
      expect(response.body.message).toContain('administrator');
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

  describe('POST /clients/:cuid/verify-account - verifyAccount', () => {
    it('should successfully verify account with valid identification data', async () => {
      // Update client with valid identification data
      await Client.findOneAndUpdate(
        { cuid: testClient.cuid },
        {
          $set: {
            isVerified: false,
            identification: {
              idType: 'passport',
              idNumber: 'A12345678',
              expiryDate: new Date('2030-12-31'),
              authority: 'Immigration Office',
              issuingState: 'United States',
              dataProcessingConsent: true,
              issueDate: new Date('2020-01-01'),
            },
          },
        }
      );

      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/verify-account`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isVerified).toBe(true);
      expect(response.body.message).toBeDefined();

      // Verify database update
      const client = await Client.findOne({ cuid: testClient.cuid });
      expect(client?.isVerified).toBe(true);
      expect(client?.identityVerification?.verifiedAt).toBeDefined();
      expect(client?.identityVerification?.verifiedBy).toBeDefined();
    });

    it('should return 400 when client is already verified', async () => {
      // Update client to verified status
      await Client.findOneAndUpdate(
        { cuid: testClient.cuid },
        {
          $set: {
            isVerified: true,
            identification: {
              idType: 'passport',
              idNumber: 'A12345678',
              expiryDate: new Date('2030-12-31'),
              authority: 'Immigration Office',
              issuingState: 'United States',
              dataProcessingConsent: true,
              issueDate: new Date('2020-01-01'),
            },
          },
        }
      );

      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/verify-account`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('already verified');
    });

    it('should verify account even when identification data is missing (validation moved to separate flow)', async () => {
      // Update client without identification data
      await Client.findOneAndUpdate(
        { cuid: testClient.cuid },
        {
          $set: {
            isVerified: false,
            identification: undefined,
          },
        }
      );

      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/verify-account`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isVerified).toBe(true);
    });

    it('should verify account regardless of identification field completeness', async () => {
      // Update client with incomplete identification data
      await Client.findOneAndUpdate(
        { cuid: testClient.cuid },
        {
          $set: {
            isVerified: false,
            identification: {
              idType: 'passport',
              idNumber: '', // Missing
              expiryDate: new Date('2030-12-31'),
              authority: 'Immigration Office',
              issuingState: 'United States',
              dataProcessingConsent: true,
              issueDate: new Date('2020-01-01'),
            },
          },
        }
      );

      const response = await request(app)
        .post(`/api/v1/clients/${testClient.cuid}/verify-account`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.isVerified).toBe(true);
    });

    it('should return 404 for non-existent client', async () => {
      const response = await request(app)
        .post('/api/v1/clients/nonexistent-cuid/verify-account')
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should accept all valid ID types', async () => {
      const validIdTypes = ['passport', 'national-id', 'drivers-license', 'corporation-license'];

      for (const idType of validIdTypes) {
        // Reset client to unverified state with valid data
        await Client.findOneAndUpdate(
          { cuid: testClient.cuid },
          {
            $set: {
              isVerified: false,
              identification: {
                idType,
                idNumber: 'A12345678',
                expiryDate: new Date('2030-12-31'),
                authority: 'Immigration Office',
                issuingState: 'United States',
                dataProcessingConsent: true,
                issueDate: new Date('2020-01-01'),
              },
            },
          }
        );

        const response = await request(app)
          .post(`/api/v1/clients/${testClient.cuid}/verify-account`)
          .expect(httpStatusCodes.OK);

        expect(response.body.success).toBe(true);
        expect(response.body.data.isVerified).toBe(true);
      }
    });
  });

  describe('PATCH /clients/:cuid/settings/tenant-features - updateTenantFeatures', () => {
    it('should update a single tenant feature toggle', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/settings/tenant-features`)
        .send({ maintenanceRequests: false })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      const updated = await Client.findOne({ cuid: testClient.cuid });
      expect(updated?.settings?.tenantFeatures?.maintenanceRequests).toBe(false);
    });

    it('should update multiple tenant feature toggles in one request', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/settings/tenant-features`)
        .send({ onlinePayments: false, guestPass: true })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      const updated = await Client.findOne({ cuid: testClient.cuid });
      expect(updated?.settings?.tenantFeatures?.onlinePayments).toBe(false);
      expect(updated?.settings?.tenantFeatures?.guestPass).toBe(true);
    });

    it('should enable tenantPortalActive', async () => {
      // First disable
      await Client.findOneAndUpdate(
        { cuid: testClient.cuid },
        { $set: { 'settings.tenantFeatures.tenantPortalActive': false } }
      );

      await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/settings/tenant-features`)
        .send({ tenantPortalActive: true })
        .expect(httpStatusCodes.OK);

      const updated = await Client.findOne({ cuid: testClient.cuid });
      expect(updated?.settings?.tenantFeatures?.tenantPortalActive).toBe(true);
    });

    it('should return 404 for non-existent client', async () => {
      const response = await request(app)
        .patch('/api/v1/clients/nonexistent-cuid-xyz/settings/tenant-features')
        .send({ maintenanceRequests: false })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should return 400 when no feature fields are provided', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/settings/tenant-features`)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should ignore unknown keys and only persist valid tenant feature fields', async () => {
      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}/settings/tenant-features`)
        .send({ maintenanceRequests: true, unknownField: 'should-be-ignored' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      const updated = await Client.findOne({ cuid: testClient.cuid });
      expect(updated?.settings?.tenantFeatures?.maintenanceRequests).toBe(true);
      expect((updated?.settings as any)?.unknownField).toBeUndefined();
    });
  });
});
