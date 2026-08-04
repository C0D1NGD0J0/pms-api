import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { LeaseStatus } from '@interfaces/lease.interface';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';

describe('UserService - Deferred Deactivation', () => {
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockEmitterService: jest.Mocked<EventEmitterService>;
  let registeredListeners: Record<string, (...args: any[]) => any>;

  const testCuid = 'TESTCLIENT123';
  const mockTenantId = new Types.ObjectId();
  const mockLeaseId = new Types.ObjectId();

  const mockUserCache = {
    invalidateUserDetail: jest.fn().mockResolvedValue(true),
    invalidateUserLists: jest.fn().mockResolvedValue(true),
  };

  beforeEach(() => {
    registeredListeners = {};

    mockUserDAO = {
      getUserById: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      listUsers: jest.fn().mockResolvedValue({ items: [] }),
    } as any;

    mockLeaseDAO = {
      list: jest.fn(),
    } as any;

    mockEmitterService = {
      emit: jest.fn(),
      on: jest.fn().mockImplementation((event: string, handler: (...args: any[]) => any) => {
        registeredListeners[event] = handler;
        return mockEmitterService;
      }),
      off: jest.fn(),
    } as any;

    userService = new UserService({
      userDAO: mockUserDAO,
      leaseDAO: mockLeaseDAO,
      clientDAO: {} as any,
      profileDAO: {} as any,
      propertyDAO: {
        getPropertiesByClientId: jest.fn().mockResolvedValue({ items: [] }),
        updateMany: jest.fn(),
      } as any,
      paymentDAO: {} as any,
      maintenanceRequestDAO: {} as any,
      paymentProcessorDAO: {} as any,
      subscriptionDAO: {} as any,
      userCache: mockUserCache as any,
      vendorService: { getVendorByUserId: jest.fn(), disconnectFromClient: jest.fn() } as any,
      emitterService: mockEmitterService,
      permissionService: { canAccessResource: jest.fn().mockResolvedValue(true) } as any,
      queueFactory: {
        getQueue: jest
          .fn()
          .mockReturnValue({ addToEmailQueue: jest.fn(), addVendorTeamDisconnectJob: jest.fn() }),
      } as any,
    });
  });

  describe('handleLeaseExpired', () => {
    it('should set pendingDeactivation instead of immediately disconnecting the tenant', async () => {
      const handler = registeredListeners[EventTypes.LEASE_EXPIRED];
      expect(handler).toBeDefined();

      // No ongoing leases
      mockLeaseDAO.list.mockResolvedValue({ items: [] } as any);
      mockUserDAO.getUserById.mockResolvedValue({ _id: mockTenantId, uid: 'tenant-uid' } as any);

      await handler({
        leaseId: mockLeaseId.toString(),
        luid: 'LEASE123',
        cuid: testCuid,
        tenantId: mockTenantId.toString(),
        expiredAt: new Date(),
        reason: 'expired',
      });

      expect(mockUserDAO.update).toHaveBeenCalledWith(
        { _id: expect.any(Types.ObjectId), 'cuids.cuid': testCuid },
        {
          $set: {
            'cuids.$.isFormerTenant': true,
            'cuids.$.leaseExpiredAt': expect.any(Date),
            'cuids.$.pendingDeactivation': true,
            'cuids.$.deactivateAfter': 'inspection',
          },
        }
      );

      // Verify isConnected is NOT set to false (deferred, not immediate)
      const updateCall = mockUserDAO.update.mock.calls[0][1] as any;
      expect(updateCall.$set['cuids.$.isConnected']).toBeUndefined();
    });

    it('should skip deactivation if tenant has other active leases', async () => {
      const handler = registeredListeners[EventTypes.LEASE_EXPIRED];

      // Tenant has another active lease
      mockLeaseDAO.list.mockResolvedValue({
        items: [{ _id: new Types.ObjectId(), status: LeaseStatus.ACTIVE }],
      } as any);

      await handler({
        leaseId: mockLeaseId.toString(),
        luid: 'LEASE123',
        cuid: testCuid,
        tenantId: mockTenantId.toString(),
        expiredAt: new Date(),
        reason: 'expired',
      });

      expect(mockUserDAO.update).not.toHaveBeenCalled();
    });
  });
});
