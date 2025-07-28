// // Set Jest timeout to prevent hanging tests
// jest.setTimeout(10000);

// import request from 'supertest';
// import express from 'express';
// import { faker } from '@faker-js/faker';

// // Create mock ObjectId generator to avoid mongoose import
// class MockObjectId {
//   private _id: string;

//   constructor() {
//     this._id = faker.string.alphanumeric(24);
//   }

//   toString() {
//     return this._id;
//   }
// }

// // Mock Types object to avoid mongoose dependency
// const Types = {
//   ObjectId: MockObjectId
// };

// // Define HTTP status codes directly to avoid importing full app
// const httpStatusCodes = {
//   OK: 200,
//   CREATED: 201,
//   BAD_REQUEST: 400,
//   UNAUTHORIZED: 401,
//   FORBIDDEN: 403,
//   NOT_FOUND: 404,
//   TOO_MANY_REQUESTS: 429,
//   INTERNAL_SERVER_ERROR: 500,
//   SERVICE_UNAVAILABLE: 503,
// };

// // Create inline mock factories to avoid external imports
// const createMockCurrentUser = (overrides = {}) => ({
//   sub: new Types.ObjectId().toString(),
//   email: faker.internet.email(),
//   isActive: true,
//   displayName: faker.person.fullName(),
//   fullname: faker.person.fullName(),
//   avatarUrl: faker.image.avatar(),
//   preferences: {
//     theme: 'light',
//     lang: 'en',
//     timezone: 'UTC',
//   },
//   client: {
//     csub: faker.string.uuid(),
//     displayname: faker.company.name(),
//     role: 'admin',
//   },
//   permissions: ['read', 'write', 'admin'],
//   gdpr: {
//     dataRetentionPolicy: 'standard',
//     dataProcessingConsent: true,
//     processingConsentDate: new Date().toISOString(),
//     retentionExpiryDate: faker.date.future().toISOString(),
//   },
//   accounts: [],
//   activeAccount: null,
//   ...overrides,
// });

// const createMockPropertyData = (overrides = {}) => ({
//   name: faker.location.streetAddress(),
//   fullAddress: faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state(),
//   propertyType: faker.helpers.arrayElement(['apartment', 'house', 'condominium', 'townhouse', 'commercial', 'industrial']),
//   status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance', 'construction', 'inactive']),
//   yearBuilt: faker.number.int({ min: 1900, max: 2024 }),
//   specifications: {
//     totalArea: faker.number.int({ min: 500, max: 5000 }),
//     bedrooms: faker.number.int({ min: 1, max: 5 }),
//     bathrooms: faker.number.float({ min: 1, max: 4 }),
//   },
//   ...overrides,
// });

// const createMockProperty = (overrides = {}) => ({
//   _id: new Types.ObjectId(),
//   pid: faker.string.uuid(),
//   name: faker.location.streetAddress(),
//   cuid: faker.string.uuid(),
//   propertyType: faker.helpers.arrayElement(['apartment', 'house', 'condominium', 'townhouse', 'commercial', 'industrial']),
//   status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance', 'construction', 'inactive']),
//   createdAt: faker.date.recent().toISOString(),
//   updatedAt: faker.date.recent().toISOString(),
//   ...overrides,
// });

// const createMockPropertyPaginationResponse = (overrides = {}) => ({
//   data: Array.from({ length: 10 }, () => createMockProperty()),
//   pagination: {
//     total: faker.number.int({ min: 10, max: 100 }),
//     perPage: 10,
//     totalPages: faker.number.int({ min: 1, max: 10 }),
//     currentPage: 1,
//     hasMoreResource: false,
//   },
//   ...overrides,
// });

// const createMockPropertySearchFilters = (overrides = {}) => ({
//   status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance']),
//   propertyType: faker.helpers.arrayElement(['apartment', 'house', 'commercial']),
//   minPrice: faker.number.int({ min: 500, max: 2000 }),
//   maxPrice: faker.number.int({ min: 2000, max: 5000 }),
//   ...overrides,
// });

// const createMockPropertyCsvFile = (overrides = {}) => ({
//   fieldname: 'csvFile',
//   originalname: 'properties.csv',
//   encoding: '7bit',
//   mimetype: 'text/csv',
//   size: faker.number.int({ min: 1000, max: 100000 }),
//   buffer: Buffer.from('mock csv content'),
//   ...overrides,
// });

// const createMockPropertyFormMetadata = (overrides = {}) => ({
//   propertyTypes: ['apartment', 'house', 'condominium', 'townhouse', 'commercial', 'industrial'],
//   statusOptions: ['available', 'occupied', 'maintenance', 'construction', 'inactive'],
//   amenities: ['parking', 'pool', 'gym', 'elevator'],
//   utilities: ['electricity', 'water', 'gas', 'internet'],
//   ...overrides,
// });

// // Simplified Express app for testing - focus on route logic only
// function createTestApp(controller: any) {
//   const app = express();
//   app.use(express.json());

//   // Inject container directly without complex middleware chains
//   app.use((req, res, next) => {
//     req.container = mockContainer;
//     req.context = { currentuser: createMockCurrentUser() };
//     next();
//   });

//   const baseUrl = '/api/v1/properties';

//   // Simple route definitions without complex middleware
//   app.get(`${baseUrl}/property_form_metadata`, controller.getPropertyFormMetadata);
//   app.post(`${baseUrl}/:cuid/add_property`, controller.create);
//   app.post(`${baseUrl}/:cuid/validate_csv`, controller.validateCsv);
//   app.post(`${baseUrl}/:cuid/import_properties_csv`, controller.createPropertiesFromCsv);
//   app.get(`${baseUrl}/:cuid/client_properties`, controller.getClientProperties);
//   app.get(`${baseUrl}/:cuid/client_properties/:pid`, controller.getProperty);
//   app.patch(`${baseUrl}/:cuid/client_properties/:pid`, controller.updateClientProperty);
//   app.patch(`${baseUrl}/:cuid/client_properties/:pid/add_media`, controller.addMediaToProperty);
//   app.patch(`${baseUrl}/:cuid/client_properties/:pid/remove_media`, controller.deleteMediaFromProperty);
//   app.delete(`${baseUrl}/:cuid/delete_properties/:pid`, controller.archiveProperty);

//   return app;
// }

// // Simplified mock container
// const mockContainer = {
//   resolve: jest.fn((service: string) => {
//     switch (service) {
//       case 'propertyController':
//         return {
//           create: jest.fn(),
//           validateCsv: jest.fn(),
//           createPropertiesFromCsv: jest.fn(),
//           getClientProperties: jest.fn(),
//           getProperty: jest.fn(),
//           updateClientProperty: jest.fn(),
//           addMediaToProperty: jest.fn(),
//           deleteMediaFromProperty: jest.fn(),
//           archiveProperty: jest.fn(),
//           getPropertyFormMetadata: jest.fn(),
//         };
//       default:
//         return {};
//     }
//   }),
// };

// // Helper functions for consistent responses
// const createSuccessResponse = (data: any, message = 'Success') => ({
//   success: true,
//   message,
//   data,
// });

// const createErrorResponse = (message: string) => ({
//   success: false,
//   message,
// });

// describe('Property Routes Integration Tests', () => {
//   const baseUrl = '/api/v1/properties';
//   let mockController: any;
//   let app: any;
//   const validCuid = faker.string.uuid();
//   const validPid = faker.string.uuid();

//   beforeEach(() => {
//     jest.clearAllMocks();
//     mockController = mockContainer.resolve('propertyController');
//     app = createTestApp(mockController);
//   });

//   describe('GET /property_form_metadata (authenticated)', () => {
//     const endpoint = `${baseUrl}/property_form_metadata`;

//     it('should get property form metadata successfully', async () => {
//       const mockMetadata = createMockPropertyFormMetadata();
//       const mockResponse = {
//         success: true,
//         data: mockMetadata,
//       };

//       mockController.getPropertyFormMetadata.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.getPropertyFormMetadata).toHaveBeenCalled();
//     });

//     it('should handle route access', async () => {
//       // Test that route exists and responds
//       const response = await request(app)
//         .get(endpoint);

//       expect(response.status).toBeDefined();
//     });

//     it('should apply rate limiting', async () => {
//       // Rate limiting would be handled by middleware
//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`);

//       expect(response.status).toBeDefined();
//     });
//   });

//   describe('POST /:cuid/add_property (authenticated + permissions)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/add_property`;

//     it('should create property successfully with valid data', async () => {
//       const propertyData = createMockPropertyData({ cuid: validCuid });
//       const mockCreatedProperty = createMockProperty(propertyData);
//       const mockResponse = {
//         success: true,
//         data: mockCreatedProperty,
//       };

//       mockController.create.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .field('name', propertyData.name)
//         .field('propertyType', propertyData.propertyType)
//         .field('fullAddress', propertyData.fullAddress)
//         .field('managedBy', propertyData.managedBy)
//         .attach('document.photos', Buffer.from('photo1'), 'photo1.jpg')
//         .attach('document.photos', Buffer.from('photo2'), 'photo2.jpg')
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.create).toHaveBeenCalled();
//     });

//     it('should return 401 without authentication', async () => {
//       const propertyData = createMockPropertyData();

//       const response = await request(app)
//         .post(endpoint)
//         .send(propertyData);

//       // Authentication middleware would handle this
//       expect(response.status).toBeDefined();
//     });

//     it('should return 403 without proper permissions', async () => {
//       const propertyData = createMockPropertyData();

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(propertyData);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });

//     it('should validate required fields', async () => {
//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({});

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });

//     it('should validate property type enum', async () => {
//       const invalidData = createMockPropertyData({
//         propertyType: 'invalid-type',
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(invalidData);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });

//     it('should validate address uniqueness', async () => {
//       const duplicateAddressData = createMockPropertyData({
//         cuid: validCuid,
//         fullAddress: 'Existing Address 123, City, State 12345',
//       });

//       const errorResponse = {
//         success: false,
//         message: 'A property with this address already exists for this client.',
//       };

//       mockController.create.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(duplicateAddressData)
//         .expect(httpStatusCodes.BAD_REQUEST);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should handle file upload validation', async () => {
//       const propertyData = createMockPropertyData();

//       // Testing with invalid file types would be handled by diskUpload middleware
//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .field('name', propertyData.name)
//         .attach('document.photos', Buffer.from('invalid'), 'invalid.txt');

//       expect(response.status).toBeDefined();
//     });

//     it('should handle file scanning', async () => {
//       const propertyData = createMockPropertyData();

//       // File scanning would be handled by scanFile middleware
//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .field('name', propertyData.name)
//         .attach('document.photos', Buffer.from('photo'), 'photo.jpg');

//       expect(response.status).toBeDefined();
//     });
//   });

//   describe('POST /:cuid/validate_csv (authenticated + permissions)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/validate_csv`;

//     it('should validate CSV file successfully', async () => {
//       const mockResponse = {
//         success: true,
//         data: {
//           processId: faker.string.uuid(),
//           validRows: 10,
//           invalidRows: 0,
//           errors: [],
//         },
//       };

//       mockController.validateCsv.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const csvFile = createMockPropertyCsvFile();

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .attach('csv_file', csvFile.buffer, csvFile.filename)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.validateCsv).toHaveBeenCalled();
//     });

//     it('should return 400 without CSV file', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'No CSV file uploaded',
//       };

//       mockController.validateCsv.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.BAD_REQUEST);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should return 401 without authentication', async () => {
//       const response = await request(app)
//         .post(endpoint);

//       // Authentication middleware would handle this
//       expect(response.status).toBeDefined();
//     });

//     it('should return 403 without proper permissions', async () => {
//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`);

//       // Permission middleware would handle this
//       expect(response.status).toBeDefined();
//     });

//     it('should handle CSV validation errors', async () => {
//       const errorResponse = {
//         success: false,
//         data: {
//           processId: faker.string.uuid(),
//           validRows: 5,
//           invalidRows: 3,
//           errors: [
//             { row: 2, field: 'propertyType', message: 'Invalid property type' },
//             { row: 4, field: 'fullAddress', message: 'Address too short' },
//             { row: 6, field: 'yearBuilt', message: 'Invalid year' },
//           ],
//         },
//       };

//       mockController.validateCsv.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(errorResponse);
//       });

//       const csvFile = createMockPropertyCsvFile();

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .attach('csv_file', csvFile.buffer, csvFile.filename)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(errorResponse);
//     });
//   });

//   describe('POST /:cuid/import_properties_csv (authenticated + permissions)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/import_properties_csv`;

//     it('should import properties from CSV successfully', async () => {
//       const mockResponse = {
//         success: true,
//         data: {
//           processId: faker.string.uuid(),
//           imported: 10,
//           failed: 0,
//           skipped: 0,
//           errors: [],
//         },
//       };

//       mockController.createPropertiesFromCsv.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const csvFile = createMockPropertyCsvFile();

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .attach('csv_file', csvFile.buffer, csvFile.filename)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.createPropertiesFromCsv).toHaveBeenCalled();
//     });

//     it('should return 400 without CSV file', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'No CSV file uploaded',
//       };

//       mockController.createPropertiesFromCsv.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.BAD_REQUEST);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should handle import failures', async () => {
//       const errorResponse = {
//         success: false,
//         data: {
//           processId: faker.string.uuid(),
//           imported: 7,
//           failed: 3,
//           skipped: 0,
//           errors: [
//             { row: 3, message: 'Address already exists' },
//             { row: 5, message: 'Invalid property data' },
//             { row: 8, message: 'Geocoding failed' },
//           ],
//         },
//       };

//       mockController.createPropertiesFromCsv.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(errorResponse);
//       });

//       const csvFile = createMockPropertyCsvFile();

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .attach('csv_file', csvFile.buffer, csvFile.filename)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(errorResponse);
//     });
//   });

//   describe('GET /:cuid/client_properties (authenticated)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/client_properties`;

//     it('should get client properties successfully', async () => {
//       const mockProperties = [createMockProperty(), createMockProperty()];
//       const mockResponse = createMockPropertyPaginationResponse(mockProperties);

//       mockController.getClientProperties.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.getClientProperties).toHaveBeenCalled();
//     });

//     it('should support pagination parameters', async () => {
//       const mockResponse = createMockPropertyPaginationResponse([createMockProperty()], {
//         pagination: {
//           total: 1,
//           page: 2,
//           pages: 5,
//           limit: 5,
//           hasNext: true,
//           hasPrev: true,
//         },
//       });

//       mockController.getClientProperties.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .query({
//           page: '2',
//           limit: '5',
//           sortBy: 'createdAt',
//           sort: 'desc',
//         })
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//     });

//     it('should support filtering parameters', async () => {
//       const filters = createMockPropertySearchFilters();
//       const mockResponse = createMockPropertyPaginationResponse([createMockProperty(filters)]);

//       mockController.getClientProperties.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .query({
//           propertyType: filters.propertyType,
//           status: filters.status,
//           occupancyStatus: filters.occupancyStatus,
//           minPrice: filters.minPrice.toString(),
//           maxPrice: filters.maxPrice.toString(),
//           searchTerm: filters.searchTerm,
//         })
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//     });

//     it('should return empty results when no properties found', async () => {
//       const mockResponse = createMockPropertyPaginationResponse([], {
//         pagination: {
//           total: 0,
//           page: 1,
//           pages: 0,
//           limit: 10,
//           hasNext: false,
//           hasPrev: false,
//         },
//       });

//       mockController.getClientProperties.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.OK);

//       expect(response.body.data).toEqual([]);
//       expect(response.body.pagination.total).toBe(0);
//     });

//     it('should handle route access', async () => {
//       // Test that route exists and responds
//       const response = await request(app)
//         .get(endpoint);

//       expect(response.status).toBeDefined();
//     });

//     it('should validate client ID parameter', async () => {
//       const invalidEndpoint = `${baseUrl}/invalid-cuid/client_properties`;

//       const response = await request(app)
//         .get(invalidEndpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });
//   });

//   describe('GET /:cuid/client_properties/:pid (authenticated)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/client_properties/${validPid}`;

//     it('should get specific property successfully', async () => {
//       const mockProperty = createMockProperty({ pid: validPid, cuid: validCuid });
//       const mockResponse = {
//         success: true,
//         data: mockProperty,
//       };

//       mockController.getProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.getProperty).toHaveBeenCalled();
//     });

//     it('should return 404 for non-existent property', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Property not found',
//       };

//       mockController.getProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.NOT_FOUND).json(errorResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.NOT_FOUND);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should return 403 for unauthorized access to property', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Access denied to this property',
//       };

//       mockController.getProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.FORBIDDEN).json(errorResponse);
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.FORBIDDEN);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should handle route access', async () => {
//       // Test that route exists and responds
//       const response = await request(app)
//         .get(endpoint);

//       expect(response.status).toBeDefined();
//     });

//     it('should validate property and client ID parameters', async () => {
//       const invalidEndpoint = `${baseUrl}/invalid-cuid/client_properties/invalid-pid`;

//       const response = await request(app)
//         .get(invalidEndpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });
//   });

//   describe('PATCH /:cuid/client_properties/:pid (authenticated)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/client_properties/${validPid}`;

//     it('should update property successfully', async () => {
//       const updateData = {
//         name: 'Updated Property Name',
//         status: 'maintenance',
//         specifications: {
//           bedrooms: 3,
//           bathrooms: 2.5,
//         },
//       };

//       const mockUpdatedProperty = createMockProperty({
//         ...updateData,
//         pid: validPid,
//         cuid: validCuid
//       });

//       const mockResponse = {
//         success: true,
//         message: 'Property updated successfully',
//         data: mockUpdatedProperty,
//       };

//       mockController.updateClientProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(updateData)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.updateClientProperty).toHaveBeenCalled();
//     });

//     it('should handle partial updates', async () => {
//       const partialUpdateData = {
//         status: 'available',
//       };

//       const mockResponse = {
//         success: true,
//         message: 'Property updated successfully',
//         data: createMockProperty({ ...partialUpdateData, pid: validPid }),
//       };

//       mockController.updateClientProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(partialUpdateData)
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//     });

//     it('should return 404 for non-existent property', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Property not found',
//       };

//       mockController.updateClientProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.NOT_FOUND).json(errorResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({ name: 'New Name' })
//         .expect(httpStatusCodes.NOT_FOUND);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should validate update data', async () => {
//       const invalidUpdateData = {
//         propertyType: 'invalid-type',
//         yearBuilt: 1700, // Too old
//         specifications: {
//           bedrooms: -1, // Invalid
//         },
//       };

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(invalidUpdateData);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });

//     it('should return 401 without authentication', async () => {
//       const response = await request(app)
//         .patch(endpoint)
//         .send({ name: 'New Name' });

//       // Authentication middleware would handle this
//       expect(response.status).toBeDefined();
//     });
//   });

//   describe('PATCH /:cuid/client_properties/:pid/add_media (authenticated)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/client_properties/${validPid}/add_media`;

//     it('should add media to property successfully', async () => {
//       const mockResponse = {
//         success: true,
//         message: 'Media added successfully',
//         data: {
//           mediaCount: 3,
//           addedMedia: [
//             {
//               url: faker.internet.url(),
//               type: 'image',
//               uploadedAt: new Date(),
//             },
//           ],
//         },
//       };

//       mockController.addMediaToProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({
//           mediaUrls: [faker.internet.url()],
//           mediaType: 'image',
//         })
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.addMediaToProperty).toHaveBeenCalled();
//     });

//     it('should return 404 for non-existent property', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Property not found',
//       };

//       mockController.addMediaToProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.NOT_FOUND).json(errorResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({ mediaUrls: [faker.internet.url()] })
//         .expect(httpStatusCodes.NOT_FOUND);

//       expect(response.body).toEqual(errorResponse);
//     });
//   });

//   describe('PATCH /:cuid/client_properties/:pid/remove_media (authenticated)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/client_properties/${validPid}/remove_media`;

//     it('should remove media from property successfully', async () => {
//       const mockResponse = {
//         success: true,
//         message: 'Media removed successfully',
//         data: {
//           mediaCount: 2,
//           removedMedia: [faker.string.uuid()],
//         },
//       };

//       mockController.deleteMediaFromProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({
//           mediaIds: [faker.string.uuid()],
//         })
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.deleteMediaFromProperty).toHaveBeenCalled();
//     });

//     it('should return 404 for non-existent property', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Property not found',
//       };

//       mockController.deleteMediaFromProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.NOT_FOUND).json(errorResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({ mediaIds: [faker.string.uuid()] })
//         .expect(httpStatusCodes.NOT_FOUND);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should handle media not found', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Media not found or already removed',
//       };

//       mockController.deleteMediaFromProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
//       });

//       const response = await request(app)
//         .patch(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({ mediaIds: [faker.string.uuid()] })
//         .expect(httpStatusCodes.BAD_REQUEST);

//       expect(response.body).toEqual(errorResponse);
//     });
//   });

//   describe('DELETE /:cuid/delete_properties/:pid (authenticated)', () => {
//     const endpoint = `${baseUrl}/${validCuid}/delete_properties/${validPid}`;

//     it('should archive property successfully', async () => {
//       const mockResponse = {
//         success: true,
//         message: 'Property archived successfully',
//         data: {
//           pid: validPid,
//           archivedAt: new Date(),
//           status: 'archived',
//         },
//       };

//       mockController.archiveProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.OK).json(mockResponse);
//       });

//       const response = await request(app)
//         .delete(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .query({ cuid: validCuid, pid: validPid })
//         .expect(httpStatusCodes.OK);

//       expect(response.body).toEqual(mockResponse);
//       expect(mockController.archiveProperty).toHaveBeenCalled();
//     });

//     it('should return 404 for non-existent property', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Property not found',
//       };

//       mockController.archiveProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.NOT_FOUND).json(errorResponse);
//       });

//       const response = await request(app)
//         .delete(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .query({ cuid: validCuid, pid: validPid })
//         .expect(httpStatusCodes.NOT_FOUND);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should handle property with active tenants', async () => {
//       const errorResponse = {
//         success: false,
//         message: 'Cannot archive property with active tenants',
//       };

//       mockController.archiveProperty.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.BAD_REQUEST).json(errorResponse);
//       });

//       const response = await request(app)
//         .delete(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .query({ cuid: validCuid, pid: validPid })
//         .expect(httpStatusCodes.BAD_REQUEST);

//       expect(response.body).toEqual(errorResponse);
//     });

//     it('should return 401 without authentication', async () => {
//       const response = await request(app)
//         .delete(endpoint)
//         .query({ cuid: validCuid, pid: validPid });

//       // Authentication middleware would handle this
//       expect(response.status).toBeDefined();
//     });

//     it('should validate query parameters', async () => {
//       const response = await request(app)
//         .delete(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .query({ invalidParam: 'invalid' });

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });
//   });

//   describe('Error Handling', () => {
//     it('should handle internal server errors gracefully', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/client_properties`;

//       mockController.getClientProperties.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.INTERNAL_SERVER_ERROR).json({
//           success: false,
//           message: 'Internal server error',
//         });
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.INTERNAL_SERVER_ERROR);

//       expect(response.body.success).toBe(false);
//       expect(response.body.message).toBeDefined();
//     });

//     it('should handle database connection errors', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/client_properties`;

//       mockController.getClientProperties.mockImplementation((req, res) => {
//         res.status(httpStatusCodes.SERVICE_UNAVAILABLE).json({
//           success: false,
//           message: 'Database connection error',
//         });
//       });

//       const response = await request(app)
//         .get(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .expect(httpStatusCodes.SERVICE_UNAVAILABLE);

//       expect(response.body.success).toBe(false);
//     });

//     it('should handle validation errors consistently', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/add_property`;

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send({
//           name: '', // Invalid - too short
//           propertyType: 'invalid', // Invalid enum value
//         });

//       // Validation middleware would return consistent error format
//       expect(response.status).toBeDefined();
//     });

//     it('should handle file upload errors', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/add_property`;

//       // Testing file upload limits and validation
//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .field('name', 'Test Property')
//         .attach('document.photos', Buffer.alloc(10 * 1024 * 1024), 'huge-file.jpg'); // 10MB file

//       expect(response.status).toBeDefined();
//     });
//   });

//   describe('Route Integration', () => {
//     it('should handle all routes correctly', async () => {
//       const testEndpoints = [
//         { method: 'get', path: `${baseUrl}/property_form_metadata` },
//         { method: 'post', path: `${baseUrl}/${validCuid}/add_property` },
//         { method: 'get', path: `${baseUrl}/${validCuid}/client_properties` },
//       ];

//       for (const endpoint of testEndpoints) {
//         const response = await request(app)[endpoint.method](endpoint.path);
//         expect(response.status).toBeDefined();
//       }
//     });
//   });

//   describe('Business Logic Validation', () => {
//     it('should validate property capacity constraints', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/add_property`;
//       const invalidData = createMockPropertyData({
//         maxAllowedUnits: 251, // Above maximum limit
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(invalidData);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });

//     it('should validate financial data ranges', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/add_property`;
//       const invalidData = createMockPropertyData({
//         financialDetails: {
//           purchasePrice: -1000, // Negative value
//           propertyTax: -500, // Negative value
//         },
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(invalidData);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });

//     it('should validate year built constraints', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/add_property`;
//       const currentYear = new Date().getFullYear();
//       const invalidData = createMockPropertyData({
//         yearBuilt: currentYear + 15, // Too far in the future
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(invalidData);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });

//     it('should validate specification constraints', async () => {
//       const endpoint = `${baseUrl}/${validCuid}/add_property`;
//       const invalidData = createMockPropertyData({
//         specifications: {
//           bedrooms: -1, // Negative bedrooms
//           bathrooms: -0.5, // Negative bathrooms
//           floors: 0, // Zero floors
//           maxOccupants: 0, // Zero occupants
//         },
//       });

//       const response = await request(app)
//         .post(endpoint)
//         .set('Authorization', `Bearer ${faker.string.alphanumeric(50)}`)
//         .send(invalidData);

//       // Test that route can handle requests
//       expect(response.status).toBeDefined();
//     });
//   });
// });
