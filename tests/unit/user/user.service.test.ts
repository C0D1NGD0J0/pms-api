import { Types } from 'mongoose';
import { UserService } from '@services/user/user.service';
import { ROLES } from '@shared/constants/roles.constants';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import {
  createMockRequestContext,
  createMockVendorService,
  createMockCurrentUser,
  createMockClientDAO,
  createMockUserDAO,
  createMockClient,
  createMockUser,
} from '@tests/helpers';

describe('UserService', () => {
  let userService: UserService;
  let mockClientDAO: any;
  let mockUserDAO: any;
  let mockPropertyDAO: any;
  let mockUserCache: any;
  let mockPermissionService: any;
  let mockVendorService: any;
  let mockProfileDAO: any;

  beforeEach(() => {
    mockClientDAO = createMockClientDAO();
    mockUserDAO = createMockUserDAO();
    mockUserDAO.getLinkedVendorUsers = jest
      .fn()
      .mockResolvedValue({ items: [], pagination: undefined });
    mockPropertyDAO = {
      getPropertiesByClientId: jest.fn().mockResolvedValue({ items: [] }),
    };
    mockUserCache = {
      getUserDetail: jest.fn().mockResolvedValue({ success: false }),
      cacheUserDetail: jest.fn().mockResolvedValue({ success: true }),
      getFilteredUsers: jest.fn().mockResolvedValue({ success: false }),
      cacheFilteredUsers: jest.fn().mockResolvedValue({ success: true }),
      saveFilteredUsers: jest.fn().mockResolvedValue({ success: true }),
      invalidateUserDetail: jest.fn().mockResolvedValue({ success: true }),
      invalidateUserLists: jest.fn().mockResolvedValue({ success: true }),
    };
    mockPermissionService = {
      canUserAccessUser: jest.fn().mockReturnValue(true),
      canAccessResource: jest.fn().mockReturnValue(true),
    };
    mockVendorService = createMockVendorService();
    mockProfileDAO = {
      updateById: jest.fn().mockResolvedValue({ success: true }),
      findById: jest.fn().mockResolvedValue({}),
    };

    userService = new UserService({
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      propertyDAO: mockPropertyDAO,
      userCache: mockUserCache,
      permissionService: mockPermissionService,
      vendorService: mockVendorService,
      profileDAO: mockProfileDAO,
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
      const role = ROLES.MANAGER;
      const clientId = 'test-client-id';
      const mockClient = createMockClient({ cuid: clientId });
      const mockUsers = [
        createMockUser({
          uid: 'user-1',
          cuids: [
            {
              cuid: clientId,
              roles: [ROLES.MANAGER],
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
              roles: [ROLES.MANAGER],
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
      const role = ROLES.ADMIN;
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
      const filterOptions = { role: [ROLES.MANAGER], status: 'active' as const };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          uid: 'user-1',
          email: 'employee1@test.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: [ROLES.MANAGER],
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
        { role: [ROLES.MANAGER], status: 'active' },
        paginationOpts
      );
    });

    it('should successfully retrieve filtered users with vendor type', async () => {
      const filterOptions = { role: [ROLES.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          uid: 'vendor-1',
          email: 'vendor1@test.com',
          _id: new Types.ObjectId('507f1f77bcf86cd799439011'), // Add _id for vendor lookup
          cuids: [
            {
              cuid: 'test-client-id',
              roles: [ROLES.VENDOR],
              isConnected: true,
              clientDisplayName: 'Vendor User',
              linkedVendorUid: 'vendor-company-123',
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
                responseTime: '2h',
              },
              reviewCount: 15,
              averageServiceCost: 250,
            },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      // Mock vendor service for this specific test
      mockVendorService.getVendorByUserId.mockResolvedValue({
        companyName: 'Vendor Corp',
        businessType: 'Plumbing',
        contactPerson: { name: 'Jane Vendor' },
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
          linkedVendorUid: 'vendor-company-123',
          isPrimaryVendor: false,
        },
      });
      expect(result.data.items[0]).not.toHaveProperty('employeeInfo');
    });

    it('should successfully retrieve filtered users with tenant type', async () => {
      const filterOptions = { role: [ROLES.TENANT] };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          uid: 'tenant-1',
          email: 'tenant1@test.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: [ROLES.TENANT],
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

    it('should handle vendor without linkedVendorUid (primary vendor)', async () => {
      const filterOptions = { role: [ROLES.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          _id: 'vendor-primary-id',
          uid: 'vendor-primary',
          email: 'primary@vendor.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: [ROLES.VENDOR],
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
                responseTime: '4h',
              },
              reviewCount: 12,
              averageServiceCost: 300,
            },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockUsers,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      // Mock vendor service to return vendor data
      mockVendorService.getVendorByUserId.mockResolvedValue({
        companyName: 'Primary Corp',
        businessType: 'General Contractor',
        contactPerson: { name: 'Primary Vendor' },
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
        rating: 4.5, // hardcoded placeholder in user service
        reviewCount: 15, // hardcoded placeholder in user service
        completedJobs: 25, // hardcoded placeholder in user service
        averageResponseTime: '2h', // hardcoded placeholder in user service
        averageServiceCost: 250, // hardcoded placeholder in user service
        isPrimaryVendor: true,
        isLinkedAccount: false,
      });
    });

    it('should convert string role to array format', async () => {
      const filterOptions = { role: ROLES.MANAGER as any };
      const paginationOpts = { limit: 10, skip: 0 };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, limit: 10, pages: 0 },
      });

      await userService.getFilteredUsers('test-client-id', filterOptions, paginationOpts);

      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        'test-client-id',
        { role: [ROLES.MANAGER] },
        paginationOpts
      );
    });

    it('should throw BadRequestError when cuid is missing', async () => {
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };

      await expect(userService.getFilteredUsers('', filterOptions, paginationOpts)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw NotFoundError when client not found', async () => {
      const filterOptions = {};
      const paginationOpts = { limit: 10, skip: 0 };

      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(
        userService.getFilteredUsers('invalid-client-id', filterOptions, paginationOpts)
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

  describe('getUserStats', () => {
    it('should successfully retrieve user statistics for employee roles', async () => {
      const mockClient = createMockClient({ cuid: 'test-client-id' });
      const filterOptions = { role: [ROLES.STAFF] };
      const expectedStats = {
        totalFilteredUsers: 10,
        roleDistribution: [{ name: 'Staff', value: 10, percentage: 100 }],
        departmentDistribution: [{ name: 'IT', value: 10, percentage: 100 }],
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockClientDAO.getClientUsersStats.mockResolvedValue(expectedStats);

      const result = await userService.getUserStats('test-client-id', filterOptions);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expectedStats);
      expect(mockClientDAO.getClientUsersStats).toHaveBeenCalledWith(
        'test-client-id',
        filterOptions
      );
    });

    it('should successfully retrieve user statistics for any role', async () => {
      const mockClient = createMockClient({ cuid: 'test-client-id' });
      const filterOptions = { role: [ROLES.MANAGER] };
      const expectedStats = {
        totalFilteredUsers: 5,
        roleDistribution: [{ name: 'Manager', value: 5, percentage: 100 }],
        departmentDistribution: [{ name: 'Management', value: 5, percentage: 100 }],
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockClientDAO.getClientUsersStats.mockResolvedValue(expectedStats);

      const result = await userService.getUserStats('test-client-id', filterOptions);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expectedStats);
      expect(mockClientDAO.getClientUsersStats).toHaveBeenCalledWith(
        'test-client-id',
        filterOptions
      );
    });

    it('should work with no role filter specified', async () => {
      const mockClient = createMockClient({ cuid: 'test-client-id' });
      const filterOptions = {};
      const expectedStats = {
        totalFilteredUsers: 15,
        roleDistribution: [
          { name: 'Staff', value: 8, percentage: 53 },
          { name: 'Manager', value: 5, percentage: 33 },
          { name: 'Admin', value: 2, percentage: 14 },
        ],
        departmentDistribution: [
          { name: 'IT', value: 6, percentage: 40 },
          { name: 'HR', value: 5, percentage: 33 },
          { name: 'Finance', value: 4, percentage: 27 },
        ],
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockClientDAO.getClientUsersStats.mockResolvedValue(expectedStats);

      const result = await userService.getUserStats('test-client-id', filterOptions);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(expectedStats);
      expect(mockClientDAO.getClientUsersStats).toHaveBeenCalledWith(
        'test-client-id',
        filterOptions
      );
    });
  });

  /* Skipped: getVendorTeamMembers has been moved to VendorService
  describe('getVendorTeamMembers - MOVED TO VendorService', () => {
    const mockVendorId = 'vendor-123';
    const mockClientId = 'test-client-id';

    it('should successfully retrieve vendor team members', async () => {
      const mockClient = createMockClient({ cuid: mockClientId });
      const mockTeamMembers = [
        createMockUser({
          uid: 'team-member-1',
          email: 'member1@vendor.com',
          cuids: [
            {
              cuid: mockClientId,
              roles: [ROLES.VENDOR],
              isConnected: true,
              clientDisplayName: 'Team Member 1',
              linkedVendorUid: mockVendorId,
            },
          ],
          profile: {
            personalInfo: {
              firstName: 'John',
              lastName: 'Doe',
              displayName: 'John Doe',
              location: 'New York',
              avatar: { filename: 'avatar1.jpg', key: 'key1', url: 'url1' },
              phoneNumber: '+1234567890',
            },
          } as any,
        }),
        createMockUser({
          uid: 'team-member-2',
          email: 'member2@vendor.com',
          cuids: [
            {
              cuid: mockClientId,
              roles: [ROLES.VENDOR],
              isConnected: true,
              clientDisplayName: 'Team Member 2',
              linkedVendorUid: mockVendorId,
            },
          ],
          profile: {
            personalInfo: {
              firstName: 'Jane',
              lastName: 'Smith',
              displayName: 'Jane Smith',
              location: 'Los Angeles',
              avatar: { filename: 'avatar2.jpg', key: 'key2', url: 'url2' },
              phoneNumber: '+1987654321',
            },
          } as any,
        }),
      ];

      const paginationOpts = { limit: 10, skip: 0 };
      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockTeamMembers,
        pagination: { total: 2, page: 1, limit: 10, pages: 1 },
      });

      // Mock userDAO.getUserByUId to return vendor user
      mockUserDAO.getUserByUId.mockResolvedValue({
        _id: 'vendor-object-id',
        uid: mockVendorId,
        cuids: [{ cuid: mockClientId, isConnected: true, roles: [ROLES.VENDOR] }],
        profile: { personalInfo: { firstName: 'Vendor', lastName: 'Owner' } },
      });

      // Mock getLinkedVendorUsers to return team members
      mockUserDAO.getLinkedVendorUsers.mockResolvedValue({
        items: mockTeamMembers,
        pagination: { total: 2, page: 1, limit: 10, pages: 1 },
      });

      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
        request: { params: { cuid: mockClientId } },
      });

      const result = await userService.getVendorTeamMembers(
        mockContext,
        mockClientId,
        mockVendorId,
        'active',
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.teamMembers).toHaveLength(2);
      expect(result.data.teamMembers[0]).toMatchObject({
        uid: 'team-member-1',
        email: 'member1@vendor.com',
        fullName: 'John Doe',
        avatar: 'avatar1.jpg',
        phoneNumber: '+1234567890',
        isLinkedAccount: true,
        isPrimaryVendor: false,
      });
      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        mockClientId,
        { role: [ROLES.VENDOR], status: 'active', linkedVendorUid: mockVendorId },
        paginationOpts
      );
    });

    it('should handle pagination and filtering correctly', async () => {
      const mockClient = createMockClient({ cuid: mockClientId });
      const paginationOpts = { limit: 5, skip: 10 };
      const filterOptions = { status: 'inactive' as const };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 3, limit: 5, pages: 0 },
      });

      // Mock userDAO.getUserByUId to return vendor user
      mockUserDAO.getUserByUId.mockResolvedValue({
        _id: 'vendor-object-id',
        uid: mockVendorId,
        cuids: [{ cuid: mockClientId, isConnected: true, roles: [ROLES.VENDOR] }],
        profile: { personalInfo: { firstName: 'Vendor', lastName: 'Owner' } },
      });

      // Mock getLinkedVendorUsers to return empty team members
      mockUserDAO.getLinkedVendorUsers.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 3, limit: 5, pages: 0 },
      });

      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
        request: { params: { cuid: mockClientId } },
      });

      const result = await userService.getVendorTeamMembers(
        mockContext,
        mockClientId,
        mockVendorId,
        'inactive',
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.teamMembers).toHaveLength(0);
      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        mockClientId,
        { role: [ROLES.VENDOR], status: 'inactive', linkedVendorUid: mockVendorId },
        paginationOpts
      );
    });

    it('should throw NotFoundError when client not found', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
        request: { params: { cuid: mockClientId } },
      });

    });
  });
  */

  describe('enhanced vendor data transformation in getFilteredUsers', () => {
    it('should properly transform vendor data with enhanced vendor information', async () => {
      const mockClient = createMockClient({ cuid: 'test-client-id' });
      const filterOptions = { role: [ROLES.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };

      const mockVendorUsers = [
        {
          _id: 'vendor-enhanced-id',
          uid: 'vendor-enhanced',
          email: 'enhanced@vendor.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: [ROLES.VENDOR],
              isConnected: true,
              clientDisplayName: 'Enhanced Vendor',
              linkedVendorUid: 'linked-vendor-123',
            },
          ],
          createdAt: new Date(),
          isActive: true,
          profile: {
            personalInfo: {
              firstName: 'Enhanced',
              lastName: 'Vendor',
              avatar: 'enhanced-avatar.jpg',
              phoneNumber: '+1111111111',
              displayName: 'Enhanced Vendor Display',
            },
            vendorInfo: {
              companyName: 'Enhanced Corp',
              businessType: 'electrical',
              contactPerson: { name: 'Enhanced Contact', jobTitle: 'Manager' },
              stats: {
                rating: '4.8',
                completedJobs: 150,
                responseTime: '1h',
              },
              reviewCount: 75,
              averageServiceCost: 500,
            },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockVendorUsers,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      // Mock vendor service to return enhanced vendor data
      mockVendorService.getVendorByUserId.mockResolvedValue({
        companyName: 'Enhanced Corp',
        businessType: 'electrical',
        contactPerson: { name: 'Enhanced Contact', jobTitle: 'Manager' },
      });

      const result = await userService.getFilteredUsers(
        'test-client-id',
        filterOptions,
        paginationOpts
      );

      expect(result.success).toBe(true);
      expect(result.data.items[0].vendorInfo).toMatchObject({
        companyName: 'Enhanced Corp',
        businessType: 'electrical',
        serviceType: 'electrical',
        contactPerson: 'Enhanced Contact',
        rating: 4.5, // hardcoded placeholder in user service
        reviewCount: 15, // hardcoded placeholder in user service
        completedJobs: 25, // hardcoded placeholder in user service
        averageResponseTime: '2h', // hardcoded placeholder in user service
        averageServiceCost: 250, // hardcoded placeholder in user service
        isLinkedAccount: true,
        linkedVendorUid: 'linked-vendor-123',
        isPrimaryVendor: false,
      });
    });

    it('should handle primary vendor (no linkedVendorUid) correctly', async () => {
      const mockClient = createMockClient({ cuid: 'test-client-id' });
      const filterOptions = { role: [ROLES.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };

      const mockPrimaryVendor = [
        {
          _id: 'primary-vendor-id',
          uid: 'primary-vendor',
          email: 'primary@vendor.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: [ROLES.VENDOR],
              isConnected: true,
              clientDisplayName: 'Primary Vendor',
            },
          ],
          createdAt: new Date(),
          isActive: true,
          profile: {
            personalInfo: {
              firstName: 'Primary',
              lastName: 'Owner',
              displayName: 'Primary Owner',
            },
            vendorInfo: {
              companyName: 'Primary Corp',
              businessType: 'general_contractor',
              stats: { rating: '4.5', completedJobs: 100, responseTime: '2h' },
              reviewCount: 50,
              averageServiceCost: 750,
            },
          },
        },
      ];

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: mockPrimaryVendor,
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      });

      // Mock vendor service to return primary vendor data
      mockVendorService.getVendorByUserId.mockResolvedValue({
        companyName: 'Primary Corp',
        businessType: 'general_contractor',
        contactPerson: { name: 'Primary Owner' },
      });

      const result = await userService.getFilteredUsers(
        'test-client-id',
        filterOptions,
        paginationOpts
      );

      expect(result.data.items[0].vendorInfo).toMatchObject({
        isPrimaryVendor: true,
        isLinkedAccount: false,
        linkedVendorUid: null,
        serviceType: 'general_contractor',
        contactPerson: 'Primary Owner',
      });
    });
  });

  // ===================================================================
  // MISSING METHOD TESTS - Added for Phase 1 Completion
  // ===================================================================

  describe('updateUserInfo', () => {
    beforeEach(() => {
      mockUserDAO.findFirst = jest.fn();
      mockUserDAO.updateById = jest.fn();
    });

    it('should successfully update user email', async () => {
      const userId = 'user-123';
      const existingUser = { _id: 'obj-id-123', uid: userId, email: 'old@example.com' };
      const updatedUser = { ...existingUser, email: 'new@example.com' };

      mockUserDAO.findFirst
        .mockResolvedValueOnce(existingUser) // First call: check user exists
        .mockResolvedValueOnce(null); // Second call: email doesn't exist
      mockUserDAO.updateById.mockResolvedValue(updatedUser);

      const result = await userService.updateUserInfo(userId, { email: 'new@example.com' });

      expect(result.success).toBe(true);
      expect(result.data.email).toBe('new@example.com');
    });

    it('should throw error for duplicate email', async () => {
      const userId = 'user-123';
      const existingUser = { _id: 'obj-id-123', uid: userId, email: 'old@example.com' };

      mockUserDAO.findFirst
        .mockResolvedValueOnce(existingUser)
        .mockResolvedValueOnce({ email: 'exists@example.com' }); // Email exists

      await expect(
        userService.updateUserInfo(userId, { email: 'exists@example.com' })
      ).rejects.toThrow(BadRequestError);
    });

    it('should throw error for user not found', async () => {
      mockUserDAO.findFirst.mockResolvedValue(null);

      await expect(
        userService.updateUserInfo('nonexistent', { email: 'test@example.com' })
      ).rejects.toThrow(NotFoundError);
    });
  });

  describe('getTenantsByClient', () => {
    beforeEach(() => {
      mockUserDAO.getTenantsByClient = jest.fn();
    });

    it('should successfully retrieve tenants', async () => {
      const cuid = 'client-123';
      const mockClient = createMockClient({ cuid });
      const mockTenants = {
        items: [
          {
            uid: 'tenant-1',
            email: 'tenant@example.com',
            isActive: true,
            profile: {
              personalInfo: { firstName: 'John', lastName: 'Doe' },
              tenantInfo: {},
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
        pagination: { total: 1, page: 1, limit: 10, pages: 1 },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getTenantsByClient.mockResolvedValue(mockTenants);

      const result = await userService.getTenantsByClient(cuid);

      expect(result.success).toBe(true);
      expect(result.data.items).toHaveLength(1);
    });

    it('should throw error for missing client ID', async () => {
      await expect(userService.getTenantsByClient('')).rejects.toThrow(BadRequestError);
    });

    it('should throw error for non-existent client', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(userService.getTenantsByClient('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getTenantStats', () => {
    beforeEach(() => {
      mockUserDAO.getTenantStats = jest.fn();
    });

    it('should retrieve tenant statistics', async () => {
      const cuid = 'client-123';
      const mockClient = createMockClient({ cuid });
      const mockStats = {
        total: 10,
        byLeaseStatus: { active: 8, inactive: 2 },
        byBackgroundCheck: { completed: 9, pending: 1 },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getTenantStats.mockResolvedValue(mockStats);

      const result = await userService.getTenantStats(cuid);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(10);
    });

    it('should throw error for missing client ID', async () => {
      await expect(userService.getTenantStats('')).rejects.toThrow(BadRequestError);
    });

    it('should throw error for non-existent client', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(userService.getTenantStats('nonexistent')).rejects.toThrow(NotFoundError);
    });
  });

  describe('getClientTenantDetails', () => {
    beforeEach(() => {
      mockUserDAO.getClientTenantDetails = jest.fn();
    });

    it('should retrieve tenant details', async () => {
      const cuid = 'client-123';
      const tenantUid = 'tenant-456';
      const mockClient = createMockClient({ cuid });
      const mockTenant = {
        uid: tenantUid,
        email: 'tenant@example.com',
        firstName: 'Jane',
        lastName: 'Smith',
        fullName: 'Jane Smith',
        isActive: true,
        createdAt: new Date(),
        tenantInfo: { activeLeases: [] },
        tenantMetrics: {},
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getClientTenantDetails.mockResolvedValue(mockTenant);

      const result = await userService.getClientTenantDetails(cuid, tenantUid);

      expect(result.success).toBe(true);
      expect(result.data.profile.uid).toBe(tenantUid);
      expect(result.data.profile.firstName).toBe('Jane');
      expect(result.data.profile.lastName).toBe('Smith');
      expect(result.data.userType).toBe('tenant');
    });

    it('should throw error for non-existent tenant', async () => {
      const mockClient = createMockClient({ cuid: 'client-123' });
      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getClientTenantDetails.mockResolvedValue(null);

      await expect(userService.getClientTenantDetails('client-123', 'nonexistent')).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw error for missing parameters', async () => {
      await expect(userService.getClientTenantDetails('', 'tenant-456')).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('getUserAnnouncementFilters', () => {
    beforeEach(() => {
      mockUserDAO.findFirst = jest.fn();
    });

    it('should return user roles', async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = createMockUser({
        _id: userId,
        cuids: [{ cuid: 'client-123', roles: [ROLES.EMPLOYEE] }],
        profile: { personalInfo: {} },
      });

      mockUserDAO.findFirst.mockResolvedValue(mockUser);

      const result = await userService.getUserAnnouncementFilters(userId, 'client-123');

      expect(result.roles).toContain(ROLES.EMPLOYEE);
    });

    it('should return vendorId for vendor users', async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = createMockUser({
        _id: userId,
        cuids: [
          {
            cuid: 'client-123',
            roles: [ROLES.VENDOR],
            isConnected: true,
            clientDisplayName: 'Test Vendor',
          },
        ],
        profile: { personalInfo: {} },
      });

      mockUserDAO.findFirst.mockResolvedValue(mockUser);
      mockVendorService.getVendorByUserId.mockResolvedValue({ vuid: 'vendor-123' });

      const result = await userService.getUserAnnouncementFilters(userId, 'client-123');

      expect(result.vendorId).toBe('vendor-123');
    });

    it('should return empty roles for non-existent user', async () => {
      mockUserDAO.findFirst.mockResolvedValue(null);

      const result = await userService.getUserAnnouncementFilters('nonexistent', 'client-123');

      expect(result.roles).toEqual([]);
    });
  });

  describe('getUserProperties', () => {
    it('should retrieve user properties', async () => {
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({
        items: [
          {
            _id: 'prop-1',
            name: 'Building A',
            address: { street: '123 Main St', city: 'NYC' },
          },
        ],
      });

      const result = await userService.getUserProperties('user-123', 'client-123');

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Building A');
    });

    it('should return empty array for no properties', async () => {
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({ items: [] });

      const result = await userService.getUserProperties('user-123', 'client-123');

      expect(result).toEqual([]);
    });

    it('should return empty array on error', async () => {
      mockPropertyDAO.getPropertiesByClientId.mockRejectedValue(new Error('Database error'));

      const result = await userService.getUserProperties('user-123', 'client-123');

      expect(result).toEqual([]);
    });
  });

  describe('getUserWithClientContext', () => {
    beforeEach(() => {
      mockUserDAO.findFirst = jest.fn();
    });

    it('should retrieve user with client context', async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = createMockUser({
        _id: userId,
        uid: 'user-123',
        cuids: [{ cuid: 'client-123', roles: [ROLES.EMPLOYEE] }],
      });

      mockUserDAO.findFirst.mockResolvedValue(mockUser);

      const result = await userService.getUserWithClientContext(userId, 'client-123');

      expect(result).toBeDefined();
      expect(result.uid).toBe('user-123');
    });

    it('should return null for missing user ID', async () => {
      const result = await userService.getUserWithClientContext('', 'client-123');

      expect(result).toBeNull();
    });

    it('should return null for missing client ID', async () => {
      const userId = new Types.ObjectId().toString();
      const result = await userService.getUserWithClientContext(userId, '');

      expect(result).toBeNull();
    });
  });

  describe('getUserSupervisor', () => {
    beforeEach(() => {
      mockUserDAO.findFirst = jest.fn();
    });

    it('should return supervisor ID', async () => {
      const userId = new Types.ObjectId().toString();
      const supervisorObjId = new Types.ObjectId().toString();
      const mockUser = createMockUser({
        _id: userId,
        profile: {
          personalInfo: {},
          employeeInfo: { reportsTo: supervisorObjId },
        },
      });

      const mockSupervisor = createMockUser({ _id: supervisorObjId, uid: 'supervisor-123' });

      mockUserDAO.findFirst.mockResolvedValueOnce(mockUser).mockResolvedValueOnce(mockSupervisor);

      const result = await userService.getUserSupervisor(userId, 'client-123');

      expect(result).toBe(supervisorObjId);
    });

    it('should return null when user has no supervisor', async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = createMockUser({
        _id: userId,
        profile: {
          personalInfo: {},
          employeeInfo: {},
        },
      });

      mockUserDAO.findFirst.mockResolvedValue(mockUser);

      const result = await userService.getUserSupervisor(userId, 'client-123');

      expect(result).toBeNull();
    });

    it('should return null when supervisor not found', async () => {
      const userId = new Types.ObjectId().toString();
      const supervisorObjId = new Types.ObjectId().toString();
      const mockUser = createMockUser({
        _id: userId,
        profile: {
          personalInfo: {},
          employeeInfo: { reportsTo: supervisorObjId },
        },
      });

      mockUserDAO.findFirst.mockResolvedValueOnce(mockUser).mockResolvedValueOnce(null); // Supervisor not found

      const result = await userService.getUserSupervisor(userId, 'client-123');

      expect(result).toBeNull();
    });
  });

  describe('getUserDisplayName', () => {
    beforeEach(() => {
      mockUserDAO.findFirst = jest.fn();
    });

    it('should return "System" for system user', async () => {
      const result = await userService.getUserDisplayName('system', 'client-123');

      expect(result).toBe('System');
    });

    it('should return full name for valid user', async () => {
      const userId = new Types.ObjectId().toString();
      const mockUser = createMockUser({
        _id: userId,
        profile: {
          personalInfo: { firstName: 'John', lastName: 'Doe' },
        },
      });

      mockUserDAO.findFirst.mockResolvedValue(mockUser);

      const result = await userService.getUserDisplayName(userId, 'client-123');

      expect(result).toBe('John Doe');
    });

    it('should return "Unknown User" for non-existent user', async () => {
      mockUserDAO.findFirst.mockResolvedValue(null);

      const result = await userService.getUserDisplayName('nonexistent', 'client-123');

      expect(result).toBe('Unknown User');
    });
  });

  // NEW: Tenant Admin Methods Tests
  describe('getTenantUserInfo', () => {
    beforeEach(() => {
      mockUserDAO.getUserByUId = jest.fn();
    });

    it('should retrieve tenant profile successfully', async () => {
      const cuid = 'client-123';
      const uid = 'tenant-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
      });
      const mockContext = createMockRequestContext({
        currentuser: mockCurrentUser,
      });
      const mockTenant = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        cuids: [{ cuid, roles: [ROLES.TENANT], isConnected: true }],
        profile: {
          personalInfo: { firstName: 'Jane', lastName: 'Tenant' },
          tenantInfo: {
            leaseStatus: 'active',
            rentStatus: 'current',
          },
        },
      });

      // Mock fetchAndValidateUser chain
      mockUserDAO.getUserByUId.mockResolvedValue(mockTenant);
      mockUserCache.getUserDetail.mockResolvedValue({
        success: true,
        data: {
          ...mockTenant,
          profile: {
            ...mockTenant.profile,
            userType: 'tenant',
          },
        },
      });

      const result = await userService.getTenantUserInfo(cuid, uid, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.profile.userType).toBe('tenant');
    });

    it('should throw NotFoundError when tenant not found', async () => {
      const cuid = 'client-123';
      const uid = 'nonexistent';
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });

      mockUserDAO.getUserByUId.mockResolvedValue(null);

      await expect(userService.getTenantUserInfo(cuid, uid, mockContext)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw BadRequestError for non-tenant user', async () => {
      const cuid = 'client-123';
      const uid = 'employee-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
      });
      const mockContext = createMockRequestContext({
        currentuser: mockCurrentUser,
      });
      const mockEmployee = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        cuids: [{ cuid, roles: [ROLES.EMPLOYEE], isConnected: true }],
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockEmployee);
      mockUserCache.getUserDetail.mockResolvedValue({
        success: true,
        data: {
          ...mockEmployee,
          profile: {
            userType: 'employee',
          },
        },
      });

      await expect(userService.getTenantUserInfo(cuid, uid, mockContext)).rejects.toThrow(
        BadRequestError
      );
    });
  });

  describe('updateTenantProfile', () => {
    beforeEach(() => {
      mockUserDAO.updateTenantProfile = jest.fn();
      mockUserDAO.getUserByUId = jest.fn();
    });

    it('should update tenant profile successfully', async () => {
      const cuid = 'client-123';
      const uid = 'tenant-123';
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });
      const updateData = {
        personalInfo: { phone: '555-1234' },
        tenantInfo: { leaseStatus: 'active', rentAmount: 1500 },
      };
      const mockTenant = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        cuids: [{ cuid, roles: ['tenant'], isConnected: true }],
        profile: {
          _id: new Types.ObjectId(),
          tenantInfo: {},
        },
      });
      mockUserDAO.getUserByUId.mockResolvedValue(mockTenant);
      mockPermissionService.canUserAccessUser.mockReturnValue(true);
      mockProfileDAO.updateById.mockResolvedValue({ success: true });

      const result = await userService.updateTenantProfile(cuid, uid, updateData, mockContext);

      expect(result.success).toBe(true);
      expect(mockProfileDAO.updateById).toHaveBeenCalled();
    });

    it('should throw BadRequestError for non-tenant user', async () => {
      const cuid = 'client-123';
      const uid = 'employee-123';
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });
      const mockEmployee = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        cuids: [{ cuid, roles: [ROLES.EMPLOYEE], isConnected: true }],
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockEmployee);

      await expect(userService.updateTenantProfile(cuid, uid, {}, mockContext)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw NotFoundError when tenant not found', async () => {
      const cuid = 'client-123';
      const uid = 'nonexistent';
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });

      mockUserDAO.getUserByUId.mockResolvedValue(null);

      await expect(userService.updateTenantProfile(cuid, uid, {}, mockContext)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('archiveUser', () => {
    beforeEach(() => {
      mockUserDAO.archiveUser = jest.fn();
      mockUserDAO.getUserByUId = jest.fn();
      mockClientDAO.getClientByCuid = jest.fn();
    });

    it('should successfully archive user (soft delete)', async () => {
      const cuid = 'client-123';
      const uid = 'user-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        uid: 'admin-123',
      });
      const mockUser = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        cuids: [{ cuid, roles: [ROLES.TENANT], isConnected: true }],
      });
      const mockClient = createMockClient({ cuid, primaryAccountHolder: 'other-user' });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUserByUId.mockResolvedValue(mockUser);
      mockUserDAO.archiveUser.mockResolvedValue({ ...mockUser, deletedAt: new Date() });
      mockPermissionService.canUserAccessUser.mockReturnValue(true);

      const result = await userService.archiveUser(cuid, uid, mockCurrentUser);

      expect(result.success).toBe(true);
    });

    it('should prevent archiving self', async () => {
      const cuid = 'client-123';
      const uid = 'user-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        uid,
      });
      const mockUser = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        cuids: [{ cuid, roles: [ROLES.ADMIN], isConnected: true }],
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockUser);
      mockPermissionService.canUserAccessUser.mockReturnValue(true);

      await expect(userService.archiveUser(cuid, uid, mockCurrentUser)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw NotFoundError when user not found', async () => {
      const cuid = 'client-123';
      const uid = 'nonexistent';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
      });

      mockUserDAO.getUserByUId.mockResolvedValue(null);

      await expect(userService.archiveUser(cuid, uid, mockCurrentUser)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('getTenantsStats', () => {
    beforeEach(() => {
      mockUserDAO.getTenantStats = jest.fn();
      mockClientDAO.getClientByCuid = jest.fn();
    });

    it('should return tenant statistics successfully', async () => {
      const cuid = 'client-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
      });
      const mockClient = createMockClient({ cuid });
      const mockStats = {
        total: 20,
        byLeaseStatus: { active: 15, expired: 5 },
        byRentStatus: { current: 18, late: 2 },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getTenantStats.mockResolvedValue(mockStats);

      const result = await userService.getTenantsStats(cuid, mockCurrentUser);

      expect(result.success).toBe(true);
      expect(result.data.total).toBe(20);
    });

    it('should handle missing client ID', async () => {
      const mockCurrentUser = createMockCurrentUser();

      await expect(userService.getTenantsStats('', mockCurrentUser)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should handle errors gracefully', async () => {
      const cuid = 'client-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
      });

      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      await expect(userService.getTenantsStats(cuid, mockCurrentUser)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('getClientUserInfo', () => {
    beforeEach(() => {
      mockUserDAO.getUserByUId = jest.fn();
      mockUserCache.getUserDetail = jest.fn();
      mockUserCache.cacheUserDetail = jest.fn();
    });

    it('should retrieve user info with cache hit', async () => {
      const cuid = 'client-123';
      const uid = 'user-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
      });
      const mockUser = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        cuids: [{ cuid, roles: [ROLES.EMPLOYEE], isConnected: true }],
      });
      const cachedUserInfo = {
        uid,
        email: 'user@example.com',
        profile: { personalInfo: { firstName: 'John', lastName: 'Doe' } },
      };

      mockUserDAO.getUserByUId.mockResolvedValue(mockUser);
      mockUserCache.getUserDetail.mockResolvedValue({ success: true, data: cachedUserInfo });

      const result = await userService.getClientUserInfo(cuid, uid, mockCurrentUser);

      expect(result.success).toBe(true);
      expect(result.data.uid).toBe(uid);
    });

    it('should build user details with cache miss', async () => {
      const cuid = 'client-123';
      const uid = 'user-123';
      const mockCurrentUser = createMockCurrentUser({
        client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
      });
      const mockUser = createMockUser({
        uid,
        _id: new Types.ObjectId().toString(),
        email: 'user@example.com',
        cuids: [{ cuid, roles: [ROLES.EMPLOYEE], isConnected: true }],
        profile: {
          personalInfo: { firstName: 'Jane', lastName: 'Smith' },
        },
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockUser);
      mockUserCache.getUserDetail.mockResolvedValue({ success: false });
      mockUserCache.cacheUserDetail.mockResolvedValue({ success: true });

      const result = await userService.getClientUserInfo(cuid, uid, mockCurrentUser);

      expect(result.success).toBe(true);
      expect(mockUserCache.cacheUserDetail).toHaveBeenCalled();
    });

    it('should throw NotFoundError for invalid user', async () => {
      const cuid = 'client-123';
      const uid = 'nonexistent';
      const mockCurrentUser = createMockCurrentUser({ client: { cuid, role: ROLES.ADMIN } });

      mockUserDAO.getUserByUId.mockResolvedValue(null);

      await expect(userService.getClientUserInfo(cuid, uid, mockCurrentUser)).rejects.toThrow(
        NotFoundError
      );
    });
  });

  describe('deactivateTenant', () => {
    const cuid = 'client-123';
    const uid = 'tenant-456';

    it('should successfully deactivate tenant', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          uid: 'admin-789',
          client: { cuid, role: ROLES.ADMIN },
        }),
      });

      const mockTenant = createMockUser({
        _id: new Types.ObjectId(),
        uid,
        cuids: [
          {
            cuid,
            roles: [ROLES.TENANT],
            isConnected: true,
            clientDisplayName: 'Test Tenant',
          },
        ],
        profile: new Types.ObjectId(),
        isActive: true,
        deletedAt: null,
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockTenant);
      mockUserDAO.updateById.mockResolvedValue({ success: true });
      mockPermissionService.canUserAccessUser.mockReturnValue(true);
      mockUserCache.invalidateUserDetail.mockResolvedValue({ success: true });
      mockUserCache.invalidateUserLists.mockResolvedValue({ success: true });

      const result = await userService.deactivateTenant(cuid, uid, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.uid).toBe(uid);
      expect(result.data.deactivatedBy).toBe('admin-789');
      expect(result.data.actions).toHaveLength(2);
      expect(result.data.actions[0].action).toBe('user_soft_deleted');
      expect(result.data.actions[1].action).toBe('tenant_disconnected_from_client');

      // Verify soft delete was called
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        mockTenant._id.toString(),
        expect.objectContaining({
          deletedAt: expect.any(Date),
          isActive: false,
        })
      );

      // Verify disconnect was called
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(
        mockTenant._id.toString(),
        {
          $set: { 'cuids.$[elem].isConnected': false },
        },
        expect.objectContaining({
          arrayFilters: [{ 'elem.cuid': cuid }],
        })
      );

      // Verify cache invalidation
      expect(mockUserCache.invalidateUserDetail).toHaveBeenCalledWith(cuid, uid);
      expect(mockUserCache.invalidateUserLists).toHaveBeenCalledWith(cuid);
    });

    it('should throw BadRequestError when missing parameters', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
      });

      await expect(userService.deactivateTenant('', uid, mockContext)).rejects.toThrow(
        BadRequestError
      );

      await expect(userService.deactivateTenant(cuid, '', mockContext)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw NotFoundError when user not found', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });

      mockUserDAO.getUserByUId.mockResolvedValue(null);

      await expect(userService.deactivateTenant(cuid, uid, mockContext)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw NotFoundError when user not connected to client', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });

      const mockTenant = createMockUser({
        uid,
        cuids: [
          {
            cuid: 'different-client',
            roles: [ROLES.TENANT],
            isConnected: true,
          },
        ],
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockTenant);

      await expect(userService.deactivateTenant(cuid, uid, mockContext)).rejects.toThrow(
        NotFoundError
      );
    });

    it('should throw BadRequestError when user is not a tenant', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });

      const mockUser = createMockUser({
        uid,
        cuids: [
          {
            cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
          },
        ],
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockUser);

      await expect(userService.deactivateTenant(cuid, uid, mockContext)).rejects.toThrow(
        BadRequestError
      );
    });

    it('should throw ForbiddenError when user lacks permission', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({ client: { cuid, role: ROLES.STAFF } }),
      });

      const mockTenant = createMockUser({
        uid,
        cuids: [
          {
            cuid,
            roles: [ROLES.TENANT],
            isConnected: true,
          },
        ],
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockTenant);
      mockPermissionService.canUserAccessUser.mockReturnValue(false);

      await expect(userService.deactivateTenant(cuid, uid, mockContext)).rejects.toThrow(
        ForbiddenError
      );
    });

    it('should throw BadRequestError when trying to deactivate self', async () => {
      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser({
          uid,
          client: { cuid, role: ROLES.ADMIN, displayname: 'Test Client' },
        }),
      });

      const mockTenant = createMockUser({
        uid,
        cuids: [
          {
            cuid,
            roles: [ROLES.TENANT],
            isConnected: true,
          },
        ],
      });

      mockUserDAO.getUserByUId.mockResolvedValue(mockTenant);
      mockPermissionService.canUserAccessUser.mockReturnValue(true);

      await expect(userService.deactivateTenant(cuid, uid, mockContext)).rejects.toThrow(
        BadRequestError
      );
    });
  });
});
