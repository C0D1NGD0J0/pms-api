import { Types } from 'mongoose';
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
  createMockVendorDAO,
  createMockVendorService,
} from '@tests/helpers';

describe('UserService', () => {
  let userService: UserService;
  let mockClientDAO: any;
  let mockUserDAO: any;
  let mockPropertyDAO: any;
  let mockUserCache: any;
  let mockPermissionService: any;
  let mockVendorDAO: any;
  let mockVendorService: any;

  beforeEach(() => {
    mockClientDAO = createMockClientDAO();
    mockUserDAO = createMockUserDAO();
    // Add missing method to mock
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
    };
    mockPermissionService = {
      canUserAccessUser: jest.fn().mockReturnValue(true),
      canAccessResource: jest.fn().mockReturnValue(true),
    };
    mockVendorDAO = createMockVendorDAO();
    mockVendorService = createMockVendorService();

    userService = new UserService({
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
      propertyDAO: mockPropertyDAO,
      userCache: mockUserCache,
      permissionService: mockPermissionService,
      vendorService: mockVendorService,
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
          _id: new Types.ObjectId('507f1f77bcf86cd799439011'), // Add _id for vendor lookup
          cuids: [
            {
              cuid: 'test-client-id',
              roles: ['vendor'],
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

    it('should handle vendor without linkedVendorUid (primary vendor)', async () => {
      const filterOptions = { role: [IUserRole.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };
      const mockUsers = [
        {
          _id: 'vendor-primary-id',
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
      const filterOptions = { role: IUserRole.MANAGER as any };
      const paginationOpts = { limit: 10, skip: 0 };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, limit: 10, pages: 0 },
      });

      await userService.getFilteredUsers('test-client-id', filterOptions, paginationOpts);

      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        'test-client-id',
        { role: ['manager'] },
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
      const filterOptions = { role: [IUserRole.STAFF] };
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
      const filterOptions = { role: [IUserRole.MANAGER] };
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
              roles: ['vendor'],
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
              roles: ['vendor'],
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
        cuids: [{ cuid: mockClientId, isConnected: true, roles: ['vendor'] }],
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
        { role: ['vendor'], status: 'active', linkedVendorUid: mockVendorId },
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
        cuids: [{ cuid: mockClientId, isConnected: true, roles: ['vendor'] }],
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
        { role: ['vendor'], status: 'inactive', linkedVendorUid: mockVendorId },
        paginationOpts
      );
    });

    it('should throw NotFoundError when client not found', async () => {
      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      const mockContext = createMockRequestContext({
        currentuser: createMockCurrentUser(),
        request: { params: { cuid: mockClientId } },
      });

      // Test removed - getVendorTeamMembers no longer exists on UserService
    });
  });
  */

  describe('enhanced vendor data transformation in getFilteredUsers', () => {
    it('should properly transform vendor data with enhanced vendor information', async () => {
      const mockClient = createMockClient({ cuid: 'test-client-id' });
      const filterOptions = { role: [IUserRole.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };

      const mockVendorUsers = [
        {
          _id: 'vendor-enhanced-id',
          uid: 'vendor-enhanced',
          email: 'enhanced@vendor.com',
          cuids: [
            {
              cuid: 'test-client-id',
              roles: ['vendor'],
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
      const filterOptions = { role: [IUserRole.VENDOR] };
      const paginationOpts = { limit: 10, skip: 0 };

      const mockPrimaryVendor = [
        {
          _id: 'primary-vendor-id',
          uid: 'primary-vendor',
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
});
