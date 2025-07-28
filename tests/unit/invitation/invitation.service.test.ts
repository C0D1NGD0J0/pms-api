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

  // Common test data
  const testUserId = '507f1f77bcf86cd799439011';
  const testCuid = 'test-cuid';
  const testEmail = 'test@example.com';

  const createMockContext = (overrides: any = {}) => ({
    request: {
      params: { cuid: testCuid, iuid: 'invitation-123' },
      url: '/invitations',
      method: 'GET',
      path: '/invitations',
      query: {},
    },
    userAgent: {
      browser: 'Chrome',
      version: '120.0',
      os: 'MacOS',
      raw: 'Mozilla/5.0...',
      isMobile: false,
      isBot: false,
    },
    langSetting: {
      lang: 'en',
      t: jest.fn((key: string) => key),
    },
    timing: { startTime: Date.now() },
    currentuser: { sub: testUserId },
    service: { env: 'test' },
    source: RequestSource.WEB,
    requestId: 'req-123',
    timestamp: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    mockInvitationDAO = createMockInvitationDAO();
    mockUserDAO = createMockUserDAO();
    mockClientDAO = createMockClientDAO();
    mockProfileDAO = createMockProfileDAO();
    mockEmailQueue = createMockEmailQueue();
    mockInvitationQueue = createMockInvitationQueue();
    mockEventEmitterService = createMockEventEmitterService();

    // Add missing methods to the mocks
    mockInvitationDAO.updateInvitation = jest.fn().mockResolvedValue(createMockInvitation());
    mockInvitationDAO.updateInvitationStatus = jest.fn().mockResolvedValue(createMockInvitation());
    mockClientDAO.findById = jest.fn().mockResolvedValue(createMockClient());
    mockClientDAO.getClientByCuid = jest.fn().mockResolvedValue(createMockClient());
    mockUserDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(null);
    mockUserDAO.getUserWithClientAccess = jest.fn().mockResolvedValue(null);

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
    const setupMocks = (status: 'pending' | 'draft' = 'pending') => {
      const mockClient = createMockClient({ cuid: testCuid });
      const mockInviter = createMockUser({
        _id: new Types.ObjectId(testUserId),
        cuids: [{ cuid: testCuid, roles: ['admin'], isConnected: true, displayName: 'Test Client' }],
      });
      const mockInvitation = createMockInvitation({
        inviteeEmail: testEmail,
        status,
        clientId: mockClient._id,
      });

      mockUserDAO.getUserById.mockResolvedValue(mockInviter);
      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationDAO.findPendingInvitation.mockResolvedValue(null);
      mockUserDAO.getUserWithClientAccess.mockResolvedValue(null);
      mockInvitationDAO.createInvitation.mockResolvedValue(mockInvitation);
      mockEmailQueue.addToEmailQueue.mockResolvedValue({ success: true });

      return { mockClient, mockInviter, mockInvitation };
    };

    it('should successfully send pending invitation with email', async () => {
      const { mockInvitation } = setupMocks('pending');
      const invitationData = createMockInvitationData({
        inviteeEmail: testEmail,
        personalInfo: { firstName: 'John', lastName: 'Doe' },
        role: 'manager' as any,
        status: 'pending',
      });

      const result = await invitationService.sendInvitation(testUserId, testCuid, invitationData);

      expect(result.success).toBe(true);
      expect(result.data.invitation).toEqual(mockInvitation);
      expect(mockInvitationDAO.createInvitation).toHaveBeenCalled();
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        'invitationJob',
        expect.objectContaining({ to: testEmail })
      );
    });

    it('should create draft invitation without sending email', async () => {
      const { mockInvitation } = setupMocks('draft');
      const invitationData = createMockInvitationData({
        inviteeEmail: testEmail,
        status: 'draft',
      });

      const result = await invitationService.sendInvitation(testUserId, testCuid, invitationData);

      expect(result.success).toBe(true);
      expect(result.data.invitation.status).toBe('draft');
      expect(mockEmailQueue.addToEmailQueue).not.toHaveBeenCalled();
    });

    it('should prevent duplicate pending invitations', async () => {
      setupMocks();
      const existingInvitation = createMockInvitation({ inviteeEmail: testEmail, status: 'pending' });
      mockInvitationDAO.findPendingInvitation.mockResolvedValue(existingInvitation);

      const invitationData = createMockInvitationData({ inviteeEmail: testEmail });

      await expect(
        invitationService.sendInvitation(testUserId, testCuid, invitationData)
      ).rejects.toThrow(ConflictError);
    });

    it('should handle self-invitation prevention', async () => {
      const mockClient = createMockClient({ cuid: testCuid });
      const mockInviter = createMockUser({
        _id: new Types.ObjectId(testUserId),
        email: testEmail,
      });
      
      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUserById.mockResolvedValue(mockInviter);

      const invitationData = createMockInvitationData({ inviteeEmail: testEmail });

      await expect(
        invitationService.sendInvitation(testUserId, testCuid, invitationData)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('acceptInvitation', () => {
    it('should successfully accept invitation and create new user', async () => {
      const mockContext = createMockContext();
      const acceptanceData = createMockInvitationAcceptance({
        invitationToken: 'valid-token',
        cuid: testCuid,
        userData: { password: 'SecurePass123!' },
      });
      const mockInvitation = createMockInvitation({
        inviteeEmail: testEmail,
        status: 'pending',
        invitationToken: 'valid-token',
      });
      const mockClient = createMockClient();
      const newUser = createMockUser({ email: testEmail, _id: new Types.ObjectId(testUserId) });

      mockInvitationDAO.findByToken.mockResolvedValue(mockInvitation);
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);
      mockClientDAO.findById.mockResolvedValue(mockClient);
      mockInvitationDAO.startSession.mockReturnValue('mock-session');
      mockInvitationDAO.withTransaction.mockImplementation(async (_session: any, callback: any) => {
        return await callback(_session);
      });
      mockUserDAO.createUserFromInvitation.mockResolvedValue(newUser);
      mockInvitationDAO.acceptInvitation.mockResolvedValue({ ...mockInvitation, status: 'accepted' });

      const result = await invitationService.acceptInvitation(mockContext, acceptanceData);

      expect(result.success).toBe(true);
      expect(result.data.user).toEqual(newUser);
      expect(mockInvitationDAO.acceptInvitation).toHaveBeenCalled();
    });

    it('should handle invalid invitation token', async () => {
      const mockContext = createMockContext();
      const acceptanceData = createMockInvitationAcceptance({ invitationToken: 'invalid-token' });

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
      expect(result.data.isValid).toBe(true);
    });

    it('should reject invalid invitation token', async () => {
      const token = 'invalid-token';
      mockInvitationDAO.findByToken.mockResolvedValue(null);

      await expect(invitationService.validateInvitationByToken(token)).rejects.toThrow(NotFoundError);
    });

    it('should reject expired invitation token', async () => {
      const token = 'expired-token';
      const expiredInvitation = createMockInvitation({
        invitationToken: token,
        status: 'pending',
        expiresAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        isValid: jest.fn().mockReturnValue(false),
      });

      mockInvitationDAO.findByToken.mockResolvedValue(expiredInvitation);

      await expect(invitationService.validateInvitationByToken(token)).rejects.toThrow(BadRequestError);
    });
  });

  describe('revokeInvitation', () => {
    it('should successfully revoke pending invitation', async () => {
      const iuid = 'invitation-123';
      const mockClientId = new Types.ObjectId();
      const mockInvitation = createMockInvitation({ iuid, status: 'pending', clientId: mockClientId });
      const mockRevoker = createMockUser({
        _id: new Types.ObjectId(testUserId),
        cuids: [{ cuid: mockClientId.toString(), roles: ['admin'], isConnected: true, displayName: 'Test Client' }],
      });
      const revokedInvitation = { ...mockInvitation, status: 'revoked' };

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(mockInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockRevoker);
      mockInvitationDAO.revokeInvitation.mockResolvedValue(revokedInvitation);

      const result = await invitationService.revokeInvitation(iuid, testUserId, 'No longer needed');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(revokedInvitation);
      expect(mockInvitationDAO.revokeInvitation).toHaveBeenCalled();
    });

    it('should throw NotFoundError for non-existent invitation', async () => {
      const iuid = 'nonexistent-invitation';
      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(null);

      await expect(invitationService.revokeInvitation(iuid, testUserId)).rejects.toThrow(NotFoundError);
    });

    it('should throw BadRequestError for invalid invitation status', async () => {
      const iuid = 'invitation-123';
      const mockInvitation = createMockInvitation({ iuid, status: 'accepted' });

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(mockInvitation);

      await expect(invitationService.revokeInvitation(iuid, testUserId)).rejects.toThrow(BadRequestError);
    });
  });

  describe('resendInvitation', () => {
    it('should successfully resend pending invitation', async () => {
      const resendData = { iuid: 'invitation-123', customMessage: 'Please join our team!' };
      const mockClientId = new Types.ObjectId();
      const mockInvitation = createMockInvitation({
        iuid: resendData.iuid,
        status: 'pending',
        inviteeEmail: testEmail,
        clientId: mockClientId,
        metadata: { remindersSent: 0 },
      });
      const mockResender = createMockUser({
        _id: new Types.ObjectId(testUserId),
        cuids: [{ cuid: mockClientId.toString(), roles: ['admin'], isConnected: true, displayName: 'Test Client' }],
      });
      const updatedInvitation = { ...mockInvitation, metadata: { ...mockInvitation.metadata, remindersSent: 1 } };

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(mockInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockResender);
      mockInvitationDAO.incrementReminderCount.mockResolvedValue(updatedInvitation);
      mockEmailQueue.addToEmailQueue.mockResolvedValue({ success: true });

      const result = await invitationService.resendInvitation(resendData, testUserId);

      expect(result.success).toBe(true);
      expect(mockInvitationDAO.incrementReminderCount).toHaveBeenCalled();
      expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
        'invitationJob',
        expect.objectContaining({ to: testEmail, emailType: 'INVITATION_REMINDER' })
      );
    });

    it('should prevent resending draft invitations', async () => {
      const resendData = { iuid: 'draft-invitation' };
      const mockClientId = new Types.ObjectId();
      const draftInvitation = createMockInvitation({ iuid: resendData.iuid, status: 'draft', clientId: mockClientId });
      const mockResender = createMockUser({
        _id: new Types.ObjectId(testUserId),
        cuids: [{ cuid: mockClientId.toString(), roles: ['admin'], isConnected: true, displayName: 'Test Client' }],
      });

      mockInvitationDAO.findByIuidUnsecured.mockResolvedValue(draftInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockResender);

      await expect(invitationService.resendInvitation(resendData, testUserId)).rejects.toThrow(BadRequestError);
    });
  });

  describe('updateInvitation', () => {
    it('should successfully update draft invitation', async () => {
      const mockContext = createMockContext();
      const currentUser = { sub: testUserId } as any;
      const updatedData = createMockInvitationData({
        inviteeEmail: 'updated@example.com',
        personalInfo: { firstName: 'Updated', lastName: 'User' },
        role: 'staff' as any,
      });
      const mockClient = createMockClient({ cuid: testCuid });
      const mockUpdater = createMockUser({ _id: new Types.ObjectId(testUserId), email: 'updater@example.com' });
      const existingInvitation = createMockInvitation({
        iuid: 'invitation-123',
        status: 'draft',
        clientId: mockClient._id,
      });
      const updatedInvitation = createMockInvitation({
        iuid: existingInvitation.iuid,
        inviteeEmail: updatedData.inviteeEmail,
        personalInfo: updatedData.personalInfo,
        role: updatedData.role,
        status: 'draft',
        clientId: existingInvitation.clientId,
      });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockInvitationDAO.findByIuid.mockResolvedValue(existingInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockUpdater);
      mockInvitationDAO.findPendingInvitation.mockResolvedValue(null);
      mockUserDAO.getUserWithClientAccess.mockResolvedValue(null);
      mockInvitationDAO.updateInvitation.mockResolvedValue(updatedInvitation);

      const result = await invitationService.updateInvitation(mockContext, updatedData, currentUser);

      expect(result.success).toBe(true);
      expect(result.data.invitation).toBeDefined();
      expect(mockInvitationDAO.updateInvitation).toHaveBeenCalled();
    });

    it('should throw BadRequestError for non-draft invitation', async () => {
      const mockContext = createMockContext();
      const currentUser = { sub: testUserId } as any;
      const updatedData = createMockInvitationData();
      const mockClient = createMockClient({ cuid: testCuid });
      const existingInvitation = createMockInvitation({ iuid: 'invitation-123', status: 'pending', clientId: mockClient._id });

      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationDAO.findByIuid.mockResolvedValue(existingInvitation);

      await expect(
        invitationService.updateInvitation(mockContext, updatedData, currentUser)
      ).rejects.toThrow(BadRequestError);
    });

    it('should prevent self-invitation during update', async () => {
      const mockContext = createMockContext();
      const currentUser = { sub: testUserId } as any;
      const updatedData = createMockInvitationData({ inviteeEmail: 'updater@example.com' });
      const mockClient = createMockClient({ cuid: testCuid });
      const mockUpdater = createMockUser({ _id: new Types.ObjectId(testUserId), email: 'updater@example.com' });
      const existingInvitation = createMockInvitation({ iuid: 'invitation-123', status: 'draft', clientId: mockClient._id });

      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationDAO.findByIuid.mockResolvedValue(existingInvitation);
      mockUserDAO.getUserById.mockResolvedValue(mockUpdater);

      await expect(
        invitationService.updateInvitation(mockContext, updatedData, currentUser)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('getInvitations', () => {
    it('should successfully retrieve invitations for client', async () => {
      const mockContext = createMockContext();
      const query = { cuid: testCuid, status: 'pending' as const, page: 1, limit: 10 };
      const mockInvitations = [
        createMockInvitation({ status: 'pending' }),
        createMockInvitation({ status: 'pending' }),
      ];

      mockInvitationDAO.getInvitationsByClient.mockResolvedValue({
        items: mockInvitations,
        pagination: { total: 2, page: 1, limit: 10 },
      });

      const result = await invitationService.getInvitations(mockContext, query);

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(2);
      expect(mockInvitationDAO.getInvitationsByClient).toHaveBeenCalledWith(query);
    });

    it('should handle empty invitation list', async () => {
      const mockContext = createMockContext();
      const query = { cuid: testCuid, status: 'pending' as const, page: 1, limit: 10 };

      mockInvitationDAO.getInvitationsByClient.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, limit: 10 },
      });

      const result = await invitationService.getInvitations(mockContext, query);

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(0);
      expect(result.data.pagination.total).toBe(0);
    });
  });

  describe('getInvitationStats', () => {
    it('should successfully retrieve invitation statistics', async () => {
      const clientId = 'client-123';
      const mockStats = {
        total: 100,
        pending: 25,
        accepted: 60,
        expired: 10,
        revoked: 5,
        sent: 30,
        byRole: { admin: 5, manager: 15, staff: 50, vendor: 20, tenant: 10 },
      };

      mockInvitationDAO.getInvitationStats.mockResolvedValue(mockStats);

      const result = await invitationService.getInvitationStats(clientId, testUserId);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockStats);
      expect(result.data.total).toBe(100);
      expect(mockInvitationDAO.getInvitationStats).toHaveBeenCalledWith(clientId);
    });

    it('should handle empty statistics', async () => {
      const clientId = 'empty-client';
      const emptyStats = {
        total: 0,
        pending: 0,
        accepted: 0,
        expired: 0,
        revoked: 0,
        sent: 0,
        byRole: { admin: 0, manager: 0, staff: 0, vendor: 0, tenant: 0 },
      };

      mockInvitationDAO.getInvitationStats.mockResolvedValue(emptyStats);

      const result = await invitationService.getInvitationStats(clientId, testUserId);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(0);
      expect(Object.values(result.data.byRole).every(count => count === 0)).toBe(true);
    });
  });

  describe('expireInvitations', () => {
    it('should successfully expire invitations', async () => {
      const expiredCount = 15;
      mockInvitationDAO.expireInvitations.mockResolvedValue(expiredCount);

      const result = await invitationService.expireInvitations();

      expect(result.success).toBe(true);
      expect(result.data.expiredCount).toBe(expiredCount);
      expect(result.message).toBe('invitation.success.expired');
      expect(mockInvitationDAO.expireInvitations).toHaveBeenCalledWith();
    });

    it('should handle zero expired invitations', async () => {
      const expiredCount = 0;
      mockInvitationDAO.expireInvitations.mockResolvedValue(expiredCount);

      const result = await invitationService.expireInvitations();

      expect(result.success).toBe(true);
      expect(result.data.expiredCount).toBe(0);
    });
  });

  describe('validateInvitationCsv', () => {
    const mockCsvFile = {
      originalFileName: 'invitations.csv',
      fieldName: 'csvFile',
      mimeType: 'text/csv',
      path: '/tmp/uploads/invitations.csv',
      url: 'https://storage.example.com/invitations.csv',
      key: 'uploads/invitations.csv',
      status: 'active' as const,
      filename: 'invitations.csv',
      fileSize: 1024 * 50,
      uploadedAt: new Date(),
      uploadedBy: 'user-123',
    };

    it('should successfully start CSV validation', async () => {
      const currentUser = { sub: 'user-123' } as any;
      const mockClient = createMockClient({ cuid: testCuid, displayName: 'Test Company', id: 'client-123' });
      const mockJob = { id: 'job-123' };

      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationQueue.addCsvValidationJob.mockResolvedValue(mockJob);

      const result = await invitationService.validateInvitationCsv(testCuid, mockCsvFile, currentUser);

      expect(result.success).toBe(true);
      expect(result.data.processId).toBeDefined();
      expect(mockInvitationQueue.addCsvValidationJob).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-123',
          csvFilePath: mockCsvFile.path,
          clientInfo: expect.objectContaining({ cuid: testCuid }),
        })
      );
    });

    it('should reject missing CSV file', async () => {
      const currentUser = { sub: 'user-123' } as any;

      await expect(
        invitationService.validateInvitationCsv(testCuid, null as any, currentUser)
      ).rejects.toThrow(BadRequestError);
    });

    it('should reject files that are too large', async () => {
      const largeCsvFile = { ...mockCsvFile, fileSize: 11 * 1024 * 1024 };
      const currentUser = { sub: 'user-123' } as any;
      const mockClient = createMockClient({ cuid: testCuid });

      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);

      await expect(
        invitationService.validateInvitationCsv(testCuid, largeCsvFile, currentUser)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('importInvitationsFromCsv', () => {
    it('should successfully start CSV import', async () => {
      const mockContext = createMockContext();
      const csvFilePath = '/tmp/uploads/validated-invitations.csv';
      const mockClient = createMockClient({ cuid: testCuid, displayName: 'Test Company', id: 'client-123' });
      const mockJob = { id: 'import-job-123' };

      mockClientDAO.getClientBycuid.mockResolvedValue(mockClient);
      mockInvitationQueue.addCsvImportJob.mockResolvedValue(mockJob);

      const result = await invitationService.importInvitationsFromCsv(mockContext, csvFilePath);

      expect(result.success).toBe(true);
      expect(result.data.processId).toBeDefined();
      expect(mockInvitationQueue.addCsvImportJob).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: testUserId,
          csvFilePath,
          clientInfo: expect.objectContaining({ cuid: testCuid }),
        })
      );
    });

    it('should reject missing CSV file path', async () => {
      const mockContext = createMockContext();
      const csvFilePath = '';

      await expect(
        invitationService.importInvitationsFromCsv(mockContext, csvFilePath)
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('processPendingInvitations', () => {
    it('should successfully process pending invitations', async () => {
      const filters = { timeline: '24h', role: 'staff', limit: 10 };
      const mockPendingInvitations = [
        createMockInvitation({
          iuid: 'invitation-1',
          status: 'pending',
          inviteeEmail: 'user1@example.com',
          role: 'staff',
          createdAt: new Date(Date.now() - 12 * 60 * 60 * 1000),
        }),
        createMockInvitation({
          iuid: 'invitation-2',
          status: 'pending',
          inviteeEmail: 'user2@example.com',
          role: 'staff',
          createdAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        }),
      ];

      mockInvitationDAO.getInvitationsByClient.mockResolvedValue({
        items: mockPendingInvitations,
        pagination: { total: 2, page: 1, limit: 10 },
      });

      jest.spyOn(invitationService, 'resendInvitation').mockResolvedValue({
        success: true,
        data: { invitation: mockPendingInvitations[0], emailData: {} },
        message: 'success',
      } as any);

      const result = await invitationService.processPendingInvitations(testCuid, testUserId, filters);

      expect(result.success).toBe(true);
      expect(result.data.processed).toBe(2);
      expect(result.data.failed).toBe(0);
      expect(result.data.totalFound).toBe(2);
    });

    it('should handle dry run mode', async () => {
      const filters = { dryRun: true, limit: 5 };
      const mockPendingInvitations = [
        createMockInvitation({ iuid: 'invitation-1', status: 'pending', inviteeEmail: 'user1@example.com', role: 'manager' }),
      ];

      mockInvitationDAO.getInvitationsByClient.mockResolvedValue({
        items: mockPendingInvitations,
        pagination: { total: 1, page: 1, limit: 5 },
      });

      const result = await invitationService.processPendingInvitations(testCuid, testUserId, filters);

      expect(result.success).toBe(true);
      expect(result.data.totalFound).toBe(1);
      expect(result.data.invitations).toHaveLength(1);
      expect(result.data.invitations[0]).toMatchObject({
        iuid: 'invitation-1',
        inviteeEmail: 'user1@example.com',
        role: 'manager',
      });
    });

    it('should handle processing failures', async () => {
      const filters = { limit: 5 };
      const mockPendingInvitations = [
        createMockInvitation({ iuid: 'invitation-1', status: 'pending', inviteeEmail: 'user1@example.com' }),
        createMockInvitation({ iuid: 'invitation-2', status: 'pending', inviteeEmail: 'user2@example.com' }),
      ];

      mockInvitationDAO.getInvitationsByClient.mockResolvedValue({
        items: mockPendingInvitations,
        pagination: { total: 2, page: 1, limit: 5 },
      });

      jest.spyOn(invitationService, 'resendInvitation')
        .mockResolvedValueOnce({
          success: true,
          data: { invitation: mockPendingInvitations[0], emailData: {} },
          message: 'success',
        } as any)
        .mockRejectedValueOnce(new Error('Email service unavailable'));

      const result = await invitationService.processPendingInvitations(testCuid, testUserId, filters);

      expect(result.success).toBe(true);
      expect(result.data.processed).toBe(1);
      expect(result.data.failed).toBe(1);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors![0]).toMatchObject({
        iuid: 'invitation-2',
        email: 'user2@example.com',
        error: 'Email service unavailable',
      });
    });
  });

  describe('destroy', () => {
    it('should cleanup event listeners on destroy', () => {
      invitationService.destroy();

      expect(mockEventEmitterService.off).toHaveBeenCalledTimes(2);
      expect(mockEventEmitterService.off).toHaveBeenCalledWith('EMAIL_SENT', expect.any(Function));
      expect(mockEventEmitterService.off).toHaveBeenCalledWith('EMAIL_FAILED', expect.any(Function));
    });

    it('should be callable multiple times without error', () => {
      expect(() => {
        invitationService.destroy();
        invitationService.destroy();
        invitationService.destroy();
      }).not.toThrow();

      expect(mockEventEmitterService.off).toHaveBeenCalledTimes(6);
    });
  });
});