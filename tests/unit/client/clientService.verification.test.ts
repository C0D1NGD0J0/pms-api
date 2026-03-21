import { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { IRequestContext } from '@interfaces/utils.interface';
import { IClientDocument } from '@interfaces/client.interface';
import { ClientService } from '@services/client/client.service';
import { BadRequestError, NotFoundError } from '@shared/customErrors';

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
      subscriptionDAO: {} as any,
      subscriptionService: {} as any,
      emitterService: { emit: jest.fn(), on: jest.fn() } as any,
      notificationService: {} as any,
      sseService: {} as any,
      paymentGatewayService: {} as any,
    });
  });

  describe('verifyAccount', () => {
    const stripeVerifiedClient: Partial<IClientDocument> = {
      _id: mockClientId,
      cuid: 'TEST123',
      isVerified: false,
      dataProcessingConsent: true,
      identityVerification: {
        sessionId: 'vs_test_123',
        sessionStatus: 'stripe_verified',
        documentType: 'passport',
        issuingCountry: 'US',
      },
    };

    it('should successfully verify account when Stripe session is verified', async () => {
      const mockUpdatedClient = { ...stripeVerifiedClient, isVerified: true, identityVerification: { ...stripeVerifiedClient.identityVerification, verifiedAt: new Date(), verifiedBy: mockUserId } };
      mockClientDAO.getClientByCuid.mockResolvedValue(stripeVerifiedClient as IClientDocument);
      mockClientDAO.updateById.mockResolvedValue(mockUpdatedClient as IClientDocument);

      const result = await clientService.verifyAccount(mockContext);

      expect(result.success).toBe(true);
      expect(result.data.isVerified).toBe(true);
      expect(mockClientDAO.updateById).toHaveBeenCalledWith(
        mockClientId.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({ isVerified: true, 'identityVerification.verifiedBy': mockUserId }),
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

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(
        new BadRequestError({ message: 'Account is already verified' })
      );
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when update fails', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue(stripeVerifiedClient as IClientDocument);
      mockClientDAO.updateById.mockResolvedValue(null);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(
        new BadRequestError({ message: 'Failed to verify account' })
      );
    });
  });
});
