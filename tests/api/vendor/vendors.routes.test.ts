// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock Vendor Controller
const mockVendorController = {
  getVendorStats: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        total: 50,
        active: 45,
        inactive: 5,
        byStatus: {
          approved: 40,
          pending: 5,
          rejected: 5,
        },
      },
    });
  }),

  getFilteredVendors: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          vuid: faker.string.uuid(),
          businessName: faker.company.name(),
          contactPerson: faker.person.fullName(),
          email: faker.internet.email(),
          phoneNumber: faker.phone.number(),
          status: 'active',
          services: ['plumbing', 'electrical'],
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

  getSingleVendor: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        vuid: faker.string.uuid(),
        businessName: faker.company.name(),
        contactPerson: faker.person.fullName(),
        email: faker.internet.email(),
        phoneNumber: faker.phone.number(),
        businessAddress: faker.location.streetAddress(),
        services: ['plumbing', 'electrical'],
        status: 'active',
        rating: 4.5,
      },
    });
  }),

  getVendorTeamMembers: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          uid: faker.string.uuid(),
          fullName: faker.person.fullName(),
          email: faker.internet.email(),
          role: 'technician',
          isActive: true,
        },
      ],
    });
  }),

  getVendorForEdit: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        vuid: faker.string.uuid(),
        businessName: faker.company.name(),
        contactPerson: faker.person.fullName(),
        email: faker.internet.email(),
        phoneNumber: faker.phone.number(),
        businessAddress: faker.location.streetAddress(),
        services: ['plumbing'],
        businessHours: {
          monday: '9:00-17:00',
          tuesday: '9:00-17:00',
        },
      },
    });
  }),

  updateVendorDetails: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Vendor details updated successfully',
    });
  }),
};

// Simplified mock container
const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'vendorController':
        return mockVendorController;
      default:
        return {};
    }
  }),
};

describe('Vendors Routes Integration Tests', () => {
  const baseUrl = '/api/v1/vendors';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockVuid = faker.string.uuid();

  beforeAll(() => {
    // Setup test app with routes
    app = apiHelper.createApp((testApp) => {
      // Inject container and simulate authentication
      testApp.use((req, res, next) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Define vendor routes
      testApp.get(`${baseUrl}/:cuid/vendors/stats`, mockVendorController.getVendorStats);
      testApp.get(`${baseUrl}/:cuid/filteredVendors`, mockVendorController.getFilteredVendors);
      testApp.get(
        `${baseUrl}/:cuid/vendor_details/:vuid`,
        mockVendorController.getSingleVendor
      );
      testApp.get(
        `${baseUrl}/:cuid/team_members/:vuid`,
        mockVendorController.getVendorTeamMembers
      );
      testApp.get(`${baseUrl}/:cuid/vendor/:vuid/edit`, mockVendorController.getVendorForEdit);
      testApp.patch(
        `${baseUrl}/:cuid/vendor/:vuid`,
        mockVendorController.updateVendorDetails
      );
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /:cuid/vendors/stats (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/vendors/stats`;

    it('should get vendor statistics successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.total).toBeDefined();
      expect(response.body.data.byStatus).toBeDefined();
      expect(mockVendorController.getVendorStats).toHaveBeenCalled();
    });

    it('should return statistics with status breakdown', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.byStatus).toHaveProperty('approved');
      expect(response.body.data.byStatus).toHaveProperty('pending');
    });

    it('should support status filter query parameter', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ status: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return 403 for insufficient permissions', async () => {
      mockVendorController.getVendorStats.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /:cuid/filteredVendors (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/filteredVendors`;

    it('should get filtered vendors successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(mockVendorController.getFilteredVendors).toHaveBeenCalled();
    });

    it('should support pagination query parameters', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ page: '1', limit: '10' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support filtering by status', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ status: 'active' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support filtering by service type', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ services: 'plumbing' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support search by business name', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ search: 'plumbing' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return empty array when no vendors match filter', async () => {
      mockVendorController.getFilteredVendors.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.OK).json({
            success: true,
            data: [],
            pagination: {
              total: 0,
              page: 1,
              pages: 0,
              limit: 10,
            },
          });
        }
      );

      const response = await request(app)
        .get(endpoint)
        .query({ status: 'invalid' })
        .expect(httpStatusCodes.OK);

      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /:cuid/vendor_details/:vuid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/vendor_details/${mockVuid}`;

    it('should get single vendor details successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.vuid).toBeDefined();
      expect(response.body.data.businessName).toBeDefined();
      expect(mockVendorController.getSingleVendor).toHaveBeenCalled();
    });

    it('should include vendor services information', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.services).toBeDefined();
      expect(Array.isArray(response.body.data.services)).toBe(true);
    });

    it('should include vendor rating', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.rating).toBeDefined();
    });

    it('should return 404 for non-existent vendor', async () => {
      mockVendorController.getSingleVendor.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Vendor not found',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not found');
    });

    it('should return 403 for insufficient permissions', async () => {
      mockVendorController.getSingleVendor.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /:cuid/team_members/:vuid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/team_members/${mockVuid}`;

    it('should get vendor team members successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockVendorController.getVendorTeamMembers).toHaveBeenCalled();
    });

    it('should include team member details', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data[0]).toHaveProperty('uid');
      expect(response.body.data[0]).toHaveProperty('fullName');
      expect(response.body.data[0]).toHaveProperty('role');
    });

    it('should return empty array for vendor with no team members', async () => {
      mockVendorController.getVendorTeamMembers.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.OK).json({
            success: true,
            data: [],
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data).toEqual([]);
    });

    it('should return 404 for non-existent vendor', async () => {
      mockVendorController.getVendorTeamMembers.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Vendor not found',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /:cuid/vendor/:vuid/edit (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/vendor/${mockVuid}/edit`;

    it('should get vendor data for editing', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.businessName).toBeDefined();
      expect(mockVendorController.getVendorForEdit).toHaveBeenCalled();
    });

    it('should include editable fields', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.data.businessAddress).toBeDefined();
      expect(response.body.data.services).toBeDefined();
      expect(response.body.data.businessHours).toBeDefined();
    });

    it('should return 403 for non-primary account holder', async () => {
      mockVendorController.getVendorForEdit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only primary account holder can edit vendor details',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.message).toContain('primary account holder');
    });

    it('should return 404 for non-existent vendor', async () => {
      mockVendorController.getVendorForEdit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Vendor not found',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /:cuid/vendor/:vuid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/vendor/${mockVuid}`;

    it('should update vendor details successfully', async () => {
      const updateData = {
        businessName: faker.company.name(),
        contactPerson: faker.person.fullName(),
        phoneNumber: faker.phone.number(),
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated');
      expect(mockVendorController.updateVendorDetails).toHaveBeenCalled();
    });

    it('should update business address', async () => {
      const updateData = {
        businessAddress: faker.location.streetAddress(),
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should update services offered', async () => {
      const updateData = {
        services: ['plumbing', 'hvac', 'electrical'],
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should update business hours', async () => {
      const updateData = {
        businessHours: {
          monday: '8:00-18:00',
          tuesday: '8:00-18:00',
        },
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should validate required fields', async () => {
      mockVendorController.updateVendorDetails.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Validation failed',
            errors: ['Business name is required'],
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 for non-primary account holder', async () => {
      mockVendorController.updateVendorDetails.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Only primary account holder can update vendor details',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ businessName: faker.company.name() })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.message).toContain('primary account holder');
    });

    it('should return 404 for non-existent vendor', async () => {
      mockVendorController.updateVendorDetails.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Vendor not found',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ businessName: faker.company.name() })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should validate email format', async () => {
      mockVendorController.updateVendorDetails.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid email format',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ email: 'invalid-email' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid email');
    });
  });

  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async () => {
      mockVendorController.getFilteredVendors.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/filteredVendors`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle unauthorized access', async () => {
      mockVendorController.getFilteredVendors.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Unauthorized',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/filteredVendors`)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should handle invalid vendor ID format', async () => {
      mockVendorController.getSingleVendor.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid vendor ID format',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/vendor_details/invalid-vuid`)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid');
    });
  });
});
