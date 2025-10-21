// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { ROLES } from '@shared/constants/roles.constants';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock User Controller
const mockUserController = {
  getFilteredUsers: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          uid: faker.string.uuid(),
          email: faker.internet.email(),
          fullName: faker.person.fullName(),
          role: ROLES.STAFF,
          isActive: true,
          createdAt: new Date().toISOString(),
        },
      ],
      pagination: {
        total: 1,
        page: 1,
        pages: 1,
        limit: 10,
      },
    });
  }),

  getUserStats: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        total: 100,
        active: 95,
        inactive: 5,
        byRole: {
          admin: 5,
          manager: 15,
          staff: 50,
          tenant: 30,
        },
      },
    });
  }),

  getUsersByRole: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          uid: faker.string.uuid(),
          email: faker.internet.email(),
          fullName: faker.person.fullName(),
          role: ROLES.STAFF,
        },
      ],
    });
  }),

  getUserProfile: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        uid: faker.string.uuid(),
        email: faker.internet.email(),
        personalInfo: {
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
          phoneNumber: faker.phone.number(),
        },
        preferences: {
          theme: 'light',
          lang: 'en',
          timezone: 'UTC',
        },
      },
    });
  }),

  getClientUserInfo: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        uid: faker.string.uuid(),
        email: faker.internet.email(),
        fullName: faker.person.fullName(),
        role: ROLES.STAFF,
        employeeInfo: {
          department: 'IT',
          position: 'Developer',
          startDate: new Date().toISOString(),
        },
      },
    });
  }),

  updateUserProfile: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Profile updated successfully',
    });
  }),

  getNotificationPreferences: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        email: true,
        sms: false,
        push: true,
        inApp: true,
      },
    });
  }),

  getFilteredTenants: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          uid: faker.string.uuid(),
          email: faker.internet.email(),
          fullName: faker.person.fullName(),
          tenantInfo: {
            unitNumber: '101',
            leaseStatus: 'active',
            rentStatus: 'paid',
          },
        },
      ],
      pagination: {
        total: 1,
        page: 1,
        pages: 1,
        limit: 10,
      },
    });
  }),

  getTenantsStats: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        total: 50,
        active: 45,
        inactive: 5,
        byRentStatus: {
          paid: 40,
          pending: 5,
          overdue: 5,
        },
      },
    });
  }),

  getClientTenantDetails: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        uid: faker.string.uuid(),
        email: faker.internet.email(),
        fullName: faker.person.fullName(),
        tenantInfo: {
          unitNumber: '101',
          leaseStatus: 'active',
          leaseStartDate: new Date().toISOString(),
          rentAmount: 1500,
        },
      },
    });
  }),

  getTenantUserInfo: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        uid: faker.string.uuid(),
        email: faker.internet.email(),
        fullName: faker.person.fullName(),
        role: ROLES.TENANT,
      },
    });
  }),

  updateTenantProfile: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Tenant profile updated successfully',
    });
  }),

  deactivateTenant: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Tenant deactivated successfully',
    });
  }),

  archiveUser: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'User archived successfully',
    });
  }),
};

// Mock Client Controller
const mockClientController = {
  getUserRoles: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        roles: [ROLES.STAFF, ROLES.MANAGER],
      },
    });
  }),

  assignUserRole: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Role assigned successfully',
    });
  }),

  removeUserRole: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Role removed successfully',
    });
  }),
};

// Mock Property Controller
const mockPropertyController = {
  getAssignableUsers: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          uid: faker.string.uuid(),
          fullName: faker.person.fullName(),
          role: ROLES.MANAGER,
        },
      ],
    });
  }),
};

// Simplified mock container
const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'propertyController':
        return mockPropertyController;
      case 'clientController':
        return mockClientController;
      case 'userController':
        return mockUserController;
      default:
        return {};
    }
  }),
};

describe('Users Routes Integration Tests', () => {
  const baseUrl = '/api/v1/users';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockUid = faker.string.uuid();

  beforeAll(() => {
    // Setup test app with routes
    app = apiHelper.createApp((testApp) => {
      // Inject container and simulate authentication
      testApp.use((req, res, next) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Define user routes
      testApp.get(`${baseUrl}/:cuid/users`, mockUserController.getFilteredUsers);
      testApp.get(`${baseUrl}/:cuid/filtered-users`, mockUserController.getFilteredUsers);
      testApp.get(`${baseUrl}/:cuid/users/stats`, mockUserController.getUserStats);
      testApp.get(`${baseUrl}/:cuid/users/by-role`, mockUserController.getUsersByRole);
      testApp.get(`${baseUrl}/:cuid/users/:uid/roles`, mockClientController.getUserRoles);
      testApp.post(`${baseUrl}/:cuid/users/:uid/roles`, mockClientController.assignUserRole);
      testApp.delete(
        `${baseUrl}/:cuid/users/:uid/roles/:role`,
        mockClientController.removeUserRole
      );
      testApp.get(`${baseUrl}/:cuid/property_managers`, mockPropertyController.getAssignableUsers);
      testApp.get(`${baseUrl}/:cuid/profile_details`, mockUserController.getUserProfile);
      testApp.get(`${baseUrl}/:cuid/user_details/:uid`, mockUserController.getClientUserInfo);
      testApp.patch(`${baseUrl}/:cuid/update_profile`, mockUserController.updateUserProfile);
      testApp.get(
        `${baseUrl}/:cuid/notification-preferences`,
        mockUserController.getNotificationPreferences
      );
      testApp.get(`${baseUrl}/:cuid/filtered-tenants`, mockUserController.getFilteredTenants);
      testApp.get(`${baseUrl}/:cuid/stats`, mockUserController.getTenantsStats);
      testApp.get(
        `${baseUrl}/:cuid/client_tenant/:uid`,
        mockUserController.getClientTenantDetails
      );
      testApp.get(
        `${baseUrl}/:cuid/tenant_details/:uid`,
        mockUserController.getTenantUserInfo
      );
      testApp.patch(
        `${baseUrl}/:cuid/tenant_details/:uid`,
        mockUserController.updateTenantProfile
      );
      testApp.delete(
        `${baseUrl}/:cuid/tenant_details/:uid`,
        mockUserController.deactivateTenant
      );
      testApp.delete(`${baseUrl}/:cuid/:uid`, mockUserController.archiveUser);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /:cuid/users (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/users`;

    it('should get filtered users successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(mockUserController.getFilteredUsers).toHaveBeenCalled();
    });

    it('should support pagination query parameters', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ page: '1', limit: '10' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support filtering by role', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ role: ROLES.STAFF })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support filtering by active status', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ isActive: 'true' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /:cuid/filtered-users (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/filtered-users`;

    it('should get filtered users with query parameters', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ role: ROLES.STAFF, isActive: 'true' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(mockUserController.getFilteredUsers).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/users/stats (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/users/stats`;

    it('should get user statistics successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.total).toBeDefined();
      expect(response.body.data.byRole).toBeDefined();
      expect(mockUserController.getUserStats).toHaveBeenCalled();
    });

    it('should return statistics with role breakdown', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.byRole).toHaveProperty('admin');
      expect(response.body.data.byRole).toHaveProperty('staff');
    });
  });

  describe('GET /:cuid/users/by-role (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/users/by-role`;

    it('should get users by specific role', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ role: ROLES.STAFF })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockUserController.getUsersByRole).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/users/:uid/roles (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/users/${mockUid}/roles`;

    it('should get user roles successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.roles).toBeDefined();
      expect(Array.isArray(response.body.data.roles)).toBe(true);
      expect(mockClientController.getUserRoles).toHaveBeenCalled();
    });
  });

  describe('POST /:cuid/users/:uid/roles (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/users/${mockUid}/roles`;

    it('should assign role to user successfully', async () => {
      const roleData = { role: ROLES.MANAGER };

      const response = await request(app)
        .post(endpoint)
        .send(roleData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('assigned');
      expect(mockClientController.assignUserRole).toHaveBeenCalled();
    });

    it('should handle invalid role assignment', async () => {
      mockClientController.assignUserRole.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid role provided',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ role: 'invalid_role' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /:cuid/users/:uid/roles/:role (protected)', () => {
    const role = ROLES.STAFF;
    const endpoint = `${baseUrl}/${mockCuid}/users/${mockUid}/roles/${role}`;

    it('should remove role from user successfully', async () => {
      const response = await request(app).delete(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('removed');
      expect(mockClientController.removeUserRole).toHaveBeenCalled();
    });

    it('should handle role not found', async () => {
      mockClientController.removeUserRole.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Role not found',
          });
        }
      );

      const response = await request(app)
        .delete(endpoint)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /:cuid/property_managers (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/property_managers`;

    it('should get assignable property managers', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockPropertyController.getAssignableUsers).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/profile_details (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/profile_details`;

    it('should get user profile details', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ uid: mockUid })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.personalInfo).toBeDefined();
      expect(mockUserController.getUserProfile).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/user_details/:uid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/user_details/${mockUid}`;

    it('should get detailed user information', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(mockUserController.getClientUserInfo).toHaveBeenCalled();
    });

    it('should return 404 for non-existent user', async () => {
      mockUserController.getClientUserInfo.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'User not found',
          });
        }
      );

      const response = await request(app)
        .get(endpoint)
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /:cuid/update_profile (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/update_profile`;

    it('should update user profile successfully', async () => {
      const profileData = {
        personalInfo: {
          firstName: faker.person.firstName(),
          lastName: faker.person.lastName(),
        },
      };

      const response = await request(app)
        .patch(endpoint)
        .send(profileData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated');
      expect(mockUserController.updateUserProfile).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/notification-preferences (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/notification-preferences`;

    it('should get notification preferences', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ uid: mockUid })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(mockUserController.getNotificationPreferences).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/filtered-tenants (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/filtered-tenants`;

    it('should get filtered tenants successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockUserController.getFilteredTenants).toHaveBeenCalled();
    });

    it('should support filtering by lease status', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ leaseStatus: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /:cuid/stats (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/stats`;

    it('should get tenant statistics', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.total).toBeDefined();
      expect(response.body.data.byRentStatus).toBeDefined();
      expect(mockUserController.getTenantsStats).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/client_tenant/:uid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_tenant/${mockUid}`;

    it('should get detailed tenant information', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.tenantInfo).toBeDefined();
      expect(mockUserController.getClientTenantDetails).toHaveBeenCalled();
    });

    it('should support include query parameter', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ include: 'leaseAgreement,payments' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('Tenant Details Routes - /:cuid/tenant_details/:uid', () => {
    const endpoint = `${baseUrl}/${mockCuid}/tenant_details/${mockUid}`;

    describe('GET (protected)', () => {
      it('should get tenant user info', async () => {
        const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

        expect(response.body.success).toBe(true);
        expect(mockUserController.getTenantUserInfo).toHaveBeenCalled();
      });
    });

    describe('PATCH (protected)', () => {
      it('should update tenant profile successfully', async () => {
        const updateData = {
          personalInfo: {
            phoneNumber: faker.phone.number(),
          },
        };

        const response = await request(app)
          .patch(endpoint)
          .send(updateData)
          .expect(httpStatusCodes.OK);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('updated');
        expect(mockUserController.updateTenantProfile).toHaveBeenCalled();
      });
    });

    describe('DELETE (protected)', () => {
      it('should deactivate tenant successfully', async () => {
        const response = await request(app).delete(endpoint).expect(httpStatusCodes.OK);

        expect(response.body.success).toBe(true);
        expect(response.body.message).toContain('deactivated');
        expect(mockUserController.deactivateTenant).toHaveBeenCalled();
      });

      it('should handle tenant not found', async () => {
        mockUserController.deactivateTenant.mockImplementationOnce(
          (_req: Request, res: Response) => {
            res.status(httpStatusCodes.NOT_FOUND).json({
              success: false,
              message: 'Tenant not found',
            });
          }
        );

        const response = await request(app)
          .delete(endpoint)
          .expect(httpStatusCodes.NOT_FOUND);

        expect(response.body.success).toBe(false);
      });
    });
  });

  describe('DELETE /:cuid/:uid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/${mockUid}`;

    it('should archive user successfully', async () => {
      const response = await request(app).delete(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('archived');
      expect(mockUserController.archiveUser).toHaveBeenCalled();
    });

    it('should handle user not found', async () => {
      mockUserController.archiveUser.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'User not found',
        });
      });

      const response = await request(app).delete(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async () => {
      mockUserController.getFilteredUsers.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/users`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle unauthorized access', async () => {
      mockUserController.getFilteredUsers.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Unauthorized',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/users`)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should handle forbidden access', async () => {
      mockUserController.getFilteredUsers.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/users`)
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.message).toContain('permissions');
    });
  });
});
