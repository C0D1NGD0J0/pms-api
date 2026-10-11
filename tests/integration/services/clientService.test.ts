import { ROLES } from '@shared/constants/roles.constants';
import { BadRequestError } from '@shared/customErrors/index';
import { ClientService } from '@services/client/client.service';
import { PropertyUnit, Property, Profile, Client, User } from '@models/index';
import { beforeEach, beforeAll, afterEach, describe, expect, it } from '@jest/globals';
import {
  PropertyUnitDAO,
  SubscriptionDAO,
  PropertyDAO,
  ProfileDAO,
  ClientDAO,
  UserDAO,
} from '@dao/index';

import {
  setupAllExternalMocks,
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
  const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
  const subscriptionDAO = new SubscriptionDAO();

  const authCache = {
    invalidateUserCache: jest.fn().mockResolvedValue(undefined),
  } as any;

  const mockEmailQueue = { addToEmailQueue: jest.fn() };
  const mockQueueFactory = { getQueue: jest.fn().mockReturnValue(mockEmailQueue) };
  const paymentProcessorDAO = { findFirst: jest.fn().mockResolvedValue(null) };

  const clientService = new ClientService({
    clientDAO,
    userDAO,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    authCache,
    userCache: {
      invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
      invalidateUserLists: jest.fn().mockResolvedValue(undefined),
    } as any,
    subscriptionDAO,
    subscriptionService: {
      getBillingHistory: jest.fn().mockResolvedValue([]),
    } as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    notificationService: {} as any,
    sseService: {} as any,
    paymentGatewayService: {} as any,
    featureFlagService: { isEnabled: jest.fn().mockReturnValue(true) } as any,
    vendorDAO: {} as any,
    paymentProcessorDAO: paymentProcessorDAO as any,
    queueFactory: mockQueueFactory as any,
  });

  return { clientService, clientDAO, userDAO, profileDAO, propertyDAO, paymentProcessorDAO };
};

describe('ClientService Integration Tests - Write Operations', () => {
  let clientService: ClientService;
  let clientDAO: ClientDAO;
  let userDAO: UserDAO;
  let paymentProcessorDAO: ReturnType<typeof setupServices>['paymentProcessorDAO'];

  beforeAll(async () => {
    setupAllExternalMocks();
    const services = setupServices();
    clientService = services.clientService;
    clientDAO = services.clientDAO;
    userDAO = services.userDAO;
    paymentProcessorDAO = services.paymentProcessorDAO;
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
      ).rejects.toThrow('Client not found.');
    });

    describe('partial nested updates', () => {
      const buildContext = (cuid: string, userId: string) =>
        ({
          currentuser: {
            sub: userId,
            client: { cuid, role: ROLES.ADMIN },
          },
          request: {
            params: { cuid },
            url: '/test',
            method: 'PATCH',
            path: `/clients/${cuid}`,
            query: {},
          },
          requestId: 'req-partial',
        }) as any;

      const seedClientWithSettings = async () => {
        const client = await createTestClient();
        await Client.updateOne(
          { _id: client._id },
          {
            $set: {
              'settings.defaultCurrency': 'CAD',
              'settings.lang': 'fr',
              'settings.timeZone': 'America/Toronto',
              'settings.vendorPayoutMode': 'express',
              'settings.requireDepositRefundApproval': false,
              'settings.notificationPreferences.sms': true,
              'settings.tenantFeatures.guestPass': true,
              'companyProfile.logo': 'https://cdn.example.com/logo.png',
              'companyProfile.tradingName': 'Original Trading',
            },
          }
        );
        const user = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
        return { client, user };
      };

      it('updating one settings flag leaves every other setting untouched', async () => {
        const { client, user } = await seedClientWithSettings();

        await clientService.updateClientDetails(buildContext(client.cuid, user._id.toString()), {
          settings: { requireDepositRefundApproval: true },
        } as any);

        const updated = await Client.findById(client._id).lean();
        expect(updated?.settings).toMatchObject({
          requireDepositRefundApproval: true,
          defaultCurrency: 'CAD',
          lang: 'fr',
          timeZone: 'America/Toronto',
          vendorPayoutMode: 'express',
          notificationPreferences: { email: true, sms: true, inApp: true },
          tenantFeatures: { guestPass: true, tenantPortalActive: true },
        });
        expect(updated?.companyProfile?.logo).toBe('https://cdn.example.com/logo.png');
      });

      it('vendorPayoutMode-only update does not reset currency, language or features', async () => {
        const { client, user } = await seedClientWithSettings();

        await clientService.updateClientDetails(buildContext(client.cuid, user._id.toString()), {
          settings: { vendorPayoutMode: 'platform_hold' },
        } as any);

        const updated = await Client.findById(client._id).lean();
        expect(updated?.settings?.vendorPayoutMode).toBe('platform_hold');
        expect(updated?.settings?.defaultCurrency).toBe('CAD');
        expect(updated?.settings?.lang).toBe('fr');
        expect(updated?.settings?.tenantFeatures?.guestPass).toBe(true);
      });

      it('partial companyProfile update keeps the logo and other profile fields', async () => {
        const { client, user } = await seedClientWithSettings();

        await clientService.updateClientDetails(buildContext(client.cuid, user._id.toString()), {
          companyProfile: { website: 'https://acme.example.com' },
        } as any);

        const updated = await Client.findById(client._id).lean();
        expect(updated?.companyProfile?.website).toBe('https://acme.example.com');
        expect(updated?.companyProfile?.logo).toBe('https://cdn.example.com/logo.png');
        expect(updated?.companyProfile?.tradingName).toBe('Original Trading');
      });
    });

    describe('locked fields once a payment processor exists', () => {
      const buildContext = (cuid: string, userId: string) =>
        ({
          currentuser: { sub: userId, client: { cuid, role: ROLES.ADMIN } },
          request: { params: { cuid }, url: '/test', method: 'PATCH', path: '/', query: {} },
          requestId: 'req-currency',
        }) as any;

      afterEach(() => {
        paymentProcessorDAO.findFirst.mockResolvedValue(null);
      });

      it('rejects changing defaultCurrency', async () => {
        const client = await createTestClient();
        const user = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
        paymentProcessorDAO.findFirst.mockResolvedValue({ cuid: client.cuid });

        await expect(
          clientService.updateClientDetails(buildContext(client.cuid, user._id.toString()), {
            settings: { defaultCurrency: 'EUR' },
          } as any)
        ).rejects.toThrow(BadRequestError);

        const unchanged = await Client.findById(client._id).lean();
        expect(unchanged?.settings?.defaultCurrency).toBe('USD');
      });

      it('rejects defaultCurrency even when the same value is sent back', async () => {
        const client = await createTestClient();
        const user = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
        paymentProcessorDAO.findFirst.mockResolvedValue({ cuid: client.cuid });

        await expect(
          clientService.updateClientDetails(buildContext(client.cuid, user._id.toString()), {
            settings: { defaultCurrency: 'USD', lang: 'fr' },
          } as any)
        ).rejects.toThrow(BadRequestError);

        const unchanged = await Client.findById(client._id).lean();
        expect(unchanged?.settings?.lang).toBe('en');
      });

      it.each([
        ['companyAddress', { companyAddress: '123 main st' }],
        ['legalEntityName', { legalEntityName: 'Acme Holdings Inc' }],
        ['registrationNumber', { registrationNumber: 'REG-123' }],
      ])('rejects %s when present, even if unchanged', async (_field, lockedField) => {
        const client = await createTestClient();
        await Client.updateOne(
          { _id: client._id },
          {
            $set: {
              'companyProfile.companyAddress': '123 main st',
              'companyProfile.legalEntityName': 'Acme Holdings Inc',
              'companyProfile.registrationNumber': 'REG-123',
            },
          }
        );
        const user = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
        paymentProcessorDAO.findFirst.mockResolvedValue({ cuid: client.cuid });

        await expect(
          clientService.updateClientDetails(buildContext(client.cuid, user._id.toString()), {
            companyProfile: { ...lockedField, tradingName: 'New Trading' },
          } as any)
        ).rejects.toThrow(BadRequestError);

        const unchanged = await Client.findById(client._id).lean();
        expect(unchanged?.companyProfile?.tradingName).not.toBe('New Trading');
      });

      it.each([ROLES.SUPER_ADMIN, ROLES.ROOT_ADMIN])(
        'applies the lock to %s callers too',
        async (role) => {
          const client = await createTestClient();
          const user = await createTestUser(client.cuid, { roles: [role] });
          paymentProcessorDAO.findFirst.mockResolvedValue({ cuid: client.cuid });
          const cxt = buildContext(client.cuid, user._id.toString());
          cxt.currentuser.client.role = role;

          await expect(
            clientService.updateClientDetails(cxt, {
              companyProfile: { legalEntityName: 'Acme Holdings Inc' },
            } as any)
          ).rejects.toThrow(BadRequestError);

          const result = await clientService.updateClientDetails(cxt, {
            companyProfile: { tradingName: 'Allowed Trading' },
          } as any);
          expect(result.success).toBe(true);
        }
      );

      it('accepts a full-form save that omits the locked fields', async () => {
        const client = await createTestClient();
        const user = await createTestUser(client.cuid, { roles: [ROLES.ADMIN] });
        paymentProcessorDAO.findFirst.mockResolvedValue({ cuid: client.cuid });

        const result = await clientService.updateClientDetails(
          buildContext(client.cuid, user._id.toString()),
          {
            displayName: 'Renamed Co',
            companyProfile: {
              tradingName: 'New Trading',
              website: 'https://acme.example.com',
            },
            settings: { lang: 'fr', timeZone: 'America/Vancouver' },
          } as any
        );

        expect(result.success).toBe(true);
        const updated = await Client.findById(client._id).lean();
        expect(updated?.displayName).toBe('Renamed Co');
        expect(updated?.companyProfile?.tradingName).toBe('New Trading');
        expect(updated?.settings?.lang).toBe('fr');
        expect(updated?.settings?.defaultCurrency).toBe('USD');
      });
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

      const result = await clientService.assignUserRole(mockContext, user.uid, ROLES.MANAGER);

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

      const result = await clientService.assignUserRole(mockContext, user.uid, ROLES.MANAGER);
      expect(result.success).toBe(true);
    });
  });

  describe('removeUserRole', () => {
    it('should successfully remove user role when not the last admin', async () => {
      const client = await createTestClient();
      const admin1 = await createTestUser(client.cuid, {
        roles: [ROLES.ADMIN, ROLES.MANAGER],
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

      const result = await clientService.removeUserRole(mockContext, admin1.uid, ROLES.ADMIN);

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
        clientService.removeUserRole(mockContext, admin!.uid, ROLES.ADMIN)
      ).rejects.toThrow();
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

      const result = await clientService.disconnectUser(mockContext, user.uid);

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

      await expect(clientService.disconnectUser(mockContext, admin!.uid)).rejects.toThrow(
        'Cannot disconnect the last administrator'
      );
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
      await clientService.disconnectUser(mockContext, user.uid);

      // Then reconnect
      const result = await clientService.reconnectUser(mockContext, user.uid);

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
    setupAllExternalMocks();
    const services = setupServices();
    clientService = services.clientService;
    seededData = await seedTestData();
  });

  describe('getClientDetails', () => {
    it('should successfully retrieve client details with statistics for regular admin', async () => {
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
      expect(result.data.subscription).toBeUndefined(); // Regular admin should NOT see subscription

      // Verify structured accountType
      expect(result.data.accountType).toBeDefined();
      expect(result.data.accountType.category).toMatch(/^(business|individual)$/);
    });

    it('should include subscription details for super-admin', async () => {
      const mockContext = {
        currentuser: {
          uid: seededData.users.admin1.uid,
          sub: seededData.users.admin1._id.toString(),
          client: {
            cuid: seededData.clients.client1.cuid,
            role: ROLES.SUPER_ADMIN,
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
      expect(result.data.subscription).toBeDefined(); // Super-admin should see subscription

      // Verify structured accountType
      expect(result.data.accountType).toBeDefined();
      expect(result.data.accountType.category).toMatch(/^(business|individual)$/);

      // Verify sanitized fields are present
      const subscription = result.data.subscription as any;
      expect(subscription.subscriptionId).toBeDefined();
      expect(subscription.suid).toBeDefined();
      expect(subscription.cuid).toBe(seededData.clients.client1.cuid);
      expect(subscription.planName).toBeDefined();
      expect(subscription.status).toBeDefined();
      expect(subscription.billingInterval).toBeDefined();
      expect(subscription.totalMonthlyPrice).toBeDefined();
      expect(subscription.currentSeats).toBeDefined();
      expect(subscription.currentProperties).toBeDefined();
      expect(subscription.currentUnits).toBeDefined();

      // Verify sensitive fields are NOT present
      expect(subscription).not.toHaveProperty('client');
      expect(subscription).not.toHaveProperty('billing');
      expect(subscription).not.toHaveProperty('additionalSeatsCount');
      expect(subscription).not.toHaveProperty('additionalSeatsCost');
      expect(subscription).not.toHaveProperty('customPriceInCents');
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

      const result = await clientService.getUserRoles(mockContext, seededData.users.admin1.uid);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data.roles)).toBe(true);
      expect(result.data.roles).toContain(ROLES.ADMIN);
    });
  });
});
