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
    });
  });

  describe('verifyAccount', () => {
    it('should successfully verify account with valid identification data', async () => {
      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        identification: {
          idType: 'passport',
          idNumber: 'A12345678',
          expiryDate: new Date('2030-12-31'),
          authority: 'Immigration Office',
          issuingState: 'United States',
          dataProcessingConsent: true,
          issueDate: new Date('2020-01-01'),
        } as any,
      };

      const mockUpdatedClient: Partial<IClientDocument> = {
        ...mockClient,
        isVerified: true,
        verifiedAt: new Date(),
        verifiedBy: mockUserId,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);
      mockClientDAO.updateById.mockResolvedValue(mockUpdatedClient as IClientDocument);

      const result = await clientService.verifyAccount(mockContext);

      expect(result.success).toBe(true);
      expect(result.data.isVerified).toBe(true);
      expect(mockClientDAO.updateById).toHaveBeenCalledWith(
        mockClientId.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            isVerified: true,
            verifiedBy: mockUserId,
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
      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: true,
        identification: {
          idType: 'passport',
          idNumber: 'A12345678',
          expiryDate: new Date('2030-12-31'),
          authority: 'Immigration Office',
          issuingState: 'United States',
          dataProcessingConsent: true,
          issueDate: new Date('2020-01-01'),
        } as any,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(
        new BadRequestError({ message: 'Account is already verified' })
      );
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when identification data is missing', async () => {
      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        identification: undefined,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(
        new BadRequestError({ message: 'Identification information is required' })
      );
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when required fields are missing', async () => {
      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        identification: {
          idType: 'passport',
          idNumber: '', // Missing
          expiryDate: new Date('2030-12-31'),
          authority: '', // Missing
          issuingState: 'United States',
          dataProcessingConsent: true,
          issueDate: new Date('2020-01-01'),
        } as any,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(BadRequestError);
      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(
        /Verification failed/
      );
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when ID type is invalid', async () => {
      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        identification: {
          idType: 'invalid-type' as any,
          idNumber: 'A12345678',
          expiryDate: new Date('2030-12-31'),
          authority: 'Immigration Office',
          issuingState: 'United States',
          dataProcessingConsent: true,
          issueDate: new Date('2020-01-01'),
        } as any,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(BadRequestError);
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when document has expired', async () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        identification: {
          idType: 'passport',
          idNumber: 'A12345678',
          expiryDate: yesterday,
          authority: 'Immigration Office',
          issuingState: 'United States',
          dataProcessingConsent: true,
          issueDate: new Date('2020-01-01'),
        } as any,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(BadRequestError);
      await expect(clientService.verifyAccount(mockContext)).rejects.toMatchObject({
        errorInfo: {
          validationErrors: expect.arrayContaining([
            'Document has expired. Please provide a valid document.',
          ]),
        },
      });
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should throw BadRequestError when data processing consent is not given', async () => {
      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        identification: {
          idType: 'passport',
          idNumber: 'A12345678',
          expiryDate: new Date('2030-12-31'),
          authority: 'Immigration Office',
          issuingState: 'United States',
          dataProcessingConsent: false,
          issueDate: new Date('2020-01-01'),
        } as any,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(BadRequestError);
      expect(mockClientDAO.updateById).not.toHaveBeenCalled();
    });

    it('should accept all valid ID types', async () => {
      const validIdTypes = ['passport', 'national-id', 'drivers-license', 'corporation-license'];

      for (const idType of validIdTypes) {
        const mockClient: Partial<IClientDocument> = {
          _id: mockClientId,
          cuid: 'TEST123',
          isVerified: false,
          identification: {
            idType: idType as any,
            idNumber: 'A12345678',
            expiryDate: new Date('2030-12-31'),
            authority: 'Immigration Office',
            issuingState: 'United States',
            dataProcessingConsent: true,
            issueDate: new Date('2020-01-01'),
          } as any,
        };

        const mockUpdatedClient: Partial<IClientDocument> = {
          ...mockClient,
          isVerified: true,
          verifiedAt: new Date(),
          verifiedBy: mockUserId,
        };

        mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);
        mockClientDAO.updateById.mockResolvedValue(mockUpdatedClient as IClientDocument);

        const result = await clientService.verifyAccount(mockContext);

        expect(result.success).toBe(true);
        expect(result.data.isVerified).toBe(true);
      }
    });

    it('should throw BadRequestError when update fails', async () => {
      const mockClient: Partial<IClientDocument> = {
        _id: mockClientId,
        cuid: 'TEST123',
        isVerified: false,
        identification: {
          idType: 'passport',
          idNumber: 'A12345678',
          expiryDate: new Date('2030-12-31'),
          authority: 'Immigration Office',
          issuingState: 'United States',
          dataProcessingConsent: true,
          issueDate: new Date('2020-01-01'),
        } as any,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient as IClientDocument);
      mockClientDAO.updateById.mockResolvedValue(null);

      await expect(clientService.verifyAccount(mockContext)).rejects.toThrow(
        new BadRequestError({ message: 'Failed to verify account' })
      );
    });
  });
});
