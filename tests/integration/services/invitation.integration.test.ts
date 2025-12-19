import { Types } from 'mongoose';
import { UserService } from '@services/user/user.service';
import { VendorService } from '@services/vendor/vendor.service';
import { ProfileService } from '@services/profile/profile.service';
import { IUserRole, ROLES } from '@shared/constants/roles.constants';
import { BadRequestError, ConflictError } from '@shared/customErrors';
import { Invitation, Profile, Client, Lease, User } from '@models/index';
import { InvitationService } from '@services/invitation/invitation.service';
import { InvitationDAO, ProfileDAO, ClientDAO, LeaseDAO, UserDAO } from '@dao/index';
import { mockQueueFactory, mockEventEmitter, mockEmailQueue } from '@tests/setup/externalMocks';
import {
  createTestInvitation,
  createTestAdminUser,
  clearTestDatabase,
  setupTestDatabase,
  createTestClient,
  createTestUser,
  SeededTestData,
  seedTestData,
} from '@tests/helpers';

const mockMediaUploadService = {
  handleAvatarDeletion: jest.fn().mockResolvedValue(undefined),
  uploadFile: jest.fn().mockResolvedValue({ success: true }),
};

describe('InvitationService Integration Tests', () => {
  let invitationService: InvitationService;
  let profileService: ProfileService;
  let userService: UserService;
  let vendorService: VendorService;

  let invitationDAO: InvitationDAO;
  let userDAO: UserDAO;
  let clientDAO: ClientDAO;
  let profileDAO: ProfileDAO;
  let leaseDAO: LeaseDAO;

  const createMockContext = (cuid: string) => ({
    request: {
      params: { cuid },
      url: '/invitations',
      method: 'GET',
      path: '/invitations',
      query: {},
    },
    userAgent: {
      browser: 'Chrome',
      version: '120.0',
      os: 'MacOS',
      raw: 'test',
      isMobile: false,
      isBot: false,
    },
    langSetting: { lang: 'en', t: jest.fn((key: string) => key) },
    timing: { startTime: Date.now() },
    currentuser: { sub: new Types.ObjectId().toString() },
    service: { env: 'test' },
    source: 'WEB' as any,
    requestId: 'req-123',
    timestamp: new Date(),
  });

  beforeAll(async () => {
    await setupTestDatabase();

    invitationDAO = new InvitationDAO();
    userDAO = new UserDAO({ userModel: User });
    clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
    profileDAO = new ProfileDAO({ profileModel: Profile });
    leaseDAO = new LeaseDAO({ leaseModel: Lease });

    userService = new UserService({
      userDAO,
      clientDAO,
      profileDAO,
      queueFactory: mockQueueFactory as any,
      emitterService: mockEventEmitter as any,
    } as any);

    vendorService = new VendorService({
      vendorDAO: {} as any,
      userDAO,
      profileDAO,
      queueFactory: mockQueueFactory as any,
      emitterService: mockEventEmitter as any,
    } as any);

    profileService = new ProfileService({
      profileDAO,
      userDAO,
      clientDAO,
      emitterService: mockEventEmitter as any,
      mediaUploadService: mockMediaUploadService as any,
      vendorService,
      userService,
    });

    invitationService = new InvitationService({
      invitationDAO,
      userDAO,
      clientDAO,
      profileDAO,
      queueFactory: mockQueueFactory as any,
      emitterService: mockEventEmitter as any,
      profileService,
      vendorService,
      userService,
      leaseDAO,
    });
  });

  // =========================================================================
  // WRITE TESTS - Create fresh data for each test (mutations)
  // =========================================================================
  describe('Write Operations', () => {
    let testClient: any;
    let adminUser: any;

    beforeEach(async () => {
      await clearTestDatabase();
      jest.clearAllMocks();

      // Create fresh test data for mutations
      testClient = await createTestClient();
      adminUser = await createTestAdminUser(testClient.cuid);
    });

    describe('sendInvitation', () => {
      it('should create invitation and persist to database', async () => {
        const invitationData = {
          inviteeEmail: `newuser-${Date.now()}@example.com`,
          role: IUserRole.STAFF,
          personalInfo: { firstName: 'John', lastName: 'Doe' },
          status: 'pending' as const,
        };

        const result = await invitationService.sendInvitation(
          adminUser._id.toString(),
          testClient.cuid,
          invitationData
        );

        // Assert: Verify result
        expect(result.success).toBe(true);
        expect(result.data.invitation).toBeDefined();
        expect(result.data.invitation.inviteeEmail).toBe(invitationData.inviteeEmail);

        // Assert: Verify data is actually in database
        const savedInvitation = await Invitation.findOne({
          inviteeEmail: invitationData.inviteeEmail,
        });
        expect(savedInvitation).not.toBeNull();
        expect(savedInvitation!.status).toBe('pending');
        expect(savedInvitation!.role).toBe(ROLES.STAFF);
        expect(savedInvitation!.clientId.toString()).toBe(testClient._id.toString());
        expect(savedInvitation!.invitedBy.toString()).toBe(adminUser._id.toString());
        expect(savedInvitation!.invitationToken).toBeDefined();
        expect(savedInvitation!.iuid).toBeDefined();

        // Assert: External email service was called
        expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
          'invitationJob',
          expect.objectContaining({
            to: invitationData.inviteeEmail,
          })
        );
      });

      it('should save draft invitation without sending email', async () => {
        const invitationData = {
          inviteeEmail: `draft-${Date.now()}@example.com`,
          role: IUserRole.MANAGER,
          personalInfo: { firstName: 'Jane', lastName: 'Smith' },
          status: 'draft' as const,
        };

        const result = await invitationService.sendInvitation(
          adminUser._id.toString(),
          testClient.cuid,
          invitationData
        );

        expect(result.success).toBe(true);

        const savedInvitation = await Invitation.findOne({
          inviteeEmail: invitationData.inviteeEmail,
        });
        expect(savedInvitation!.status).toBe('draft');
        expect(mockEmailQueue.addToEmailQueue).not.toHaveBeenCalled();
      });

      it('should prevent duplicate pending invitations for same email and client', async () => {
        const email = `duplicate-${Date.now()}@example.com`;

        await createTestInvitation(testClient, adminUser._id, {
          inviteeEmail: email,
          status: 'pending',
        });

        const invitationData = {
          inviteeEmail: email,
          role: IUserRole.STAFF,
          personalInfo: { firstName: 'Duplicate', lastName: 'User' },
          status: 'pending' as const,
        };

        await expect(
          invitationService.sendInvitation(
            adminUser._id.toString(),
            testClient.cuid,
            invitationData
          )
        ).rejects.toThrow(ConflictError);

        const invitations = await Invitation.find({ inviteeEmail: email });
        expect(invitations).toHaveLength(1);
      });

      it('should allow inviting same email to different clients', async () => {
        const client1 = await createTestClient();
        const client2 = await createTestClient();
        const admin1 = await createTestAdminUser(client1.cuid);
        const admin2 = await createTestAdminUser(client2.cuid);
        const email = `multi-client-${Date.now()}@example.com`;

        const invitationData = {
          inviteeEmail: email,
          role: IUserRole.STAFF,
          personalInfo: { firstName: 'Multi', lastName: 'Client' },
          status: 'pending' as const,
        };

        // Invite to first client
        const result1 = await invitationService.sendInvitation(
          admin1._id.toString(),
          client1.cuid,
          invitationData
        );
        expect(result1.success).toBe(true);

        // Invite SAME email to second client - should succeed
        const result2 = await invitationService.sendInvitation(
          admin2._id.toString(),
          client2.cuid,
          invitationData
        );
        expect(result2.success).toBe(true);

        // Verify TWO invitations exist
        const invitations = await Invitation.find({ inviteeEmail: email });
        expect(invitations).toHaveLength(2);

        const clientIds = invitations.map((i) => i.clientId.toString()).sort();
        expect(clientIds).toEqual([client1._id.toString(), client2._id.toString()].sort());
      });

      it('should prevent inviting existing client member', async () => {
        const client = await createTestClient();
        const adminUser = await createTestAdminUser(client.cuid);
        const existingMember = await createTestUser(client.cuid, {
          email: `existing-${Date.now()}@example.com`,
          cuids: [
            {
              cuid: client.cuid,
              roles: [ROLES.STAFF],
              isConnected: true,
              clientDisplayName: client.displayName,
            },
          ],
        });

        const invitationData = {
          inviteeEmail: existingMember.email,
          role: IUserRole.MANAGER,
          personalInfo: { firstName: 'Existing', lastName: 'Member' },
          status: 'pending' as const,
        };

        // Should throw BadRequestError (user already has access)
        await expect(
          invitationService.sendInvitation(adminUser._id.toString(), client.cuid, invitationData)
        ).rejects.toThrow();

        // No invitation should be created
        const invitations = await Invitation.find({ inviteeEmail: existingMember.email });
        expect(invitations).toHaveLength(0);
      });
    }); // End sendInvitation

    describe('revokeInvitation', () => {
      it('should update invitation status to revoked in database', async () => {
        const invitation = await createTestInvitation(testClient, adminUser._id, {
          status: 'pending',
        });

        const result = await invitationService.revokeInvitation(
          invitation.iuid,
          adminUser._id.toString(),
          'Position filled'
        );

        expect(result.success).toBe(true);

        const revokedInvitation = await Invitation.findById(invitation._id);
        expect(revokedInvitation!.status).toBe('revoked');
        expect(revokedInvitation!.revokeReason).toBe('Position filled');
        expect(revokedInvitation!.revokedBy?.toString()).toBe(adminUser._id.toString());
        expect(revokedInvitation!.revokedAt).toBeDefined();
      });

      it('should not allow revoking already accepted invitation', async () => {
        const invitation = await createTestInvitation(testClient, adminUser._id, {
          status: 'accepted',
        });

        await expect(
          invitationService.revokeInvitation(invitation.iuid, adminUser._id.toString())
        ).rejects.toThrow(BadRequestError);
      });
    });
  }); // End Write Operations

  // =========================================================================
  // READ TESTS - Use seeded data once (queries - no mutations)
  // =========================================================================
  describe('Read Operations', () => {
    let seededData: SeededTestData;

    beforeAll(async () => {
      await clearTestDatabase();
      seededData = await seedTestData();
    });

    afterAll(async () => {
      await clearTestDatabase();
    });

    describe('getInvitations', () => {
      it('should return all invitations for a client', async () => {
        // client1 has 4 invitations: pending1, pending2, declined1, revoked1
        const query = {
          cuid: seededData.clients.client1.cuid,
          page: 1,
          limit: 10,
        };

        const result = await invitationService.getInvitations(
          createMockContext(seededData.clients.client1.cuid) as any,
          query
        );

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(4);
        expect(result.data.pagination.total).toBe(4);
      });

      it('should filter invitations by status', async () => {
        // Filter for pending invitations only (should get 2: pending1, pending2)
        const query = {
          cuid: seededData.clients.client1.cuid,
          status: 'pending' as any,
          page: 1,
          limit: 10,
        };

        const result = await invitationService.getInvitations(
          createMockContext(seededData.clients.client1.cuid) as any,
          query
        );

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(2);
        expect(result.data.items.every((inv: any) => inv.status === 'pending')).toBe(true);
      });

      it('should only return invitations for specified client', async () => {
        // client1 has 4 invitations, client2 has 1 (accepted1)
        const query = {
          cuid: seededData.clients.client1.cuid,
          page: 1,
          limit: 10,
        };

        const result = await invitationService.getInvitations(
          createMockContext(seededData.clients.client1.cuid) as any,
          query
        );

        expect(result.success).toBe(true);
        expect(result.data.items).toHaveLength(4);
        expect(
          result.data.items.every(
            (inv: any) => inv.clientId.toString() === seededData.clients.client1._id.toString()
          )
        ).toBe(true);
      });
    });

    describe('getInvitationStats', () => {
      it('should return correct statistics for client invitations', async () => {
        // client1 has: 2 pending, 1 declined, 1 revoked = 4 total
        const result = await invitationService.getInvitationStats(
          seededData.clients.client1._id.toString(),
          seededData.users.admin1._id.toString()
        );

        expect(result.success).toBe(true);
        expect(result.data.total).toBe(4);
        expect(result.data.pending).toBe(2);
      });
    });
  });
});
