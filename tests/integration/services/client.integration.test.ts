import { ROLES } from '@shared/constants/roles.constants';
import { ClientService } from '@services/client/client.service';
import { Property, Profile, Client, User } from '@models/index';
import { PropertyDAO, ProfileDAO, ClientDAO, UserDAO } from '@dao/index';
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
  const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
  const userDAO = new UserDAO({ userModel: User });
  const profileDAO = new ProfileDAO({ profileModel: Profile });
  const propertyDAO = new PropertyDAO({ propertyModel: Property } as any);

  const authCache = {
    invalidateUserCache: jest.fn().mockResolvedValue(undefined),
  } as any;

  const clientService = new ClientService({
    clientDAO,
    userDAO,
    profileDAO,
    propertyDAO,
    authCache,
  });

  return { clientService, clientDAO, userDAO, profileDAO, propertyDAO };
};

describe('ClientService Integration Tests - Write Operations', () => {
  let clientService: ClientService;
  let clientDAO: ClientDAO;
  let userDAO: UserDAO;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    clientService = services.clientService;
    clientDAO = services.clientDAO;
    userDAO = services.userDAO;
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('updateClientDetails', () => {
    it('should successfully update client details with valid data', async () => {
      const client = await createTestClient();
      const user = await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN],
      });

      const mockContext = {
        currentuser: {
          uid: user.uid,
          sub: user._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: { cuid: client.cuid },
          url: '/test',
          method: 'PUT',
          path: '/client/update',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      const updateData = {
        companyProfile: {
          tradingName: 'Updated Company Name',
          companyEmail: 'updated@company.com',
        },
      };

      const result = await clientService.updateClientDetails(mockContext, updateData);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.companyProfile?.tradingName).toBe('Updated Company Name');
      expect(result.data.companyProfile?.companyEmail).toBe('updated@company.com');

      // Verify persistence
      const updatedClient = await clientDAO.getClientByCuid(client.cuid);
      expect(updatedClient?.companyProfile?.tradingName).toBe('Updated Company Name');
    });

    it('should throw NotFoundError when client not found', async () => {
      const mockContext = {
        currentuser: {
          uid: 'test-uid',
          sub: 'test-sub',
          client: {
            cuid: 'non-existent-cuid',
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: { cuid: 'non-existent-cuid' },
          url: '/test',
          method: 'PUT',
          path: '/client/update',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      await expect(
        clientService.updateClientDetails(mockContext, {
          companyProfile: { tradingName: 'Test' },
        })
      ).rejects.toThrow('Client not found');
    });
  });

  describe('assignUserRole', () => {
    it('should successfully assign role to user', async () => {
      const client = await createTestClient();
      const admin = await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN],
      });
      const user = await createTestUser(client.cuid, {
        roles: [ROLES.TENANT],
      });

      const mockContext = {
        currentuser: {
          uid: admin.uid,
          sub: admin._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'POST',
          path: '/client/assign-role',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      const result = await clientService.assignUserRole(
        mockContext,
        user._id.toString(),
        ROLES.MANAGER
      );

      expect(result.success).toBe(true);

      // Verify persistence
      const updatedUser = await userDAO.getUserByUId(user.uid);
      const clientConnection = updatedUser?.cuids?.find((c: any) => c.cuid === client.cuid);
      expect(clientConnection?.roles).toContain(ROLES.MANAGER);
    });

    it('should prevent duplicate role assignment', async () => {
      const client = await createTestClient();
      const admin = await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN],
      });
      const user = await createTestUser(client.cuid, {
        roles: [ROLES.MANAGER],
      });

      const mockContext = {
        currentuser: {
          uid: admin.uid,
          sub: admin._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'POST',
          path: '/client/assign-role',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      await expect(
        clientService.assignUserRole(mockContext, user._id.toString(), ROLES.MANAGER)
      ).rejects.toThrow('User already has the role manager');
    });
  });

  describe('removeUserRole', () => {
    it('should successfully remove user role when not the last admin', async () => {
      const client = await createTestClient();
      const admin1 = await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN],
      });
      const _admin2 = await createTestClient();
      await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN],
      });

      const mockContext = {
        currentuser: {
          uid: admin1.uid,
          sub: admin1._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'POST',
          path: '/client/remove-role',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      const result = await clientService.removeUserRole(
        mockContext,
        admin1._id.toString(),
        ROLES.ADMIN
      );

      expect(result.success).toBe(true);

      // Verify persistence
      const updatedUser = await userDAO.getUserByUId(admin1.uid);
      const clientConnection = updatedUser?.cuids?.find((c: any) => c.cuid === client.cuid);
      expect(clientConnection?.roles).not.toContain(ROLES.ADMIN);
    });

    it('should prevent removing the last admin role', async () => {
      const client = await createTestClient();
      // createTestClient already creates an admin user, get it from the client
      const admin = await userDAO.getUserById(client.accountAdmin.toString());

      const mockContext = {
        currentuser: {
          uid: admin!.uid,
          sub: admin!._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'POST',
          path: '/client/remove-role',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      await expect(
        clientService.removeUserRole(mockContext, admin!._id.toString(), ROLES.ADMIN)
      ).rejects.toThrow('Cannot remove admin role from the last administrator');
    });
  });

  describe('disconnectUser', () => {
    it('should successfully disconnect non-admin user', async () => {
      const client = await createTestClient();
      const admin = await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN],
      });
      const user = await createTestUser(client.cuid, {
        roles: [ROLES.TENANT],
      });

      const mockContext = {
        currentuser: {
          uid: admin.uid,
          sub: admin._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'POST',
          path: '/client/disconnect-user',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      const result = await clientService.disconnectUser(mockContext, user._id.toString());

      expect(result.success).toBe(true);

      // Verify persistence
      const updatedUser = await userDAO.getUserByUId(user.uid);
      const clientConnection = updatedUser?.cuids?.find((c: any) => c.cuid === client.cuid);
      expect(clientConnection?.isConnected).toBe(false);
    });

    it('should prevent disconnecting the last connected admin', async () => {
      const client = await createTestClient();
      // createTestClient already creates an admin user, get it from the client
      const admin = await userDAO.getUserById(client.accountAdmin.toString());

      const mockContext = {
        currentuser: {
          uid: admin!.uid,
          sub: admin!._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'POST',
          path: '/client/disconnect-user',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      await expect(
        clientService.disconnectUser(mockContext, admin!._id.toString())
      ).rejects.toThrow('Cannot disconnect the last administrator');
    });
  });

  describe('reconnectUser', () => {
    it('should successfully reconnect disconnected user', async () => {
      const client = await createTestClient();
      const admin = await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN],
      });
      const user = await createTestUser(client.cuid, {
        roles: [ROLES.TENANT],
      });

      const mockContext = {
        currentuser: {
          uid: admin.uid,
          sub: admin._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'POST',
          path: '/client/reconnect-user',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      // First disconnect
      await clientService.disconnectUser(mockContext, user._id.toString());

      // Then reconnect
      const result = await clientService.reconnectUser(mockContext, user._id.toString());

      expect(result.success).toBe(true);

      // Verify persistence
      const updatedUser = await userDAO.getUserByUId(user.uid);
      const clientConnection = updatedUser?.cuids?.find((c: any) => c.cuid === client.cuid);
      expect(clientConnection?.isConnected).toBe(true);
    });
  });
});

describe('ClientService Integration Tests - Read Operations', () => {
  let clientService: ClientService;
  let seededData: SeededTestData;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    clientService = services.clientService;
    seededData = await seedTestData();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('getClientDetails', () => {
    it('should successfully retrieve client details with statistics', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          sub: seededData.users.admin1._id.toString(),
          client: {
            cuid: seededData.clients.client1.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: { cuid: seededData.clients.client1.cuid },
          url: '/test',
          method: 'GET',
          path: '/client/details',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      const result = await clientService.getClientDetails(mockContext);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.cuid).toBe(seededData.clients.client1.cuid);
      expect(result.data.clientStats).toBeDefined();
      expect(result.data.clientStats.totalUsers).toBeGreaterThanOrEqual(0);
    });

    it('should handle client not found', async () => {
      const mockContext = {
        currentuser: {
          uid: 'test-uid',
          sub: 'test-sub',
          client: {
            cuid: 'non-existent-cuid',
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: { cuid: 'non-existent-cuid' },
          url: '/test',
          method: 'GET',
          path: '/client/details',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      await expect(clientService.getClientDetails(mockContext)).rejects.toThrow(
        'Client details not found'
      );
    });
  });

  describe('getUserRoles', () => {
    it('should successfully retrieve user roles', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          sub: seededData.users.admin1._id.toString(),
          client: {
            cuid: seededData.clients.client1.cuid,
            role: ROLES.ADMIN,
          },
        },
        request: {
          params: {},
          url: '/test',
          method: 'GET',
          path: '/client/user-roles',
          query: {},
        },
        requestId: 'req-123',
      } as any;

      const result = await clientService.getUserRoles(
        mockContext,
        seededData.users.admin1._id.toString()
      );

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data.roles)).toBe(true);
      expect(result.data.roles).toContain(ROLES.ADMIN);
    });
  });
});
