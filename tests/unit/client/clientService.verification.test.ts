import { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { IRequestContext } from '@interfaces/utils.interface';
import { IClientDocument } from '@interfaces/client.interface';
import { ClientService } from '@services/client/client.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { PermissionService } from '@services/permission/permission.service';

describe('ClientService - Account Verification', () => {
  let clientService: ClientService;
  let mockClientDAO: jest.Mocked<ClientDAO>;

  const mockUserId = new Types.ObjectId().toString();
  const mockClientId = new Types.ObjectId();

  const mockContext: IRequestContext = {
    currentuser: {
      sub: mockUserId,
      email: 'admin@example.com',
      client: { cuid: 'TEST123', role: 'super-admin' },
    },
    request: {
      params: { cuid: 'TEST123' },
      url: '/api/v1/clients/TEST123/verify-account',
    },
    requestId: 'req-123',
  } as any;

  beforeEach(() => {
    mockClientDAO = {
      getClientByCuid: jest.fn(),
      updateById: jest.fn(),
    } as any;

    clientService = new ClientService({
      clientDAO: mockClientDAO,
      propertyDAO: {} as any,
      propertyUnitDAO: {} as any,
      userDAO: {} as any,
      profileDAO: {} as any,
      authCache: {} as any,
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
      vendorDAO: {} as any,
      featureFlagService: { isEnabled: jest.fn().mockReturnValue(true) } as any,
      permissionService: new PermissionService(),
      queueFactory: { getQueue: jest.fn().mockReturnValue({ addToEmailQueue: jest.fn() }) } as any,
      paymentProcessorDAO: {} as any,
    });
  });

  describe('verifyAccount', () => {
    const stripeVerifiedClient: Partial<IClientDocument> = {
      _id: mockClientId,
      cuid: 'TEST123',
      isVerified: false,
      identification: {
        idType: 'passport',
        idNumber: 'AB123456',
        dataProcessingConsent: true,
        expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year from now
      },
    } as any;

    it('should successfully verify account when identification data is present and valid', async () => {
      const mockUpdatedClient = {
        ...stripeVerifiedClient,
        isVerified: true,
        identityVerification: { verifiedAt: new Date(), verifiedBy: mockUserId },
      };
      mockClientDAO.getClientByCuid.mockResolvedValue(stripeVerifiedClient as IClientDocument);
      mockClientDAO.updateById.mockResolvedValue(mockUpdatedClient as IClientDocument);

      const result = await clientService.verifyAccount(mockContext);

      expect(result.success).toBe(true);
      expect(result.data.isVerified).toBe(true);
      expect(mockClientDAO.updateById).toHaveBeenCalledWith(
        mockClientId.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            isVerified: true,
            'identityVerification.verifiedBy': mockUserId,
          }),
        })
      );
    });

    it('should throw NotFoundError when client does not exist', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(NotFoundError);
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when client is already verified', async () => {
      const alreadyVerified = { ...stripeVerifiedClient, isVerified: true };
      mockClientDAO.getClientByCuid.mockResolvedValue(alreadyVerified as IClientDocument);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(BadRequestError);
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when update fails', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue(stripeVerifiedClient as IClientDocument);
      mockClientDAO.updateById.mockResolvedValue(null);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(BadRequestError);
    });
  });

  describe('handleIdentityWebhookEvent', () => {
    const sessionId = 'vs_test_123';
    const accountAdminId = new Types.ObjectId();
    let mockSSEService: { sendToUser: jest.Mock };
    let mockNotificationService: { createNotification: jest.Mock };
    let mockAuthCache: { invalidateCurrentUser: jest.Mock };
    let mockPaymentGatewayService: { retrieveIdentityVerificationSession: jest.Mock };

    const buildService = () =>
      new ClientService({
        clientDAO: mockClientDAO,
        propertyDAO: {} as any,
        propertyUnitDAO: {} as any,
        userDAO: {} as any,
        profileDAO: {} as any,
        authCache: mockAuthCache as any,
        userCache: {} as any,
        subscriptionDAO: {} as any,
        subscriptionService: {} as any,
        emitterService: { emit: jest.fn(), on: jest.fn() } as any,
        notificationService: mockNotificationService as any,
        sseService: mockSSEService as any,
        paymentGatewayService: mockPaymentGatewayService as any,
        vendorDAO: {} as any,
        featureFlagService: { isEnabled: jest.fn().mockReturnValue(true) } as any,
        permissionService: new PermissionService(),
        queueFactory: { getQueue: jest.fn() } as any,
        paymentProcessorDAO: {} as any,
      });

    beforeEach(() => {
      mockClientDAO = { findFirst: jest.fn(), updateById: jest.fn() } as any;
      mockSSEService = { sendToUser: jest.fn().mockResolvedValue(true) };
      mockNotificationService = { createNotification: jest.fn().mockResolvedValue({}) };
      mockAuthCache = { invalidateCurrentUser: jest.fn().mockResolvedValue({ success: true }) };
      mockPaymentGatewayService = {
        retrieveIdentityVerificationSession: jest.fn().mockResolvedValue({
          data: { documentType: 'passport', issuingCountry: 'CA' },
        }),
      };
      clientService = buildService();
    });

    const verifiedClient = () =>
      ({ _id: mockClientId, cuid: 'TEST123', accountAdmin: accountAdminId }) as any;

    it('marks client verified, busts admin cache, pushes SSE and persists a notification', async () => {
      mockClientDAO.findFirst.mockResolvedValue(verifiedClient());

      await clientService.handleIdentityWebhookEvent('verified', sessionId);

      expect(mockClientDAO.updateById).toHaveBeenCalledWith(
        mockClientId.toString(),
        expect.objectContaining({ $set: expect.objectContaining({ isVerified: true }) })
      );
      expect(mockAuthCache.invalidateCurrentUser).toHaveBeenCalledWith(
        accountAdminId.toString(),
        'TEST123'
      );
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        accountAdminId.toString(),
        'TEST123',
        { resource: 'identity', action: 'verified', isVerified: true },
        'resource-event'
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
        'TEST123',
        'system',
        expect.objectContaining({
          recipient: accountAdminId.toString(),
          title: 'Identity Verified',
        })
      );
    });

    it('pushes an identity requires-input resource event when Stripe needs more input', async () => {
      mockClientDAO.findFirst.mockResolvedValue(verifiedClient());

      await clientService.handleIdentityWebhookEvent('requires_input', sessionId);

      expect(mockPaymentGatewayService.retrieveIdentityVerificationSession).not.toHaveBeenCalled();
      expect(mockSSEService.sendToUser).toHaveBeenCalledWith(
        accountAdminId.toString(),
        'TEST123',
        { resource: 'identity', action: 'requires-input', sessionStatus: 'requires_input' },
        'resource-event'
      );
      expect(mockNotificationService.createNotification).toHaveBeenCalled();
    });

    it('still updates the client but skips notifications when accountAdmin is missing', async () => {
      mockClientDAO.findFirst.mockResolvedValue({ ...verifiedClient(), accountAdmin: undefined });

      await expect(
        clientService.handleIdentityWebhookEvent('verified', sessionId)
      ).resolves.toBeUndefined();

      expect(mockClientDAO.updateById).toHaveBeenCalled();
      expect(mockSSEService.sendToUser).not.toHaveBeenCalled();
      expect(mockNotificationService.createNotification).not.toHaveBeenCalled();
    });

    it('does not throw when SSE delivery fails, so the webhook is not retried', async () => {
      mockClientDAO.findFirst.mockResolvedValue(verifiedClient());
      mockSSEService.sendToUser.mockRejectedValue(new Error('redis down'));

      await expect(
        clientService.handleIdentityWebhookEvent('verified', sessionId)
      ).resolves.toBeUndefined();
      expect(mockClientDAO.updateById).toHaveBeenCalled();
    });

    it('returns early when no client matches the session', async () => {
      mockClientDAO.findFirst.mockResolvedValue(null);

      await clientService.handleIdentityWebhookEvent('verified', sessionId);

      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
      expect(mockSSEService.sendToUser).not.toHaveBeenCalled();
    });
  });
});
