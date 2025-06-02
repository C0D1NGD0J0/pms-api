/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { ClientDAO } from '@dao/clientDAO';
import { Client } from '@models/index';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';
import { IdentificationType } from '@interfaces/user.interface';
import { setupDAOTestMocks } from '@tests/mocks/dao/commonMocks';

// Setup centralized mocks
setupDAOTestMocks();

describe('ClientDAO - Unit Tests', () => {
  let clientDAO: ClientDAO;
  let mockClientModel: any;
  let mockLogger: any;

  beforeAll(() => {
    mockClientModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    clientDAO = new ClientDAO({ 
      clientModel: mockClientModel 
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getClientByCid', () => {
    describe('Successful client retrieval', () => {
      it('should get client by CID successfully', async () => {
        // Arrange
        const cid = 'client-123';
        const client = TestDataFactory.createClient({ cid });

        clientDAO.findFirst = jest.fn().mockResolvedValue(client);

        // Act
        const result = await clientDAO.getClientByCid(cid);

        // Assert
        expect(result).toEqual(client);
        expect(clientDAO.findFirst).toHaveBeenCalledWith(
          { cid },
          undefined
        );
      });

      it('should get client with find options', async () => {
        // Arrange
        const cid = 'client-456';
        const client = TestDataFactory.createClient({ cid });
        const opts = { populate: 'subscription' };

        clientDAO.findFirst = jest.fn().mockResolvedValue(client);

        // Act
        const result = await clientDAO.getClientByCid(cid, opts);

        // Assert
        expect(result).toEqual(client);
        expect(clientDAO.findFirst).toHaveBeenCalledWith(
          { cid },
          opts
        );
      });

      it('should return null for non-existent client', async () => {
        // Arrange
        const cid = 'non-existent-client';

        clientDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await clientDAO.getClientByCid(cid);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('Client retrieval errors', () => {
      it('should handle database query errors', async () => {
        // Arrange
        const cid = 'client-error';
        const dbError = new Error('Database connection failed');

        clientDAO.findFirst = jest.fn().mockRejectedValue(dbError);
        clientDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(clientDAO.getClientByCid(cid))
          .rejects.toThrow('Database connection failed');

        expect(clientDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });

  describe('createClient', () => {
    describe('Successful client creation', () => {
      it('should create client with auto-generated CID', async () => {
        // Arrange
        const clientData = TestDataFactory.createClient({ cid: undefined });
        const createdClient = { ...clientData, cid: 'client-12345', _id: 'obj-123' };

        clientDAO.insert = jest.fn().mockResolvedValue(createdClient);

        // Act
        const result = await clientDAO.createClient(clientData);

        // Assert
        expect(result).toEqual(createdClient);
        expect(clientDAO.insert).toHaveBeenCalledWith(
          expect.objectContaining({
            ...clientData,
            cid: 'client-12345',
          })
        );
      });

      it('should create client with provided CID', async () => {
        // Arrange
        const clientData = TestDataFactory.createClient({ cid: 'custom-cid' });
        const createdClient = { ...clientData, _id: 'obj-456' };

        clientDAO.insert = jest.fn().mockResolvedValue(createdClient);

        // Act
        const result = await clientDAO.createClient(clientData);

        // Assert
        expect(result).toEqual(createdClient);
        expect(clientDAO.insert).toHaveBeenCalledWith(clientData);
      });

      it('should create client with company information', async () => {
        // Arrange
        const clientData = TestDataFactory.createClient({
          companyInfo: {
            legalEntityName: 'Test Company LLC',
            tradingName: 'Test Company',
            contactInfo: {
              email: 'contact@testcompany.com',
              contactPerson: 'John Doe',
              phoneNumber: '+1234567890',
            },
            address: {
              street: '123 Business Ave',
              city: 'Business City',
              state: 'BC',
              zipCode: '12345',
              country: 'Test Country',
            },
          },
        });
        const createdClient = { ...clientData, _id: 'obj-789' };

        clientDAO.insert = jest.fn().mockResolvedValue(createdClient);

        // Act
        const result = await clientDAO.createClient(clientData);

        // Assert
        expect(result).toEqual(createdClient);
        expect(result.companyInfo.legalEntityName).toBe('Test Company LLC');
        expect(result.companyInfo.contactInfo.email).toBe('contact@testcompany.com');
      });
    });

    describe('Client creation errors', () => {
      it('should handle database insertion errors', async () => {
        // Arrange
        const clientData = TestDataFactory.createClient();
        const dbError = new Error('Validation failed');

        clientDAO.insert = jest.fn().mockRejectedValue(dbError);
        clientDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(clientDAO.createClient(clientData))
          .rejects.toThrow('Validation failed');

        expect(clientDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });

  describe('updateAccountType', () => {
    describe('Successful account type update', () => {
      it('should update account type successfully', async () => {
        // Arrange
        const clientId = 'client-obj-123';
        const accountTypeData = {
          planName: 'Premium',
          planId: 'plan-premium',
          isEnterprise: true,
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          accountType: accountTypeData,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateAccountType(clientId, accountTypeData);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: {
              'accountType.planName': 'Premium',
              'accountType.planId': 'plan-premium',
              'accountType.isEnterprise': true,
            },
          }
        );
      });

      it('should handle partial account type updates', async () => {
        // Arrange
        const clientId = 'client-obj-456';
        const partialData = {
          planName: 'Basic',
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          accountType: { ...partialData },
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateAccountType(clientId, partialData);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: {
              'accountType.planName': 'Basic',
            },
          }
        );
      });
    });

    describe('Account type update errors', () => {
      it('should handle update errors', async () => {
        // Arrange
        const clientId = 'client-obj-error';
        const accountTypeData = { planName: 'Premium' };
        const dbError = new Error('Update failed');

        clientDAO.updateById = jest.fn().mockRejectedValue(dbError);
        clientDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(clientDAO.updateAccountType(clientId, accountTypeData))
          .rejects.toThrow('Update failed');

        expect(clientDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });

  describe('updateCompanyInfo', () => {
    describe('Successful company info update', () => {
      it('should update company information successfully', async () => {
        // Arrange
        const clientId = 'client-obj-123';
        const companyInfo = {
          legalEntityName: 'Updated Company LLC',
          tradingName: 'Updated Company',
          contactInfo: {
            email: 'updated@company.com',
            contactPerson: 'Jane Smith',
          },
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          companyInfo,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateCompanyInfo(clientId, companyInfo);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: {
              'companyInfo.legalEntityName': 'Updated Company LLC',
              'companyInfo.tradingName': 'Updated Company',
              'companyInfo.contactInfo': {
                email: 'updated@company.com',
                contactPerson: 'Jane Smith',
              },
            },
          }
        );
      });

      it('should handle partial company info updates', async () => {
        // Arrange
        const clientId = 'client-obj-456';
        const partialCompanyInfo = {
          legalEntityName: 'New Legal Name',
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          companyInfo: partialCompanyInfo,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateCompanyInfo(clientId, partialCompanyInfo);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: {
              'companyInfo.legalEntityName': 'New Legal Name',
            },
          }
        );
      });
    });
  });

  describe('updateClientSettings', () => {
    describe('Successful settings update', () => {
      it('should update client settings successfully', async () => {
        // Arrange
        const clientId = 'client-obj-123';
        const settings = {
          notifications: {
            email: true,
            sms: false,
            push: true,
          },
          timezone: 'America/New_York',
          language: 'en',
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          settings,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateClientSettings(clientId, settings);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: {
              'settings.notifications': {
                email: true,
                sms: false,
                push: true,
              },
              'settings.timezone': 'America/New_York',
              'settings.language': 'en',
            },
          }
        );
      });

      it('should handle partial settings updates', async () => {
        // Arrange
        const clientId = 'client-obj-456';
        const partialSettings = {
          timezone: 'Europe/London',
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          settings: partialSettings,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateClientSettings(clientId, partialSettings);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: {
              'settings.timezone': 'Europe/London',
            },
          }
        );
      });
    });
  });

  describe('updateIdentification', () => {
    describe('Successful identification update', () => {
      it('should update identification successfully', async () => {
        // Arrange
        const clientId = 'client-obj-123';
        const identification: IdentificationType = {
          type: 'businessLicense',
          number: 'BL123456789',
          issuedBy: 'State Business Bureau',
          issuedDate: new Date('2024-01-01'),
          expiryDate: new Date('2025-01-01'),
          verified: true,
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          identification,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateIdentification(clientId, identification);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: { identification },
          }
        );
      });

      it('should handle different identification types', async () => {
        // Arrange
        const clientId = 'client-obj-456';
        const identification: IdentificationType = {
          type: 'taxId',
          number: 'TAX987654321',
          issuedBy: 'Internal Revenue Service',
          issuedDate: new Date('2023-01-01'),
          verified: false,
        };

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          identification,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateIdentification(clientId, identification);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(result.identification.type).toBe('taxId');
        expect(result.identification.verified).toBe(false);
      });
    });
  });

  describe('updateSubscription', () => {
    describe('Successful subscription update', () => {
      it('should update subscription with valid subscription ID', async () => {
        // Arrange
        const clientId = 'client-obj-123';
        const subscriptionId = 'subscription-456';

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          subscription: subscriptionId,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateSubscription(clientId, subscriptionId);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: { subscription: expect.any(Object) }, // ObjectId
          }
        );
      });

      it('should remove subscription when subscriptionId is null', async () => {
        // Arrange
        const clientId = 'client-obj-456';
        const subscriptionId = null;

        const updatedClient = TestDataFactory.createClient({
          _id: clientId,
          subscription: null,
        });

        clientDAO.updateById = jest.fn().mockResolvedValue(updatedClient);

        // Act
        const result = await clientDAO.updateSubscription(clientId, subscriptionId);

        // Assert
        expect(result).toEqual(updatedClient);
        expect(clientDAO.updateById).toHaveBeenCalledWith(
          clientId,
          {
            $set: { subscription: null },
          }
        );
      });
    });
  });

  describe('getClientsByAccountAdmin', () => {
    describe('Successful admin clients retrieval', () => {
      it('should get clients by account admin', async () => {
        // Arrange
        const adminId = 'admin-123';
        const clients = [
          TestDataFactory.createClient({ accountAdmin: adminId }),
          TestDataFactory.createClient({ accountAdmin: adminId }),
        ];

        const paginatedResult = {
          data: clients,
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
            pages: 1,
          },
        };

        clientDAO.list = jest.fn().mockResolvedValue(paginatedResult);

        // Act
        const result = await clientDAO.getClientsByAccountAdmin(adminId);

        // Assert
        expect(result).toEqual(paginatedResult);
        expect(clientDAO.list).toHaveBeenCalledWith(
          { accountAdmin: expect.any(Object) }, // ObjectId
          undefined
        );
      });

      it('should handle empty admin clients list', async () => {
        // Arrange
        const adminId = 'admin-empty';
        const emptyResult = {
          data: [],
          pagination: {
            page: 1,
            limit: 10,
            total: 0,
            pages: 0,
          },
        };

        clientDAO.list = jest.fn().mockResolvedValue(emptyResult);

        // Act
        const result = await clientDAO.getClientsByAccountAdmin(adminId);

        // Assert
        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });
    });
  });

  describe('searchClients', () => {
    describe('Successful client search', () => {
      it('should search clients by CID', async () => {
        // Arrange
        const searchTerm = 'client-123';
        const matchingClients = [
          TestDataFactory.createClient({ cid: 'client-123' }),
        ];

        const searchResult = {
          data: matchingClients,
          pagination: {
            page: 1,
            limit: 10,
            total: 1,
            pages: 1,
          },
        };

        clientDAO.list = jest.fn().mockResolvedValue(searchResult);

        // Act
        const result = await clientDAO.searchClients(searchTerm);

        // Assert
        expect(result).toEqual(searchResult);
        expect(clientDAO.list).toHaveBeenCalledWith(
          {
            $or: [
              { cid: { $regex: searchTerm, $options: 'i' } },
              { 'companyInfo.legalEntityName': { $regex: searchTerm, $options: 'i' } },
              { 'companyInfo.tradingName': { $regex: searchTerm, $options: 'i' } },
              { 'companyInfo.contactInfo.email': { $regex: searchTerm, $options: 'i' } },
              { 'companyInfo.contactInfo.contactPerson': { $regex: searchTerm, $options: 'i' } },
            ],
          },
          undefined
        );
      });

      it('should search clients by company name', async () => {
        // Arrange
        const searchTerm = 'Test Company';
        const matchingClients = [
          TestDataFactory.createClient({
            companyInfo: {
              legalEntityName: 'Test Company LLC',
              tradingName: 'Test Company',
            },
          }),
        ];

        const searchResult = {
          data: matchingClients,
          pagination: { page: 1, limit: 10, total: 1, pages: 1 },
        };

        clientDAO.list = jest.fn().mockResolvedValue(searchResult);

        // Act
        const result = await clientDAO.searchClients(searchTerm);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(result.data[0].companyInfo.legalEntityName).toContain('Test Company');
      });

      it('should search clients by email', async () => {
        // Arrange
        const searchTerm = 'contact@example.com';
        const matchingClients = [
          TestDataFactory.createClient({
            companyInfo: {
              contactInfo: {
                email: 'contact@example.com',
              },
            },
          }),
        ];

        const searchResult = {
          data: matchingClients,
          pagination: { page: 1, limit: 10, total: 1, pages: 1 },
        };

        clientDAO.list = jest.fn().mockResolvedValue(searchResult);

        // Act
        const result = await clientDAO.searchClients(searchTerm);

        // Assert
        expect(result.data).toHaveLength(1);
        expect(result.data[0].companyInfo.contactInfo.email).toBe('contact@example.com');
      });

      it('should handle empty search results', async () => {
        // Arrange
        const searchTerm = 'nonexistent';
        const emptyResult = {
          data: [],
          pagination: { page: 1, limit: 10, total: 0, pages: 0 },
        };

        clientDAO.list = jest.fn().mockResolvedValue(emptyResult);

        // Act
        const result = await clientDAO.searchClients(searchTerm);

        // Assert
        expect(result.data).toHaveLength(0);
        expect(result.pagination.total).toBe(0);
      });
    });
  });

  describe('doesClientExist', () => {
    describe('Client existence check', () => {
      it('should return true for existing client', async () => {
        // Arrange
        const cid = 'existing-client';

        clientDAO.countDocuments = jest.fn().mockResolvedValue(1);

        // Act
        const result = await clientDAO.doesClientExist(cid);

        // Assert
        expect(result).toBe(true);
        expect(clientDAO.countDocuments).toHaveBeenCalledWith({ cid });
      });

      it('should return false for non-existent client', async () => {
        // Arrange
        const cid = 'non-existent-client';

        clientDAO.countDocuments = jest.fn().mockResolvedValue(0);

        // Act
        const result = await clientDAO.doesClientExist(cid);

        // Assert
        expect(result).toBe(false);
        expect(clientDAO.countDocuments).toHaveBeenCalledWith({ cid });
      });
    });

    describe('Client existence check errors', () => {
      it('should handle database query errors', async () => {
        // Arrange
        const cid = 'error-client';
        const dbError = new Error('Database error');

        clientDAO.countDocuments = jest.fn().mockRejectedValue(dbError);
        clientDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(clientDAO.doesClientExist(cid))
          .rejects.toThrow('Database error');

        expect(clientDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });
});