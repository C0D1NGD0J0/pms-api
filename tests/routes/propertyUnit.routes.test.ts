import express from 'express';
import request from 'supertest';
import { validateRequest } from '@shared/validations';
import propertyUnitRoutes from '@routes/propertyUnit.routes';
import { PropertyTestFactory } from '@tests/utils/propertyTestHelpers';
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';

jest.mock('@controllers/PropertyUnitController');
jest.mock('@shared/validations');
jest.mock('@shared/middlewares');
jest.mock('@utils/helpers', () => ({
  asyncWrapper: jest.fn((handler) => handler),
  httpStatusCodes: {
    OK: 200,
    CREATED: 201,
    ACCEPTED: 202,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    FORBIDDEN: 403,
  },
}));

describe('PropertyUnit Routes - Integration Tests', () => {
  let app: express.Application;
  let mockPropertyUnitController: jest.Mocked<PropertyUnitController>;

  beforeEach(() => {
    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Mock property unit controller methods
    mockPropertyUnitController = {
      addUnit: jest.fn(),
      getPropertyUnits: jest.fn(),
      getPropertyUnit: jest.fn(),
      getJobStatus: jest.fn(),
      getUserJobs: jest.fn(),
      updateUnit: jest.fn(),
      updateUnitStatus: jest.fn(),
      archiveUnit: jest.fn(),
      setupInpection: jest.fn(),
      addDocumentToUnit: jest.fn(),
      deleteDocumentFromUnit: jest.fn(),
    } as any;

    // Mock container resolution
    app.use((req, res, next) => {
      req.container = {
        resolve: jest.fn().mockReturnValue(mockPropertyUnitController),
      } as any;
      // Mock params from parent routes (property.routes.ts)
      req.params.cid = 'client123';
      req.params.pid = 'property123';
      next();
    });

    // Mock middleware functions
    (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => next());
    (routeLimiter as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (diskUpload as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (scanFile as jest.Mock).mockImplementation((req, res, next) => next());

    // Use property unit routes with base path
    app.use('/properties/:cid/client_properties/:pid/units', propertyUnitRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /properties/:cid/client_properties/:pid/units', () => {
    it('should create a new property unit', async () => {
      const unitData = PropertyTestFactory.createPropertyUnit();
      const expectedResponse = {
        success: true,
        data: { ...unitData, _id: 'unit123' },
        message: 'Unit created successfully',
      };

      mockPropertyUnitController.addUnit.mockImplementation((req, res) => {
        res.status(201).json(expectedResponse);
      });

      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(unitData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.addUnit).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object), // PropertyUnitValidations.createUnits
      });
      expect(diskUpload).toHaveBeenCalledWith(['propertyUnit.media']);
      expect(scanFile).toHaveBeenCalled();
      expect(routeLimiter).toHaveBeenCalled();
    });

    it('should handle unit creation validation errors', async () => {
      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['Unit number is required'],
        });
      });

      await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send({})
        .expect(400);

      expect(mockPropertyUnitController.addUnit).not.toHaveBeenCalled();
    });

    it('should require authentication', async () => {
      (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      });

      await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(PropertyTestFactory.createPropertyUnit())
        .expect(401);

      expect(mockPropertyUnitController.addUnit).not.toHaveBeenCalled();
    });
  });

  describe('GET /properties/:cid/client_properties/:pid/units', () => {
    it('should get all property units with pagination', async () => {
      const units = [
        PropertyTestFactory.createPropertyUnit(),
        PropertyTestFactory.createPropertyUnit(),
      ];
      const expectedResponse = {
        success: true,
        data: units,
        pagination: { page: 1, limit: 10, total: 2 },
      };

      mockPropertyUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.getPropertyUnits).toHaveBeenCalledTimes(1);
      expect(routeLimiter).toHaveBeenCalled();
    });

    it('should handle empty units list', async () => {
      const expectedResponse = {
        success: true,
        data: [],
        pagination: { page: 1, limit: 10, total: 0 },
      };

      mockPropertyUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);

      expect(response.body.data).toEqual([]);
    });
  });

  describe('GET /properties/:cid/client_properties/:pid/units/jobs/:jobId/status', () => {
    it('should get job status by job ID', async () => {
      const jobId = 'job123';
      const expectedResponse = {
        success: true,
        data: {
          jobId,
          status: 'completed',
          progress: 100,
          result: 'Job completed successfully',
        },
      };

      mockPropertyUnitController.getJobStatus.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/jobs/${jobId}/status`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.getJobStatus).toHaveBeenCalledTimes(1);
    });

    it('should handle job not found', async () => {
      const jobId = 'nonexistent';
      const expectedResponse = {
        success: false,
        message: 'Job not found',
      };

      mockPropertyUnitController.getJobStatus.mockImplementation((req, res) => {
        res.status(404).json(expectedResponse);
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/jobs/${jobId}/status`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /properties/:cid/client_properties/:pid/units/jobs/user/active', () => {
    it('should get active user jobs', async () => {
      const expectedJobs = [
        { jobId: 'job1', status: 'pending', type: 'unit_creation' },
        { jobId: 'job2', status: 'running', type: 'unit_update' },
      ];

      mockPropertyUnitController.getUserJobs.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          data: expectedJobs,
        });
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units/jobs/user/active')
        .expect(200);

      expect(response.body.data).toEqual(expectedJobs);
      expect(mockPropertyUnitController.getUserJobs).toHaveBeenCalledTimes(1);
    });

    it('should handle unauthorized user for job access', async () => {
      mockPropertyUnitController.getUserJobs.mockImplementation((req, res) => {
        res.status(401).json({
          success: false,
          message: 'Unauthorized',
        });
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units/jobs/user/active')
        .expect(401);

      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /properties/:cid/client_properties/:pid/units/:puid', () => {
    it('should get specific property unit by PUID', async () => {
      const puid = 'unit123';
      const unit = PropertyTestFactory.createPropertyUnit();
      const expectedResponse = {
        success: true,
        data: unit,
      };

      mockPropertyUnitController.getPropertyUnit.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/${puid}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.getPropertyUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle unit not found', async () => {
      const puid = 'nonexistent';

      mockPropertyUnitController.getPropertyUnit.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'Unit not found',
        });
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/${puid}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid/units/:puid', () => {
    it('should update property unit successfully', async () => {
      const puid = 'unit123';
      const updateData = {
        unitNumber: 'A-1002',
        specifications: { bedrooms: 2, bathrooms: 1 },
      };
      const expectedResponse = {
        success: true,
        data: { ...updateData, _id: puid },
        message: 'Unit updated successfully',
      };

      mockPropertyUnitController.updateUnit.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${puid}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.updateUnit).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object), // PropertyUnitValidations.updateUnit
      });
      expect(diskUpload).toHaveBeenCalledWith(['propertyUnit.media']);
      expect(scanFile).toHaveBeenCalled();
    });

    it('should handle update validation errors', async () => {
      const puid = 'unit123';

      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['Invalid unit data'],
        });
      });

      await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${puid}`)
        .send({})
        .expect(400);

      expect(mockPropertyUnitController.updateUnit).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /properties/:cid/client_properties/:pid/units/:puid', () => {
    it('should archive property unit successfully', async () => {
      const puid = 'unit123';
      const expectedResponse = {
        success: true,
        message: 'Unit archived successfully',
      };

      mockPropertyUnitController.archiveUnit.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .delete(`/properties/client123/client_properties/property123/units/${puid}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.archiveUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle archive errors', async () => {
      const puid = 'unit123';

      mockPropertyUnitController.archiveUnit.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Cannot archive unit with active lease',
        });
      });

      const response = await request(app)
        .delete(`/properties/client123/client_properties/property123/units/${puid}`)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid/units/update_status/:puid', () => {
    it('should update unit status successfully', async () => {
      const puid = 'unit123';
      const statusData = { status: 'occupied' };
      const expectedResponse = {
        success: true,
        data: { status: 'occupied', updatedAt: new Date() },
        message: 'Unit status updated successfully',
      };

      mockPropertyUnitController.updateUnitStatus.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/update_status/${puid}`)
        .send(statusData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.updateUnitStatus).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object), // PropertyUnitValidations.updateUnit
      });
    });

    it('should handle invalid status values', async () => {
      const puid = 'unit123';
      const statusData = { status: 'invalid_status' };

      mockPropertyUnitController.updateUnitStatus.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Invalid status value',
        });
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/update_status/${puid}`)
        .send(statusData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /properties/:cid/client_properties/:pid/units/setup_inspection/:puid', () => {
    it('should setup inspection successfully', async () => {
      const puid = 'unit123';
      const inspectionData = {
        type: 'move_in',
        scheduledDate: new Date().toISOString(),
        inspector: 'inspector123',
      };
      const expectedResponse = {
        success: true,
        data: { ...inspectionData, _id: 'inspection123' },
        message: 'Inspection scheduled successfully',
      };

      mockPropertyUnitController.setupInpection.mockImplementation((req, res) => {
        res.status(201).json(expectedResponse);
      });

      const response = await request(app)
        .post(`/properties/client123/client_properties/property123/units/setup_inspection/${puid}`)
        .send(inspectionData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.setupInpection).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object), // PropertyUnitValidations.inspectUnit
      });
    });

    it('should handle inspection scheduling conflicts', async () => {
      const puid = 'unit123';
      const inspectionData = {
        type: 'move_out',
        scheduledDate: new Date().toISOString(),
      };

      mockPropertyUnitController.setupInpection.mockImplementation((req, res) => {
        res.status(409).json({
          success: false,
          message: 'Inspector not available at requested time',
        });
      });

      const response = await request(app)
        .post(`/properties/client123/client_properties/property123/units/setup_inspection/${puid}`)
        .send(inspectionData)
        .expect(409);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid/units/upload_media/:puid', () => {
    it('should upload unit media successfully', async () => {
      const puid = 'unit123';
      const mediaData = {
        scannedFiles: [
          PropertyTestFactory.createUploadResult(),
          PropertyTestFactory.createUploadResult(),
        ],
      };
      const expectedResponse = {
        success: true,
        data: { documents: mediaData.scannedFiles },
        message: 'Media uploaded successfully',
      };

      mockPropertyUnitController.addDocumentToUnit.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/upload_media/${puid}`)
        .send(mediaData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.addDocumentToUnit).toHaveBeenCalledTimes(1);
      expect(validateRequest).toHaveBeenCalledWith({
        body: expect.any(Object), // PropertyUnitValidations.uploadUnitMedia
      });
      expect(diskUpload).toHaveBeenCalledWith(['propertyUnit.media']);
      expect(scanFile).toHaveBeenCalled();
    });

    it('should handle media upload validation errors', async () => {
      const puid = 'unit123';

      (validateRequest as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'No media files provided',
        });
      });

      await request(app)
        .patch(`/properties/client123/client_properties/property123/units/upload_media/${puid}`)
        .send({})
        .expect(400);

      expect(mockPropertyUnitController.addDocumentToUnit).not.toHaveBeenCalled();
    });

    it('should handle file upload errors', async () => {
      const puid = 'unit123';

      (diskUpload as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(413).json({
          success: false,
          message: 'File too large',
        });
      });

      await request(app)
        .patch(`/properties/client123/client_properties/property123/units/upload_media/${puid}`)
        .send({})
        .expect(413);

      expect(mockPropertyUnitController.addDocumentToUnit).not.toHaveBeenCalled();
    });
  });

  describe('Middleware integration', () => {
    it('should apply authentication to all routes', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';

      // Test several routes to ensure authentication is applied
      await request(app).get(basePath);
      await request(app).post(basePath);
      await request(app).get(`${basePath}/unit123`);

      // isAuthenticated should be called for each route since it's applied at router level
      expect(isAuthenticated).toHaveBeenCalledTimes(3);
    });

    it('should apply rate limiting to all routes', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';

      await request(app).get(basePath);
      await request(app).post(basePath);
      await request(app).patch(`${basePath}/unit123`);

      // routeLimiter should be called for each route
      expect(routeLimiter).toHaveBeenCalledTimes(3);
    });

    it('should apply file upload middleware to appropriate routes', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';

      await request(app).post(basePath).send({});
      await request(app).patch(`${basePath}/unit123`).send({});
      await request(app).patch(`${basePath}/upload_media/unit123`).send({});

      expect(diskUpload).toHaveBeenCalledWith(['propertyUnit.media']);
      expect(scanFile).toHaveBeenCalledTimes(3);
    });

    it('should handle middleware errors gracefully', async () => {
      (routeLimiter as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(429).json({
          success: false,
          message: 'Rate limit exceeded',
        });
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(429);
    });
  });

  describe('Route parameter handling', () => {
    it('should handle merged parameters from parent routes', async () => {
      // Test that the router correctly inherits cid and pid from parent route
      const mockResolve = jest.fn().mockReturnValue(mockPropertyUnitController);

      app.use((req, res, next) => {
        req.container = { resolve: mockResolve } as any;
        // Verify parameters are available
        expect(req.params.cid).toBe('client123');
        expect(req.params.pid).toBe('property123');
        next();
      });

      mockPropertyUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json({ success: true, data: [] });
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);
    });

    it('should handle PUID parameter correctly', async () => {
      const puid = 'unit-123-abc';

      mockPropertyUnitController.getPropertyUnit.mockImplementation((req, res) => {
        expect(req.params.puid).toBe(puid);
        res.status(200).json({ success: true, data: {} });
      });

      await request(app)
        .get(`/properties/client123/client_properties/property123/units/${puid}`)
        .expect(200);
    });

    it('should handle jobId parameter correctly', async () => {
      const jobId = 'job-456-def';

      mockPropertyUnitController.getJobStatus.mockImplementation((req, res) => {
        expect(req.params.jobId).toBe(jobId);
        res.status(200).json({ success: true, data: {} });
      });

      await request(app)
        .get(`/properties/client123/client_properties/property123/units/jobs/${jobId}/status`)
        .expect(200);
    });
  });

  describe('Container resolution', () => {
    it('should resolve PropertyUnitController from container', async () => {
      const mockResolve = jest.fn().mockReturnValue(mockPropertyUnitController);

      app.use((req, res, next) => {
        req.container = { resolve: mockResolve } as any;
        req.params.cid = 'client123';
        req.params.pid = 'property123';
        next();
      });

      mockPropertyUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json({ success: true, data: [] });
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);

      expect(mockResolve).toHaveBeenCalledWith('propertyUnitController');
    });

    it('should handle container resolution failures', async () => {
      app.use((req, res, next) => {
        req.container = {
          resolve: jest.fn().mockImplementation(() => {
            throw new Error('PropertyUnitController not found');
          }),
        } as any;
        req.params.cid = 'client123';
        req.params.pid = 'property123';
        next();
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(500);
    });
  });

  describe('Error handling', () => {
    it('should handle controller method exceptions', async () => {
      mockPropertyUnitController.getPropertyUnits.mockImplementation(() => {
        throw new Error('Database connection failed');
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(500);
    });

    it('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send('invalid json')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toMatchObject({
        error: expect.any(String),
      });
    });

    it('should handle missing required parameters', async () => {
      // Test without required parent route parameters
      const standaloneApp = express();
      standaloneApp.use(express.json());
      standaloneApp.use((req, res, next) => {
        req.container = {
          resolve: jest.fn().mockReturnValue(mockPropertyUnitController),
        } as any;
        next();
      });
      standaloneApp.use('/units', propertyUnitRoutes);

      mockPropertyUnitController.getPropertyUnits.mockImplementation((req, res) => {
        // Should have undefined cid and pid since parent route params are missing
        expect(req.params.cid).toBeUndefined();
        expect(req.params.pid).toBeUndefined();
        res.status(400).json({
          success: false,
          message: 'Missing required parameters',
        });
      });

      await request(standaloneApp).get('/units').expect(400);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete unit lifecycle', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';
      const unitData = PropertyTestFactory.createPropertyUnit();
      const puid = 'unit123';

      // Create unit
      mockPropertyUnitController.addUnit.mockImplementation((req, res) => {
        res.status(201).json({
          success: true,
          data: { ...unitData, _id: puid },
        });
      });

      await request(app).post(basePath).send(unitData).expect(201);

      // Update unit status
      mockPropertyUnitController.updateUnitStatus.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          data: { status: 'occupied' },
        });
      });

      await request(app)
        .patch(`${basePath}/update_status/${puid}`)
        .send({ status: 'occupied' })
        .expect(200);

      // Archive unit
      mockPropertyUnitController.archiveUnit.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          message: 'Unit archived',
        });
      });

      await request(app).delete(`${basePath}/${puid}`).expect(200);

      expect(mockPropertyUnitController.addUnit).toHaveBeenCalledTimes(1);
      expect(mockPropertyUnitController.updateUnitStatus).toHaveBeenCalledTimes(1);
      expect(mockPropertyUnitController.archiveUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle inspection workflow', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';
      const puid = 'unit123';
      const inspectionData = {
        type: 'move_in',
        scheduledDate: new Date().toISOString(),
        inspector: 'inspector123',
      };

      // Schedule inspection
      mockPropertyUnitController.setupInpection.mockImplementation((req, res) => {
        res.status(201).json({
          success: true,
          data: { ...inspectionData, _id: 'inspection123' },
        });
      });

      await request(app)
        .post(`${basePath}/setup_inspection/${puid}`)
        .send(inspectionData)
        .expect(201);

      // Upload inspection documents
      mockPropertyUnitController.addDocumentToUnit.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          data: { documents: ['doc1.pdf', 'doc2.jpg'] },
        });
      });

      await request(app)
        .patch(`${basePath}/upload_media/${puid}`)
        .send({ scannedFiles: ['doc1.pdf', 'doc2.jpg'] })
        .expect(200);

      expect(mockPropertyUnitController.setupInpection).toHaveBeenCalledTimes(1);
      expect(mockPropertyUnitController.addDocumentToUnit).toHaveBeenCalledTimes(1);
    });
  });
});
