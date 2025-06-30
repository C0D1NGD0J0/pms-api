import express from 'express';
import request from 'supertest';
import unitRoutes from '@routes/unit.routes';
import { PropertyUnitController } from '@controllers/index';
import { PropertyTestFactory } from '@tests/utils/propertyTestHelpers';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';

jest.mock('@controllers/PropertyUnitController');
jest.mock('@shared/middlewares');
jest.mock('@utils/helpers', () => ({
  asyncWrapper: jest.fn((handler) => handler),
  httpStatusCodes: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    FORBIDDEN: 403,
    CONFLICT: 409,
  },
}));

describe('Unit Routes - Integration Tests', () => {
  let app: express.Application;
  let mockUnitController: jest.Mocked<PropertyUnitController>;

  beforeEach(() => {
    // Create Express app for testing
    app = express();
    app.use(express.json());

    // Mock unit controller methods
    mockUnitController = {
      getPropertyUnits: jest.fn(),
      getPropertyUnit: jest.fn(),
      addUnit: jest.fn(),
      updateUnit: jest.fn(),
      updateUnitStatus: jest.fn(),
      setupInpection: jest.fn(),
      archiveUnit: jest.fn(),
    } as any;

    // Mock container resolution
    app.use((req, res, next) => {
      req.container = {
        resolve: jest.fn().mockReturnValue(mockUnitController),
      } as any;
      // Mock params from parent routes
      req.params.cid = 'client123';
      req.params.pid = 'property123';
      next();
    });

    // Mock middleware functions
    (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => next());
    (routeLimiter as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (diskUpload as jest.Mock).mockImplementation(() => (req, res, next) => next());
    (scanFile as jest.Mock).mockImplementation((req, res, next) => next());

    // Use unit routes with base path
    app.use('/properties/:cid/client_properties/:pid/units', unitRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /properties/:cid/client_properties/:pid/units', () => {
    it('should get all units for a property', async () => {
      const units = [
        PropertyTestFactory.createPropertyUnit(),
        PropertyTestFactory.createPropertyUnit(),
      ];
      const expectedResponse = {
        success: true,
        data: units,
        pagination: { page: 1, limit: 10, total: 2 },
      };

      mockUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.getPropertyUnits).toHaveBeenCalledTimes(1);
      expect(routeLimiter).toHaveBeenCalled();
    });

    it('should handle empty units list', async () => {
      const expectedResponse = {
        success: true,
        data: [],
        pagination: { page: 1, limit: 10, total: 0 },
      };

      mockUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);

      expect(response.body.data).toEqual([]);
    });

    it('should require authentication', async () => {
      (isAuthenticated as jest.Mock).mockImplementation((req, res, next) => {
        res.status(401).json({
          success: false,
          message: 'Authentication required',
        });
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(401);

      expect(mockUnitController.getPropertyUnits).not.toHaveBeenCalled();
    });
  });

  describe('GET /properties/:cid/client_properties/:pid/units/:unitId', () => {
    it('should get specific unit by ID', async () => {
      const unitId = 'unit123';
      const unit = PropertyTestFactory.createPropertyUnit();
      const expectedResponse = {
        success: true,
        data: unit,
      };

      mockUnitController.getPropertyUnit.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.getPropertyUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle unit not found', async () => {
      const unitId = 'nonexistent';

      mockUnitController.getPropertyUnit.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'Unit not found',
        });
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
    });

    it('should handle unauthorized access to unit', async () => {
      const unitId = 'unit123';

      mockUnitController.getPropertyUnit.mockImplementation((req, res) => {
        res.status(403).json({
          success: false,
          message: 'Access denied to this unit',
        });
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(403);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /properties/:cid/client_properties/:pid/units', () => {
    it('should create a new unit successfully', async () => {
      const unitData = PropertyTestFactory.createPropertyUnit();
      const expectedResponse = {
        success: true,
        data: { ...unitData, _id: 'unit123' },
        message: 'Unit created successfully',
      };

      mockUnitController.addUnit.mockImplementation((req, res) => {
        res.status(201).json(expectedResponse);
      });

      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(unitData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.addUnit).toHaveBeenCalledTimes(1);
      expect(diskUpload).toHaveBeenCalledWith(['unit.media']);
      expect(scanFile).toHaveBeenCalled();
    });

    it('should handle unit creation validation errors', async () => {
      const invalidUnitData = {
        unitNumber: '', // Invalid empty unit number
      };

      mockUnitController.addUnit.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['Unit number is required'],
        });
      });

      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(invalidUnitData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should handle file upload errors', async () => {
      (diskUpload as jest.Mock).mockImplementation(() => (req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'File upload failed',
        });
      });

      await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send({})
        .expect(400);

      expect(mockUnitController.createUnit).not.toHaveBeenCalled();
    });

    it('should handle duplicate unit number conflict', async () => {
      const unitData = PropertyTestFactory.createPropertyUnit({
        unitNumber: 'A-101',
      });

      mockUnitController.createUnit.mockImplementation((req, res) => {
        res.status(409).json({
          success: false,
          message: 'Unit number A-101 already exists',
        });
      });

      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(unitData)
        .expect(409);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid/units/:unitId', () => {
    it('should update unit successfully', async () => {
      const unitId = 'unit123';
      const updateData = {
        unitNumber: 'A-102',
        specifications: { bedrooms: 2, bathrooms: 1 },
      };
      const expectedResponse = {
        success: true,
        data: { ...updateData, _id: unitId },
        message: 'Unit updated successfully',
      };

      mockUnitController.updateUnit.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${unitId}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.updateUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle update validation errors', async () => {
      const unitId = 'unit123';
      const invalidUpdateData = {
        specifications: { bedrooms: -1 }, // Invalid negative bedrooms
      };

      mockUnitController.updateUnit.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Validation failed',
          errors: ['Bedrooms must be a positive number'],
        });
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${unitId}`)
        .send(invalidUpdateData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });

    it('should handle unit not found for update', async () => {
      const unitId = 'nonexistent';
      const updateData = { unitNumber: 'A-103' };

      mockUnitController.updateUnit.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'Unit not found',
        });
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${unitId}`)
        .send(updateData)
        .expect(404);

      expect(response.body.success).toBe(false);
    });
  });

  describe('PATCH /properties/:cid/client_properties/:pid/units/:unitId/status', () => {
    it('should update unit status successfully', async () => {
      const unitId = 'unit123';
      const statusData = { status: 'occupied', occupancyDate: new Date() };
      const expectedResponse = {
        success: true,
        data: { ...statusData, updatedAt: new Date() },
        message: 'Unit status updated successfully',
      };

      mockUnitController.updateUnitStatus.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${unitId}/status`)
        .send(statusData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.updateUnitStatus).toHaveBeenCalledTimes(1);
    });

    it('should handle invalid status values', async () => {
      const unitId = 'unit123';
      const statusData = { status: 'invalid_status' };

      mockUnitController.updateUnitStatus.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Invalid status value',
          validStatuses: ['available', 'occupied', 'maintenance', 'reserved'],
        });
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${unitId}/status`)
        .send(statusData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.validStatuses).toBeDefined();
    });

    it('should handle status transition restrictions', async () => {
      const unitId = 'unit123';
      const statusData = { status: 'available' };

      mockUnitController.updateUnitStatus.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Cannot change status from occupied to available without ending lease',
        });
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${unitId}/status`)
        .send(statusData)
        .expect(400);

      expect(response.body.success).toBe(false);
    });
  });

  describe('POST /properties/:cid/client_properties/:pid/units/:unitId/inspections', () => {
    it('should add inspection to unit successfully', async () => {
      const unitId = 'unit123';
      const inspectionData = {
        type: 'move_in',
        scheduledDate: new Date().toISOString(),
        inspector: 'inspector123',
        notes: 'Initial move-in inspection',
      };
      const expectedResponse = {
        success: true,
        data: { ...inspectionData, _id: 'inspection123' },
        message: 'Inspection scheduled successfully',
      };

      mockUnitController.addInspection.mockImplementation((req, res) => {
        res.status(201).json(expectedResponse);
      });

      const response = await request(app)
        .post(`/properties/client123/client_properties/property123/units/${unitId}/inspections`)
        .send(inspectionData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.addInspection).toHaveBeenCalledTimes(1);
    });

    it('should handle inspection scheduling conflicts', async () => {
      const unitId = 'unit123';
      const inspectionData = {
        type: 'routine',
        scheduledDate: new Date().toISOString(),
        inspector: 'inspector123',
      };

      mockUnitController.addInspection.mockImplementation((req, res) => {
        res.status(409).json({
          success: false,
          message: 'Inspector is not available at the requested time',
          suggestedTimes: ['2024-01-15T10:00:00Z', '2024-01-15T14:00:00Z'],
        });
      });

      const response = await request(app)
        .post(`/properties/client123/client_properties/property123/units/${unitId}/inspections`)
        .send(inspectionData)
        .expect(409);

      expect(response.body.success).toBe(false);
      expect(response.body.suggestedTimes).toBeDefined();
    });

    it('should handle invalid inspection data', async () => {
      const unitId = 'unit123';
      const invalidInspectionData = {
        type: 'invalid_type',
        scheduledDate: 'invalid_date',
      };

      mockUnitController.addInspection.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Invalid inspection data',
          errors: ['Invalid inspection type', 'Invalid date format'],
        });
      });

      const response = await request(app)
        .post(`/properties/client123/client_properties/property123/units/${unitId}/inspections`)
        .send(invalidInspectionData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.errors).toHaveLength(2);
    });
  });

  describe('DELETE /properties/:cid/client_properties/:pid/units/:unitId', () => {
    it('should archive unit successfully', async () => {
      const unitId = 'unit123';
      const expectedResponse = {
        success: true,
        message: 'Unit archived successfully',
        data: { archivedAt: new Date() },
      };

      mockUnitController.archiveUnit.mockImplementation((req, res) => {
        res.status(200).json(expectedResponse);
      });

      const response = await request(app)
        .delete(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.archiveUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle archive restrictions', async () => {
      const unitId = 'unit123';

      mockUnitController.archiveUnit.mockImplementation((req, res) => {
        res.status(400).json({
          success: false,
          message: 'Cannot archive unit with active lease',
          restrictions: ['Active lease ends on 2024-12-31', 'Pending inspection on 2024-01-15'],
        });
      });

      const response = await request(app)
        .delete(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.restrictions).toBeDefined();
    });

    it('should handle unit not found for archival', async () => {
      const unitId = 'nonexistent';

      mockUnitController.archiveUnit.mockImplementation((req, res) => {
        res.status(404).json({
          success: false,
          message: 'Unit not found',
        });
      });

      const response = await request(app)
        .delete(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(404);

      expect(response.body.success).toBe(false);
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

    it('should apply rate limiting to GET routes', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';

      await request(app).get(basePath);
      await request(app).get(`${basePath}/unit123`);

      expect(routeLimiter).toHaveBeenCalledTimes(2);
    });

    it('should apply file upload middleware to POST route', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';

      await request(app).post(basePath).send({});

      expect(diskUpload).toHaveBeenCalledWith(['unit.media']);
      expect(scanFile).toHaveBeenCalled();
    });

    it('should handle middleware errors gracefully', async () => {
      (scanFile as jest.Mock).mockImplementation((req, res, next) => {
        res.status(400).json({
          success: false,
          message: 'File scanning failed - malicious content detected',
        });
      });

      await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send({})
        .expect(400);

      expect(mockUnitController.createUnit).not.toHaveBeenCalled();
    });
  });

  describe('Route parameter handling', () => {
    it('should handle merged parameters from parent routes', async () => {
      // Test that the router correctly inherits cid and pid from parent route
      const mockResolve = jest.fn().mockReturnValue(mockUnitController);

      app.use((req, res, next) => {
        req.container = { resolve: mockResolve } as any;
        // Verify parameters are available
        expect(req.params.cid).toBe('client123');
        expect(req.params.pid).toBe('property123');
        next();
      });

      mockUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json({ success: true, data: [] });
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);
    });

    it('should handle unitId parameter correctly', async () => {
      const unitId = 'unit-456-xyz';

      mockUnitController.getUnit.mockImplementation((req, res) => {
        expect(req.params.unitId).toBe(unitId);
        res.status(200).json({ success: true, data: {} });
      });

      await request(app)
        .get(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(200);
    });

    it('should handle special characters in unitId', async () => {
      const unitId = 'unit-A@B-123';

      mockUnitController.getUnit.mockImplementation((req, res) => {
        expect(req.params.unitId).toBe(unitId);
        res.status(200).json({ success: true, data: {} });
      });

      await request(app)
        .get(
          `/properties/client123/client_properties/property123/units/${encodeURIComponent(unitId)}`
        )
        .expect(200);
    });
  });

  describe('Container resolution', () => {
    it('should resolve PropertyUnitController from container', async () => {
      const mockResolve = jest.fn().mockReturnValue(mockUnitController);

      app.use((req, res, next) => {
        req.container = { resolve: mockResolve } as any;
        req.params.cid = 'client123';
        req.params.pid = 'property123';
        next();
      });

      mockUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json({ success: true, data: [] });
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);

      expect(mockResolve).toHaveBeenCalledWith('unitController');
    });

    it('should handle container resolution failures', async () => {
      app.use((req, res, next) => {
        req.container = {
          resolve: jest.fn().mockImplementation(() => {
            throw new Error('PropertyUnitController not found in container');
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
      mockUnitController.getPropertyUnits.mockImplementation(() => {
        throw new Error('Database connection lost');
      });

      await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(500);
    });

    it('should handle malformed JSON requests', async () => {
      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send('invalid json string')
        .set('Content-Type', 'application/json')
        .expect(400);

      expect(response.body).toMatchObject({
        error: expect.any(String),
      });
    });

    it('should handle oversized payloads', async () => {
      const oversizedData = {
        description: 'x'.repeat(10000), // Very large description
        specifications: {},
      };

      mockUnitController.createUnit.mockImplementation((req, res) => {
        res.status(413).json({
          success: false,
          message: 'Payload too large',
        });
      });

      await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(oversizedData)
        .expect(413);
    });
  });

  describe('Integration scenarios', () => {
    it('should handle complete unit lifecycle', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';
      const unitData = PropertyTestFactory.createPropertyUnit();
      const unitId = 'unit123';

      // Create unit
      mockUnitController.createUnit.mockImplementation((req, res) => {
        res.status(201).json({
          success: true,
          data: { ...unitData, _id: unitId },
        });
      });

      await request(app).post(basePath).send(unitData).expect(201);

      // Update unit
      mockUnitController.updateUnit.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          data: { ...unitData, unitNumber: 'B-201' },
        });
      });

      await request(app).patch(`${basePath}/${unitId}`).send({ unitNumber: 'B-201' }).expect(200);

      // Add inspection
      mockUnitController.addInspection.mockImplementation((req, res) => {
        res.status(201).json({
          success: true,
          data: { _id: 'inspection123', type: 'routine' },
        });
      });

      await request(app)
        .post(`${basePath}/${unitId}/inspections`)
        .send({ type: 'routine', scheduledDate: new Date() })
        .expect(201);

      // Update status
      mockUnitController.updateUnitStatus.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          data: { status: 'occupied' },
        });
      });

      await request(app)
        .patch(`${basePath}/${unitId}/status`)
        .send({ status: 'occupied' })
        .expect(200);

      // Archive unit
      mockUnitController.archiveUnit.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          message: 'Unit archived',
        });
      });

      await request(app).delete(`${basePath}/${unitId}`).expect(200);

      // Verify all controller methods were called
      expect(mockUnitController.createUnit).toHaveBeenCalledTimes(1);
      expect(mockUnitController.updateUnit).toHaveBeenCalledTimes(1);
      expect(mockUnitController.addInspection).toHaveBeenCalledTimes(1);
      expect(mockUnitController.updateUnitStatus).toHaveBeenCalledTimes(1);
      expect(mockUnitController.archiveUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle bulk operations workflow', async () => {
      const basePath = '/properties/client123/client_properties/property123/units';

      // Get all units first
      mockUnitController.getPropertyUnits.mockImplementation((req, res) => {
        res.status(200).json({
          success: true,
          data: [
            PropertyTestFactory.createPropertyUnit({ unitNumber: 'A-101' }),
            PropertyTestFactory.createPropertyUnit({ unitNumber: 'A-102' }),
          ],
        });
      });

      await request(app).get(basePath).expect(200);

      // Create multiple units (simulated bulk creation)
      const unitPromises = ['A-103', 'A-104', 'A-105'].map((unitNumber) => {
        mockUnitController.createUnit.mockImplementation((req, res) => {
          res.status(201).json({
            success: true,
            data: PropertyTestFactory.createPropertyUnit({ unitNumber }),
          });
        });

        return request(app)
          .post(basePath)
          .send(PropertyTestFactory.createPropertyUnit({ unitNumber }))
          .expect(201);
      });

      await Promise.all(unitPromises);

      expect(mockUnitController.createUnit).toHaveBeenCalledTimes(3);
    });
  });

  describe('Route documentation and comments', () => {
    it('should handle routes with disabled validation gracefully', async () => {
      // The routes have commented-out validation due to schema issues
      // This test ensures the routes still work without validation
      const unitData = PropertyTestFactory.createPropertyUnit();

      mockUnitController.createUnit.mockImplementation((req, res) => {
        res.status(201).json({
          success: true,
          data: unitData,
        });
      });

      // Should work even without validation middleware
      await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(unitData)
        .expect(201);

      expect(mockUnitController.createUnit).toHaveBeenCalledTimes(1);
    });
  });
});
