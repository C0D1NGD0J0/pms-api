import { UserService } from '@services/user/user.service';
import { ROLES } from '@shared/constants/roles.constants';
import { mockQueueFactory } from '@tests/setup/externalMocks';
import { VendorService } from '@services/vendor/vendor.service';
import { PermissionService } from '@services/permission/permission.service';
import { PropertyUnit, Property, Profile, Client, Vendor, User } from '@models/index';
import { beforeEach, beforeAll, describe, afterAll, expect, it } from '@jest/globals';
import {
  PropertyUnitDAO,
  PropertyDAO,
  ProfileDAO,
  ClientDAO,
  VendorDAO,
  UserDAO,
} from '@dao/index';

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
  const userDAO = new UserDAO({ userModel: User });
  const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
  const profileDAO = new ProfileDAO({ profileModel: Profile });
  const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
  const propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
  const vendorDAO = new VendorDAO({ vendorModel: Vendor });

  const userCache = {
    getUserDetail: jest.fn().mockResolvedValue({ success: false, data: null }),
    cacheUserDetail: jest.fn().mockResolvedValue(undefined),
    getFilteredUsers: jest.fn().mockResolvedValue({ success: false, data: null }),
    saveFilteredUsers: jest.fn().mockResolvedValue(undefined),
    invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
    invalidateUserLists: jest.fn().mockResolvedValue(undefined),
  } as any;

  const permissionService = new PermissionService();
  const vendorService = new VendorService({
    vendorDAO,
    clientDAO,
    userDAO,
    profileDAO,
    permissionService,
    queueFactory: mockQueueFactory as any,
    emitterService: {} as any,
  } as any);

  const userService = new UserService({
    clientDAO,
    userDAO,
    propertyDAO,
    profileDAO,
    userCache,
    permissionService,
    vendorService,
  });

  return { userService, userDAO, clientDAO, profileDAO, propertyDAO, vendorDAO };
};

describe('UserService Integration Tests - Write Operations', () => {
  let userService: UserService;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    userService = services.userService;
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('updateUserInfo', () => {
    it('should update user email successfully', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        email: 'original@test.com',
      });

      const result = await userService.updateUserInfo(user.uid, {
        email: 'updated@test.com',
      });

      expect(result.success).toBe(true);
      expect(result.data.email).toBe('updated@test.com');
      expect(result.data.uid).toBe(user.uid);
    });

    it('should fail when updating with existing email', async () => {
      const client = await createTestClient();
      const user1 = await createTestUser(client.cuid, {
        email: 'user1@test.com',
      });
      await createTestUser(client.cuid, {
        email: 'user2@test.com',
      });

      await expect(
        userService.updateUserInfo(user1.uid, {
          email: 'user2@test.com',
        })
      ).rejects.toThrow('Email already exists');
    });

    it('should fail when user does not exist', async () => {
      await expect(
        userService.updateUserInfo('non-existent-uid', {
          email: 'new@test.com',
        })
      ).rejects.toThrow('User not found');
    });
  });
});

describe('UserService Integration Tests - Read Operations', () => {
  let userService: UserService;
  let seededData: SeededTestData;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    userService = services.userService;
    seededData = await seedTestData();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('getUsersByRole', () => {
    it('should return users with specific role', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          client: { cuid: seededData.clients.client1.cuid },
        },
        request: {
          params: { cuid: seededData.clients.client1.cuid },
        },
      } as any;

      const result = await userService.getUsersByRole(mockContext, ROLES.STAFF);

      expect(result.success).toBe(true);
      expect(result.data.users).toBeInstanceOf(Array);
      expect(result.data.users.length).toBeGreaterThan(0);
    });

    it('should fail with invalid role', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          client: { cuid: seededData.clients.client1.cuid },
        },
        request: {
          params: { cuid: seededData.clients.client1.cuid },
        },
      } as any;

      await expect(
        userService.getUsersByRole(mockContext, 'invalid_role' as any)
      ).rejects.toThrow();
    });
  });

  describe('getFilteredUsers', () => {
    it('should return filtered users with pagination', async () => {
      const result = await userService.getFilteredUsers(
        seededData.clients.client1.cuid,
        { role: [ROLES.STAFF] },
        { limit: 10, skip: 0 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toBeInstanceOf(Array);
      expect(result.data.pagination).toBeDefined();
      expect(result.data.pagination.total).toBeGreaterThan(0);
    });

    it('should filter by multiple roles', async () => {
      const result = await userService.getFilteredUsers(
        seededData.clients.client1.cuid,
        { role: [ROLES.STAFF, ROLES.ADMIN] },
        { limit: 20, skip: 0 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toBeInstanceOf(Array);
    });

    it('should handle search query', async () => {
      const result = await userService.getFilteredUsers(
        seededData.clients.client1.cuid,
        { search: seededData.users.staff1.email },
        { limit: 10, skip: 0 }
      );

      expect(result.success).toBe(true);
      expect(result.data.items.length).toBeGreaterThan(0);
    });
  });

  describe('getUserStats', () => {
    it('should return user statistics for client', async () => {
      const result = await userService.getUserStats(seededData.clients.client1.cuid, {});

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.totalFilteredUsers).toBeGreaterThan(0);
    });

    it('should return stats filtered by role', async () => {
      const result = await userService.getUserStats(seededData.clients.client1.cuid, {
        role: [ROLES.STAFF],
      });

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.roleDistribution).toBeDefined();
    });
  });

  describe('getClientUserInfo', () => {
    it('should return user details for valid user', async () => {
      const mockCurrentUser = {
        uid: seededData.users.admin1.uid,
        sub: seededData.users.admin1._id.toString(),
        client: {
          cuid: seededData.clients.client1.cuid,
          displayname: seededData.clients.client1.displayName,
          role: 'admin' as any, // Explicit string for permission matching
        },
        roles: [ROLES.ADMIN],
        _id: seededData.users.admin1._id,
        activecuid: seededData.clients.client1.cuid,
        cuids: [{ cuid: seededData.clients.client1.cuid, roles: [ROLES.ADMIN] }],
        clients: [
          {
            cuid: seededData.clients.client1.cuid,
            roles: [ROLES.ADMIN],
            isConnected: true,
          },
        ],
        profile: seededData.profiles.admin1Profile,
      } as any;

      const result = await userService.getClientUserInfo(
        seededData.clients.client1.cuid,
        seededData.users.staff1.uid,
        mockCurrentUser
      );

      expect(result.success).toBe(true);
      expect(result.data.profile).toBeDefined();
      expect(result.data.profile.uid).toBe(seededData.users.staff1.uid);
    });

    it('should fail when user does not exist', async () => {
      const mockCurrentUser = {
        uid: seededData.users.admin1.uid,
        sub: seededData.users.admin1._id.toString(),
        client: {
          cuid: seededData.clients.client1.cuid,
          role: ROLES.ADMIN,
        },
        roles: [ROLES.ADMIN],
        _id: seededData.users.admin1._id,
        activecuid: seededData.clients.client1.cuid,
        cuids: [{ cuid: seededData.clients.client1.cuid, roles: [ROLES.ADMIN] }],
        profile: seededData.profiles.admin1Profile,
      } as any;

      await expect(
        userService.getClientUserInfo(
          seededData.clients.client1.cuid,
          'non-existent-uid',
          mockCurrentUser
        )
      ).rejects.toThrow();
    });
  });

  describe('getUserWithClientContext', () => {
    it('should return user when exists in client context', async () => {
      const result = await userService.getUserWithClientContext(
        seededData.users.staff1._id.toString(),
        seededData.clients.client1.cuid
      );

      expect(result).toBeDefined();
      expect(result.uid).toBe(seededData.users.staff1.uid);
    });

    it('should return null with invalid userId', async () => {
      const result = await userService.getUserWithClientContext(
        'invalid-id',
        seededData.clients.client1.cuid
      );

      expect(result).toBeNull();
    });
  });

  describe('getUserDisplayName', () => {
    it('should return display name for valid user', async () => {
      const result = await userService.getUserDisplayName(
        seededData.users.staff1._id.toString(),
        seededData.clients.client1.cuid
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
      expect(result).not.toBe('Unknown User');
    });

    it('should return "System" for system user', async () => {
      const result = await userService.getUserDisplayName(
        'system',
        seededData.clients.client1.cuid
      );

      expect(result).toBe('System');
    });

    it('should return "Unknown User" for invalid user', async () => {
      const result = await userService.getUserDisplayName(
        'invalid-id',
        seededData.clients.client1.cuid
      );

      expect(result).toBe('Unknown User');
    });
  });

  describe('Edge Cases', () => {
    it('getUsersByRole should return empty array when no users with role exist', async () => {
      const result = await userService.getUsersByRole(
        {
          currentuser: {
            uid: seededData.users.admin1.uid,
            client: { cuid: seededData.clients.client1.cuid },
          },
          request: { params: { cuid: seededData.clients.client1.cuid } },
        } as any,
        ROLES.VENDOR
      );

      expect(result.success).toBe(true);
      expect(result.data.users).toBeInstanceOf(Array);
    });

    it('getFilteredUsers should fail with invalid client ID', async () => {
      await expect(
        userService.getFilteredUsers(
          'invalid-cuid',
          { role: [ROLES.STAFF] },
          { limit: 10, skip: 0 }
        )
      ).rejects.toThrow();
    });

    it('getUserStats should fail with invalid client ID', async () => {
      await expect(userService.getUserStats('invalid-cuid', {})).rejects.toThrow();
    });

    it('getUserWithClientContext should return null with different client', async () => {
      const otherClient = await createTestClient();

      const result = await userService.getUserWithClientContext(
        seededData.users.staff1._id.toString(),
        otherClient.cuid
      );

      expect(result).toBeNull();
    });
  });
});
