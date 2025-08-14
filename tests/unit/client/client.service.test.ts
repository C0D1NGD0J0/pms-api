import { IUserRole } from '@interfaces/user.interface';
import { ClientService } from '@services/client/client.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  createMockRequestContext,
  createMockCurrentUser,
  createMockPropertyDAO,
  createMockClientDAO,
  createMockUserDAO,
  createMockClient,
  createMockUser,
} from '@tests/helpers';

describe('ClientService', () => {
  let clientService: ClientService;
  let mockClientDAO: any;
  let mockUserDAO: any;
  let mockPropertyDAO: any;
  beforeEach(() => {
    mockClientDAO = createMockClientDAO();
    mockUserDAO = createMockUserDAO();
    mockPropertyDAO = createMockPropertyDAO();

    clientService = new ClientService({
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      propertyDAO: mockPropertyDAO,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('updateClientDetails', () => {
    const createMockContext = () =>
      createMockRequestContext({
        request: {
          params: { cuid: 'test-cuid' },
          url: '/test',
          method: 'PUT',
          path: '/client/update',
          query: {},
        },
        currentuser: createMockCurrentUser(),
        requestId: 'req-123',
      });

    it('should successfully update client details with valid data', async () => {
      const mockContext = createMockContext();
      const updateData = {
        companyProfile: {
          companyName: 'Updated Company Name',
          companyEmail: 'updated@company.com',
          companyPhoneNumber: '+1234567890',
        },
      };
      const mockClient = createMockClient({
        _id: 'mock-client-id',
        cuid: 'test-cuid',
        companyProfile: {
          companyName: 'Old Company Name',
          companyEmail: 'old@company.com',
        },
      });
      const expectedUpdatedClient = {
        _id: mockClient._id,
        ...updateData,
        lastModifiedBy: mockContext.currentuser.sub,
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockClientDAO.startSession.mockReturnValue('mock-session');
      mockClientDAO.withTransaction.mockImplementation(async (_session: any, callback: any) => {
        return await callback(_session);
      });
      mockClientDAO.updateById.mockResolvedValue(expectedUpdatedClient);

      const result = await clientService.updateClientDetails(mockContext, updateData);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toEqual(expectedUpdatedClient);
      expect(mockClientDAO.updateById).toHaveBeenCalledWith(
        mockClient._id.toString(),
        {
          $set: {
            ...updateData,
            lastModifiedBy: mockContext.currentuser.sub,
          },
        },
        undefined,
        'mock-session'
      );
    });

    it('should handle transaction failure and rollback', async () => {
      const mockContext = createMockContext();
      const updateData = { companyProfile: { legalEntityName: 'Test Company' } };
      const mockClient = createMockClient({ cuid: 'test-cuid' });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockClientDAO.startSession.mockReturnValue('mock-session');
      mockClientDAO.withTransaction.mockRejectedValue(new Error('Database error'));

      await expect(clientService.updateClientDetails(mockContext, updateData)).rejects.toThrow(
        'Database error'
      );
    });

    it('should throw NotFoundError when client not found', async () => {
      const mockContext = createMockContext();
      const updateData = { companyProfile: { legalEntityName: 'Test Company' } };

      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(clientService.updateClientDetails(mockContext, updateData)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should validate email format in company profile updates', async () => {
      const mockContext = createMockContext();
      const updateData = {
        companyProfile: {
          companyEmail: 'invalid-email-format',
        },
      };
      const mockClient = createMockClient({ cuid: 'test-cuid' });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);

      await expect(clientService.updateClientDetails(mockContext, updateData)).rejects.toThrow(
        BadRequestError
      );
      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith('test-cuid');
    });

    it('should validate identification requirements', async () => {
      const mockContext = createMockContext();
      const updateData = {
        identification: {
          idType: 'passport' as const,
          // Missing idNumber and authority to trigger validation error
          issueDate: new Date('2020-01-01'),
          expiryDate: new Date('2030-01-01'),
          issuingState: 'US',
        } as any, // Cast to any since we intentionally want invalid data for testing
      };
      const mockClient = createMockClient({ cuid: 'test-cuid' });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);

      await expect(clientService.updateClientDetails(mockContext, updateData)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('getClientDetails', () => {
    it('should successfully retrieve client details with statistics', async () => {
      const mockContext = createMockRequestContext({
        request: { params: { cuid: 'test-cuid' } },
        currentuser: createMockCurrentUser(),
      });
      const mockAccountAdmin = {
        email: 'admin@example.com',
        _id: 'admin-id',
        profile: {
          personalInfo: {
            firstName: 'John',
            lastName: 'Admin',
            phoneNumber: '+1234567890',
            avatar: 'avatar.jpg',
          },
        },
      };
      const mockClient = {
        ...createMockClient({
          cuid: 'test-cuid',
          accountAdmin: mockAccountAdmin,
        }),
        accountAdmin: mockAccountAdmin,
        toObject: jest.fn().mockReturnValue({
          _id: 'mock-client-id',
          cuid: 'test-cuid',
          displayName: 'Mock Client',
          accountAdmin: mockAccountAdmin,
        }),
      };
      const mockUsersResult = {
        items: [createMockUser(), createMockUser()],
        pagination: { total: 2 },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByClientId.mockResolvedValue(mockUsersResult);
      mockPropertyDAO.countDocuments.mockResolvedValue(5);

      const result = await clientService.getClientDetails(mockContext);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.clientStats).toEqual({
        totalProperties: 5,
        totalUsers: 2,
      });
      expect((result.data.accountAdmin as any).email).toBe('admin@example.com');
      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith('test-cuid', {
        populate: {
          path: 'accountAdmin',
          select: 'email',
          populate: {
            path: 'profile',
            select:
              'personalInfo.firstName personalInfo.lastName personalInfo.phoneNumber personalInfo.avatar',
          },
        },
        limit: 1,
        skip: 0,
      });
      expect(mockUserDAO.getUsersByClientId).toHaveBeenCalledWith(
        'test-cuid',
        {},
        { limit: 1000, skip: 0 }
      );
      expect(mockPropertyDAO.countDocuments).toHaveBeenCalledWith({
        cuid: 'test-cuid',
        deletedAt: null,
      });
    });

    it('should handle client not found', async () => {
      const mockContext = createMockRequestContext({
        request: { params: { cuid: 'invalid-cuid' } },
        currentuser: createMockCurrentUser(),
      });

      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(clientService.getClientDetails(mockContext)).rejects.toThrow(NotFoundError);
    });

    it('should handle missing cuid parameter', async () => {
      const mockContext = createMockRequestContext({
        request: { params: {} },
        currentuser: createMockCurrentUser(),
      });

      await expect(clientService.getClientDetails(mockContext)).rejects.toThrow(BadRequestError);
    });
  });

  describe('removeUserRole', () => {
    it('should successfully remove user role when not the last admin', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const role = 'manager';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [
          {
            cuid: clientId,
            roles: ['admin', 'manager'],
            isConnected: true,
            displayName: 'Test User',
          },
        ],
      });
      const mockAdminUsers = {
        items: [
          createMockUser({
            cuids: [
              { cuid: clientId, roles: ['admin'], isConnected: true, displayName: 'Admin 1' },
            ],
          }),
          createMockUser({
            cuids: [
              { cuid: clientId, roles: ['admin'], isConnected: true, displayName: 'Admin 2' },
            ],
          }),
        ],
      };

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockUserDAO.getUsersByClientId.mockResolvedValue(mockAdminUsers);
      mockUserDAO.updateById.mockResolvedValue({ success: true });

      const result = await clientService.removeUserRole(mockContext, targetUserId, role);

      // Assert
      expect(result.success).toBe(true);
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        targetUserId,
        {
          $pull: { 'cuids.$[elem].roles': role },
        },
        {
          arrayFilters: [{ 'elem.cuid': clientId }],
        }
      );
    });

    it('should prevent removing the last admin role', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const role = 'admin';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [{ cuid: clientId, roles: ['admin'], isConnected: true, displayName: 'Admin User' }],
      });
      const mockAdminUsers = {
        items: [mockUser], // Only one admin
      };

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockUserDAO.getUsersByClientId.mockResolvedValue(mockAdminUsers);

      await expect(clientService.removeUserRole(mockContext, targetUserId, role)).rejects.toThrow(
        ForbiddenError
      );
      expect(mockUserDAO.getUsersByClientId).toHaveBeenCalledWith(clientId, {
        'cuids.roles': 'admin',
        'cuids.isConnected': true,
      });
    });

    it('should handle database error when user operation fails', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const role = 'manager';

      mockUserDAO.updateById.mockRejectedValue(new Error('Database error'));

      await expect(clientService.removeUserRole(mockContext, targetUserId, role)).rejects.toThrow(
        'Database error'
      );
    });
  });

  describe('disconnectUser', () => {
    it('should successfully disconnect non-admin user', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [
          { cuid: clientId, roles: ['manager'], isConnected: true, displayName: 'Manager User' },
        ],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockUserDAO.updateById.mockResolvedValue({ success: true });

      const result = await clientService.disconnectUser(mockContext, targetUserId);

      // Assert
      expect(result.success).toBe(true);
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        targetUserId,
        {
          $set: { 'cuids.$[elem].isConnected': false },
        },
        {
          arrayFilters: [{ 'elem.cuid': clientId }],
        }
      );
    });

    it('should prevent disconnecting the last connected admin', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [
          {
            cuid: clientId,
            roles: ['admin'],
            isConnected: true,
            displayName: 'testDisplayName',
          },
        ],
      });
      const mockConnectedAdmins = {
        items: [mockUser],
      };

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockUserDAO.getUsersByClientId.mockResolvedValue(mockConnectedAdmins);

      await expect(clientService.disconnectUser(mockContext, targetUserId)).rejects.toThrow(
        ForbiddenError
      );
      expect(mockUserDAO.getUsersByClientId).toHaveBeenCalledWith(clientId, {
        'cuids.roles': 'admin',
        'cuids.isConnected': true,
      });
    });
  });

  describe('assignUserRole', () => {
    it('should successfully assign role to user', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const role = 'manager';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [{ cuid: clientId, roles: ['tenant'], isConnected: true, displayName: 'Test User' }],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockUserDAO.updateById.mockResolvedValue({ success: true });

      const result = await clientService.assignUserRole(mockContext, targetUserId, role);

      // Assert
      expect(result.success).toBe(true);
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        targetUserId,
        {
          $addToSet: { 'cuids.$[elem].roles': role },
        },
        {
          arrayFilters: [{ 'elem.cuid': clientId }],
        }
      );
    });

    it('should prevent duplicate role assignment', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const role = 'manager';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [
          {
            cuid: clientId,
            roles: ['manager'],
            isConnected: true,
            displayName: 'testDisplayName',
          },
        ],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);

      await expect(clientService.assignUserRole(mockContext, targetUserId, role)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw error for user not in client', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const role = 'manager';
      const mockUser = createMockUser({
        cuids: [
          {
            cuid: 'different-client-id',
            roles: [IUserRole.MANAGER],
            isConnected: true,
            displayName: 'testDisplayName2',
          },
        ],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);

      await expect(clientService.assignUserRole(mockContext, targetUserId, role)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('getUserRoles', () => {
    it('should successfully retrieve user roles', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [
          {
            cuid: clientId,
            roles: ['admin', 'manager'],
            isConnected: true,
            displayName: 'testDisplayName233',
          },
        ],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);

      const result = await clientService.getUserRoles(mockContext, targetUserId);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.roles).toEqual(['admin', 'manager']);
    });
  });

  describe('reconnectUser', () => {
    it('should successfully reconnect disconnected user', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const targetUserId = 'user-123';
      const clientId = mockContext.currentuser.client.cuid;
      const mockUser = createMockUser({
        cuids: [
          {
            cuid: clientId,
            roles: ['manager'],
            isConnected: false,
            displayName: 'testDisplayName2334',
          },
        ],
      });

      mockUserDAO.getUserById.mockResolvedValue(mockUser);
      mockUserDAO.updateById.mockResolvedValue({ success: true });

      const result = await clientService.reconnectUser(mockContext, targetUserId);

      // Assert
      expect(result.success).toBe(true);
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        targetUserId,
        {
          $set: { 'cuids.$[elem].isConnected': true },
        },
        {
          arrayFilters: [{ 'elem.cuid': clientId }],
        }
      );
    });
  });

  describe('getClientUsers', () => {
    it('should successfully retrieve all client users', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });
      const clientId = mockContext.currentuser.client.cuid;
      const mockUsers = [
        createMockUser({
          cuids: [
            { cuid: clientId, roles: ['admin'], isConnected: true, displayName: 'Admin User' },
          ],
        }),
        createMockUser({
          cuids: [
            { cuid: clientId, roles: ['manager'], isConnected: true, displayName: 'Manager User' },
          ],
        }),
      ];

      mockUserDAO.getUsersByClientId.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 2 },
      });

      const result = await clientService.getClientUsers(mockContext);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(2);
      expect(result.data.users[0]).toMatchObject({
        id: expect.any(String),
        email: expect.any(String),
        displayName: 'Admin User',
        roles: ['admin'],
        isConnected: true,
      });
      expect(mockUserDAO.getUsersByClientId).toHaveBeenCalledWith(
        clientId,
        {},
        {
          limit: 100,
          skip: 0,
          populate: 'profile',
        }
      );
    });
  });

  describe('error handling', () => {
    it('should handle invalid role in assignUserRole', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });

      await expect(
        clientService.assignUserRole(mockContext, 'user-123', 'invalid-role' as any)
      ).rejects.toThrow(BadRequestError);
    });

    it('should handle invalid user ID in role operations', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });

      mockUserDAO.getUserById.mockResolvedValue(null);

      await expect(
        clientService.assignUserRole(mockContext, 'invalid-user', 'manager')
      ).rejects.toThrow(NotFoundError);
    });
  });
});
