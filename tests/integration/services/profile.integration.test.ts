import { Types } from 'mongoose';
import { ROLES } from '@shared/constants/roles.constants';
import { UserService } from '@services/user/user.service';
import { Profile, Client, Vendor, User } from '@models/index';
import { VendorService } from '@services/vendor/vendor.service';
import { ProfileService } from '@services/profile/profile.service';
import { BackgroundCheckStatus } from '@interfaces/profile.interface';
import { ProfileDAO, ClientDAO, VendorDAO, UserDAO } from '@dao/index';
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
  const profileDAO = new ProfileDAO({ profileModel: Profile });
  const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
  const userDAO = new UserDAO({ userModel: User });
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

  const userCache = {
    getUserDetail: jest.fn().mockResolvedValue({ success: false, data: null }),
    cacheUserDetail: jest.fn().mockResolvedValue(undefined),
    getFilteredUsers: jest.fn().mockResolvedValue({ success: false, data: null }),
    saveFilteredUsers: jest.fn().mockResolvedValue(undefined),
    invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
    invalidateUserLists: jest.fn().mockResolvedValue(undefined),
  } as any;

  const userService = new UserService({
    clientDAO,
    userDAO,
    propertyDAO: {} as any,
    profileDAO,
    userCache,
    permissionService,
    vendorService,
  });

  const mockEmitterService = {
    emit: jest.fn(),
    on: jest.fn(),
    off: jest.fn(),
    once: jest.fn(),
    removeAllListeners: jest.fn(),
    listenerCount: jest.fn(),
    destroy: jest.fn(),
  } as any;

  const mockMediaUploadService = {
    handleMediaDeletion: jest.fn(),
    handleAvatarDeletion: jest.fn(),
  } as any;

  const profileService = new ProfileService({
    profileDAO,
    clientDAO,
    userDAO,
    vendorService,
    userService,
    emitterService: mockEmitterService,
    mediaUploadService: mockMediaUploadService,
  });

  return { profileService, profileDAO, clientDAO, userDAO, vendorService };
};

describe('ProfileService Integration Tests - Write Operations', () => {
  let profileService: ProfileService;
  let profileDAO: ProfileDAO;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    profileService = services.profileService;
    profileDAO = services.profileDAO;
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('updateEmployeeInfo', () => {
    it('should successfully update employee information', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      // Create profile for user
      const profile = await Profile.create({
        puid: `puid-test-${Date.now()}-${Math.random()}`,
        user: user._id,
        personalInfo: {
          firstName: 'John',
          lastName: 'Manager',
          displayName: 'John Manager',
          location: 'San Francisco',
        },
        employeeInfo: {},
      });

      const employeeInfo = {
        department: 'management',
        jobTitle: 'Property Manager',
        startDate: new Date('2024-01-01'),
      };

      const result = await profileService.updateEmployeeInfo(
        profile._id.toString(),
        client.cuid,
        employeeInfo,
        ROLES.MANAGER
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Verify database persistence
      const updatedProfile = await profileDAO.findFirst({ puid: profile.puid });
      expect(updatedProfile).toBeDefined();
      expect(updatedProfile?.employeeInfo).toBeDefined();
      expect(updatedProfile?.employeeInfo?.department).toBe('management');
      expect(updatedProfile?.employeeInfo?.jobTitle).toBe('Property Manager');
    });

    it('should throw BadRequestError for invalid employee data', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Manager',
          displayName: 'Test Manager',
          location: 'New York, NY',
        },
      });

      // Test with data that actually violates the schema (invalid department enum)
      const invalidEmployeeInfo = { department: 'invalid-department' } as any;

      await expect(
        profileService.updateEmployeeInfo(
          profile.puid,
          client.cuid,
          invalidEmployeeInfo,
          ROLES.MANAGER
        )
      ).rejects.toThrow();
    });

    it('should throw ForbiddenError for invalid user role', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      const profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Tenant',
          displayName: 'Test Tenant',
          location: 'New York, NY',
        },
      });

      const employeeInfo = {
        department: 'management',
        jobTitle: 'Manager',
      };

      await expect(
        profileService.updateEmployeeInfo(profile.puid, client.cuid, employeeInfo, 'tenant' as any)
      ).rejects.toThrow();
    });
  });

  describe('updateVendorInfo', () => {
    it('should successfully update vendor information', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Vendor',
          displayName: 'Test Vendor',
          location: 'New York, NY',
        },
      });

      // Create vendor entity
      const _vendor = await Vendor.create({
        vuid: `vendor-${Date.now()}`,
        companyName: 'Test Plumbing',
        businessType: 'Plumber',
        registrationNumber: 'REG123',
        connectedClients: [
          {
            cuid: client.cuid,
            isConnected: true,
            primaryAccountHolder: user._id,
          },
        ],
      });

      const vendorInfo = {
        companyName: 'Updated Plumbing Co',
        businessType: 'Electrician',
      };

      const result = await profileService.updateVendorInfo(
        profile._id.toString(),
        client.cuid,
        vendorInfo,
        ROLES.VENDOR
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Verify vendor entity was updated
      const updatedVendor = await Vendor.findOne({
        'connectedClients.primaryAccountHolder': user._id,
      });
      expect(updatedVendor?.companyName).toBe('Updated Plumbing Co');
      expect(updatedVendor?.businessType).toBe('Electrician');
    });

    it('should throw ForbiddenError for non-vendor user role', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Manager',
          displayName: 'Test Manager',
          location: 'New York, NY',
        },
      });

      const vendorInfo = {
        companyName: 'Test Vendor',
        businessType: 'Plumber',
      };

      await expect(
        profileService.updateVendorInfo(
          profile._id.toString(),
          client.cuid,
          vendorInfo,
          ROLES.MANAGER
        )
      ).rejects.toThrow();
    });

    it('should throw NotFoundError when vendor entity not found', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Vendor',
          displayName: 'Test Vendor',
          location: 'New York, NY',
        },
      });

      const vendorInfo = {
        companyName: 'Test Vendor',
        businessType: 'Plumber',
      };

      await expect(
        profileService.updateVendorInfo(
          profile._id.toString(),
          client.cuid,
          vendorInfo,
          ROLES.VENDOR
        )
      ).rejects.toThrow('Vendor entity not found');
    });
  });

  describe('updateTenantInfo', () => {
    it.skip('should successfully update tenant information', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      const profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Tenant',
          displayName: 'Test Tenant',
          location: 'New York, NY',
        },
        tenantInfo: {
          employerInfo: {},
          emergencyContact: {},
        },
      });

      const tenantInfo = {
        employerInfo: [
          {
            cuid: client.cuid,
            companyName: 'Tech Corp',
            position: 'Software Engineer',
            monthlyIncome: 5000,
            contactPerson: 'HR Manager',
            companyAddress: '123 Tech St',
            contactEmail: 'hr@techcorp.com',
          },
        ],
        rentalReferences: [
          {
            landlordName: 'John Smith',
            propertyAddress: '456 Old St',
          },
        ],
        pets: [
          {
            type: 'dog',
            breed: 'Golden Retriever',
            isServiceAnimal: false,
          },
        ],
        emergencyContact: {
          name: 'Jane Doe',
          phone: '+1234567890',
          relationship: 'spouse',
          email: 'jane@example.com',
        },
        backgroundChecks: [
          {
            cuid: client.cuid,
            status: BackgroundCheckStatus.APPROVED,
            checkedDate: new Date(),
          },
        ],
      };

      const result = await profileService.updateTenantInfo(
        client.cuid,
        profile._id.toString(),
        tenantInfo as any
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Verify database persistence
      const updatedProfile = await profileDAO.findFirst({ puid: profile.puid });
      expect(updatedProfile).toBeDefined();
      expect(updatedProfile?.tenantInfo).toBeDefined();
      expect(updatedProfile?.tenantInfo?.employerInfo).toBeDefined();
      expect(updatedProfile?.tenantInfo?.employerInfo?.[0]?.companyName).toBe('Tech Corp');
      expect(updatedProfile?.tenantInfo?.rentalReferences).toBeDefined();
      expect(updatedProfile?.tenantInfo?.rentalReferences?.[0]?.landlordName).toBe('John Smith');
    });

    it('should throw BadRequestError for invalid tenant data', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.TENANT] });

      const profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Tenant',
          displayName: 'Test Tenant',
          location: 'New York, NY',
        },
      });

      // Test with data that violates the schema (employerInfo requires arrays)
      const invalidTenantInfo = {
        employerInfo: [
          {
            cuid: client.cuid,
            companyName: 'A', // Too short (min 2)
            position: 'Engineer',
            monthlyIncome: 5000,
            contactPerson: 'Test',
            companyAddress: '123',
            contactEmail: 'invalid-email', // Invalid email
          },
        ],
      } as any;

      await expect(
        profileService.updateTenantInfo(client.cuid, profile._id.toString(), invalidTenantInfo)
      ).rejects.toThrow();
    });

    it('should throw NotFoundError when profile update fails', async () => {
      const client = await createTestClient();

      const tenantInfo = {
        employerInfo: [
          {
            cuid: client.cuid,
            companyName: 'Test Company',
            position: 'Engineer',
            monthlyIncome: 5000,
            contactPerson: 'Test Person',
            companyAddress: '123 Test St',
            contactEmail: 'test@test.com',
          },
        ],
      };

      await expect(
        profileService.updateTenantInfo(client.cuid, 'non-existent-puid', tenantInfo)
      ).rejects.toThrow();
    });
  });

  describe('initializeRoleInfo', () => {
    it('should successfully initialize employee role info', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      const _profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Manager',
          displayName: 'Test Manager',
          location: 'New York, NY',
        },
      });

      const result = await profileService.initializeRoleInfo(
        user._id.toString(),
        client.cuid,
        ROLES.MANAGER
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Verify database persistence
      const updatedProfile = await profileDAO.findFirst({ user: user._id });
      expect(updatedProfile).toBeDefined();
      expect(updatedProfile?.employeeInfo).toBeDefined();

      // Verify user has client connection
      const updatedUser = await User.findById(user._id);
      const hasConnection = updatedUser?.cuids.some((c) => c.cuid === client.cuid);
      expect(hasConnection).toBe(true);
    });

    it('should successfully initialize vendor role info', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.VENDOR] });

      const _profile = await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Vendor',
          displayName: 'Test Vendor',
          location: 'New York, NY',
        },
      });

      const result = await profileService.initializeRoleInfo(
        user._id.toString(),
        client.cuid,
        ROLES.VENDOR
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();

      // Verify user has client connection
      const updatedUser = await User.findById(user._id);
      const hasConnection = updatedUser?.cuids.some((c) => c.cuid === client.cuid);
      expect(hasConnection).toBe(true);
    });

    it('should throw NotFoundError when client not found', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, { roles: [ROLES.MANAGER] });

      await Profile.create({
        user: user._id,
        puid: `puid-${Date.now()}-${Math.random()}`,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Manager',
          displayName: 'Test Manager',
          location: 'New York, NY',
        },
      });

      await expect(
        profileService.initializeRoleInfo(user._id.toString(), 'non-existent-cuid', ROLES.MANAGER)
      ).rejects.toThrow();
    });
  });
});

describe('ProfileService Integration Tests - Read Operations', () => {
  let profileService: ProfileService;
  let seededData: SeededTestData;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    profileService = services.profileService;
    seededData = await seedTestData();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('getUserNotificationPreferences', () => {
    it('should return user notification preferences successfully', async () => {
      const user = seededData.users.admin1;
      const client = seededData.clients.client1;

      const result = await profileService.getUserNotificationPreferences(
        user._id.toString(),
        client.cuid
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data).toHaveProperty('messages');
      expect(result.data).toHaveProperty('announcements');
      expect(result.data).toHaveProperty('emailNotifications');
    });

    it('should return default preferences when user profile not found', async () => {
      const client = seededData.clients.client1;
      const nonExistentUserId = new Types.ObjectId().toString();

      const result = await profileService.getUserNotificationPreferences(
        nonExistentUserId,
        client.cuid
      );

      expect(result.success).toBe(true);
      expect(result.message).toBe('Default notification preferences retrieved');
      expect(result.data).toEqual({
        messages: false,
        comments: false,
        announcements: true,
        maintenance: true,
        payments: true,
        system: true,
        propertyUpdates: true,
        emailNotifications: true,
        inAppNotifications: true,
        emailFrequency: 'immediate',
      });
    });
  });

  describe('getUserBasicInfo (ProfileDAO)', () => {
    it('should return complete basic user info for valid userId and cuid', async () => {
      const { profileDAO } = setupServices();
      const user = seededData.users.propertyManager1;
      const client = seededData.clients.client1;

      const result = await profileDAO.getUserBasicInfo(user._id.toString(), client.cuid);

      expect(result).not.toBeNull();
      expect(result).toMatchObject({
        userId: user._id.toString(),
        cuid: client.cuid,
        role: expect.any(String),
        firstName: expect.any(String),
        lastName: expect.any(String),
        name: expect.any(String),
        email: user.email,
      });
      expect(result?.profileId).toBeDefined();
    });

    it('should return correct role for multi-tenant user', async () => {
      const { profileDAO } = setupServices();
      const user = seededData.users.admin1;
      const client = seededData.clients.client1;

      const result = await profileDAO.getUserBasicInfo(user._id.toString(), client.cuid);

      expect(result).not.toBeNull();
      expect(result?.role).toBe(ROLES.ADMIN);
      expect(result?.cuid).toBe(client.cuid);
    });

    it('should return null for non-existent userId', async () => {
      const { profileDAO } = setupServices();
      const client = seededData.clients.client1;
      const fakeUserId = new Types.ObjectId().toString();

      const result = await profileDAO.getUserBasicInfo(fakeUserId, client.cuid);

      expect(result).toBeNull();
    });

    it('should return null for non-existent cuid', async () => {
      const { profileDAO } = setupServices();
      const user = seededData.users.admin1;

      const result = await profileDAO.getUserBasicInfo(user._id.toString(), 'INVALID_CUID');

      expect(result).toBeNull();
    });

    it('should include phone number when available', async () => {
      const { profileDAO } = setupServices();
      const user = seededData.users.admin1;
      const client = seededData.clients.client1;

      const result = await profileDAO.getUserBasicInfo(user._id.toString(), client.cuid);

      expect(result).not.toBeNull();
      // Phone may be null or a string depending on test data
      expect(result).toHaveProperty('phone');
    });

    it('should handle errors gracefully and return null', async () => {
      const { profileDAO } = setupServices();
      const client = seededData.clients.client1;

      // Pass invalid ObjectId format
      const result = await profileDAO.getUserBasicInfo('invalid-id', client.cuid);

      expect(result).toBeNull();
    });
  });
});
