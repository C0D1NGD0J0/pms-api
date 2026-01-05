import { ROLES } from '@shared/constants/roles.constants';
import { Profile, Client, Vendor, User } from '@models/index';
import { mockQueueFactory } from '@tests/setup/externalMocks';
import { VendorService } from '@services/vendor/vendor.service';
import { ProfileDAO, VendorDAO, ClientDAO, UserDAO } from '@dao/index';
import { PermissionService } from '@services/permission/permission.service';
import { beforeEach, beforeAll, describe, afterAll, expect, it } from '@jest/globals';

import {
  disconnectTestDatabase,
  setupAllExternalMocks,
  setupTestDatabase,
  clearTestDatabase,
  createTestClient,
  createTestUser,
  SeededTestData,
  seedTestData,
} from '../../helpers';

const setupServices = () => {
  const vendorDAO = new VendorDAO({ vendorModel: Vendor });
  const userDAO = new UserDAO({ userModel: User });
  const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
  const profileDAO = new ProfileDAO({ profileModel: Profile });
  const permissionService = new PermissionService();

  const vendorCache = {
    getVendor: jest.fn().mockResolvedValue({ success: false, data: null }),
    cacheVendor: jest.fn().mockResolvedValue(undefined),
    invalidateVendor: jest.fn().mockResolvedValue(undefined),
    getVendorList: jest.fn().mockResolvedValue({ success: false, data: null }),
    cacheVendorList: jest.fn().mockResolvedValue(undefined),
    invalidateVendorList: jest.fn().mockResolvedValue(undefined),
    getFilteredVendors: jest.fn().mockResolvedValue({ success: false, data: null }),
    saveFilteredVendors: jest.fn().mockResolvedValue(undefined),
  } as any;

  const vendorService = new VendorService({
    vendorDAO,
    userDAO,
    clientDAO,
    profileDAO,
    vendorCache,
    permissionService,
    queueFactory: mockQueueFactory as any,
    emitterService: {} as any,
  } as any);

  return { vendorService, vendorDAO, userDAO, clientDAO, profileDAO };
};

describe('VendorService Integration Tests - Write Operations', () => {
  let vendorService: VendorService;
  let _vendorDAO: VendorDAO;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    vendorService = services.vendorService;
    _vendorDAO = services.vendorDAO;
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('createVendor', () => {
    it('should successfully create vendor with valid data', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const vendorData = {
        userId: user._id.toString(),
        companyName: 'Test Plumbing Co',
        businessType: 'Plumber',
        registrationNumber: 'REG123456',
        taxId: 'TAX789',
        connectedClients: [
          {
            clientId: client._id.toString(),
            cuid: client.cuid,
            isActive: true,
            primaryAccountHolder: user._id.toString(),
          },
        ],
      };

      const result = await vendorService.createVendor(vendorData as any);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.companyName).toBe('Test Plumbing Co');
      expect(result.data.businessType).toBe('Plumber');
      expect(result.data.registrationNumber).toBe('REG123456');
      expect(result.data.connectedClients).toHaveLength(1);
      expect(result.data.connectedClients[0].cuid).toBe(client.cuid);
    });

    it('should throw BadRequestError for missing companyName', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const vendorData = {
        userId: user._id.toString(),
        businessType: 'Plumber',
        connectedClients: [
          {
            clientId: client._id.toString(),
            cuid: client.cuid,
            isActive: true,
            primaryAccountHolder: user._id.toString(),
          },
        ],
      };

      await expect(vendorService.createVendor(vendorData as any)).rejects.toThrow(
        'Company name is required'
      );
    });

    it('should find existing vendor when duplicate registration number provided', async () => {
      const client = await createTestClient();
      const client2 = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      // Create first vendor
      const existingVendor = await Vendor.create({
        vuid: `vendor-${Date.now()}`,
        userId: user._id,
        companyName: 'Original Plumbing',
        businessType: 'Plumber',
        registrationNumber: 'REG123456',
        connectedClients: [
          {
            clientId: client._id,
            cuid: client.cuid,
            isActive: true,
            primaryAccountHolder: user._id,
          },
        ],
      });

      // Try to create another with same registration number but different client
      const vendorData = {
        userId: user._id.toString(),
        companyName: 'New Plumbing',
        businessType: 'Plumber',
        registrationNumber: 'REG123456',
        connectedClients: [
          {
            clientId: client2._id.toString(),
            cuid: client2.cuid,
            isActive: true,
            primaryAccountHolder: user._id.toString(),
          },
        ],
      };

      const result = await vendorService.createVendor(vendorData as any);

      expect(result.success).toBe(true);
      expect(result.data._id.toString()).toBe(existingVendor._id.toString());
      // Company name should remain the original
      expect(result.data.companyName).toBe('Original Plumbing');
      // Should have 2 client connections now
      expect(result.data.connectedClients.length).toBe(2);
    });
  });

  describe('updateVendorInfo', () => {
    it('should successfully update vendor information', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const vendor = await Vendor.create({
        vuid: `vendor-${Date.now()}`,
        userId: user._id,
        companyName: 'Test Company',
        businessType: 'Plumber',
        registrationNumber: 'REG789',
        connectedClients: [
          {
            clientId: client._id,
            cuid: client.cuid,
            isActive: true,
            primaryAccountHolder: user._id,
          },
        ],
      });

      const updateData = {
        companyName: 'Updated Company Name',
        businessType: 'Electrician',
      };

      const result = await vendorService.updateVendorInfo(vendor.vuid, updateData);

      expect(result.success).toBe(true);
      expect(result.data.companyName).toBe('Updated Company Name');
      expect(result.data.businessType).toBe('Electrician');
    });

    it('should throw NotFoundError when vendor not found', async () => {
      const updateData = {
        companyName: 'Updated Name',
      };

      await expect(vendorService.updateVendorInfo('non-existent-vuid', updateData)).rejects.toThrow(
        'Vendor not found'
      );
    });
  });

  describe('createVendorFromCompanyProfile', () => {
    it('should create vendor with complete company profile', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const companyProfile = {
        companyName: 'Elite Services LLC',
        businessType: 'General Contractor',
        registrationNumber: 'REG999',
        taxId: 'TAX999',
        address: {
          street: '123 Main St',
          city: 'San Francisco',
          state: 'CA',
          postCode: '94102',
        },
        contactPerson: {
          name: 'John Doe',
          jobTitle: 'Manager',
          email: 'john@elite.com',
          phone: '555-1234',
        },
      };

      const result = await vendorService.createVendorFromCompanyProfile(
        client.cuid,
        user._id.toString(),
        companyProfile
      );

      expect(result).toBeDefined();
      expect(result.companyName).toBe('Elite Services LLC');
      expect(result.businessType).toBe('General Contractor');
      expect(result.address?.city).toBe('San Francisco');
      expect(result.contactPerson?.name).toBe('John Doe');
    });

    it('should use default businessType when not provided', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const companyProfile = {
        companyName: 'Basic Services',
        registrationNumber: 'BASIC123',
      };

      const result = await vendorService.createVendorFromCompanyProfile(
        client.cuid,
        user._id.toString(),
        companyProfile
      );

      expect(result).toBeDefined();
      expect(result.companyName).toBe('Basic Services');
      expect(result.businessType).toBe('professional_services');
    });
  });
});

describe('VendorService Integration Tests - Read Operations', () => {
  let vendorService: VendorService;
  let seededData: SeededTestData;
  let testVendor: any;
  let testClient: any;
  let testVendorUser: any;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    vendorService = services.vendorService;
    seededData = await seedTestData();

    // Create test vendor
    testClient = seededData.clients.client1;
    testVendorUser = await User.create({
      uid: `vendor-user-${Date.now()}`,
      email: 'vendor@test.com',
      password: '$2b$10$hashedPassword',
      firstName: 'Vendor',
      lastName: 'User',
      isActive: true,
      isEmailVerified: true,
      cuids: [
        {
          cuid: testClient.cuid,
          roles: [ROLES.VENDOR],
          clientDisplayName: testClient.displayName,
          isConnected: true,
        },
      ],
      activecuid: testClient.cuid,
    });

    testVendor = await Vendor.create({
      vuid: `vendor-${Date.now()}`,
      companyName: 'Test Vendor Company',
      businessType: 'Plumber',
      registrationNumber: 'TESTREG123',
      taxId: 'TESTTAX456',
      yearsInBusiness: 10,
      connectedClients: [
        {
          cuid: testClient.cuid,
          isConnected: true,
          primaryAccountHolder: testVendorUser._id,
        },
      ],
    });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('getVendorByUserId', () => {
    it('should successfully retrieve vendor by user ID', async () => {
      const result = await vendorService.getVendorByUserId(testVendorUser._id.toString());

      expect(result).toBeDefined();
      expect(result?.companyName).toBe('Test Vendor Company');
      expect(result?.businessType).toBe('Plumber');
      expect(result?.vuid).toBe(testVendor.vuid);
      // Verify the user is in connectedClients
      const clientConnection = result?.connectedClients.find((cc) => cc.cuid === testClient.cuid);
      expect(clientConnection).toBeDefined();
      expect(clientConnection?.primaryAccountHolder.toString()).toBe(testVendorUser._id.toString());
    });

    it('should return null when vendor not found', async () => {
      const result = await vendorService.getVendorByUserId('507f1f77bcf86cd799439011');

      expect(result).toBeNull();
    });
  });

  describe('getVendorById', () => {
    it('should successfully retrieve vendor by ID', async () => {
      const result = await vendorService.getVendorById(testVendor.vuid);

      expect(result).toBeDefined();
      expect(result?.vuid).toBe(testVendor.vuid);
      expect(result?.companyName).toBe('Test Vendor Company');
    });

    it('should return null when vendor not found', async () => {
      const result = await vendorService.getVendorById('non-existent-vuid');

      expect(result).toBeNull();
    });
  });

  describe('getClientVendors', () => {
    it('should successfully retrieve client vendors list', async () => {
      const result = await vendorService.getClientVendors(testClient.cuid);

      expect(result.items).toBeInstanceOf(Array);
      expect(result.items.length).toBeGreaterThan(0);
      const vendor = result.items.find((v) => v.vuid === testVendor.vuid);
      expect(vendor).toBeDefined();
      expect(vendor?.companyName).toBe('Test Vendor Company');
    });

    it('should return empty array for client with no vendors', async () => {
      const newClient = await Client.create({
        cuid: `test-client-no-vendors-${Date.now()}`,
        displayName: 'Client With No Vendors',
        status: 'active',
        accountAdmin: seededData.users.admin1._id,
        accountType: {
          planName: 'starter',
          planId: 'plan_starter',
        },
        contactInfo: {
          email: 'novendors@test.com',
          phone: '555-0000',
        },
      });

      const result = await vendorService.getClientVendors(newClient.cuid);

      expect(result.items).toBeInstanceOf(Array);
      expect(result.items.length).toBe(0);
    });
  });

  describe('getFilteredVendors', () => {
    it('should return vendors with proper format', async () => {
      const result = await vendorService.getFilteredVendors(
        testClient.cuid,
        {},
        { limit: 10, skip: 0 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toBeInstanceOf(Array);
      expect(result.data.pagination).toBeDefined();

      if (result.data.items.length > 0) {
        const vendor = result.data.items[0];
        expect(vendor).toHaveProperty('uid');
        expect(vendor).toHaveProperty('email');
        expect(vendor).toHaveProperty('vendorInfo');
      }
    });

    it('should handle search query', async () => {
      const result = await vendorService.getFilteredVendors(
        testClient.cuid,
        { search: 'Test Vendor' },
        { limit: 10, skip: 0 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toBeInstanceOf(Array);
    });
  });

  describe('getVendorInfo', () => {
    it('should return single vendor with proper format', async () => {
      const result = await vendorService.getVendorInfo(testClient.cuid, testVendor.vuid);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.vendorInfo).toBeDefined();
      expect(result.data.vendorInfo.companyName).toBe('Test Vendor Company');
      expect(result.data.profile).toBeDefined();
    });

    it('should throw NotFoundError when vendor not found', async () => {
      await expect(
        vendorService.getVendorInfo(testClient.cuid, 'non-existent-vuid')
      ).rejects.toThrow('Vendor not found');
    });
  });

  describe('getVendorStats', () => {
    it('should successfully retrieve vendor statistics', async () => {
      const result = await vendorService.getVendorStats(testClient.cuid, {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty('totalVendors');
      expect(result.data).toHaveProperty('businessTypeDistribution');
      expect(result.data).toHaveProperty('servicesDistribution');
    });

    it('should throw BadRequestError when cuid is missing', async () => {
      await expect(vendorService.getVendorStats('', {})).rejects.toThrow();
    });
  });

  describe('getVendorTeamMembers', () => {
    it('should successfully retrieve vendor team members', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          sub: seededData.users.admin1._id.toString(),
          client: {
            cuid: testClient.cuid,
            displayname: testClient.displayName,
            role: ROLES.ADMIN,
          },
          clients: [
            {
              cuid: testClient.cuid,
              roles: [ROLES.ADMIN],
              isConnected: true,
            },
          ],
        },
      } as any;

      const result = await vendorService.getVendorTeamMembers(
        mockContext,
        testClient.cuid,
        testVendor.vuid
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.items).toBeDefined();
      expect(Array.isArray(result.data.items)).toBe(true);
    });

    it('should throw BadRequestError when cuid is missing', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          sub: seededData.users.admin1._id.toString(),
          client: {
            cuid: testClient.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      await expect(
        vendorService.getVendorTeamMembers(mockContext, '', testVendor.vuid)
      ).rejects.toThrow();
    });

    it('should throw NotFoundError when vendor not found', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          sub: seededData.users.admin1._id.toString(),
          client: {
            cuid: testClient.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      await expect(
        vendorService.getVendorTeamMembers(mockContext, testClient.cuid, 'non-existent-vuid')
      ).rejects.toThrow();
    });
  });
});
