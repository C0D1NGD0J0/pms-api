import { Types } from 'mongoose';
import { ClientDAO } from '@dao/clientDAO';
import { Client, User } from '@models/index';
import { ROLES } from '@shared/constants/roles.constants';
import {
  disconnectTestDatabase,
  clearTestDatabase,
  setupTestDatabase,
} from '@tests/helpers';

describe('ClientDAO Integration Tests', () => {
  let clientDAO: ClientDAO;
  let testAdminId: Types.ObjectId;

  beforeAll(async () => {
    await setupTestDatabase();
    clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
    testAdminId = new Types.ObjectId();

    await User.create({
      _id: testAdminId,
      uid: 'admin-uid',
      email: 'admin@example.com',
      firstName: 'Admin',
      lastName: 'User',
      password: 'hashed',
      activecuid: 'TEST_CUID',
      cuids: [{ cuid: 'TEST_CUID', clientDisplayName: 'Test Client', roles: [ROLES.SUPER_ADMIN], isConnected: true }],
    });
  });

  describe('createClient', () => {
    it('should create client with auto-generated cuid', async () => {
      const client = await clientDAO.createClient({
        displayName: 'Test Company',
        status: 'active',
        accountAdmin: testAdminId,
        accountType: { category: 'individual' },
      });

      expect(client).toBeDefined();
      expect(client.cuid).toBeDefined();
      expect(client.displayName).toBe('Test Company');
    });

    it('should use provided cuid if given', async () => {
      const client = await clientDAO.createClient({
        cuid: 'CUSTOM_CUID',
        displayName: 'Custom Company',
        status: 'active',
        accountAdmin: testAdminId,
        accountType: { category: 'individual' },
      });

      expect(client.cuid).toBe('CUSTOM_CUID');
    });
  });

  describe('getClientByCuid', () => {
    it('should find client by cuid', async () => {
      await Client.create({
        accountType: { category: 'individual' },
        cuid: 'FIND_ME',
        displayName: 'Findable Company',
        status: 'active',
        accountAdmin: testAdminId,
      });

      const client = await clientDAO.getClientByCuid('FIND_ME');

      expect(client).not.toBeNull();
      expect(client?.displayName).toBe('Findable Company');
    });

    it('should return null for non-existent cuid', async () => {
      const client = await clientDAO.getClientByCuid('NON_EXISTENT');

      expect(client).toBeNull();
    });
  });

  describe('updateCompanyInfo', () => {
    it('should update company profile fields', async () => {
      const client = await Client.create({
        accountType: { category: 'individual' },
        cuid: 'UPDATE_ME',
        displayName: 'Old Name',
        status: 'active',
        accountAdmin: testAdminId,
      });

      const updated = await clientDAO.updateCompanyInfo(client._id.toString(), {
        legalName: 'New Legal Name Inc.',
        industry: 'Technology',
      });

      expect(updated?.companyProfile?.legalName).toBe('New Legal Name Inc.');
      expect(updated?.companyProfile?.industry).toBe('Technology');
    });
  });

  describe('updateClientSettings', () => {
    it('should update client settings', async () => {
      const client = await Client.create({
        accountType: { category: 'individual' },
        cuid: 'SETTINGS_TEST',
        displayName: 'Settings Company',
        status: 'active',
        accountAdmin: testAdminId,
        settings: {
          timezone: 'America/Toronto',
          currency: 'USD',
          dateFormat: 'MM/DD/YYYY',
        },
      });

      const updated = await clientDAO.updateClientSettings(client._id.toString(), {
        timezone: 'America/Los_Angeles',
        currency: 'CAD',
      });

      expect(updated?.settings?.timezone).toBe('America/Los_Angeles');
      expect(updated?.settings?.currency).toBe('CAD');
    });
  });

  describe('updateAccountType', () => {
    it('should update account type information', async () => {
      const client = await Client.create({
        accountType: { category: 'individual' },
        cuid: 'ACCOUNT_TYPE',
        displayName: 'Account Type Test',
        status: 'active',
        accountAdmin: testAdminId,
      });

      const updated = await clientDAO.updateAccountType(client._id.toString(), {
        category: 'business',
        isEnterpriseAccount: true,
      });

      expect(updated?.accountType?.category).toBe('business');
      expect(updated?.accountType?.isEnterpriseAccount).toBe(true);
    });
  });

  describe('getClientsByAccountAdmin', () => {
    it('should find all clients for account admin', async () => {
      await Client.insertMany([
        {
          accountType: { category: 'individual' },
          cuid: 'CLIENT_1',
          displayName: 'Company One',
          status: 'active',
          accountAdmin: testAdminId,
        },
        {
          accountType: { category: 'individual' },
          cuid: 'CLIENT_2',
          displayName: 'Company Two',
          status: 'active',
          accountAdmin: testAdminId,
        },
      ]);

      const result = await clientDAO.getClientsByAccountAdmin(testAdminId.toString());

      expect(result.items.length).toBe(2);
      expect(result.pagination?.total).toBe(2);
    });
  });

  describe('updateClientStatus', () => {
    it('should change client status', async () => {
      const client = await Client.create({
        accountType: { category: 'individual' },
        cuid: 'STATUS_TEST',
        displayName: 'Status Company',
        status: 'active',
        accountAdmin: testAdminId,
      });

      const updated = await clientDAO.updateById(client._id.toString(), {
        $set: { status: 'suspended' },
      });

      expect(updated?.status).toBe('suspended');
    });
  });
});
