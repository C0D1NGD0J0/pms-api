import { UserService } from '@services/user/user.service';
import { IRequestContext } from '@interfaces/utils.interface';

describe('UserService - getClientUserInfo', () => {
  let userService: UserService;
  let mockContext: IRequestContext;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockPropertyDAO: any;
  let mockUserCache: any;
  let mockPermissionService: any;

  beforeEach(() => {
    // Mock dependencies
    mockUserDAO = {
      getUserByUId: jest.fn() as jest.Mock,
    };

    mockClientDAO = {
      getClientByCuid: jest.fn() as jest.Mock,
    };

    mockPropertyDAO = {
      getPropertiesByClientId: jest.fn() as jest.Mock,
    };

    mockUserCache = {
      getUserDetail: jest.fn(() => Promise.resolve({ success: false, data: null })) as jest.Mock,
      cacheUserDetail: jest.fn(() => Promise.resolve(undefined)) as jest.Mock,
    };

    mockPermissionService = {
      canUserAccessUser: jest.fn(() => true) as jest.Mock,
    };

    // Initialize service
    userService = new UserService({
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      propertyDAO: mockPropertyDAO,
      userCache: mockUserCache,
      permissionService: mockPermissionService,
    });

    // Mock context
    mockContext = {
      currentuser: {
        client: {
          cuid: 'test-client-id',
          displayname: 'Test Client',
          role: 'admin',
        },
        email: 'admin@test.com',
        sub: 'admin-uid',
        permissions: ['view:users'],
      } as any,
      request: {
        params: {
          cuid: 'test-client-id',
        },
      } as any,
    } as IRequestContext;
  });

  describe('Employee User Response Structure', () => {
    it('should return employee-specific data in employeeInfo property', async () => {
      const mockEmployeeUser = {
        _id: 'user-id',
        uid: 'employee-uid',
        email: 'employee@test.com',
        isActive: true,
        createdAt: new Date('2025-01-01'),
        cuids: [
          {
            cuid: 'test-client-id',
            displayName: 'John Doe',
            roles: ['manager'],
            isConnected: true,
          },
        ],
        profile: {
          personalInfo: {
            firstName: 'John',
            lastName: 'Doe',
            phoneNumber: '+1-555-0123',
            bio: 'Experienced property manager',
            avatar: {
              url: 'http://example.com/avatar.jpg',
            },
          },
          employeeInfo: {
            employeeId: 'EMP001',
            startDate: new Date('2025-01-01'),
            employmentType: 'Full-Time',
            department: 'operations',
            reportsTo: 'Jane Smith',
            skills: ['Property Management', 'Tenant Relations'],
          },
          contactInfo: {
            officeAddress: '456 Office St',
            officeCity: 'Boston, MA 02101',
            workHours: 'Mon-Fri: 9AM-6PM',
          },
        },
      };

      mockUserDAO.getUserByUId.mockResolvedValue(mockEmployeeUser);
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({
        items: [
          {
            name: 'Test Property',
            location: { address: '123 Main St', city: 'Boston', state: 'MA' },
            totalUnits: 10,
            occupancyRate: 90,
            createdAt: new Date('2025-01-01'),
          },
        ],
      });

      const result = await userService.getClientUserInfo(mockContext, 'employee-uid');

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('user');
      expect(result.data).toHaveProperty('profile');
      expect(result.data).toHaveProperty('employeeInfo');
      expect(result.data).not.toHaveProperty('vendorInfo');
      expect(result.data).not.toHaveProperty('tenantInfo');

      // Validate user structure
      expect(result.data.user).toMatchObject({
        uid: 'employee-uid',
        email: 'employee@test.com',
        displayName: 'John Doe',
        roles: ['manager'],
        isActive: true,
        userType: 'employee',
      });

      // Validate profile structure (common data)
      expect(result.data.profile).toMatchObject({
        firstName: 'John',
        lastName: 'Doe',
        fullName: 'John Doe',
        phoneNumber: '+1-555-0123',
        email: 'employee@test.com',
        about: 'Experienced property manager',
      });

      // Validate employeeInfo structure
      expect(result.data.employeeInfo).toMatchObject({
        employeeId: 'EMP001',
        tenure: expect.any(String),
        employmentType: 'Full-Time',
        department: 'operations',
        position: 'Property Manager',
        directManager: 'Jane Smith',
        skills: expect.arrayContaining(['Property Management', 'Tenant Relations']),
        officeInfo: {
          address: '456 Office St',
          city: 'Boston, MA 02101',
          workHours: 'Mon-Fri: 9AM-6PM',
        },
        stats: {
          propertiesManaged: 1,
          unitsManaged: 10,
          tasksCompleted: expect.any(Number),
          onTimeRate: expect.any(String),
          rating: expect.any(String),
          activeTasks: expect.any(Number),
        },
        performance: expect.any(Object),
        tags: expect.any(Array),
      });

      // Employee-specific fields should NOT be in profile
      expect(result.data.profile).not.toHaveProperty('employeeId');
      expect(result.data.profile).not.toHaveProperty('hireDate');
      expect(result.data.profile).not.toHaveProperty('department');
      expect(result.data.profile).not.toHaveProperty('position');
    });
  });

  describe('Vendor User Response Structure', () => {
    it('should return vendor-specific data in vendorInfo property', async () => {
      const mockVendorUser = {
        _id: 'user-id',
        uid: 'vendor-uid',
        email: 'vendor@test.com',
        isActive: true,
        createdAt: new Date('2025-01-01'),
        cuids: [
          {
            cuid: 'test-client-id',
            displayName: 'ABC Plumbing',
            roles: ['vendor'],
            isConnected: true,
            linkedVendorId: null,
          },
        ],
        profile: {
          personalInfo: {
            firstName: 'Jane',
            lastName: 'Smith',
            displayName: 'ABC Plumbing',
            phoneNumber: '+1-555-0456',
          },
          vendorInfo: {
            companyName: 'ABC Plumbing Inc.',
            businessType: 'Plumbing Services',
            yearsInBusiness: 10,
            registrationNumber: 'REG123456',
            taxId: 'TAX789',
            servicesOffered: {
              plumbing: true,
              electrical: false,
              hvac: false,
            },
            insuranceInfo: {
              provider: 'Insurance Co',
              policyNumber: 'POL123',
              expirationDate: new Date('2026-01-01'),
              coverageAmount: 1000000,
            },
          },
        },
      };

      mockUserDAO.getUserByUId.mockResolvedValue(mockVendorUser);

      const result = await userService.getClientUserInfo(mockContext, 'vendor-uid');

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('vendorInfo');
      expect(result.data).not.toHaveProperty('employeeInfo');
      expect(result.data).not.toHaveProperty('tenantInfo');

      // Validate user structure
      expect(result.data.user.userType).toBe('vendor');

      // Validate vendorInfo structure
      expect(result.data.vendorInfo).toMatchObject({
        companyName: 'ABC Plumbing Inc.',
        businessType: 'Plumbing Services',
        yearsInBusiness: 10,
        registrationNumber: 'REG123456',
        taxId: 'TAX789',
        servicesOffered: {
          plumbing: true,
          electrical: false,
          hvac: false,
        },
        insuranceInfo: expect.any(Object),
        stats: {
          completedJobs: expect.any(Number),
          activeJobs: expect.any(Number),
          rating: expect.any(String),
          responseTime: expect.any(String),
          onTimeRate: expect.any(String),
        },
        tags: expect.arrayContaining(['Plumbing Services', 'Insured', 'Established']),
        isPrimaryVendor: true,
        isLinkedAccount: false,
        linkedVendorId: null,
      });
    });

    it('should identify linked vendor accounts correctly', async () => {
      const mockLinkedVendorUser = {
        _id: 'user-id',
        uid: 'linked-vendor-uid',
        email: 'subcontractor@test.com',
        isActive: true,
        createdAt: new Date('2025-01-01'),
        cuids: [
          {
            cuid: 'test-client-id',
            displayName: 'Sub Contractor',
            roles: ['vendor'],
            isConnected: true,
            linkedVendorId: 'primary-vendor-id',
          },
        ],
        profile: {
          personalInfo: {
            firstName: 'Bob',
            lastName: 'Johnson',
            displayName: 'Sub Contractor',
          },
          vendorInfo: {},
        },
      };

      mockUserDAO.getUserByUId.mockResolvedValue(mockLinkedVendorUser);

      const result = await userService.getClientUserInfo(mockContext, 'linked-vendor-uid');

      expect(result.data.vendorInfo).toMatchObject({
        isLinkedAccount: true,
        linkedVendorId: 'primary-vendor-id',
        isPrimaryVendor: false,
        tags: expect.arrayContaining(['Sub-contractor']),
      });
    });
  });

  describe('Tenant User Response Structure', () => {
    it('should return tenant-specific data in tenantInfo property', async () => {
      const mockTenantUser = {
        _id: 'user-id',
        uid: 'tenant-uid',
        email: 'tenant@test.com',
        isActive: true,
        createdAt: new Date('2025-01-01'),
        cuids: [
          {
            cuid: 'test-client-id',
            displayName: 'Alice Brown',
            roles: ['tenant'],
            isConnected: true,
          },
        ],
        profile: {
          personalInfo: {
            firstName: 'Alice',
            lastName: 'Brown',
            phoneNumber: '+1-555-0789',
          },
        },
      };

      mockUserDAO.getUserByUId.mockResolvedValue(mockTenantUser);

      const result = await userService.getClientUserInfo(mockContext, 'tenant-uid');

      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('tenantInfo');
      expect(result.data).not.toHaveProperty('employeeInfo');
      expect(result.data).not.toHaveProperty('vendorInfo');

      // Validate user structure
      expect(result.data.user.userType).toBe('tenant');

      // Validate tenantInfo structure (placeholder for now)
      expect(result.data.tenantInfo).toMatchObject({
        leaseInfo: {
          status: 'Active',
          startDate: expect.any(Date),
          endDate: null,
          monthlyRent: 0,
        },
        unit: {
          propertyName: '',
          unitNumber: '',
          address: '',
        },
        rentStatus: 'Current',
        paymentHistory: [],
        maintenanceRequests: [],
        documents: [],
      });
    });
  });

  describe('Cache Behavior', () => {
    it('should cache the restructured user detail data', async () => {
      const mockUser = {
        _id: 'user-id',
        uid: 'test-uid',
        email: 'test@test.com',
        isActive: true,
        createdAt: new Date(),
        cuids: [
          {
            cuid: 'test-client-id',
            displayName: 'Test User',
            roles: ['staff'],
            isConnected: true,
          },
        ],
        profile: {
          personalInfo: {
            firstName: 'Test',
            lastName: 'User',
          },
        },
      };

      mockUserDAO.getUserByUId.mockResolvedValue(mockUser);
      mockPropertyDAO.getPropertiesByClientId.mockResolvedValue({ items: [] });

      await userService.getClientUserInfo(mockContext, 'test-uid');

      expect(mockUserCache.cacheUserDetail).toHaveBeenCalledWith(
        'test-client-id',
        'test-uid',
        expect.objectContaining({
          user: expect.objectContaining({
            userType: 'employee',
          }),
          employeeInfo: expect.any(Object),
        })
      );
    });
  });
});
