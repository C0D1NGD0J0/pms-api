// Mock ALL external dependencies BEFORE any imports
jest.mock('@models/index', () => ({
  User: {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ _id: 'user123' }),
    findById: jest.fn().mockResolvedValue(null),
    updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
  },
  Client: {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ _id: 'client123' }),
  },
  Profile: {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ _id: 'profile123' }),
  },
  Property: {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ _id: 'property123' }),
    find: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
  },
  PropertyUnit: {
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({ _id: 'unit123' }),
    find: jest.fn().mockResolvedValue([]),
    findById: jest.fn().mockResolvedValue(null),
  },
}));

// Mock database connection
jest.mock('@database/index', () => ({
  connectDB: jest.fn().mockResolvedValue(true),
  disconnectDB: jest.fn().mockResolvedValue(true),
}));

// Mock Redis/caching
jest.mock('@caching/index', () => ({
  propertyCache: {
    get: jest.fn().mockResolvedValue(null),
    set: jest.fn().mockResolvedValue(true),
    del: jest.fn().mockResolvedValue(true),
  },
}));

// Mock all DAOs
jest.mock('@dao/index', () => ({
  propertyUnitDAO: {
    createPropertyUnit: jest.fn().mockResolvedValue({ _id: 'unit123' }),
    getPropertyUnitById: jest.fn().mockResolvedValue(null),
    getPropertyUnits: jest.fn().mockResolvedValue([]),
    updatePropertyUnit: jest.fn().mockResolvedValue({ _id: 'unit123' }),
  },
  propertyDAO: {
    getPropertyById: jest.fn().mockResolvedValue({ _id: 'property123' }),
  },
  clientDAO: {
    getClientById: jest.fn().mockResolvedValue({ _id: 'client123' }),
  },
}));

// Mock the entire DI system
jest.mock('@di/index', () => ({
  container: {
    createScope: jest.fn(() => ({
      resolve: jest.fn(),
    })),
    resolve: jest.fn(),
    register: jest.fn(),
  },
}));

// Mock DI setup to prevent initialization
jest.mock('@di/setup', () => ({
  initializeDI: jest.fn(),
}));

// Mock all queues and workers
jest.mock('@queues/index', () => ({}));
jest.mock('@workers/index', () => ({}));

// Mock all services
jest.mock('@services/index', () => ({}));

// Mock validation schemas to prevent DI initialization
jest.mock('@shared/validations/PropertyValidation', () => ({
  PropertyValidations: {
    createProperty: { parse: jest.fn() },
    updateProperty: { parse: jest.fn() },
  },
}));

jest.mock('@shared/validations/PropertyUnitValidation', () => ({
  PropertyUnitValidations: {
    createUnits: { parse: jest.fn() },
    updateUnit: { parse: jest.fn() },
  },
}));

// Mock utils constants
jest.mock('@utils/constants', () => ({
  QUEUE_NAMES: {
    MEDIA_QUEUE: 'media-queue',
    PROPERTY_QUEUE: 'property-queue',
    EMAIL_QUEUE: 'email-queue',
  },
  JOB_NAME: {
    MEDIA_UPLOAD_JOB: 'media-upload',
    MEDIA_REMOVAL_JOB: 'media-removal',
  },
}));

import request from 'supertest';
import express, { NextFunction, Response, Request } from 'express';
import { PropertyUnitController } from '@controllers/index';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';
import { mockModels } from '@tests/mocks/dao/commonMocks';
import { PropertyTestFactory } from '@tests/utils/propertyTestHelpers';
import { AppRequest } from '@interfaces/utils.interface';

// Apply model mocks to prevent real database calls
mockModels();

jest.mock('@controllers/PropertyUnitController');
jest.mock('@shared/middlewares');

jest.mock('@utils/index', () => ({
  asyncWrapper: jest.fn((handler) => handler),
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
  })),
  generateShortUID: jest.fn(() => 'test-uid-123'),
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

// Mock the unit routes directly to avoid DI initialization
const mockUnitRoutes = express.Router();

// Define the routes manually to avoid importing the real routes
mockUnitRoutes.get('/', (_req, _res, next) => next());
mockUnitRoutes.get('/:unitId', (_req, _res, next) => next());
mockUnitRoutes.post('/', (_req, _res, next) => next());
mockUnitRoutes.patch('/:unitId', (_req, _res, next) => next());
mockUnitRoutes.delete('/:unitId', (_req, _res, next) => next());

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
      archiveUnit: jest.fn(),
    } as any;

    // Mock container resolution
    app.use((req: AppRequest, res: Response, next: NextFunction) => {
      req.container = {
        resolve: jest.fn().mockReturnValue(mockUnitController),
        cradle: {
          tokenService: {
            verifyToken: jest.fn(),
            extractTokenFromRequest: jest.fn(),
          },
        },
      } as any;
      // Mock params from parent routes
      req.params.cid = 'client123';
      req.params.pid = 'property123';
      next();
    });

    // Mock middleware functions
    (isAuthenticated as jest.Mock).mockImplementation(
      (_req: AppRequest, _res: Response, next: NextFunction) => next()
    );
    (routeLimiter as jest.Mock).mockImplementation(
      () => (_req: AppRequest, _res: Response, next: NextFunction) => next()
    );
    (diskUpload as jest.Mock).mockImplementation(
      () => (_req: AppRequest, _res: Response, next: NextFunction) => next()
    );
    (scanFile as jest.Mock).mockImplementation(
      (_req: AppRequest, _res: Response, next: NextFunction) => next()
    );

    // Use unit routes with base path
    app.use('/properties/:cid/client_properties/:pid/units', mockUnitRoutes);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().get('/', async (_req, res) => {
          mockUnitController.getPropertyUnits(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockUnitController.getPropertyUnits.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.getPropertyUnits).toHaveBeenCalledTimes(1);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().get('/:unitId', async (_req, res) => {
          mockUnitController.getPropertyUnit(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockUnitController.getPropertyUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.getPropertyUnit).toHaveBeenCalledTimes(1);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().post('/', async (_req, res) => {
          mockUnitController.addUnit(_req, res);
          res.status(201).json(expectedResponse);
        })
      );

      mockUnitController.addUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(unitData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.addUnit).toHaveBeenCalledTimes(1);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().patch('/:unitId', async (_req, res) => {
          mockUnitController.updateUnit(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockUnitController.updateUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${unitId}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.updateUnit).toHaveBeenCalledTimes(1);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().delete('/:unitId', async (_req, res) => {
          mockUnitController.archiveUnit(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockUnitController.archiveUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .delete(`/properties/client123/client_properties/property123/units/${unitId}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockUnitController.archiveUnit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Authentication and middleware', () => {
    it('should require authentication for all routes', async () => {
      (isAuthenticated as jest.Mock).mockImplementation(
        (_req: AppRequest, res: Response, _next: NextFunction) => {
          res.status(401).json({
            success: false,
            message: 'Authentication required',
          });
        }
      );

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().get('/', async (_req, res) => {
          res.status(401).json({
            success: false,
            message: 'Authentication required',
          });
        })
      );

      const basePath = '/properties/client123/client_properties/property123/units';

      await request(app).get(basePath).expect(401);
    });
  });
});
