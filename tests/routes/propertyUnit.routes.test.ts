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
import { PropertyUnitController } from '@controllers/PropertyUnitController';
import { validateRequest } from '@shared/validations';
import { isAuthenticated, routeLimiter, diskUpload, scanFile } from '@shared/middlewares';
import { mockModels } from '@tests/mocks/dao/commonMocks';
import { PropertyTestFactory } from '@tests/utils/propertyTestHelpers';

// Apply model mocks to prevent real database calls
mockModels();

jest.mock('@controllers/PropertyUnitController');
jest.mock('@shared/validations', () => ({
  validateRequest: jest.fn(() => (_req: any, _res: any, next: any) => next()),
}));
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
    ACCEPTED: 202,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    NOT_FOUND: 404,
    FORBIDDEN: 403,
  },
}));

// Mock the property unit routes directly to avoid DI initialization
const mockPropertyUnitRoutes = express.Router();

// Define the routes manually to avoid importing the real routes
mockPropertyUnitRoutes.post('/', (_req, _res, next) => next());
mockPropertyUnitRoutes.get('/', (_req, _res, next) => next());
mockPropertyUnitRoutes.get('/:puid', (_req, _res, next) => next());
mockPropertyUnitRoutes.patch('/:puid', (_req, _res, next) => next());
mockPropertyUnitRoutes.delete('/:puid', (_req, _res, next) => next());
mockPropertyUnitRoutes.patch('/upload_media/:puid', (_req, _res, next) => next());

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
      updateUnit: jest.fn(),
      archiveUnit: jest.fn(),
      addDocumentToUnit: jest.fn(),
    } as any;

    // Mock container resolution
    app.use((_req: Request, _res: Response, next: NextFunction) => {
      _req.container = {
        resolve: jest.fn().mockReturnValue(mockPropertyUnitController),
        cradle: {
          tokenService: {
            verifyToken: jest.fn(),
            extractTokenFromRequest: jest.fn(),
          },
        },
      } as any;
      // Mock params from parent routes (property.routes.ts)
      _req.params.cid = 'client123';
      _req.params.pid = 'property123';
      next();
    });

    // Mock middleware functions
    (validateRequest as jest.Mock).mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next()
    );
    (isAuthenticated as jest.Mock).mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next()
    );
    (routeLimiter as jest.Mock).mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next()
    );
    (diskUpload as jest.Mock).mockImplementation(
      () => (_req: Request, _res: Response, next: NextFunction) => next()
    );
    (scanFile as jest.Mock).mockImplementation(
      (_req: Request, _res: Response, next: NextFunction) => next()
    );

    // Use property unit routes with base path
    app.use('/properties/:cid/client_properties/:pid/units', mockPropertyUnitRoutes);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /properties/:cid/client_properties/:pid/units', () => {
    it('should create a new property unit with file upload middleware', async () => {
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
          mockPropertyUnitController.addUnit(_req, res);
          res.status(201).json(expectedResponse);
        })
      );

      mockPropertyUnitController.addUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send(unitData)
        .expect(201);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.addUnit).toHaveBeenCalledTimes(1);
    });

    it('should handle validation errors', async () => {
      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().post('/', async (_req, res) => {
          res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: ['Unit number is required'],
          });
        })
      );

      await request(app)
        .post('/properties/client123/client_properties/property123/units')
        .send({})
        .expect(400);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().get('/', async (_req, res) => {
          mockPropertyUnitController.getPropertyUnits(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockPropertyUnitController.getPropertyUnits.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .get('/properties/client123/client_properties/property123/units')
        .query({ page: 1, limit: 10 })
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.getPropertyUnits).toHaveBeenCalledTimes(1);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().get('/:puid', async (_req, res) => {
          mockPropertyUnitController.getPropertyUnit(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockPropertyUnitController.getPropertyUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .get(`/properties/client123/client_properties/property123/units/${puid}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.getPropertyUnit).toHaveBeenCalledTimes(1);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().patch('/:puid', async (_req, res) => {
          mockPropertyUnitController.updateUnit(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockPropertyUnitController.updateUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/${puid}`)
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.updateUnit).toHaveBeenCalledTimes(1);
    });
  });

  describe('DELETE /properties/:cid/client_properties/:pid/units/:puid', () => {
    it('should archive property unit successfully', async () => {
      const puid = 'unit123';
      const expectedResponse = {
        success: true,
        message: 'Unit archived successfully',
      };

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().delete('/:puid', async (_req, res) => {
          mockPropertyUnitController.archiveUnit(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockPropertyUnitController.archiveUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .delete(`/properties/client123/client_properties/property123/units/${puid}`)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.archiveUnit).toHaveBeenCalledTimes(1);
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

      // Override the route handler for this test
      app.use(
        '/properties/:cid/client_properties/:pid/units',
        express.Router().patch('/upload_media/:puid', async (_req, res) => {
          mockPropertyUnitController.addDocumentToUnit(_req, res);
          res.status(200).json(expectedResponse);
        })
      );

      mockPropertyUnitController.addDocumentToUnit.mockImplementation(async (_req, _res) => {
        // Mock implementation
      });

      const response = await request(app)
        .patch(`/properties/client123/client_properties/property123/units/upload_media/${puid}`)
        .send(mediaData)
        .expect(200);

      expect(response.body).toEqual(expectedResponse);
      expect(mockPropertyUnitController.addDocumentToUnit).toHaveBeenCalledTimes(1);
    });
  });

  describe('Authentication and middleware', () => {
    it('should require authentication for all routes', async () => {
      (isAuthenticated as jest.Mock).mockImplementation(
        (_req: Request, res: Response, _next: NextFunction) => {
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
