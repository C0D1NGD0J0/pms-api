import { ICurrentUser } from '@interfaces/user.interface';
import { ClientService } from '@services/client/client.service';
import { IFindOptions } from '@dao/interfaces/baseDAO.interface';
import { EmployeeDepartment } from '@interfaces/profile.interface';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { IUserFilterOptions } from '@dao/interfaces/userDAO.interface';
import {
  createMockCurrentUser,
  createMockPropertyDAO,
  createMockClientDAO,
  createMockUserDAO,
  createMockProfile,
  createMockClient,
  createMockUser,
} from '@tests/helpers';

describe('Filtered Users Functionality', () => {
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

  describe('getFilteredUsers', () => {
    const createTestCurrentUser = (): ICurrentUser => createMockCurrentUser();

    const defaultPaginationOpts: IFindOptions = {
      limit: 10,
      skip: 0,
      sort: { createdAt: -1 },
      sortBy: 'createdAt',
    };

    it('should successfully retrieve employee-type users', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        role: 'staff',
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'admin-user-id',
          email: 'admin@example.com',
          cuids: [{ cuid, roles: ['admin'], isConnected: true, displayName: 'Admin User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Admin',
              lastName: 'User',
              displayName: 'Admin User',
              location: 'New York',
            },
            employeeInfo: {
              department: EmployeeDepartment.MANAGEMENT,
              jobTitle: 'Senior Admin',
            },
          }),
        }),
        createMockUser({
          id: 'staff-user-id',
          email: 'staff@example.com',
          cuids: [{ cuid, roles: ['staff'], isConnected: true, displayName: 'Staff User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Staff',
              lastName: 'User',
              displayName: 'Staff User',
              location: 'Boston',
            },
            employeeInfo: {
              department: EmployeeDepartment.OPERATIONS,
              jobTitle: 'Support Staff',
            },
          }),
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 2,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(2);
      expect(result.data.users[0].userType).toBe('employee');
      expect(result.data.users[0].employeeInfo).toBeDefined();
      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        cuid,
        filterOptions,
        defaultPaginationOpts
      );
    });

    it('should successfully retrieve tenant-type users', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        role: 'tenant',
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'tenant-user-id',
          email: 'tenant@example.com',
          cuids: [{ cuid, roles: ['tenant'], isConnected: true, displayName: 'Tenant User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Tenant',
              lastName: 'User',
              displayName: 'Tenant User',
              location: 'Miami',
              avatar: {
                filename: 'avatar3.jpg',
                key: 'tenant-avatar-key',
                url: 'https://example.com/avatars/avatar3.jpg',
              },
            },
          }),
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 1,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(1);
      expect(result.data.users[0].userType).toBe('tenant');
      expect(result.data.users[0].tenantInfo).toBeDefined();
    });

    it('should successfully retrieve vendor-type users', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        role: 'vendor',
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'vendor-user-id',
          email: 'vendor@example.com',
          cuids: [{ cuid, roles: ['vendor'], isConnected: true, displayName: 'Vendor User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Vendor',
              lastName: 'User',
              displayName: 'Vendor User',
              location: 'Chicago',
              avatar: {
                filename: 'avatar4.jpg',
                key: 'vendor-avatar-key',
                url: 'https://example.com/avatars/avatar4.jpg',
              },
            },
            vendorInfo: {
              servicesOffered: {
                plumbing: true,
                electrical: true,
              },
            },
          }),
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 1,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(1);
      expect(result.data.users[0].userType).toBe('vendor');
      expect(result.data.users[0].vendorInfo).toBeDefined();
    });

    it('should filter users by role when provided', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        role: 'admin',
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'admin-user-id',
          email: 'admin@example.com',
          cuids: [{ cuid, roles: ['admin'], isConnected: true, displayName: 'Admin User' }],
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 1,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(1);
      expect(result.data.users[0].roles).toContain('admin');
      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        cuid,
        filterOptions,
        defaultPaginationOpts
      );
    });

    it('should filter users by multiple roles when provided as array', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        role: ['admin', 'manager'],
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'admin-user-id',
          email: 'admin@example.com',
          cuids: [{ cuid, roles: ['admin'], isConnected: true, displayName: 'Admin User' }],
        }),
        createMockUser({
          id: 'manager-user-id',
          email: 'manager@example.com',
          cuids: [{ cuid, roles: ['manager'], isConnected: true, displayName: 'Manager User' }],
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 2,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(2);
      expect(mockUserDAO.getUsersByFilteredType).toHaveBeenCalledWith(
        cuid,
        filterOptions,
        defaultPaginationOpts
      );
    });

    it('should filter users by department when provided', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        role: 'staff',
        department: 'Management',
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'admin-user-id',
          email: 'admin@example.com',
          cuids: [{ cuid, roles: ['admin'], isConnected: true, displayName: 'Admin User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Admin',
              lastName: 'User',
              displayName: 'Admin User',
              location: 'New York',
            },
            employeeInfo: { department: EmployeeDepartment.MANAGEMENT },
          }),
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 1,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(1);
      expect(result.data.users[0].employeeInfo.department).toBe('Management');
    });

    it('should filter users by status when provided', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        status: 'active',
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'active-user-id',
          email: 'active@example.com',
          isActive: true,
          cuids: [{ cuid, roles: ['staff'], isConnected: true, displayName: 'Active User' }],
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 1,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(1);
      expect(result.data.users[0].isActive).toBe(true);
    });

    it('should search users when search term is provided', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {
        search: 'john',
      };

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'john-user-id',
          email: 'john@example.com',
          cuids: [{ cuid, roles: ['staff'], isConnected: true, displayName: 'John Doe' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'John',
              lastName: 'Doe',
              displayName: 'John Doe',
              location: 'Boston',
            },
          }),
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 1,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(1);
      expect(result.data.users[0].firstName).toBe('John');
    });

    it('should return properly formatted user data with correct user type detected from roles', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {};

      const mockClient = createMockClient({ cuid });
      const mockUsers = [
        createMockUser({
          id: 'admin-user-id',
          email: 'admin@example.com',
          cuids: [{ cuid, roles: ['admin'], isConnected: true, displayName: 'Admin User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Admin',
              lastName: 'User',
              displayName: 'Admin User',
              location: 'New York',
            },
            employeeInfo: { department: EmployeeDepartment.MANAGEMENT },
          }),
        }),
        createMockUser({
          id: 'vendor-user-id',
          email: 'vendor@example.com',
          cuids: [{ cuid, roles: ['vendor'], isConnected: true, displayName: 'Vendor User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Vendor',
              lastName: 'User',
              displayName: 'Vendor User',
              location: 'Chicago',
            },
            vendorInfo: {
              servicesOffered: {
                plumbing: true,
              },
            },
          }),
        }),
        createMockUser({
          id: 'tenant-user-id',
          email: 'tenant@example.com',
          cuids: [{ cuid, roles: ['tenant'], isConnected: true, displayName: 'Tenant User' }],
          profile: createMockProfile({
            personalInfo: {
              firstName: 'Tenant',
              lastName: 'User',
              displayName: 'Tenant User',
              location: 'Miami',
            },
          }),
        }),
      ];

      const mockResult = {
        items: mockUsers,
        pagination: {
          total: 3,
          totalPages: 1,
          page: 1,
          limit: 10,
          hasMoreResource: false,
        },
      };

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockResolvedValue(mockResult);

      // Act
      const result = await clientService.getFilteredUsers(
        cuid,
        currentUser,
        filterOptions,
        defaultPaginationOpts
      );

      // Assert
      expect(result.success).toBe(true);
      expect(result.data.users).toHaveLength(3);

      // Check user type detection
      const adminUser = result.data.users.find((u) => u.email === 'admin@example.com');
      const vendorUser = result.data.users.find((u) => u.email === 'vendor@example.com');
      const tenantUser = result.data.users.find((u) => u.email === 'tenant@example.com');

      expect(adminUser?.userType).toBe('employee');
      expect(adminUser?.employeeInfo).toBeDefined();
      expect(vendorUser?.userType).toBe('vendor');
      expect(vendorUser?.vendorInfo).toBeDefined();
      expect(tenantUser?.userType).toBe('tenant');
      expect(tenantUser?.tenantInfo).toBeDefined();
    });

    it('should throw NotFoundError when client does not exist', async () => {
      // Arrange
      const cuid = 'invalid-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {};

      mockClientDAO.getClientByCuid.mockResolvedValue(null);

      // Act & Assert
      await expect(
        clientService.getFilteredUsers(cuid, currentUser, filterOptions, defaultPaginationOpts)
      ).rejects.toThrow(NotFoundError);
    });

    it('should throw BadRequestError when cuid is missing', async () => {
      // Arrange
      const cuid = '';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {};

      // Act & Assert
      await expect(
        clientService.getFilteredUsers(cuid, currentUser, filterOptions, defaultPaginationOpts)
      ).rejects.toThrow(BadRequestError);
    });

    it('should handle errors from UserDAO.getUsersByFilteredType', async () => {
      // Arrange
      const cuid = 'test-client-cuid';
      const currentUser = createTestCurrentUser();
      const filterOptions: IUserFilterOptions = {};

      const mockClient = createMockClient({ cuid });

      mockClientDAO.getClientByCuid.mockResolvedValue(mockClient);
      mockUserDAO.getUsersByFilteredType.mockRejectedValue(new Error('Database error'));

      // Act & Assert
      await expect(
        clientService.getFilteredUsers(cuid, currentUser, filterOptions, defaultPaginationOpts)
      ).rejects.toThrow('Database error');
    });
  });
});
