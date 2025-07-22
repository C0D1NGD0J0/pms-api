import { Types } from 'mongoose';
import { IUserRole } from '@interfaces/user.interface';
import { RequestSource } from '@interfaces/utils.interface';
import { InvitationService } from '@services/invitation/invitation.service';
import {
  BadRequestError,
  ForbiddenError,
  ConflictError,
  NotFoundError,
} from '@shared/customErrors';
import {
  createMockInvitationAcceptance,
  createMockEventEmitterService,
  createMockInvitationQueue,
  createMockInvitationData,
  createMockInvitationDAO,
  createMockEmailQueue,
  createMockInvitation,
  createMockProfileDAO,
  createMockClientDAO,
  createMockUserDAO,
  createMockClient,
  createMockUser,
} from '@tests/helpers';

// Mock EventTypes
jest.mock('@interfaces/events.interface', () => ({
  EventTypes: {
    EMAIL_SENT: 'EMAIL_SENT',
    EMAIL_FAILED: 'EMAIL_FAILED',
    INVITATION_CREATED: 'INVITATION_CREATED',
    INVITATION_ACCEPTED: 'INVITATION_ACCEPTED',
    INVITATION_REVOKED: 'INVITATION_REVOKED',
  },
}));

describe('InvitationService', () => {
  let invitationService: InvitationService;
  let mockInvitationDAO: any;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockEmailQueue: any;
  let mockInvitationQueue: any;
  let mockEventEmitterService: any;

  beforeEach(() => {
    mockInvitationDAO = createMockInvitationDAO();
    mockUserDAO = createMockUserDAO();
    mockClientDAO = createMockClientDAO();
    mockProfileDAO = createMockProfileDAO();
    mockEmailQueue = createMockEmailQueue();
    mockInvitationQueue = createMockInvitationQueue();
    mockEventEmitterService = createMockEventEmitterService();

    invitationService = new InvitationService({
      invitationDAO: mockInvitationDAO,
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emailQueue: mockEmailQueue,
      invitationQueue: mockInvitationQueue,
      emitterService: mockEventEmitterService,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('sendInvitation', () => {
    it('should successfully send pending invitation with email', async () => {
      const inviterUserId = '507f1f77bcf86cd799439011';
      const cuid = 'test-cuid';
      const invitationData = createMockInvitationData({
        inviteeEmail: 'invitee@example.com',
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe',
        },
        role: 'manager' as any,
        status: 'pending',
      });
      const mockClient = createMockClient({ cuid });
      const mockInviter = createMockUser({
        _id: new Types.ObjectId(inviterUserId),
        cuids: [{ cuid: cuid, roles: ['admin'], isConnected: true, displayName: 'Test Client' }],
      });
      const mockInvitation = createMockInvitation({
        inviteeEmail: invitationData.inviteeEmail,
        personalInfo: invitationData.personalInfo,
        status: 'pending',
        clientId: mockClient._id,
      });

      mockUserDAO.getUserById.mockResolvedValue(mockInviter);
      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationDAO.findPendingInvitation.mockResolvedValue(null);
      mockUserDAO.getUserWithClientAccess.mockResolvedValue(null);
      mockInvitationDAO.createInvitation.mockResolvedValue(mockInvitation);
      mockEmailQueue.addToEmailQueue.mockResolvedValue({ success: true });

      const result = await invitationService.sendInvitation(inviterUserId, cuid, invitationData);

      expect(result.success).toBe(true);
      expect(result.data.invitation).toEqual(mockInvitation);

      // Verify createInvitation was called correctly
      expect(mockInvitationDAO.createInvitation).toHaveBeenCalled();
      const createInvitationCall = mockInvitationDAO.createInvitation.mock.calls[0];
      expect(createInvitationCall[0]).toMatchObject({
        inviteeEmail: invitationData.inviteeEmail,
        role: invitationData.role,
        status: 'pending',
      });
      expect(createInvitationCall[0].personalInfo).toMatchObject({
        firstName: invitationData.personalInfo.firstName,
        lastName: invitationData.personalInfo.lastName,
      });
      expect(createInvitationCall[1]).toBe(inviterUserId);

      // Verify email was queued
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        'invitationJob',
        expect.objectContaining({
          to: invitationData.inviteeEmail,
          data: expect.objectContaining({
            inviteeName: `${invitationData.personalInfo.firstName} ${invitationData.personalInfo.lastName}`,
            role: invitationData.role,
          }),
        })
      );
    });

    it('should create draft invitation without sending email', async () => {
      const inviterUserId = '507f1f77bcf86cd799439011';
      const cuid = 'test-cuid';
      const invitationData = createMockInvitationData({
        inviteeEmail: 'invitee@example.com',
        personalInfo: {
          firstName: 'Jane',
          lastName: 'Doe',
        },
        role: IUserRole.MANAGER,
        status: 'draft',
      });
      const mockClient = createMockClient({ cuid });
      const mockInviter = createMockUser({
        _id: new Types.ObjectId(inviterUserId),
        cuids: [{ cuid: cuid, roles: ['admin'], isConnected: true, displayName: 'Test Client' }],
      });
      const mockInvitation = createMockInvitation({
        inviteeEmail: invitationData.inviteeEmail,
        status: 'draft',
        clientId: mockClient._id,
      });

      mockUserDAO.getUserById.mockResolvedValue(mockInviter);
      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationDAO.findPendingInvitation.mockResolvedValue(null);
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);
      mockInvitationDAO.createInvitation.mockResolvedValue(mockInvitation);

      const result = await invitationService.sendInvitation(inviterUserId, cuid, invitationData);

      expect(result.success).toBe(true);
      expect(result.data.invitation.status).toBe('draft');
      expect(mockEmailQueue.addToEmailQueue).not.toHaveBeenCalled();
    });

    it('should prevent duplicate pending invitations', async () => {
      const inviterUserId = '507f1f77bcf86cd799439011';
      const cuid = 'test-cuid';
      const invitationData = createMockInvitationData({
        inviteeEmail: 'existing@example.com',
        role: IUserRole.MANAGER,
        status: 'pending',
      });
      const mockClient = createMockClient({ cuid });
      const mockInviter = createMockUser({
        _id: new Types.ObjectId(inviterUserId),
        cuids: [{ cuid: cuid, roles: ['admin'], isConnected: true, displayName: 'Test Client' }],
      });
      const existingInvitation = createMockInvitation({
        inviteeEmail: invitationData.inviteeEmail,
        status: 'pending',
        clientId: mockClient._id,
      });

      mockUserDAO.getUserById.mockResolvedValue(mockInviter);
      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationDAO.findPendingInvitation.mockResolvedValue(existingInvitation);

      await expect(
        invitationService.sendInvitation(inviterUserId, cuid, invitationData)
      ).rejects.toThrow(ConflictError);
    });

    it('should throw ForbiddenError when inviter lacks permissions', async () => {
      const inviterUserId = '507f1f77bcf86cd799439011';
      const cuid = 'test-cuid';
      const invitationData = createMockInvitationData();

      mockUserDAO.getUserWithClientAccess.mockResolvedValue(null);

      await expect(
        invitationService.sendInvitation(inviterUserId, cuid, invitationData)
      ).rejects.toThrow(ForbiddenError);
    });
  });

  describe('acceptInvitation', () => {
    const createMockContext = () => ({
      userAgent: {
        browser: 'Chrome',
        version: '120.0',
        os: 'MacOS',
        raw: 'Mozilla/5.0...',
        isMobile: false,
        isBot: false,
      },
      request: {
        url: '/invitation/accept',
        method: 'POST',
        path: '/invitation/accept',
        params: {},
        query: {},
      },
      langSetting: {
        lang: 'en',
        t: jest.fn((key: string) => key),
      },
      timing: {
        startTime: Date.now(),
      },
      currentuser: null,
      service: { env: 'test' },
      source: RequestSource.WEB,
      requestId: 'req-123',
      timestamp: new Date(),
    });

    it('should successfully accept invitation and create new user', async () => {
      const mockContext = createMockContext();
      const acceptanceData = createMockInvitationAcceptance({
        invitationToken: 'valid-token',
        cuid: 'test-cuid',
        userData: {
          password: 'SecurePass123!',
        },
      });
      const mockInvitation = createMockInvitation({
        inviteeEmail: 'newuser@example.com',
        personalInfo: {
          firstName: 'John',
          lastName: 'Doe',
        },
        status: 'pending',
        role: 'manager',
        invitationToken: 'valid-token',
      });
      const mockClient = createMockClient();
      const newUser = createMockUser({
        email: mockInvitation.inviteeEmail,
        _id: new Types.ObjectId('507f1f77bcf86cd799439011'),
      });

      mockInvitationDAO.findByToken.mockResolvedValue(mockInvitation);
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);
      mockClientDAO.findById.mockResolvedValue(mockClient);
      mockInvitationDAO.startSession.mockReturnValue('mock-session');
      mockInvitationDAO.withTransaction.mockImplementation(async (_session: any, callback: any) => {
        return await callback(_session);
      });
      mockUserDAO.createUserFromInvitation.mockResolvedValue(newUser);
      mockInvitationDAO.acceptInvitation.mockResolvedValue({
        ...mockInvitation,
        status: 'accepted',
      });

      const result = await invitationService.acceptInvitation(mockContext, acceptanceData);

      expect(result.success).toBe(true);
      expect(result.data.user).toEqual(newUser);
      expect(mockInvitationDAO.acceptInvitation).toHaveBeenCalledWith(
        acceptanceData.invitationToken,
        newUser._id!.toString(),
        'mock-session'
      );
    });

    it('should handle invalid invitation token', async () => {
      const mockContext = createMockContext();
      const acceptanceData = createMockInvitationAcceptance({
        invitationToken: 'invalid-token',
        cuid: 'test-cuid',
      });

      mockInvitationDAO.findByToken.mockResolvedValue(null);

      await expect(invitationService.acceptInvitation(mockContext, acceptanceData)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('validateInvitationByToken', () => {
    it('should successfully validate invitation token', async () => {
      const token = 'valid-token';
      const mockInvitation = createMockInvitation({
        invitationToken: token,
        status: 'pending',
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      });
      const mockClient = createMockClient();

      mockInvitationDAO.findByToken.mockResolvedValue(mockInvitation);
      mockClientDAO.findById.mockResolvedValue(mockClient);

      const result = await invitationService.validateInvitationByToken(token);

      expect(result.success).toBe(true);
      expect(result.data.invitation).toEqual(mockInvitation);
      expect(result.data.client).toMatchObject({
        displayName: expect.any(String),
        cuid: expect.any(String),
      });
      expect(result.data.isValid).toBe(true);
    });

    it('should reject invalid invitation token', async () => {
      const token = 'invalid-token';

      mockInvitationDAO.findByToken.mockResolvedValue(null);

      await expect(invitationService.validateInvitationByToken(token)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should reject expired invitation token', async () => {
      const token = 'expired-token';
      const expiredInvitation = createMockInvitation({
        invitationToken: token,
        status: 'pending',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        isValid: jest.fn().mockReturnValue(false), // Mock expired invitation
      });

      mockInvitationDAO.findByToken.mockResolvedValue(expiredInvitation);

      await expect(invitationService.validateInvitationByToken(token)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('revokeInvitation', () => {
    it('should successfully revoke pending invitation', async () => {
      const iuid = 'invitation-123';
      const revokerUserId = '507f1f77bcf86cd799439012';
      const reason = 'No longer needed';
      const mockClientId = new Types.ObjectId();
      const mockInvitation = createMockInvitation({
        iuid,
        status: 'pending',
        clientId: mockClientId,
      });
      const mockRevoker = createMockUser({
        _id: new Types.ObjectId(revokerUserId),
        cuids: [
          {
            cuid: mockClientId.toString(),
            roles: ['admin'],
            isConnected: true,
            displayName: 'Test Client',
          },
        ],
      });
      const revokedInvitation = {
        ...mockInvitation,
        status: 'revoked',
      };

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(mockInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockRevoker);
      mockInvitationDAO.revokeInvitation.mockResolvedValue(revokedInvitation);

      const result = await invitationService.revokeInvitation(iuid, revokerUserId, reason);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(revokedInvitation);
      expect(mockInvitationDAO.revokeInvitation).toHaveBeenCalledWith(
        iuid,
        mockInvitation.clientId.toString(),
        revokerUserId,
        reason
      );
    });

    it('should throw NotFoundError for non-existent invitation', async () => {
      const iuid = 'nonexistent-invitation';
      const revokerUserId = '507f1f77bcf86cd799439012';

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(null);

      await expect(invitationService.revokeInvitation(iuid, revokerUserId)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw ForbiddenError for unauthorized revoker', async () => {
      const iuid = 'invitation-123';
      const revokerUserId = 'unauthorized-user';
      const mockInvitation = createMockInvitation({
        iuid,
        status: 'pending',
        clientId: new Types.ObjectId(),
      });

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(mockInvitation);
      mockUserDAO.getUserWithClientAccess.mockResolvedValue(null);

      await expect(invitationService.revokeInvitation(iuid, revokerUserId)).rejects.toThrow(
        ForbiddenError
      );
    });
  });

  describe('resendInvitation', () => {
    it('should successfully resend pending invitation', async () => {
      const resendData = {
        iuid: 'invitation-123',
        customMessage: 'Please join our team!',
      };
      const resenderUserId = '507f1f77bcf86cd799439013';
      const mockClientId = new Types.ObjectId();
      const mockInvitation = createMockInvitation({
        iuid: resendData.iuid,
        status: 'pending',
        inviteeEmail: 'invitee@example.com',
        clientId: mockClientId,
        metadata: { remindersSent: 0 },
      });
      const mockResender = createMockUser({
        _id: new Types.ObjectId(resenderUserId),
        cuids: [
          {
            cuid: mockClientId.toString(),
            roles: ['admin'],
            isConnected: true,
            displayName: 'Test Client',
          },
        ],
      });
      const updatedInvitation = {
        ...mockInvitation,
        metadata: { ...mockInvitation.metadata, remindersSent: 1 },
      };

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(mockInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockResender);
      mockInvitationDAO.incrementReminderCount.mockResolvedValue(updatedInvitation);
      mockEmailQueue.addToEmailQueue.mockResolvedValue({ success: true });

      const result = await invitationService.resendInvitation(resendData, resenderUserId);

      expect(result.success).toBe(true);
      expect(mockInvitationDAO.incrementReminderCount).toHaveBeenCalledWith(
        resendData.iuid,
        mockInvitation.clientId.toString()
      );
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        'invitationJob',
        expect.objectContaining({
          to: mockInvitation.inviteeEmail,
          emailType: 'INVITATION_REMINDER',
          subject: 'email.invitation.reminderSubject',
        })
      );
    });

    it('should prevent resending draft invitations', async () => {
      const resendData = { iuid: 'draft-invitation' };
      const resenderUserId = '507f1f77bcf86cd799439013';
      const mockClientId = new Types.ObjectId();
      const draftInvitation = createMockInvitation({
        iuid: resendData.iuid,
        status: 'draft',
        clientId: mockClientId,
      });
      const mockResender = createMockUser({
        _id: new Types.ObjectId(resenderUserId),
        cuids: [
          {
            cuid: mockClientId.toString(),
            roles: ['admin'],
            isConnected: true,
            displayName: 'Test Client',
          },
        ],
      });

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(draftInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockResender);

      await expect(invitationService.resendInvitation(resendData, resenderUserId)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('getInvitations', () => {
    it('should successfully retrieve invitations for client', async () => {
      const query = {
        clientId: 'client-123',
        status: 'pending' as const,
        page: 1,
        limit: 10,
      };
      const requestorUserId = '507f1f77bcf86cd799439014';
      const mockInvitations = [
        createMockInvitation({ status: 'pending' }),
        createMockInvitation({ status: 'pending' }),
      ];

      mockUserDAO.getUserById.mockResolvedValue(
        createMockUser({
          _id: new Types.ObjectId(requestorUserId),
          cuids: [
            {
              cuid: query.clientId,
              roles: ['admin'],
              isConnected: true,
              displayName: 'Test Client',
            },
          ],
        })
      );
      mockInvitationDAO.getInvitations.mockResolvedValue({
        items: mockInvitations,
        pagination: { total: 2, page: 1, limit: 10 },
      });

      const result = await invitationService.getInvitations(query, requestorUserId);

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toHaveProperty('inviteeEmail');
      expect(result.data.items[0]).toHaveProperty('_id');
    });
  });

  describe('destroy', () => {
    it('should cleanup event listeners on destroy', async () => {
      await invitationService.destroy();

      expect(mockEventEmitterService.off).toHaveBeenCalledTimes(2);
    });
  });
});
