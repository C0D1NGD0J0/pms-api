import { UserService } from '@services/user/user.service';
import { IUserRole } from '@interfaces/user.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import {
  createMockRequestContext,
  createMockCurrentUser,
  createMockClientDAO,
  createMockUserDAO,
  createMockUser,
  createMockClient,
} from '@tests/helpers';

describe('UserService', () => {
  let userService: UserService;
  let mockClientDAO: any;
  let mockUserDAO: any;
  let mockPropertyDAO: any;
  let mockUserCache: any;

  beforeEach(() => {
    mockClientDAO = createMockClientDAO();
    mockUserDAO = createMockUserDAO();
    mockPropertyDAO = {
      getPropertiesByClientId: jest.fn().mockResolvedValue({ items: [] })
    };
    mockUserCache = {
      getUserDetail: jest.fn().mockResolvedValue({ success: false }),
      cacheUserDetail: jest.fn().mockResolvedValue({ success: true })
    };

    userService = new UserService({
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      propertyDAO: mockPropertyDAO,
      userCache: mockUserCache,
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });


  describe('getUsersByRole', () => {
    it('should successfully retrieve users by role', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
        request: {
          params: { cuid: 'test-client-id' },
        },
      });
      const role = IUserRole.MANAGER;
      const clientId = 'test-client-id';
      const mockClient = createMockClient({ cuid: clientId });
      const mockUsers = [
        createMockUser({
          uid: 'user-1',
          cuids: [
            { cuid: clientId, roles: ['manager'], isConnected: true, displayName: 'Manager 1' },
          ],
        }),
        createMockUser({
          uid: 'user-2',
          cuids: [
            { cuid: clientId, roles: ['manager'], isConnected: true, displayName: 'Manager 2' },
          ],
        }),
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 2, page: 1, limit: 100, pages: 1 },
      });

      const result = await userService.getUsersByRole(mockContext, role);

      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(2);
      expect(result.message).toBe('client.success.usersByRoleRetrieved');
      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        clientId,
        { role },
        {
          limit: 100,
          skip: 0,
          populate: [{ path: 'profile', select: 'personalInfo vendorInfo clientRoleInfo' }],
        }
      );
    });

    it('should throw BadRequestError for invalid role', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
        request: {
          params: { cuid: 'test-client-id' },
        },
      });

      await expect(
        userService.getUsersByRole(mockContext, 'invalid-role' as any)
      ).rejects.toThrow(BadRequestError);
    });

    it('should use currentuser client cuid when no cuid in params', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
        request: {
          params: {},
        },
      });
      const role = IUserRole.ADMIN;
      const clientId = mockContext.currentuser.client.cuid;
      const mockClient = createMockClient({ cuid: clientId });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, limit: 100, pages: 0 },
      });

      await userService.getUsersByRole(mockContext, role);

      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        clientId,
        { role },
        expect.any(Object)
      );
    });
  });

  describe('getFilteredUsers', () => {
    const mockClient = createMockClient({ cuid: 'test-client-id' });

    it('should successfully retrieve filtered users with employee type', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = { role: [IUserRole.MANAGER], status: 'active' as const };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          uid: 'user-1',
          email: 'employee1@test.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: ['manager'],
              isConnected: true,
              displayName: 'Employee Manager',
            },
          ],
          createdAt: new Date(),
          isActive: true,
          profile: {
            personalInfo: {
              firstName: 'John',
              lastName: 'Manager',
              avatar: 'avatar.jpg',
              phoneNumber: '+1234567890',
            },
            employeeInfo: { department: 'IT' },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      const result = await userService.getFilteredUsers(
        'test-client-id',
        currentUser,
        filterOptions,
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        uid: 'user-1',
        email: 'employee1@test.com',
        firstName: 'John',
        lastName: 'Manager',
        fullName: 'John Manager',
        userType: 'employee',
        employeeInfo: { department: 'IT' },
      });
      expect(result.data.items[0]).not.toHaveProperty('vendorInfo');
      expect(mockClientDAO.getClientByCuid).toHaveBeenCalledWith('test-client-id');
      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        'test-client-id',
        { role: ['manager'], status: 'active' },
        paginationOpts
      );
    });

    it('should successfully retrieve filtered users with vendor type', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = { role: [IUserRole.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          uid: 'vendor-1',
          email: 'vendor1@test.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: ['vendor'],
              isConnected: true,
              displayName: 'Vendor User',
              linkedVendorId: 'vendor-company-123',
            },
          ],
          createdAt: new Date(),
          isActive: true,
          profile: {
            personalInfo: {
              firstName: 'Jane',
              lastName: 'Vendor',
              avatar: '',
              phoneNumber: '',
            },
            vendorInfo: { companyName: 'Vendor Corp' },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      const result = await userService.getFilteredUsers(
        'test-client-id',
        currentUser,
        filterOptions,
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        uid: 'vendor-1',
        email: 'vendor1@test.com',
        firstName: 'Jane',
        lastName: 'Vendor',
        userType: 'vendor',
        vendorInfo: {
          companyName: 'Vendor Corp',
          isLinkedAccount: true,
          linkedVendorId: 'vendor-company-123',
        },
      });
      expect(result.data.items[0]).not.toHaveProperty('employeeInfo');
    });

    it('should successfully retrieve filtered users with tenant type', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = { role: [IUserRole.TENANT] };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          uid: 'tenant-1',
          email: 'tenant1@test.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: ['tenant'],
              isConnected: true,
              displayName: 'Tenant User',
            },
          ],
          createdAt: new Date(),
          isActive: true,
          profile: {
            personalInfo: {
              firstName: 'Bob',
              lastName: 'Tenant',
              avatar: '',
              phoneNumber: '',
            },
            tenantInfo: { unitNumber: '101' },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      const result = await userService.getFilteredUsers(
        'test-client-id',
        currentUser,
        filterOptions,
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        uid: 'tenant-1',
        email: 'tenant1@test.com',
        firstName: 'Bob',
        lastName: 'Tenant',
        userType: 'tenant',
        tenantInfo: { unitNumber: '101' },
      });
      expect(result.data.items[0]).not.toHaveProperty('vendorInfo');
      expect(result.data.items[0]).not.toHaveProperty('employeeInfo');
    });

    it('should handle vendor without linkedVendorId (primary vendor)', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = { role: [IUserRole.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          uid: 'vendor-primary',
          email: 'primary@vendor.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: ['vendor'],
              isConnected: true,
              displayName: 'Primary Vendor',
            },
          ],
          createdAt: new Date(),
          isActive: true,
          profile: {
            personalInfo: {
              firstName: 'Primary',
              lastName: 'Vendor',
              avatar: '',
              phoneNumber: '',
            },
            vendorInfo: { companyName: 'Primary Corp' },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      const result = await userService.getFilteredUsers(
        'test-client-id',
        currentUser,
        filterOptions,
        paginationOpts
      );

      expect(result.data.items[0].vendorInfo).toMatchObject({
        companyName: 'Primary Corp',
        isPrimaryVendor: true,
      });
      expect(result.data.items[0].vendorInfo).not.toHaveProperty('isLinkedAccount');
    });

    it('should convert string role to array format', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = { role: IUserRole.MANAGER as any };
      const paginationOpts = { limit: 10, skip: 0 };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, limit: 10, pages: 0 },
      });

      await userService.getFilteredUsers('test-client-id', currentUser, filterOptions, paginationOpts);

      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        'test-client-id',
        { role: ['manager'] },
        paginationOpts
      );
    });

    it('should throw BadRequestError when cuid is missing', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };

      await expect(
        userService.getFilteredUsers('', currentUser, filterOptions, paginationOpts)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError when client not found', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };

      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(
        userService.getFilteredUsers('invalid-client-id', currentUser, filterOptions, paginationOpts)
      ).rejects.toThrow(NotFoundError);
    });

    it('should handle errors and rethrow them', async () => {
      const currentUser = createMockCurrentUser();
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };
      const mockError = new Error('Database connection failed');

      mockClientDAO.getClientByCuid.mockRejectedValue(mockError);

      await expect(
        userService.getFilteredUsers('test-client-id', currentUser, filterOptions, paginationOpts)
      ).rejects.toThrow('Database connection failed');
    });
  });
});