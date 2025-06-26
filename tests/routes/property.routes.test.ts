import request from 'supertest';
import express from 'express';
import propertyRoutes from '@routes/property.routes';
import { PropertyController } from '@controllers/PropertyController';
import { validateRequest } from '@shared/validations';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';
import { asyncWrapper } from '@utils/helpers';
import { PropertyTestFactory } from '@tests/utils/propertyTestHelpers';
import { AuthTestFactory } from '@tests/utils/authTestHelpers';

jest.mock('@controllers/PropertyController');
jest.mock('@shared/validations');
jest.mock('@shared/middlewares');
jest.mock('@utils/helpers', () => ({
  asyncWrapper: jest.fn((handler) => handler),
  httpStatusCodes: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    FORBIDDEN: 403
  }
}));

describe('Property Routes - Integration Tests', () => {
  let app: express.Application;
  let mockPropertyController: jest.Mocked<PropertyController>;

  beforeEach(() => {
    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Mock property controller methods
    mockPropertyController = {
      create: jest.fn(),
      getClientProperties: jest.fn(),
      getProperty: jest.fn(),
      updateClientProperty: jest.fn(),
      validateCsv: jest.fn(),
      createPropertiesFromCsv: jest.fn(),
      addMediaToProperty: jest.fn(),
      deleteMediaFromProperty: jest.fn(),
      archiveProperty: jest.fn(),
      getPropertyFormMetadata: jest.fn(),
      getPropertyUnits: jest.fn(),
      verifyOccupancyStatus: jest.fn(),
      search: jest.fn(),
      checkAvailability: jest.fn(),
      getNearbyProperties: jest.fn(),
      restorArchivedProperty: jest.fn()
    } as any;

    // Mock container resolution
    app.use((req, res, next) => {
      req.container = {
        resolve: jest.fn().mockReturnValue(mockPropertyController)
      } as any;
      next();
    });

    // Mock middleware functions
    (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => next());
    (routeLimiter as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (diskUpload as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (scanFile as jest.Mock).mockImplementation((req, res, next) => next());

    // Use property routes
    app.use('/properties', propertyRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /properties/property_form_metadata', () => {
    it('should get property form metadata', async () => {
      const expectedResponse = {
        success: true,
        data: {
          propertyTypes: ['house', 'apartment', 'condo'],
          amenities: ['pool', 'gym', 'parking'],
          formFields: []
        }
      };

      mockPropertyController.getPropertyFormMetadata.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get('/properties/property_form_metadata')
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.getPropertyFormMetadata).toHaveBeenCalledTimes(1);
      expect(isAuthenticated).toHaveBeenCalled();
      expect(routeLimiter).toHaveBeenCalledWith({ enableRateLimit: true });
    });

    it('should require authentication', async () => {
      (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => {
        res.status(401).json({
          success: false,
          message: 'Authentication required'
        });
      });

      await request(app)
        .get('/properties/property_form_metadata')
        .expect(401);

      expect(mockPropertyController.getPropertyFormMetadata).not.toHaveBeenCalled();
    });
  });

  describe('POST /properties/:cid/add_property', () => {
    it('should create a new property', async () => {
      const cid = 'client123';
      const propertyData = PropertyTestFactory.createPropertyData();
      const expectedResponse = {
        success: true,
        data: { ...propertyData, _id: 'property123' },
        message: 'Property created successfully'
      };

      mockPropertyController.create.mockImplementation((req, res) => {
        res.status(201).json(expectedResponse);
      });

      const response = await request(app)
        .post(`/properties/${cid}/add_property`)
        .send(propertyData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.create).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        params: expect.any(Object), // PropertyValidations.validateCid
        body: expect.any(Object) // PropertyValidations.create
      });
      expect(diskUpload).toHaveBeenCalledWith(['document.photos']);
      expect(scanFile).toHaveBeenCalled();
    });

    it('should handle validation errors', async () => {
      const cid = 'client123';
      
      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['Property name is required']
        });
      });

      await request(app)
        .post(`/properties/${cid}/add_property`)
        .send({})
        .expect(400);

      expect(mockPropertyController.create).not.toHaveBeenCalled();
    });

    it('should handle file upload errors', async () => {
      const cid = 'client123';
      
      (diskUpload as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'File upload failed'
        });
      });

      await request(app)
        .post(`/properties/${cid}/add_property`)
        .send({})
        .expect(400);

      expect(mockPropertyController.create).not.toHaveBeenCalled();
    });
  });

  describe('POST /properties/:cid/validate_csv', () => {
    it('should validate CSV file', async () => {
      const cid = 'client123';
      const expectedResponse = {
        success: true,
        data: {
          valid: true,
          rowCount: 10,
          preview: []
        },
        message: 'CSV validation successful'
      };

      mockPropertyController.validateCsv.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .post(`/properties/${cid}/validate_csv`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.validateCsv).toHaveBeenCalledTimes(1);
      expect(diskUpload).toHaveBeenCalledWith(['csv_file']);
      expect(scanFile).toHaveBeenCalled();
    });

    it('should handle invalid CSV format', async () => {
      const cid = 'client123';

      mockPropertyController.validateCsv.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Invalid CSV format',
          errors: ['Missing required columns']
        });
      });

      const response = await request(app)
        .post(`/properties/${cid}/validate_csv`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /properties/:cid/import_properties_csv', () => {
    it('should import properties from CSV', async () => {
      const cid = 'client123';
      const expectedResponse = {
        success: true,
        data: {
          imported: 8,
          failed: 2,
          jobId: 'job123'
        },
        message: 'CSV import started'
      };

      mockPropertyController.createPropertiesFromCsv.mockImplementation((req, res) => {
        res.status(202).json(expectedResponse);
      });

      const response = await request(app)
        .post(`/properties/${cid}/import_properties_csv`)
        .expect(202);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.createPropertiesFromCsv).toHaveBeenCalledTimes(1);
      expect(diskUpload).toHaveBeenCalledWith(['csv_file']);
      expect(scanFile).toHaveBeenCalled();
    });

    it('should handle CSV import errors', async () => {
      const cid = 'client123';

      mockPropertyController.createPropertiesFromCsv.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'CSV import failed'
        });
      });

      const response = await request(app)
        .post(`/properties/${cid}/import_properties_csv`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /properties/:cid/client_properties', () => {
    it('should get client properties with pagination', async () => {
      const cid = 'client123';
      const properties = [
        PropertyTestFactory.createPropertyData(),
        PropertyTestFactory.createPropertyData()
      ];
      const expectedResponse = {
        success: true,
        data: properties,
        pagination: { page: 1, limit: 10, total: 2 }
      };

      mockPropertyController.getClientProperties.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get(`/properties/${cid}/client_properties`)
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.getClientProperties).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        params: expect.any(Object) // PropertyValidations.validateCid
      });
      expect(routeLimiter).toHaveBeenCalled();
    });

    it('should handle no properties found', async () => {
      const cid = 'client123';

      mockPropertyController.getClientProperties.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          data: [],
          pagination: { page: 1, limit: 10, total: 0 }
        });
      });

      const response = await request(app)
        .get(`/properties/${cid}/client_properties`)
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /properties/:cid/client_properties/:pid', () => {
    it('should get specific property by ID', async () => {
      const cid = 'client123';
      const pid = 'property123';
      const property = PropertyTestFactory.createPropertyData();
      const expectedResponse = {
        success: true,
        data: property
      };

      mockPropertyController.getProperty.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get(`/properties/${cid}/client_properties/${pid}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.getProperty).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        params: expect.any(Object) // PropertyValidations.validatePropertyAndClientIds
      });
    });

    it('should handle property not found', async () => {
      const cid = 'client123';
      const pid = 'nonexistent';

      mockPropertyController.getProperty.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'Property not found'
        });
      });

      const response = await request(app)
        .get(`/properties/${cid}/client_properties/${pid}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid', () => {
    it('should update property successfully', async () => {
      const cid = 'client123';
      const pid = 'property123';
      const updateData = {
        name: 'Updated Property Name',
        description: { text: 'Updated description' }
      };
      const expectedResponse = {
        success: true,
        data: { ...updateData, _id: pid },
        message: 'Property updated successfully'
      };

      mockPropertyController.updateClientProperty.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/${cid}/client_properties/${pid}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.updateClientProperty).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        params: expect.any(Object), // PropertyValidations.validatePropertyAndClientIds
        body: expect.any(Object) // PropertyValidations.updateProperty
      });
    });

    it('should handle update validation errors', async () => {
      const cid = 'client123';
      const pid = 'property123';

      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['Invalid property data']
        });
      });

      await request(app)
        .patch(`/properties/${cid}/client_properties/${pid}`)
        .send({})
        .expect(400);

      expect(mockPropertyController.updateClientProperty).not.toHaveBeenCalled();
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid/add_media', () => {
    it('should add media to property', async () => {
      const cid = 'client123';
      const pid = 'property123';
      const expectedResponse = {
        success: true,
        data: {
          mediaAdded: ['photo1.jpg', 'photo2.jpg']
        },
        message: 'Media added successfully'
      };

      mockPropertyController.addMediaToProperty.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/${cid}/client_properties/${pid}/add_media`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.addMediaToProperty).toHaveBeenCalledTimes(1);
    });

    it('should handle media upload errors', async () => {
      const cid = 'client123';
      const pid = 'property123';

      mockPropertyController.addMediaToProperty.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Failed to upload media'
        });
      });

      const response = await request(app)
        .patch(`/properties/${cid}/client_properties/${pid}/add_media`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid/remove_media', () => {
    it('should remove media from property', async () => {
      const cid = 'client123';
      const pid = 'property123';
      const expectedResponse = {
        success: true,
        message: 'Media removed successfully'
      };

      mockPropertyController.deleteMediaFromProperty.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/${cid}/client_properties/${pid}/remove_media`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.deleteMediaFromProperty).toHaveBeenCalledTimes(1);
    });

    it('should handle media not found', async () => {
      const cid = 'client123';
      const pid = 'property123';

      mockPropertyController.deleteMediaFromProperty.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'Media not found'
        });
      });

      const response = await request(app)
        .patch(`/properties/${cid}/client_properties/${pid}/remove_media`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('DELETE /properties/:cid/delete_properties/:pid', () => {
    it('should archive property successfully', async () => {
      const cid = 'client123';
      const pid = 'property123';
      const expectedResponse = {
        success: true,
        message: 'Property archived successfully'
      };

      mockPropertyController.archiveProperty.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .delete(`/properties/${cid}/delete_properties/${pid}`)
        .query({ cid, pid })
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyController.archiveProperty).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        query: expect.any(Object) // PropertyValidations.validatePropertyAndClientIds
      });
    });

    it('should handle archive errors', async () => {
      const cid = 'client123';
      const pid = 'property123';

      mockPropertyController.archiveProperty.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Cannot archive property with active leases'
        });
      });

      const response = await request(app)
        .delete(`/properties/${cid}/delete_properties/${pid}`)
        .query({ cid, pid })
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('Middleware integration', () => {
    it('should apply authentication to all routes', async () => {
      const cid = 'client123';
      
      // Test several routes to ensure authentication is applied
      await request(app).get('/properties/property_form_metadata');
      await request(app).get(`/properties/${cid}/client_properties`);
      await request(app).post(`/properties/${cid}/add_property`);

      // isAuthenticated should be called for each route since it's applied at router level
      expect(isAuthenticated).toHaveBeenCalledTimes(3);
    });

    it('should apply rate limiting to specific routes', async () => {
      await request(app).get('/properties/property_form_metadata');
      await request(app).get('/properties/client123/client_properties');

      expect(routeLimiter).toHaveBeenCalledWith({ enableRateLimit: true });
      expect(routeLimiter).toHaveBeenCalledWith();
    });

    it('should apply file upload middleware to appropriate routes', async () => {
      const cid = 'client123';
      
      await request(app).post(`/properties/${cid}/add_property`);
      await request(app).post(`/properties/${cid}/validate_csv`);
      await request(app).post(`/properties/${cid}/import_properties_csv`);

      expect(diskUpload).toHaveBeenCalledWith(['document.photos']);
      expect(diskUpload).toHaveBeenCalledWith(['csv_file']);
      expect(scanFile).toHaveBeenCalledTimes(3);
    });

    it('should handle middleware errors', async () => {
      (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => {
        res.status(401).json({
          success: false,
          message: 'Token expired'
        });
      });

      await request(app)
        .get('/properties/property_form_metadata')
        .expect(401);
    });
  });

  describe('Container resolution', () => {
    it('should resolve PropertyController from container', async () => {
      const mockResolve = jest.fn().mockReturnValue(mockPropertyController);
      
      app.use((req, res, next) => {
        req.container = { resolve: mockResolve } as any;
        next();
      });

      await request(app).get('/properties/property_form_metadata');

      expect(mockResolve).toHaveBeenCalledWith('propertyController');
    });

    it('should handle container resolution failures', async () => {
      app.use((req, res, next) => {
        req.container = {
          resolve: jest.fn().mockImplementation(() => {
            throw new Error('Controller not found');
          })
        } as any;
        next();
      });

      await request(app)
        .get('/properties/property_form_metadata')
        .expect(500);
    });
  });

  describe('Route parameter validation', () => {
    it('should validate client ID parameter', async () => {
      const invalidCid = 'invalid-client-id';

      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        if (req.params.cid === invalidCid) {
          res.status(400).json({
            success: false,
            message: 'Invalid client ID format'
          });
        } else {
          next();
        }
      });

      await request(app)
        .get(`/properties/${invalidCid}/client_properties`)
        .expect(400);

      expect(mockPropertyController.getClientProperties).not.toHaveBeenCalled();
    });

    it('should validate property and client ID parameters', async () => {
      const cid = 'client123';
      const invalidPid = 'invalid-property-id';

      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        if (req.params.pid === invalidPid) {
          res.status(400).json({
            success: false,
            message: 'Invalid property ID format'
          });
        } else {
          next();
        }
      });

      await request(app)
        .get(`/properties/${cid}/client_properties/${invalidPid}`)
        .expect(400);

      expect(mockPropertyController.getProperty).not.toHaveBeenCalled();
    });
  });

  describe('Error handling', () => {
    it('should handle controller method exceptions', async () => {
      mockPropertyController.getPropertyFormMetadata.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await request(app)
        .get('/properties/property_form_metadata')
        .expect(500);
    });

    it('should handle malformed request bodies', async () => {
      const cid = 'client123';

      const response = await request(app)
        .post(`/properties/${cid}/add_property`)
        .send('invalid json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toMatchObject({
        error: expect.any(String)
      });
    });

    it('should handle large file uploads', async () => {
      const cid = 'client123';

      (diskUpload as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(413).json({
          success: false,
          message: 'File too large'
        });
      });

      await request(app)
        .post(`/properties/${cid}/add_property`)
        .expect(413);
    });
  });

  describe('Nested route mounting', () => {
    it('should mount property unit routes correctly', async () => {
      // This test verifies that the nested route mounting is working
      // The actual property unit route tests would be in their own file
      const cid = 'client123';
      const pid = 'property123';

      // Verify the route pattern exists (would be handled by propertyUnit.routes)
      const routePath = `/properties/${cid}/client_properties/${pid}/units`;
      
      // Since we're testing route mounting, we just verify the base structure
      expect(propertyRoutes.stack).toBeDefined();
      
      // Find the nested route handler
      const nestedRoute = propertyRoutes.stack.find(layer => 
        layer.regexp.toString().includes('units')
      );
      
      expect(nestedRoute).toBeDefined();
    });
  });
});