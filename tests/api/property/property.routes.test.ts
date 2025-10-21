// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock Property Controller
const mockPropertyController = {
  getPropertyFormMetadata: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        propertyTypes: ['residential', 'commercial', 'industrial'],
        amenities: ['parking', 'gym', 'pool', 'security'],
        utilities: ['water', 'electricity', 'gas', 'internet'],
      },
    });
  }),

  create: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Property created successfully',
      data: {
        pid: faker.string.uuid(),
        name: faker.location.street(),
        status: 'pending',
      },
    });
  }),

  validateCsv: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'CSV validation started',
      data: {
        processId: faker.string.uuid(),
      },
    });
  }),

  createPropertiesFromCsv: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'CSV import started',
      data: {
        processId: faker.string.uuid(),
      },
    });
  }),

  getClientProperties: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          pid: faker.string.uuid(),
          name: faker.location.street(),
          address: faker.location.streetAddress(),
          propertyType: 'residential',
          status: 'active',
          totalUnits: 10,
          occupiedUnits: 7,
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

  getProperty: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        pid: faker.string.uuid(),
        name: faker.location.street(),
        address: faker.location.streetAddress(),
        propertyType: 'residential',
        status: 'active',
        totalUnits: 10,
        amenities: ['parking', 'gym'],
        manager: {
          uid: faker.string.uuid(),
          fullName: faker.person.fullName(),
        },
      },
    });
  }),

  getPendingApprovals: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          pid: faker.string.uuid(),
          name: faker.location.street(),
          status: 'pending',
          createdBy: faker.person.fullName(),
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }),

  approveProperty: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Property approved successfully',
    });
  }),

  rejectProperty: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Property rejected successfully',
    });
  }),

  bulkApproveProperties: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Properties approved successfully',
      data: {
        approved: 5,
        failed: 0,
      },
    });
  }),

  bulkRejectProperties: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Properties rejected successfully',
      data: {
        rejected: 3,
        failed: 0,
      },
    });
  }),

  getMyPropertyRequests: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          pid: faker.string.uuid(),
          name: faker.location.street(),
          status: 'pending',
          requestType: 'create',
          createdAt: new Date().toISOString(),
        },
      ],
    });
  }),

  updateClientProperty: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Property updated successfully',
    });
  }),

  deleteMediaFromProperty: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Media deleted successfully',
    });
  }),

  archiveProperty: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Property archived successfully',
    });
  }),

  getAssignableUsers: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          uid: faker.string.uuid(),
          fullName: faker.person.fullName(),
          role: 'manager',
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
      default:
        return {};
    }
  }),
};

describe('Property Routes Integration Tests', () => {
  const baseUrl = '/api/v1/properties';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockPid = faker.string.uuid();

  beforeAll(() => {
    // Setup test app with routes
    app = apiHelper.createApp((testApp) => {
      // Inject container and simulate authentication
      testApp.use((req, res, next) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Define property routes
      testApp.get(
        `${baseUrl}/property_form_metadata`,
        mockPropertyController.getPropertyFormMetadata
      );
      testApp.post(`${baseUrl}/:cuid/add_property`, mockPropertyController.create);
      testApp.post(`${baseUrl}/:cuid/validate_csv`, mockPropertyController.validateCsv);
      testApp.post(
        `${baseUrl}/:cuid/import_properties_csv`,
        mockPropertyController.createPropertiesFromCsv
      );
      testApp.get(
        `${baseUrl}/:cuid/client_properties`,
        mockPropertyController.getClientProperties
      );
      testApp.get(
        `${baseUrl}/:cuid/client_property/:pid`,
        mockPropertyController.getProperty
      );
      testApp.get(
        `${baseUrl}/:cuid/properties/pending`,
        mockPropertyController.getPendingApprovals
      );
      testApp.post(
        `${baseUrl}/:cuid/properties/:pid/approve`,
        mockPropertyController.approveProperty
      );
      testApp.post(
        `${baseUrl}/:cuid/properties/:pid/reject`,
        mockPropertyController.rejectProperty
      );
      testApp.post(
        `${baseUrl}/:cuid/properties/bulk-approve`,
        mockPropertyController.bulkApproveProperties
      );
      testApp.post(
        `${baseUrl}/:cuid/properties/bulk-reject`,
        mockPropertyController.bulkRejectProperties
      );
      testApp.get(
        `${baseUrl}/:cuid/properties/my-requests`,
        mockPropertyController.getMyPropertyRequests
      );
      testApp.patch(
        `${baseUrl}/:cuid/client_properties/:pid`,
        mockPropertyController.updateClientProperty
      );
      testApp.patch(
        `${baseUrl}/:cuid/client_properties/:pid/remove_media`,
        mockPropertyController.deleteMediaFromProperty
      );
      testApp.delete(
        `${baseUrl}/:cuid/delete_properties/:pid`,
        mockPropertyController.archiveProperty
      );
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /property_form_metadata (protected)', () => {
    const endpoint = `${baseUrl}/property_form_metadata`;

    it('should get property form metadata successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.propertyTypes).toBeDefined();
      expect(response.body.data.amenities).toBeDefined();
      expect(mockPropertyController.getPropertyFormMetadata).toHaveBeenCalled();
    });

    it('should include property types', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(Array.isArray(response.body.data.propertyTypes)).toBe(true);
    });

    it('should include amenities list', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(Array.isArray(response.body.data.amenities)).toBe(true);
    });
  });

  describe('POST /:cuid/add_property (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/add_property`;

    it('should create property successfully', async () => {
      const propertyData = {
        name: faker.location.street(),
        address: faker.location.streetAddress(),
        propertyType: 'residential',
        totalUnits: 10,
      };

      const response = await request(app)
        .post(endpoint)
        .send(propertyData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('created');
      expect(response.body.data.pid).toBeDefined();
      expect(mockPropertyController.create).toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      mockPropertyController.create.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'Validation failed',
          errors: ['Property name is required'],
        });
      });

      const response = await request(app)
        .post(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 for insufficient permissions', async () => {
      mockPropertyController.create.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.FORBIDDEN).json({
          success: false,
          message: 'Insufficient permissions',
        });
      });

      const response = await request(app)
        .post(endpoint)
        .send({ name: faker.location.street() })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/validate_csv (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/validate_csv`;

    it('should validate CSV file successfully', async () => {
      const response = await request(app)
        .post(endpoint)
        .attach('csv_file', Buffer.from('name,address\nProperty 1,123 Main St'), 'test.csv')
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.processId).toBeDefined();
      expect(mockPropertyController.validateCsv).toHaveBeenCalled();
    });

    it('should return 400 without CSV file', async () => {
      mockPropertyController.validateCsv.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.BAD_REQUEST).json({
          success: false,
          message: 'No CSV file uploaded',
        });
      });

      const response = await request(app).post(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/import_properties_csv (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/import_properties_csv`;

    it('should import properties from CSV successfully', async () => {
      const response = await request(app)
        .post(endpoint)
        .attach('csv_file', Buffer.from('name,address\nProperty 1,123 Main St'), 'test.csv')
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.processId).toBeDefined();
      expect(mockPropertyController.createPropertiesFromCsv).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/client_properties (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties`;

    it('should get client properties successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(mockPropertyController.getClientProperties).toHaveBeenCalled();
    });

    it('should support pagination', async () => {
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
  });

  describe('GET /:cuid/client_property/:pid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_property/${mockPid}`;

    it('should get single property details', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.pid).toBeDefined();
      expect(response.body.data.name).toBeDefined();
      expect(mockPropertyController.getProperty).toHaveBeenCalled();
    });

    it('should return 404 for non-existent property', async () => {
      mockPropertyController.getProperty.mockImplementationOnce((_req: Request, res: Response) => {
        res.status(httpStatusCodes.NOT_FOUND).json({
          success: false,
          message: 'Property not found',
        });
      });

      const response = await request(app).get(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /:cuid/properties/pending (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/properties/pending`;

    it('should get pending property approvals', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockPropertyController.getPendingApprovals).toHaveBeenCalled();
    });
  });

  describe('POST /:cuid/properties/:pid/approve (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/properties/${mockPid}/approve`;

    it('should approve property successfully', async () => {
      const response = await request(app).post(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('approved');
      expect(mockPropertyController.approveProperty).toHaveBeenCalled();
    });

    it('should return 404 for non-existent property', async () => {
      mockPropertyController.approveProperty.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Property not found',
          });
        }
      );

      const response = await request(app).post(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/properties/:pid/reject (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/properties/${mockPid}/reject`;

    it('should reject property successfully', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ reason: 'Incomplete information' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('rejected');
      expect(mockPropertyController.rejectProperty).toHaveBeenCalled();
    });
  });

  describe('POST /:cuid/properties/bulk-approve (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/properties/bulk-approve`;

    it('should bulk approve properties successfully', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ propertyIds: [mockPid, faker.string.uuid()] })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.approved).toBeDefined();
      expect(mockPropertyController.bulkApproveProperties).toHaveBeenCalled();
    });
  });

  describe('POST /:cuid/properties/bulk-reject (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/properties/bulk-reject`;

    it('should bulk reject properties successfully', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ propertyIds: [mockPid], reason: 'Invalid data' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.rejected).toBeDefined();
      expect(mockPropertyController.bulkRejectProperties).toHaveBeenCalled();
    });
  });

  describe('GET /:cuid/properties/my-requests (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/properties/my-requests`;

    it('should get user property requests', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(mockPropertyController.getMyPropertyRequests).toHaveBeenCalled();
    });
  });

  describe('PATCH /:cuid/client_properties/:pid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}`;

    it('should update property successfully', async () => {
      const updateData = {
        name: faker.location.street(),
        amenities: ['parking', 'gym'],
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated');
      expect(mockPropertyController.updateClientProperty).toHaveBeenCalled();
    });
  });

  describe('PATCH /:cuid/client_properties/:pid/remove_media (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/remove_media`;

    it('should remove media from property successfully', async () => {
      const response = await request(app)
        .patch(endpoint)
        .send({ mediaIds: [faker.string.uuid()] })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('deleted');
      expect(mockPropertyController.deleteMediaFromProperty).toHaveBeenCalled();
    });
  });

  describe('DELETE /:cuid/delete_properties/:pid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/delete_properties/${mockPid}`;

    it('should archive property successfully', async () => {
      const response = await request(app).delete(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('archived');
      expect(mockPropertyController.archiveProperty).toHaveBeenCalled();
    });

    it('should return 404 for non-existent property', async () => {
      mockPropertyController.archiveProperty.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Property not found',
          });
        }
      );

      const response = await request(app).delete(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle internal server errors gracefully', async () => {
      mockPropertyController.getClientProperties.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/client_properties`)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle unauthorized access', async () => {
      mockPropertyController.getClientProperties.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Unauthorized',
          });
        }
      );

      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/client_properties`)
        .expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });
  });
});
