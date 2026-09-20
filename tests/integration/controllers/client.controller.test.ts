import request from 'supertest';
import { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { ROLES } from '@shared/constants/roles.constants';
import { ClientService } from '@services/client/client.service';
import { ClientController } from '@controllers/ClientController';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
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
  mockRequestContext,
  clearTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/helpers';

describe('ClientController Integration Tests', () => {
  let app: Application;
  let clientController: ClientController;
  let testClient: any;
  let adminUser: any;
  let managerUser: any;
  let staffUser: any;

  let resetContextOverrides: ReturnType<typeof createControllerTestApp>['resetContextOverrides'];

  // Route path constants
  const CLIENT_DETAILS_PATH = '/api/v1/clients/:cuid';
  const DISCONNECT_PATH = '/api/v1/clients/:cuid/users/:uid/disconnect';
  const RECONNECT_PATH = '/api/v1/clients/:cuid/users/:uid/reconnect';
  const ROLES_PATH = '/api/v1/clients/:cuid/users/:uid/roles';
  const REMOVE_ROLE_PATH = '/api/v1/clients/:cuid/users/:uid/roles/:role';
  const DEPARTMENT_PATH = '/api/v1/clients/:cuid/users/:uid/department';
  const VERIFY_PATH = '/api/v1/clients/:cuid/verify-account';
  const TENANT_FEATURES_PATH = '/api/v1/clients/:cuid/settings/tenant-features';

  beforeAll(async () => {
    setupAllExternalMocks();

    // Initialize DAOs
    const userDAO = new UserDAO({ userModel: User });
    const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    const profileDAO = new ProfileDAO({ profileModel: Profile });
    const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    const propertyDAO = new PropertyDAO({
      propertyModel: Property,
      propertyUnitDAO,
    });

    const authCache = {
      invalidateUserCache: jest.fn().mockResolvedValue(undefined),
      invalidateUserSession: jest.fn().mockResolvedValue(undefined),
      invalidateCurrentUser: jest.fn().mockResolvedValue(undefined),
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
      vendorDAO: new VendorDAO({ vendorModel: Vendor }),
      authCache,
      userCache: {
        invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
        invalidateUserLists: jest.fn().mockResolvedValue(undefined),
      } as any,
      subscriptionDAO,
      subscriptionService: {} as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
      notificationService: {} as any,
      sseService: { sendToUser: jest.fn().mockResolvedValue(undefined) } as any,
      paymentGatewayService: {} as any,
      paymentProcessorDAO: { findFirst: jest.fn().mockResolvedValue(null) } as any,
      featureFlagService: { isEnabled: jest.fn().mockReturnValue(true) } as any,
      queueFactory: { getQueue: jest.fn().mockReturnValue({ addToEmailQueue: jest.fn() }) } as any,
    });

    clientController = new ClientController({ clientService });

    const testApp = createControllerTestApp({
      routes: [
        {
          method: 'get',
          path: CLIENT_DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.getClient(req, res),
        },
        {
          method: 'patch',
          path: CLIENT_DETAILS_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.updateClientProfile(req, res),
        },
        {
          method: 'post',
          path: DISCONNECT_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.disconnectUser(req, res),
        },
        {
          method: 'post',
          path: RECONNECT_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.reconnectUser(req, res),
        },
        {
          method: 'get',
          path: ROLES_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.getUserRoles(req, res),
        },
        {
          method: 'post',
          path: ROLES_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.assignUserRole(req, res),
        },
        {
          method: 'delete',
          path: REMOVE_ROLE_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.removeUserRole(req, res),
        },
        {
          method: 'patch',
          path: DEPARTMENT_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.assignDepartment(req, res),
        },
        {
          method: 'post',
          path: VERIFY_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.verifyAccount(req, res),
        },
        {
          method: 'patch',
          path: TENANT_FEATURES_PATH,
          contextUser: () => adminUser,
          handler: (req, res) => clientController.updateTenantFeatures(req, res),
        },
      ],
    });

    app = testApp.app;
    resetContextOverrides = testApp.resetContextOverrides;
  });

  beforeEach(async () => {
    await clearTestDatabase();
    resetContextOverrides();

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

  describe('GET /clients/:cuid - getClient', () => {
    it('should return complete client information', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.cuid).toBe(testClient.cuid);
      expect(response.body.data.displayName).toBe(testClient.displayName);
      expect(response.body.message).toBeDefined();
    });

    it('should return 404 for non-existent client', async () => {
      const response = await request(app)
        .get('/api/v1/clients/nonexistent-cuid')
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should include client settings in response', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.settings).toBeDefined();
      expect(response.body.data.settings.timeZone).toBeDefined();
      expect(response.body.data.settings.lang).toBeDefined();
    });

    it('should include account type plan from subscription in response', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}`)
        .expect(httpStatusCodes.OK);

      // accountType.plan is derived from subscription for all users
      expect(response.body.data.accountType).toBeDefined();
      expect(response.body.data.accountType.plan).toBe('growth');
    });

    it('should include clientStats with totalProperties and totalUsers', async () => {
      const response = await request(app)
        .get(`/api/v1/clients/${testClient.cuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.clientStats).toBeDefined();
      expect(typeof response.body.data.clientStats.totalProperties).toBe('number');
      expect(typeof response.body.data.clientStats.totalUsers).toBe('number');
    });
  });

  describe('PATCH /clients/:cuid - updateClientProfile', () => {
    it('should update client profile successfully', async () => {
      const updateData = {
        displayName: 'Updated Company Name',
        settings: {
          timeZone: 'America/Los_Angeles',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/clients/${testClient.cuid}`)
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
        .patch(`/api/v1/clients/${testClient.cuid}`)
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
        .patch(`/api/v1/clients/${testClient.cuid}`)
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

      // Create a separate app where the admin's context cuid is testClient.cuid
      // while the URL targets otherClient.cuid — the service check
      // `cuid !== currentuser.client.cuid` fires and throws Forbidden.
      //
      // We build context with testClient.cuid for currentuser, but override
      // request.params to use req.params (which has otherClient.cuid from the URL).
      const { app: isolatedApp } = createControllerTestApp({
        routes: [
          {
            method: 'get',
            path: CLIENT_DETAILS_PATH,
            contextUser: () => adminUser,
            handler: (req, res) => {
              const ctx = mockRequestContext(adminUser, testClient.cuid) as any;
              // Let request.params reflect the URL's :cuid (otherClient.cuid)
              ctx.request.params = req.params;
              req.context = ctx;
              return clientController.getClient(req, res);
            },
          },
        ],
      });

      const response = await request(isolatedApp)
        .get(`/api/v1/clients/${otherClient.cuid}`)
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
        .patch(`/api/v1/clients/${testClient.cuid}`)
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
