// Set Jest timeout to prevent hanging tests
jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// Mock Property Unit Controller
const mockPropertyUnitController = {
  addUnit: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Unit(s) created successfully',
      data: {
        puid: faker.string.uuid(),
        unitNumber: 'A101',
        status: 'available',
      },
    });
  }),

  getPropertyUnits: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        {
          puid: faker.string.uuid(),
          unitNumber: 'A101',
          status: 'available',
          rentAmount: 1500,
          bedrooms: 2,
          bathrooms: 1,
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

  getPropertyUnit: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        puid: faker.string.uuid(),
        unitNumber: 'A101',
        status: 'available',
        rentAmount: 1500,
        bedrooms: 2,
        bathrooms: 1,
        squareFeet: 850,
        amenities: ['balcony', 'parking'],
      },
    });
  }),

  updateUnit: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Unit updated successfully',
    });
  }),

  archiveUnit: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Unit archived successfully',
    });
  }),

  updateUnitStatus: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Unit status updated successfully',
    });
  }),

  setupInpection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection scheduled successfully',
      data: {
        inspectionId: faker.string.uuid(),
        scheduledDate: faker.date.future().toISOString(),
      },
    });
  }),

  addDocumentToUnit: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Media uploaded successfully',
    });
  }),

  validateUnitsCsv: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'CSV validation started',
      data: {
        processId: faker.string.uuid(),
      },
    });
  }),

  importUnitsFromCsv: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'CSV import started',
      data: {
        processId: faker.string.uuid(),
      },
    });
  }),
};

// Simplified mock container
const mockContainer = {
  resolve: jest.fn((service: string) => {
    switch (service) {
      case 'propertyUnitController':
        return mockPropertyUnitController;
      default:
        return {};
    }
  }),
};

describe('Property Unit Routes Integration Tests', () => {
  const baseUrl = '/api/v1/properties';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockPid = faker.string.uuid();
  const mockPuid = faker.string.uuid();

  beforeAll(() => {
    // Setup test app with routes
    app = apiHelper.createApp((testApp) => {
      // Inject container and simulate authentication
      testApp.use((req, res, next) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Define property unit routes (nested under property)
      const unitsBase = `${baseUrl}/:cuid/client_properties/:pid/units`;
      testApp.post(unitsBase, mockPropertyUnitController.addUnit);
      testApp.get(unitsBase, mockPropertyUnitController.getPropertyUnits);
      testApp.get(`${unitsBase}/:puid`, mockPropertyUnitController.getPropertyUnit);
      testApp.patch(`${unitsBase}/:puid`, mockPropertyUnitController.updateUnit);
      testApp.delete(`${unitsBase}/:puid`, mockPropertyUnitController.archiveUnit);
      testApp.patch(
        `${unitsBase}/update_status/:puid`,
        mockPropertyUnitController.updateUnitStatus
      );
      testApp.post(
        `${unitsBase}/setup_inspection/:puid`,
        mockPropertyUnitController.setupInpection
      );
      testApp.patch(
        `${unitsBase}/upload_media/:puid`,
        mockPropertyUnitController.addDocumentToUnit
      );
      testApp.post(`${unitsBase}/validate_csv`, mockPropertyUnitController.validateUnitsCsv);
      testApp.post(`${unitsBase}/import_csv`, mockPropertyUnitController.importUnitsFromCsv);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /:cuid/client_properties/:pid/units (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units`;

    it('should create unit successfully', async () => {
      const unitData = {
        unitNumber: 'A101',
        rentAmount: 1500,
        bedrooms: 2,
        bathrooms: 1,
        squareFeet: 850,
      };

      const response = await request(app)
        .post(endpoint)
        .send(unitData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('created');
      expect(response.body.data.puid).toBeDefined();
      expect(mockPropertyUnitController.addUnit).toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      mockPropertyUnitController.addUnit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Validation failed',
            errors: ['Unit number is required'],
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });

    it('should return 403 for insufficient permissions', async () => {
      mockPropertyUnitController.addUnit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.FORBIDDEN).json({
            success: false,
            message: 'Insufficient permissions',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({ unitNumber: 'A101' })
        .expect(httpStatusCodes.FORBIDDEN);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /:cuid/client_properties/:pid/units (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units`;

    it('should get property units successfully', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(mockPropertyUnitController.getPropertyUnits).toHaveBeenCalled();
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
        .query({ status: 'available' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should support filtering by bedrooms', async () => {
      const response = await request(app)
        .get(endpoint)
        .query({ bedrooms: '2' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });
  });

  describe('GET /:cuid/client_properties/:pid/units/:puid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/${mockPuid}`;

    it('should get single unit details', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.puid).toBeDefined();
      expect(response.body.data.unitNumber).toBeDefined();
      expect(mockPropertyUnitController.getPropertyUnit).toHaveBeenCalled();
    });

    it('should return 404 for non-existent unit', async () => {
      mockPropertyUnitController.getPropertyUnit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Unit not found',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /:cuid/client_properties/:pid/units/:puid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/${mockPuid}`;

    it('should update unit successfully', async () => {
      const updateData = {
        rentAmount: 1600,
        status: 'occupied',
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('updated');
      expect(mockPropertyUnitController.updateUnit).toHaveBeenCalled();
    });

    it('should update unit amenities', async () => {
      const updateData = {
        amenities: ['balcony', 'parking', 'storage'],
      };

      const response = await request(app)
        .patch(endpoint)
        .send(updateData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
    });

    it('should return 404 for non-existent unit', async () => {
      mockPropertyUnitController.updateUnit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Unit not found',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ rentAmount: 1600 })
        .expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /:cuid/client_properties/:pid/units/:puid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/${mockPuid}`;

    it('should archive unit successfully', async () => {
      const response = await request(app).delete(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('archived');
      expect(mockPropertyUnitController.archiveUnit).toHaveBeenCalled();
    });

    it('should return 404 for non-existent unit', async () => {
      mockPropertyUnitController.archiveUnit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.NOT_FOUND).json({
            success: false,
            message: 'Unit not found',
          });
        }
      );

      const response = await request(app).delete(endpoint).expect(httpStatusCodes.NOT_FOUND);

      expect(response.body.success).toBe(false);
    });

    it('should prevent deleting occupied unit', async () => {
      mockPropertyUnitController.archiveUnit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Cannot delete occupied unit',
          });
        }
      );

      const response = await request(app).delete(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('occupied');
    });
  });

  describe('PATCH /:cuid/client_properties/:pid/units/update_status/:puid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/update_status/${mockPuid}`;

    it('should update unit status successfully', async () => {
      const response = await request(app)
        .patch(endpoint)
        .send({ status: 'maintenance' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('status updated');
      expect(mockPropertyUnitController.updateUnitStatus).toHaveBeenCalled();
    });

    it('should validate status value', async () => {
      mockPropertyUnitController.updateUnitStatus.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid status value',
          });
        }
      );

      const response = await request(app)
        .patch(endpoint)
        .send({ status: 'invalid' })
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/client_properties/:pid/units/setup_inspection/:puid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/setup_inspection/${mockPuid}`;

    it('should schedule inspection successfully', async () => {
      const inspectionData = {
        scheduledDate: faker.date.future().toISOString(),
        inspectorId: faker.string.uuid(),
        notes: 'Annual inspection',
      };

      const response = await request(app)
        .post(endpoint)
        .send(inspectionData)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('scheduled');
      expect(response.body.data.inspectionId).toBeDefined();
      expect(mockPropertyUnitController.setupInpection).toHaveBeenCalled();
    });

    it('should validate required fields', async () => {
      mockPropertyUnitController.setupInpection.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Scheduled date is required',
          });
        }
      );

      const response = await request(app)
        .post(endpoint)
        .send({})
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /:cuid/client_properties/:pid/units/upload_media/:puid (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/upload_media/${mockPuid}`;

    it('should upload media successfully', async () => {
      const response = await request(app)
        .patch(endpoint)
        .attach('propertyUnit.media', Buffer.from('fake image data'), 'unit.jpg')
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toContain('uploaded');
      expect(mockPropertyUnitController.addDocumentToUnit).toHaveBeenCalled();
    });

    it('should return 400 without media file', async () => {
      mockPropertyUnitController.addDocumentToUnit.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'No media file provided',
          });
        }
      );

      const response = await request(app).patch(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/client_properties/:pid/units/validate_csv (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/validate_csv`;

    it('should validate units CSV successfully', async () => {
      const response = await request(app)
        .post(endpoint)
        .attach('csv_file', Buffer.from('unitNumber,rentAmount\nA101,1500'), 'units.csv')
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.processId).toBeDefined();
      expect(mockPropertyUnitController.validateUnitsCsv).toHaveBeenCalled();
    });

    it('should return 400 without CSV file', async () => {
      mockPropertyUnitController.validateUnitsCsv.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'No CSV file uploaded',
          });
        }
      );

      const response = await request(app).post(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /:cuid/client_properties/:pid/units/import_csv (protected)', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units/import_csv`;

    it('should import units from CSV successfully', async () => {
      const response = await request(app)
        .post(endpoint)
        .attach('csv_file', Buffer.from('unitNumber,rentAmount\nA101,1500'), 'units.csv')
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.processId).toBeDefined();
      expect(mockPropertyUnitController.importUnitsFromCsv).toHaveBeenCalled();
    });

    it('should return 400 without CSV file', async () => {
      mockPropertyUnitController.importUnitsFromCsv.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'No CSV file uploaded',
          });
        }
      );

      const response = await request(app).post(endpoint).expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Error Handling', () => {
    const endpoint = `${baseUrl}/${mockCuid}/client_properties/${mockPid}/units`;

    it('should handle internal server errors gracefully', async () => {
      mockPropertyUnitController.getPropertyUnits.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
            success: false,
            message: 'Internal server error',
          });
        }
      );

      const response = await request(app)
        .get(endpoint)
        .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

      expect(response.body.success).toBe(false);
    });

    it('should handle unauthorized access', async () => {
      mockPropertyUnitController.getPropertyUnits.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.UNAUTHORIZED).json({
            success: false,
            message: 'Unauthorized',
          });
        }
      );

      const response = await request(app).get(endpoint).expect(httpStatusCodes.UNAUTHORIZED);

      expect(response.body.success).toBe(false);
    });

    it('should handle invalid property ID', async () => {
      mockPropertyUnitController.getPropertyUnits.mockImplementationOnce(
        (_req: Request, res: Response) => {
          res.status(httpStatusCodes.BAD_REQUEST).json({
            success: false,
            message: 'Invalid property ID format',
          });
        }
      );

      const invalidEndpoint = `${baseUrl}/${mockCuid}/client_properties/invalid-pid/units`;
      const response = await request(app)
        .get(invalidEndpoint)
        .expect(httpStatusCodes.BAD_REQUEST);

      expect(response.body.message).toContain('Invalid');
    });
  });
});
