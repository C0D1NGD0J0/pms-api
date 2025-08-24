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
  let mockPermissionService: any;

  beforeEach(() => {
    mockClientDAO = createMockClientDAO();
    mockUserDAO = createMockUserDAO();
    mockPropertyDAO = {
      getPropertiesByClientId: jest.fn().mockResolvedValue({ items: [] }),
    };
    mockUserCache = {
      getUserDetail: jest.fn().mockResolvedValue({ success: false }),
      cacheUserDetail: jest.fn().mockResolvedValue({ success: true }),
    };
    mockPermissionService = {
      canUserAccessUser: jest.fn().mockReturnValue(true),
      canAccessResource: jest.fn().mockReturnValue(true),
    };

    userService = new UserService({
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      propertyDAO: mockPropertyDAO,
      userCache: mockUserCache,
      permissionService: mockPermissionService,
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
            {
              cuid: clientId,
              roles: ['manager'],
              isConnected: true,
              clientDisplayName: 'Manager 1',
            },
          ],
        }),
        createMockUser({
          uid: 'user-2',
          cuids: [
            {
              cuid: clientId,
              roles: ['manager'],
              isConnected: true,
              clientDisplayName: 'Manager 2',
            },
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
        { role: [role] }, // Service converts single role to array
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

      await expect(userService.getUsersByRole(mockContext, 'invalid-role' as any)).rejects.toThrow(
        BadRequestError
      );
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
        { role: [role] }, // Service converts single role to array
        expect.any(Object)
      );
    });
  });

  describe('getFilteredUsers', () => {
    const mockClient = createMockClient({ cuid: 'test-client-id' });

    it('should successfully retrieve filtered users with employee type', async () => {
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
              clientDisplayName: 'Employee Manager',
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
        filterOptions,
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        uid: 'user-1',
        email: 'employee1@test.com',
        fullName: 'John Manager',
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
              clientDisplayName: 'Vendor User',
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
              displayName: 'Jane Vendor',
            },
            vendorInfo: { 
              companyName: 'Vendor Corp',
              businessType: 'Plumbing',
              contactPerson: { name: 'Jane Vendor' },
              stats: { 
                rating: '4.5',
                completedJobs: 25,
                responseTime: '2h'
              },
              reviewCount: 15,
              averageServiceCost: 250
            },
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
        filterOptions,
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        uid: 'vendor-1',
        email: 'vendor1@test.com',
        fullName: 'Jane Vendor',
        vendorInfo: {
          companyName: 'Vendor Corp',
          businessType: 'Plumbing',
          serviceType: 'Plumbing',
          contactPerson: 'Jane Vendor',
          rating: 4.5,
          reviewCount: 15,
          completedJobs: 25,
          averageResponseTime: '2h',
          averageServiceCost: 250,
          isLinkedAccount: true,
          linkedVendorId: 'vendor-company-123',
          isPrimaryVendor: false,
        },
      });
      expect(result.data.items[0]).not.toHaveProperty('employeeInfo');
    });

    it('should successfully retrieve filtered users with tenant type', async () => {
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
              clientDisplayName: 'Tenant User',
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
        filterOptions,
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
      expect(result.data.items[0]).toMatchObject({
        uid: 'tenant-1',
        email: 'tenant1@test.com',
        tenantInfo: { unitNumber: '101' },
      });
      expect(result.data.items[0]).not.toHaveProperty('vendorInfo');
      expect(result.data.items[0]).not.toHaveProperty('employeeInfo');
    });

    it('should handle vendor without linkedVendorId (primary vendor)', async () => {
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
              clientDisplayName: 'Primary Vendor',
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
              displayName: 'Primary Vendor',
            },
            vendorInfo: { 
              companyName: 'Primary Corp',
              businessType: 'General Contractor',
              stats: { 
                rating: '4.2',
                completedJobs: 18,
                responseTime: '4h'
              },
              reviewCount: 12,
              averageServiceCost: 300
            },
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
        filterOptions,
        paginationOpts
      );

      expect(result.data.items[0].vendorInfo).toMatchObject({
        companyName: 'Primary Corp',
        businessType: 'General Contractor',
        serviceType: 'General Contractor',
        contactPerson: 'Primary Vendor',
        rating: 4.2,
        reviewCount: 12,
        completedJobs: 18,
        averageResponseTime: '4h',
        averageServiceCost: 300,
        isPrimaryVendor: true,
        isLinkedAccount: false,
      });
    });

    it('should convert string role to array format', async () => {
      const filterOptions = { role: IUserRole.MANAGER as any };
      const paginationOpts = { limit: 10, skip: 0 };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, limit: 10, pages: 0 },
      });

      await userService.getFilteredUsers(
        'test-client-id',
        filterOptions,
        paginationOpts
      );

      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        'test-client-id',
        { role: ['manager'] },
        paginationOpts
      );
    });

    it('should throw BadRequestError when cuid is missing', async () => {
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };

      await expect(
        userService.getFilteredUsers('', filterOptions, paginationOpts)
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw NotFoundError when client not found', async () => {
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };

      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(
        userService.getFilteredUsers(
          'invalid-client-id',
          filterOptions,
          paginationOpts
        )
      ).rejects.toThrow(NotFoundError);
    });

    it('should handle errors and rethrow them', async () => {
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };
      const mockError = new Error('Database connection failed');

      mockClientDAO.getClientByCuid.mockRejectedValue(mockError);

      await expect(
        userService.getFilteredUsers('test-client-id', filterOptions, paginationOpts)
      ).rejects.toThrow('Database connection failed');
    });
  });
});
