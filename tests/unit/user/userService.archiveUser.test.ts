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
  let mockVendorService: { getVendorByUserId: jest.Mock; disconnectFromClient: jest.Mock };
  let mockAddToEmailQueue: jest.Mock;
  let mockAddVendorTeamDisconnectJob: jest.Mock;

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

    mockAddToEmailQueue = jest.fn();
    mockAddVendorTeamDisconnectJob = jest.fn().mockResolvedValue(undefined);

    const mockPermissionService = {
      canAccessResource: jest.fn().mockResolvedValue(true),
    };

    const mockUserCache = {
      invalidateUserDetail: jest.fn().mockResolvedValue(true),
      invalidateUserLists: jest.fn().mockResolvedValue(true),
    };

    const mockQueueFactory = {
      getQueue: jest.fn().mockImplementation((name: string) => {
        if (name === 'userQueue') {
          return { addVendorTeamDisconnectJob: mockAddVendorTeamDisconnectJob };
        }
        return { addToEmailQueue: mockAddToEmailQueue };
      }),
    };

    mockVendorService = {
      getVendorByUserId: jest.fn().mockResolvedValue(null),
      disconnectFromClient: jest.fn().mockResolvedValue(undefined),
    };

    userService = new UserService({
      userDAO: mockUserDAO,
      leaseDAO: mockLeaseDAO,
      clientDAO: mockClientDAO,
      propertyDAO: mockPropertyDAO,
      profileDAO: {} as any,
      paymentDAO: {} as any,
      userCache: mockUserCache as any,
      vendorService: mockVendorService as any,
      emitterService: mockEmitterService,
      permissionService: mockPermissionService as any,
      queueFactory: mockQueueFactory as any,
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

  describe('Account Disconnection Email', () => {
    it('should queue a disconnection email after archiving a user', async () => {
      const archivedUser = {
        _id: mockUserId,
        uid: testUid,
        email: 'user@example.com',
        fullname: 'Jane Doe',
        cuids: [{ cuid: testCuid, roles: ['staff'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(archivedUser as any);
      mockUserDAO.updateById.mockResolvedValue(archivedUser as any);
      mockClientDAO.getClientByCuid.mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        displayName: 'Acme Properties',
        accountAdmin: new Types.ObjectId(),
      } as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockAddToEmailQueue).toHaveBeenCalledWith(
        'accountDisconnectedJob',
        expect.objectContaining({
          to: 'user@example.com',
          emailType: 'ACCOUNT_DISCONNECTED',
          data: expect.objectContaining({
            fullname: 'Jane Doe',
            companyName: 'Acme Properties',
            roles: 'staff',
          }),
        })
      );
    });

    it('should not throw if email queuing fails', async () => {
      const archivedUser = {
        _id: mockUserId,
        uid: testUid,
        email: 'user@example.com',
        cuids: [{ cuid: testCuid, roles: ['staff'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(archivedUser as any);
      mockUserDAO.updateById.mockResolvedValue(archivedUser as any);
      mockAddToEmailQueue.mockImplementation(() => {
        throw new Error('Queue unavailable');
      });

      const result = await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);
      expect(result.success).toBe(true);
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

  describe('Vendor Cascade', () => {
    const mockVendorObjectId = new Types.ObjectId();

    it('should call vendorService.disconnectFromClient() when a primary vendor is archived', async () => {
      const vendorUser = {
        _id: mockUserId,
        uid: testUid,
        email: 'vendor@example.com',
        fullname: 'Acme Plumbing',
        cuids: [{ cuid: testCuid, roles: ['vendor'], isConnected: true, linkedVendorUid: null }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(vendorUser as any);
      mockUserDAO.updateById.mockResolvedValue(vendorUser as any);
      mockVendorService.getVendorByUserId.mockResolvedValue({
        _id: mockVendorObjectId,
        vuid: 'V001',
      } as any);
      // No linked users
      mockUserDAO.getLinkedVendorUsers = jest.fn().mockResolvedValue({ items: [] });

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockVendorService.disconnectFromClient).toHaveBeenCalledWith(
        mockVendorObjectId.toString(),
        testCuid
      );
    });

    it('should enqueue a background job to disconnect linked team members', async () => {
      const vendorUser = {
        _id: mockUserId,
        uid: testUid,
        email: 'vendor@example.com',
        fullname: 'Acme Plumbing',
        cuids: [{ cuid: testCuid, roles: ['vendor'], isConnected: true, linkedVendorUid: null }],
      };
      const linkedUser1 = { _id: new Types.ObjectId(), uid: 'team1', email: 'team1@example.com', fullname: 'Team One' };
      const linkedUser2 = { _id: new Types.ObjectId(), uid: 'team2', email: 'team2@example.com', fullname: 'Team Two' };

      mockUserDAO.getUserByUId.mockResolvedValue(vendorUser as any);
      mockUserDAO.updateById.mockResolvedValue(vendorUser as any);
      mockVendorService.getVendorByUserId.mockResolvedValue({
        _id: mockVendorObjectId,
        vuid: 'V001',
      } as any);
      mockUserDAO.getLinkedVendorUsers = jest.fn().mockResolvedValue({
        items: [linkedUser1, linkedUser2],
      });

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      // Team member disconnection is handled asynchronously via the UserQueue
      expect(mockAddVendorTeamDisconnectJob).toHaveBeenCalledWith(
        expect.objectContaining({
          primaryVendorUserId: mockUserId.toString(),
          vendorId: mockVendorObjectId.toString(),
          cuid: testCuid,
          clientId: mockClientId.toString(),
        })
      );

      // Team members are NOT updated synchronously in archiveUser anymore
      expect(mockUserDAO.updateById).not.toHaveBeenCalledWith(
        linkedUser1._id.toString(),
        expect.anything(),
        expect.anything()
      );
    });

    it('should include companyName in the enqueued team disconnect job payload', async () => {
      const vendorUser = {
        _id: mockUserId,
        uid: testUid,
        email: 'vendor@example.com',
        fullname: 'Acme Plumbing',
        cuids: [{ cuid: testCuid, roles: ['vendor'], isConnected: true, linkedVendorUid: null }],
      };
      const linkedUser = { _id: new Types.ObjectId(), uid: 'team1', email: 'team1@example.com', fullname: 'Team Member' };

      mockUserDAO.getUserByUId.mockResolvedValue(vendorUser as any);
      mockUserDAO.updateById.mockResolvedValue(vendorUser as any);
      mockVendorService.getVendorByUserId.mockResolvedValue({
        _id: mockVendorObjectId,
        vuid: 'V001',
      } as any);
      mockUserDAO.getLinkedVendorUsers = jest.fn().mockResolvedValue({ items: [linkedUser] });
      mockClientDAO.getClientByCuid.mockResolvedValue({
        _id: mockClientId,
        cuid: testCuid,
        displayName: 'Acme Properties',
        accountAdmin: new Types.ObjectId(),
      } as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockAddVendorTeamDisconnectJob).toHaveBeenCalledWith(
        expect.objectContaining({ companyName: 'Acme Properties' })
      );
    });

    it('should NOT call vendorService.disconnectFromClient() for non-vendor users', async () => {
      const staffUser = {
        _id: mockUserId,
        uid: testUid,
        email: 'staff@example.com',
        cuids: [{ cuid: testCuid, roles: ['staff'], isConnected: true }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(staffUser as any);
      mockUserDAO.updateById.mockResolvedValue(staffUser as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockVendorService.disconnectFromClient).not.toHaveBeenCalled();
    });

    it('should NOT call vendorService.disconnectFromClient() for linked vendor team members', async () => {
      const linkedVendorUser = {
        _id: mockUserId,
        uid: testUid,
        email: 'team@example.com',
        cuids: [{ cuid: testCuid, roles: ['vendor'], isConnected: true, linkedVendorUid: 'V001' }],
      };

      mockUserDAO.getUserByUId.mockResolvedValue(linkedVendorUser as any);
      mockUserDAO.updateById.mockResolvedValue(linkedVendorUser as any);

      await userService.archiveUser(testCuid, testUid, mockCurrentUser as any);

      expect(mockVendorService.disconnectFromClient).not.toHaveBeenCalled();
    });
  });
});
