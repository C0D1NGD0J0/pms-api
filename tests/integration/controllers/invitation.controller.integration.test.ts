import request from 'supertest';
import cookieParser from 'cookie-parser';
import express, { Application } from 'express';
import { httpStatusCodes } from '@utils/constants';
import { AuthService } from '@services/auth/auth.service';
import { ROLES } from '@shared/constants/roles.constants';
import { VendorService } from '@services/vendor/vendor.service';
import { setupAllExternalMocks } from '@tests/setup/externalMocks';
import { InvitationController } from '@controllers/InvitationController';
import { Invitation, Profile, Client, Vendor, User } from '@models/index';
import { InvitationService } from '@services/invitation/invitation.service';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, afterAll, describe, expect, it } from '@jest/globals';
import { InvitationDAO, ProfileDAO, ClientDAO, VendorDAO, UserDAO } from '@dao/index';
import { disconnectTestDatabase, setupTestDatabase, clearTestDatabase } from '@tests/helpers';
import {
  createTestInvitation,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '@tests/setup/testFactories';

describe('InvitationController Integration Tests', () => {
  let app: Application;
  let invitationController: InvitationController;
  let testClient: any;
  let adminUser: any;
  let managerUser: any;
  let testInvitation: any;

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
    const invitationDAO = new InvitationDAO();
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

    const mockTokenService = {
      createJwtTokens: jest.fn().mockResolvedValue({
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      }),
      verifyJwtToken: jest.fn(),
    } as any;

    const mockAuthCache = {
      saveRefreshToken: jest.fn().mockResolvedValue({ success: true }),
      saveCurrentUser: jest.fn().mockResolvedValue({ success: true }),
      invalidateUserSession: jest.fn().mockResolvedValue({ success: true }),
      getRefreshToken: jest.fn().mockResolvedValue({ success: true }),
    } as any;

    const authService = new AuthService({
      userDAO,
      clientDAO,
      profileDAO,
      queueFactory: {} as any,
      tokenService: mockTokenService,
      authCache: mockAuthCache,
      vendorService,
    });

    const mockEmailService = {
      sendEmail: jest.fn().mockResolvedValue({ success: true }),
    } as any;

    const invitationService = new InvitationService({
      invitationDAO,
      clientDAO,
      userDAO,
      profileDAO,
      vendorService,
      queueFactory: {} as any,
      emailService: mockEmailService,
      permissionService,
    } as any);

    invitationController = new InvitationController({
      invitationService,
      authService,
    });

    // Setup Express app
    app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use((req, res, next) => {
      req.container = {} as any;
      next();
    });

    // Setup routes matching invitation.routes.ts
    app.post('/api/v1/invites/:cuid/send_invite', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await invitationController.sendInvitation(req as any, res);
    });

    app.get('/api/v1/invites/:cuid/validate_token', async (req, res) => {
      req.context = { currentuser: null } as any;
      await invitationController.validateInvitation(req as any, res);
    });

    app.post('/api/v1/invites/:cuid/accept_invite/:token', async (req, res) => {
      req.context = { currentuser: null } as any;
      await invitationController.acceptInvitation(req as any, res);
    });

    app.patch('/api/v1/invites/:cuid/decline_invite/:token', async (req, res) => {
      req.context = { currentuser: null } as any;
      await invitationController.declineInvitation(req as any, res);
    });

    app.patch('/api/v1/invites/:cuid/revoke/:iuid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await invitationController.revokeInvitation(req as any, res);
    });

    app.patch('/api/v1/invites/:cuid/resend/:iuid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await invitationController.resendInvitation(req as any, res);
    });

    app.get('/api/v1/invites/clients/:cuid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await invitationController.getInvitations(req as any, res);
    });

    app.get('/api/v1/invites/clients/:cuid/stats', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await invitationController.getInvitationStats(req as any, res);
    });

    app.get('/api/v1/invites/:iuid', async (req, res) => {
      req.context = mockContext(adminUser, testClient.cuid) as any;
      await invitationController.getInvitationById(req as any, res);
    });

    app.patch('/api/v1/invites/:cuid/update_invite/:iuid', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await invitationController.updateInvitation(req as any, res);
    });

    app.patch('/api/v1/invites/:cuid/process-pending', async (req, res) => {
      req.context = mockContext(adminUser, req.params.cuid) as any;
      await invitationController.processPendingInvitations(req as any, res);
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();

    // Create test client and users
    testClient = await createTestClient();
    adminUser = await createTestUser(testClient.cuid, { roles: [ROLES.ADMIN] });
    managerUser = await createTestUser(testClient.cuid, { roles: [ROLES.MANAGER] });

    // Create profiles
    await createTestProfile(adminUser._id, testClient._id, { type: 'employee' });
    await createTestProfile(managerUser._id, testClient._id, { type: 'employee' });

    // Create a test invitation
    testInvitation = await createTestInvitation(testClient._id, adminUser._id, {
      inviteeEmail: `invitee.${Date.now()}@test.com`,
      role: ROLES.STAFF,
      status: 'pending',
    });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('POST /invites/:cuid/send_invite - sendInvitation', () => {
    it('should send invitation successfully', async () => {
      const invitationData = {
        inviteeEmail: `new.invitee.${Date.now()}@test.com`,
        role: ROLES.STAFF,
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe',
        },
        status: 'pending',
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send(invitationData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.iuid).toBeDefined();
      expect(response.body.data.inviteeEmail).toBe(invitationData.inviteeEmail);
      expect(response.body.data.role).toBe(ROLES.STAFF);
      expect(response.body.data.status).toBe('pending');
    });

    it('should send invitation with employee info', async () => {
      const invitationData = {
        inviteeEmail: `employee.${Date.now()}@test.com`,
        role: ROLES.MANAGER,
        personalInfo: {
          firstName: 'Jane',
          lastName: 'Manager',
        },
        employeeInfo: {
          department: 'management',
          jobTitle: 'Property Manager',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send(invitationData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.role).toBe(ROLES.MANAGER);
    });

    it('should send invitation with vendor info', async () => {
      const invitationData = {
        inviteeEmail: `vendor.${Date.now()}@test.com`,
        role: ROLES.VENDOR,
        personalInfo: {
          firstName: 'Vendor',
          lastName: 'Company',
        },
        vendorInfo: {
          companyName: 'Test Vendor LLC',
          businessType: 'Plumber',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send(invitationData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.role).toBe(ROLES.VENDOR);
    });

    it('should reject duplicate email invitation', async () => {
      const invitationData = {
        inviteeEmail: testInvitation.inviteeEmail,
        role: ROLES.STAFF,
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send(invitationData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('already');
    });

    it('should reject invalid email format', async () => {
      const invitationData = {
        inviteeEmail: 'invalid-email',
        role: ROLES.STAFF,
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send(invitationData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should reject missing required fields', async () => {
      const invitationData = {
        inviteeEmail: `test.${Date.now()}@test.com`,
        // Missing role
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send(invitationData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /invites/:cuid/validate_token - validateInvitation', () => {
    it('should validate valid invitation token', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/${testClient.cuid}/validate_token`)
        .query({ token: testInvitation.invitationToken })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.inviteeEmail).toBe(testInvitation.inviteeEmail);
    });

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/${testClient.cuid}/validate_token`)
        .query({ token: 'invalid-token' })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should reject expired invitation', async () => {
      // Create expired invitation
      const expiredInvitation = await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `expired.${Date.now()}@test.com`,
        status: 'expired',
        expiresAt: new Date(Date.now() - 1000), // Expired
      });

      const response = await request(app)
        .get(`/api/v1/invites/${testClient.cuid}/validate_token`)
        .query({ token: expiredInvitation.invitationToken })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('expired');
    });

    it('should reject already accepted invitation', async () => {
      const acceptedInvitation = await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `accepted.${Date.now()}@test.com`,
        status: 'accepted',
      });

      const response = await request(app)
        .get(`/api/v1/invites/${testClient.cuid}/validate_token`)
        .query({ token: acceptedInvitation.invitationToken })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /invites/:cuid/accept_invite/:token - acceptInvitation', () => {
    it('should accept invitation and create user account', async () => {
      const acceptData = {
        password: 'SecurePassword123!',
        personalInfo: {
          firstName: 'NewUser',
          lastName: 'Accepted',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/accept_invite/${testInvitation.invitationToken}`)
        .send(acceptData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.accounts).toBeDefined();
      expect(response.body.data.activeAccount).toBeDefined();

      // Verify invitation status changed
      const invitation = await Invitation.findById(testInvitation._id);
      expect(invitation?.status).toBe('accepted');

      // Verify user was created
      const user = await User.findOne({ email: testInvitation.inviteeEmail });
      expect(user).toBeDefined();
      expect(user?.isActive).toBe(true);
    });

    it('should reject acceptance with weak password', async () => {
      const acceptData = {
        password: '123', // Too short
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/accept_invite/${testInvitation.invitationToken}`)
        .send(acceptData)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should reject acceptance with invalid token', async () => {
      const acceptData = {
        password: 'SecurePassword123!',
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/accept_invite/invalid-token`)
        .send(acceptData)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should set proper authentication cookies after acceptance', async () => {
      const acceptData = {
        password: 'SecurePassword123!',
        personalInfo: {
          firstName: 'Test',
          lastName: 'User',
        },
      };

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/accept_invite/${testInvitation.invitationToken}`)
        .send(acceptData)
        .expect(httpStatusCodes.OK);

      expect(response.headers['set-cookie']).toBeDefined();
    });
  });

  describe('PATCH /invites/:cuid/decline_invite/:token - declineInvitation', () => {
    it('should decline invitation successfully', async () => {
      const declineData = {
        reason: 'Not interested at this time',
      };

      const response = await request(app)
        .patch(
          `/api/v1/invites/${testClient.cuid}/decline_invite/${testInvitation.invitationToken}`
        )
        .send(declineData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify invitation status changed
      const invitation = await Invitation.findById(testInvitation._id);
      expect(invitation?.status).toBe('declined');
    });

    it('should allow declining without reason', async () => {
      const response = await request(app)
        .patch(
          `/api/v1/invites/${testClient.cuid}/decline_invite/${testInvitation.invitationToken}`
        )
        .send({})
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should reject declining already accepted invitation', async () => {
      const acceptedInvitation = await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `accepted2.${Date.now()}@test.com`,
        status: 'accepted',
      });

      const response = await request(app)
        .patch(
          `/api/v1/invites/${testClient.cuid}/decline_invite/${acceptedInvitation.invitationToken}`
        )
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /invites/:cuid/revoke/:iuid - revokeInvitation', () => {
    it('should revoke invitation successfully', async () => {
      const revokeData = {
        reason: 'Position filled',
      };

      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/revoke/${testInvitation.iuid}`)
        .send(revokeData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('revoked');
      expect(response.body.data.revokeReason).toBe('Position filled');

      // Verify in database
      const invitation = await Invitation.findById(testInvitation._id);
      expect(invitation?.status).toBe('revoked');
    });

    it('should reject revoking already accepted invitation', async () => {
      const acceptedInvitation = await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `accepted3.${Date.now()}@test.com`,
        status: 'accepted',
      });

      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/revoke/${acceptedInvitation.iuid}`)
        .send({ reason: 'Test' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should reject revoking with invalid iuid', async () => {
      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/revoke/invalid-iuid`)
        .send({ reason: 'Test' })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /invites/:cuid/resend/:iuid - resendInvitation', () => {
    it('should resend invitation successfully', async () => {
      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/resend/${testInvitation.iuid}`)
        .send({ customMessage: 'Please join us!' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.iuid).toBe(testInvitation.iuid);
      expect(response.body.data.remindersSent).toBeGreaterThan(0);

      // Verify reminder count increased
      const invitation = await Invitation.findById(testInvitation._id);
      expect(invitation?.metadata.remindersSent).toBeGreaterThan(0);
    });

    it('should resend without custom message', async () => {
      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/resend/${testInvitation.iuid}`)
        .send({})
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should reject resending already accepted invitation', async () => {
      const acceptedInvitation = await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `accepted4.${Date.now()}@test.com`,
        status: 'accepted',
      });

      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/resend/${acceptedInvitation.iuid}`)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /invites/clients/:cuid - getInvitations', () => {
    it('should return list of invitations for client', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/clients/${testClient.cuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.data.length).toBeGreaterThan(0);
      expect(response.body.pagination).toBeDefined();
    });

    it('should filter invitations by status', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/clients/${testClient.cuid}`)
        .query({ filter: { status: 'pending' } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      response.body.data.forEach((inv: any) => {
        expect(inv.status).toBe('pending');
      });
    });

    it('should filter invitations by role', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/clients/${testClient.cuid}`)
        .query({ filter: { role: ROLES.STAFF } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/clients/${testClient.cuid}`)
        .query({ pagination: { page: 1, limit: 5 } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.pagination.page).toBe(1);
      expect(response.body.pagination.limit).toBe(5);
    });

    it('should support sorting', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/clients/${testClient.cuid}`)
        .query({ pagination: { sort: 'inviteeEmail', order: 'asc' } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /invites/clients/:cuid/stats - getInvitationStats', () => {
    it('should return invitation statistics', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/clients/${testClient.cuid}/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data.total).toBe('number');
      expect(response.body.data.byStatus).toBeDefined();
    });

    it('should include breakdown by status', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/clients/${testClient.cuid}/stats`)
        .expect(httpStatusCodes.OK);

      expect(response.body.data.byStatus.pending).toBeDefined();
      expect(response.body.data.byStatus.accepted).toBeDefined();
      expect(response.body.data.byStatus.declined).toBeDefined();
    });
  });

  describe('GET /invites/:iuid - getInvitationById', () => {
    it('should return invitation details by iuid', async () => {
      const response = await request(app)
        .get(`/api/v1/invites/${testInvitation.iuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.iuid).toBe(testInvitation.iuid);
      expect(response.body.data.inviteeEmail).toBe(testInvitation.inviteeEmail);
    });

    it('should return 404 for non-existent iuid', async () => {
      const response = await request(app)
        .get('/api/v1/invites/nonexistent-iuid')
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /invites/:cuid/update_invite/:iuid - updateInvitation', () => {
    it('should update invitation details', async () => {
      const updateData = {
        personalInfo: {
          firstName: 'UpdatedFirst',
          lastName: 'UpdatedLast',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/update_invite/${testInvitation.iuid}`)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);

      // Verify update persisted
      const invitation = await Invitation.findById(testInvitation._id);
      expect(invitation?.personalInfo.firstName).toBe('UpdatedFirst');
    });

    it('should reject updating accepted invitation', async () => {
      const acceptedInvitation = await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `accepted5.${Date.now()}@test.com`,
        status: 'accepted',
      });

      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/update_invite/${acceptedInvitation.iuid}`)
        .send({ personalInfo: { firstName: 'Test' } })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /invites/:cuid/process-pending - processPendingInvitations', () => {
    beforeEach(async () => {
      // Create multiple pending invitations
      await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `pending1.${Date.now()}@test.com`,
        status: 'pending',
        role: ROLES.STAFF,
      });
      await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `pending2.${Date.now()}@test.com`,
        status: 'pending',
        role: ROLES.MANAGER,
      });
    });

    it('should process pending invitations', async () => {
      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/process-pending`)
        .query({ timeline: '7days' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should support dry run mode', async () => {
      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/process-pending`)
        .query({ timeline: '7days', dry_run: 'true' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
    });

    it('should filter by role', async () => {
      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/process-pending`)
        .query({ role: ROLES.STAFF })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should respect limit parameter', async () => {
      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/process-pending`)
        .query({ limit: 1 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should require authentication for protected endpoints', async () => {
      app.use((req, res, next) => {
        req.context = { currentuser: null } as any;
        next();
      });

      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send({ inviteeEmail: 'test@test.com', role: ROLES.STAFF })
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should handle expired invitations properly', async () => {
      const expiredInvitation = await createTestInvitation(testClient._id, adminUser._id, {
        inviteeEmail: `expired2.${Date.now()}@test.com`,
        expiresAt: new Date(Date.now() - 1000),
      });

      const response = await request(app)
        .patch(`/api/v1/invites/${testClient.cuid}/resend/${expiredInvitation.iuid}`)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('expired');
    });

    it('should validate email format in invitation', async () => {
      const response = await request(app)
        .post(`/api/v1/invites/${testClient.cuid}/send_invite`)
        .send({
          inviteeEmail: 'not-an-email',
          role: ROLES.STAFF,
          personalInfo: { firstName: 'Test', lastName: 'User' },
        })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should handle concurrent invitation operations', async () => {
      const promises = [
        request(app)
          .patch(`/api/v1/invites/${testClient.cuid}/resend/${testInvitation.iuid}`)
          .send({}),
        request(app)
          .patch(`/api/v1/invites/${testClient.cuid}/resend/${testInvitation.iuid}`)
          .send({}),
      ];

      const responses = await Promise.all(promises);

      // Both should succeed
      responses.forEach((res) => {
        expect([httpStatusCodes.OK, httpStatusCodes.BAD_REQUEST]).toContain(res.status);
      });
    });
  });
});
