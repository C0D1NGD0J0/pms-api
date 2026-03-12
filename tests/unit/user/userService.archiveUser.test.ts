import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { ClientDAO } from '@dao/clientDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { BadRequestError } from '@shared/customErrors';
import { EventTypes } from '@interfaces/events.interface';
import { UserService } from '@services/user/user.service';
import { EventEmitterService } from '@services/eventEmitter';

describe('UserService - archiveUser with Multi-Tenant and Lease Validation', () => {
  let userService: UserService;
  let mockUserDAO: jest.Mocked<UserDAO>;
  let mockLeaseDAO: jest.Mocked<LeaseDAO>;
  let mockClientDAO: jest.Mocked<ClientDAO>;
  let mockPropertyDAO: jest.Mocked<PropertyDAO>;
  let mockEmitterService: jest.Mocked<EventEmitterService>;

  const testCuid = 'client123';
  const testUid = 'user123';
  const mockUserId = new Types.ObjectId();
  const mockClientId = new Types.ObjectId();

  const mockCurrentUser = {
    uid: 'admin123',
    sub: new Types.ObjectId().toString(),
    client: { cuid: testCuid, role: 'super-admin' },
    permissions: [],
  };

  beforeEach(() => {
    mockUserDAO = {
      getUserByUId: jest.fn(),
      updateById: jest.fn(),
    } as any;

    mockLeaseDAO = {
      list: jest.fn(),
    } as any;

    mockClientDAO = {
      getClientByCuid: jest.fn().mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        accountAdmin: new Types.ObjectId(), // Default: different user is account owner
      }),
    } as any;

    mockPropertyDAO = {
      getPropertiesByClientId: jest.fn().mockResolvedValue({ items: [] }),
    } as any;

    mockEmitterService = {
      emit: jest.fn(),
    } as any;

    const mockPermissionService = {
      canAccessResource: jest.fn().mockResolvedValue(true),
    };

    const mockUserCache = {
      invalidateUserDetail: jest.fn().mockResolvedValue(true),
      invalidateUserLists: jest.fn().mockResolvedValue(true),
    };

    userService = new UserService({
      userDAO: mockUserDAO,
      leaseDAO: mockLeaseDAO,
      clientDAO: mockClientDAO,
      propertyDAO: mockPropertyDAO,
      profileDAO: {} as any,
      paymentDAO: {} as any,
      userCache: mockUserCache as any,
      vendorService: {} as any,
      emitterService: mockEmitterService,
      permissionService: mockPermissionService as any,
    });
  });

  describe('Account Owner Protection', () => {
    it('should prevent deleting account owner', async () => {
      const accountOwnerUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['super-admin'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(accountOwnerUser as any);
      mockClientDAO.getClientByCuid.mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        accountAdmin: mockUserId, // This user IS the account owner
      } as any);

      await expect(
        userService.archiveUser(testCuid, testUid, mockCurrentUser as any)
      ).rejects.toThrow(BadRequestError);

      await expect(
        userService.archiveUser(testCuid, testUid, mockCurrentUser as any)
      ).rejects.toThrow(/cannotDeleteAccountOwner/);
    });

    it('should allow deleting non-account-owner admin', async () => {
      const adminUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['admin'], isConnected: true }],
      };

      const differentUserId = new Types.ObjectId();

      mockUserDAO.getUserByUId.mockResolvedValue(adminUser as any);
      mockClientDAO.getClientByCuid.mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        accountAdmin: differentUserId, // Different user is account owner
      } as any);

      mockUserDAO.updateById.mockResolvedValue(adminUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(result.success).toBe(true);
    });
  });

  describe('Multi-Tenant User Protection', () => {
    it('should only disconnect user from current client when user belongs to multiple clients', async () => {
      const multiTenantUser = {
        _id: mockUserId,
        uid: testUid,
        isActive: true,
        cuids: [
          { cuid: testCuid, roles: ['admin'], isConnected: true },
          { cuid: 'client456', roles: ['manager'], isConnected: true },
          { cuid: 'client789', roles: ['staff'], isConnected: true },
        ],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(multiTenantUser as any);
      mockUserDAO.updateById.mockResolvedValue(multiTenantUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(result.success).toBe(true);

      // Should NOT set global deletedAt or isActive=false
      expect(mockUserDAO.updateById).not.toHaveBeenCalledWith(
        mockUserId.toString(),
        expect.objectContaining({
          deletedAt: expect.any(Date),
          isActive: false,
        })
      );

      // Should only disconnect from current client
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        mockUserId.toString(),
        {
          $set: { 'cuids.$[elem].isConnected': false },
        },
        expect.objectContaining({
          arrayFilters: [{ 'elem.cuid': testCuid }],
        })
      );

      // Should emit USER_ARCHIVED event
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.USER_ARCHIVED,
        expect.objectContaining({
          userId: mockUserId.toString(),
          cuid: testCuid,
          roles: ['admin'],
        })
      );
    });

    it('should disconnect user when they belong to only one client', async () => {
      const singleTenantUser = {
        _id: mockUserId,
        uid: testUid,
        isActive: true,
        cuids: [{ cuid: testCuid, roles: ['manager'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(singleTenantUser as any);
      mockUserDAO.updateById.mockResolvedValue(singleTenantUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(result.success).toBe(true);

      // Should NOT set global deletion flags (data preserved for compliance)
      expect(mockUserDAO.updateById).not.toHaveBeenCalledWith(
        mockUserId.toString(),
        expect.objectContaining({
          deletedAt: expect.any(Date),
          isActive: false,
        })
      );

      // Should only disconnect from client
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        mockUserId.toString(),
        {
          $set: { 'cuids.$[elem].isConnected': false },
        },
        expect.any(Object)
      );
    });

    it('should handle user with some disconnected clients correctly', async () => {
      const partiallyConnectedUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [
          { cuid: testCuid, roles: ['admin'], isConnected: true },
          { cuid: 'client456', roles: ['staff'], isConnected: false }, // Already disconnected
          { cuid: 'client789', roles: ['manager'], isConnected: true },
        ],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(partiallyConnectedUser as any);
      mockUserDAO.updateById.mockResolvedValue(partiallyConnectedUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(result.success).toBe(true);

      // 2 active connections total, so should NOT globally delete
      expect(mockUserDAO.updateById).not.toHaveBeenCalledWith(
        mockUserId.toString(),
        expect.objectContaining({
          deletedAt: expect.any(Date),
        })
      );
    });
  });

  describe('Active Lease Validation for Tenants', () => {
    it('should block archival of tenant with active leases', async () => {
      const tenantUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      const activeLease = {
        _id: new Types.ObjectId(),
        tenantId: mockUserId,
        cuid: testCuid,
        startDate: new Date('2024-01-01'),
        endDate: new Date('2025-12-31'), // Active lease
        deletedAt: null,
      };

      mockUserDAO.getUserByUId.mockResolvedValue(tenantUser as any);
      mockLeaseDAO.list.mockResolvedValue({
        items: [activeLease],
        pagination: {},
      } as any);

      await expect(
        userService.archiveUser(testCuid, testUid, mockCurrentUser as any)
      ).rejects.toThrow(BadRequestError);

      await expect(
        userService.archiveUser(testCuid, testUid, mockCurrentUser as any)
      ).rejects.toThrow(/active lease/);

      expect(mockUserDAO.updateById).not.toHaveBeenCalled();
    });

    it('should allow archival of tenant with expired leases', async () => {
      const tenantUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(tenantUser as any);
      // Expired leases don't match the query (endDate >= now), so return empty
      mockLeaseDAO.list.mockResolvedValue({
        items: [],
        pagination: {},
      } as any);

      mockUserDAO.updateById.mockResolvedValue(tenantUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(result.success).toBe(true);
    });

    it('should allow archival of tenant with no leases', async () => {
      const tenantUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(tenantUser as any);
      mockLeaseDAO.list.mockResolvedValue({
        items: [],
        pagination: {},
      } as any);

      mockUserDAO.updateById.mockResolvedValue(tenantUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(result.success).toBe(true);
    });

    it('should not check leases for non-tenant users', async () => {
      const employeeUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['manager'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(employeeUser as any);
      mockUserDAO.updateById.mockResolvedValue(employeeUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(result.success).toBe(true);
      expect(mockLeaseDAO.list).not.toHaveBeenCalled();
    });

    it('should include deleted leases in the check', async () => {
      const tenantUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(tenantUser as any);
      mockLeaseDAO.list.mockResolvedValue({
        items: [],
        pagination: {},
      } as any);

      mockUserDAO.updateById.mockResolvedValue(tenantUser as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      // Verify lease query includes deletedAt: null
      expect(mockLeaseDAO.list).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: mockUserId,
          cuid: testCuid,
          deletedAt: null,
          endDate: { $gte: expect.any(Date) },
        })
      );
    });
  });

  describe('USER_ARCHIVED Event Emission', () => {
    it('should emit event with correct payload for employee archival', async () => {
      const employeeUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['admin'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(employeeUser as any);
      mockUserDAO.updateById.mockResolvedValue(employeeUser as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.USER_ARCHIVED,
        expect.objectContaining({
          userId: mockUserId.toString(),
          cuid: testCuid,
          roles: ['admin'],
          archivedBy: mockCurrentUser.uid,
          createdAt: expect.any(Date),
        })
      );
    });

    it('should emit event for tenant archival', async () => {
      const tenantUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(tenantUser as any);
      mockLeaseDAO.list.mockResolvedValue({ items: [], pagination: {} } as any);
      mockUserDAO.updateById.mockResolvedValue(tenantUser as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.USER_ARCHIVED,
        expect.objectContaining({
          roles: ['tenant'],
        })
      );
    });

    it('should emit event for vendor archival', async () => {
      const vendorUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['vendor'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(vendorUser as any);
      mockUserDAO.updateById.mockResolvedValue(vendorUser as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        EventTypes.USER_ARCHIVED,
        expect.objectContaining({
          roles: ['vendor'],
        })
      );
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple active leases correctly', async () => {
      const tenantUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      };

      const lease1 = {
        _id: new Types.ObjectId(),
        endDate: new Date('2025-06-30'),
        deletedAt: null,
      };
      const lease2 = {
        _id: new Types.ObjectId(),
        endDate: new Date('2025-12-31'),
        deletedAt: null,
      };

      mockUserDAO.getUserByUId.mockResolvedValue(tenantUser as any);
      mockLeaseDAO.list.mockResolvedValue({
        items: [lease1, lease2],
        pagination: {},
      } as any);

      await expect(
        userService.archiveUser(testCuid, testUid, mockCurrentUser as any)
      ).rejects.toThrow(/2 active lease/);
    });

    it('should handle user with no client connections', async () => {
      const disconnectedUser = {
        _id: mockUserId,
        uid: testUid,
        cuids: [{ cuid: testCuid, roles: ['staff'], isConnected: false }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(disconnectedUser as any);
      mockUserDAO.updateById.mockResolvedValue(disconnectedUser as any);

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      // Should succeed (idempotent operation)
      expect(result.success).toBe(true);
    });
  });
});
