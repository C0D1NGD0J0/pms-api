import request from 'supertest';
import { Express } from 'express';
import { PropertyController } from '@controllers/PropertyController';
import { 
  PropertyTestFactory, 
  PropertyAssertions 
} from '@tests/utils/propertyTestHelpers';
import { 
  HttpTestHelpers, 
  TestDataFactory,
  AssertionHelpers 
} from '@tests/utils/testHelpers';
import { createPropertyServiceMocks } from '@tests/mocks/services/propertyServiceMocks';
import { httpStatusCodes } from '@utils/index';
import { jest } from '@jest/globals';

describe('PropertyController - Integration Tests', () => {
  let app: Express;
  let propertyController: PropertyController;
  let mockPropertyService: any;

  beforeEach(() => {
    // Create mock service
    mockPropertyService = {
      addProperty: jest.fn(),
      getClientProperties: jest.fn(),
      getClientProperty: jest.fn(),
      updateClientProperty: jest.fn(),
      archiveClientProperty: jest.fn(),
      validateCsv: jest.fn(),
      addPropertiesFromCsv: jest.fn()
    };

    // Initialize controller with mock service
    propertyController = new PropertyController({
      propertyService: mockPropertyService
    });

    // Create mock express app for testing
    app = createMockExpressApp();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  function createMockExpressApp(): Express {
    const express = require('express');
    const mockApp = express();
    
    mockApp.use(express.json());
    
    // Add middleware to simulate auth context
    mockApp.use((req: any, res: any, next: any) => {
      req.context = PropertyTestFactory.createRequestContext();
      next();
    });

    // Property routes
    mockApp.post('/api/v1/clients/:cid/properties', propertyController.create);
    mockApp.get('/api/v1/clients/:cid/properties', propertyController.getClientProperties);
    mockApp.get('/api/v1/clients/:cid/properties/:pid', propertyController.getProperty);
    mockApp.put('/api/v1/clients/:cid/properties/:pid', propertyController.updateClientProperty);
    mockApp.delete('/api/v1/clients/:cid/properties/:pid', propertyController.archiveProperty);
    mockApp.post('/api/v1/clients/:cid/properties/validate-csv', propertyController.validateCsv);
    mockApp.post('/api/v1/clients/:cid/properties/import-csv', propertyController.createPropertiesFromCsv);
    mockApp.get('/api/v1/properties/form-metadata', propertyController.getPropertyFormMetadata);

    return mockApp;
  }

  describe('POST /api/v1/clients/:cid/properties', () => {
    describe('Successful Property Creation', () => {
      it('should create a new property', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyData = PropertyTestFactory.createPropertyData();
        const createdProperty = { ...propertyData, id: 'property-123' };

        mockPropertyService.addProperty.mockResolvedValue({
          success: true,
          data: createdProperty,
          message: 'Property created successfully.'
        });

        // Act
        const response = await request(app)
          .post(`/api/v1/clients/${cid}/properties`)
          .send(propertyData)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data.data).toEqual(createdProperty);
        
        expect(mockPropertyService.addProperty).toHaveBeenCalledWith(
          expect.objectContaining({
            request: expect.objectContaining({
              params: { cid }
            })
          }),
          propertyData
        );
      });

      it('should handle property with file uploads', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyData = PropertyTestFactory.createPropertyData();
        propertyData.scannedFiles = [
          PropertyTestFactory.createUploadResult()
        ];

        mockPropertyService.addProperty.mockResolvedValue({
          success: true,
          data: { ...propertyData, id: 'property-123' },
          message: 'Property created successfully.'
        });

        // Act
        const response = await request(app)
          .post(`/api/v1/clients/${cid}/properties`)
          .send(propertyData)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(mockPropertyService.addProperty).toHaveBeenCalledWith(
          expect.any(Object),
          expect.objectContaining({
            scannedFiles: expect.arrayContaining([
              expect.objectContaining({
                filename: expect.any(String),
                path: expect.any(String)
              })
            ])
          })
        );
      });
    });

    describe('Property Creation Errors', () => {
      it('should handle validation errors', async () => {
        // Arrange
        const cid = 'client-123';
        const invalidPropertyData = { name: '' }; // Invalid data

        mockPropertyService.addProperty.mockRejectedValue(
          new Error('Property validation failed')
        );

        // Act
        const response = await request(app)
          .post(`/api/v1/clients/${cid}/properties`)
          .send(invalidPropertyData)
          .expect(500); // Express error handler

        // Assert
        expect(mockPropertyService.addProperty).toHaveBeenCalled();
      });

      it('should handle service errors', async () => {
        // Arrange
        const cid = 'client-123';
        const propertyData = PropertyTestFactory.createPropertyData();

        mockPropertyService.addProperty.mockRejectedValue(
          new Error('Database connection failed')
        );

        // Act
        await request(app)
          .post(`/api/v1/clients/${cid}/properties`)
          .send(propertyData)
          .expect(500);

        // Assert
        expect(mockPropertyService.addProperty).toHaveBeenCalled();
      });
    });
  });

  describe('GET /api/v1/clients/:cid/properties', () => {
    describe('Successful Property Listing', () => {
      it('should get client properties with default pagination', async () => {
        // Arrange
        const cid = 'client-123';
        const properties = Array.from({ length: 5 }, () => 
          PropertyTestFactory.createPropertyData()
        );

        mockPropertyService.getClientProperties.mockResolvedValue({
          success: true,
          data: {
            items: properties,
            pagination: { page: 1, limit: 10, total: 5, pages: 1 }
          }
        });

        // Act
        const response = await request(app)
          .get(`/api/v1/clients/${cid}/properties`)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data.items).toHaveLength(5);
        expect(response.body.data.pagination).toBeDefined();

        expect(mockPropertyService.getClientProperties).toHaveBeenCalledWith(
          cid,
          expect.objectContaining({
            pagination: expect.objectContaining({
              page: 1,
              limit: 10
            })
          })
        );
      });

      it('should handle pagination parameters', async () => {
        // Arrange
        const cid = 'client-123';
        const queryParams = {
          page: '2',
          limit: '5',
          sort: 'desc',
          sortBy: 'createdAt'
        };

        mockPropertyService.getClientProperties.mockResolvedValue({
          success: true,
          data: { items: [], pagination: { page: 2, limit: 5, total: 0, pages: 0 } }
        });

        // Act
        const response = await request(app)
          .get(`/api/v1/clients/${cid}/properties`)
          .query(queryParams)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(mockPropertyService.getClientProperties).toHaveBeenCalledWith(
          cid,
          expect.objectContaining({
            pagination: expect.objectContaining({
              page: 2,
              limit: 5,
              sort: 'desc',
              sortBy: 'createdAt'
            })
          })
        );
      });

      it('should handle filtering parameters', async () => {
        // Arrange
        const cid = 'client-123';
        const queryParams = {
          propertyType: 'house',
          status: 'active',
          occupancyStatus: 'vacant',
          minPrice: '100000',
          maxPrice: '500000',
          searchTerm: 'luxury'
        };

        mockPropertyService.getClientProperties.mockResolvedValue({
          success: true,
          data: { items: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } }
        });

        // Act
        const response = await request(app)
          .get(`/api/v1/clients/${cid}/properties`)
          .query(queryParams)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(mockPropertyService.getClientProperties).toHaveBeenCalledWith(
          cid,
          expect.objectContaining({
            filters: expect.objectContaining({
              propertyType: 'house',
              status: 'active',
              occupancyStatus: 'vacant',
              priceRange: {
                min: 100000,
                max: 500000
              },
              searchTerm: 'luxury'
            })
          })
        );
      });

      it('should handle empty results', async () => {
        // Arrange
        const cid = 'client-123';

        mockPropertyService.getClientProperties.mockResolvedValue({
          success: true,
          data: {
            items: [],
            pagination: { page: 1, limit: 10, total: 0, pages: 0 }
          }
        });

        // Act
        const response = await request(app)
          .get(`/api/v1/clients/${cid}/properties`)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data.items).toHaveLength(0);
      });
    });

    describe('Property Listing Errors', () => {
      it('should handle service errors', async () => {
        // Arrange
        const cid = 'client-123';

        mockPropertyService.getClientProperties.mockRejectedValue(
          new Error('Client not found')
        );

        // Act
        await request(app)
          .get(`/api/v1/clients/${cid}/properties`)
          .expect(500);

        // Assert
        expect(mockPropertyService.getClientProperties).toHaveBeenCalled();
      });
    });
  });

  describe('GET /api/v1/clients/:cid/properties/:pid', () => {
    describe('Successful Property Retrieval', () => {
      it('should get single property with unit info', async () => {
        // Arrange
        const cid = 'client-123';
        const pid = 'property-456';
        const property = PropertyTestFactory.createPropertyData({
          id: pid,
          unitInfo: {
            canAddUnit: true,
            totalUnits: 12,
            currentUnits: 8,
            availableSpaces: 4,
            unitStats: {
              occupied: 5,
              vacant: 2,
              maintenance: 1,
              available: 2,
              reserved: 0,
              inactive: 0
            }
          }
        });

        mockPropertyService.getClientProperty.mockResolvedValue({
          success: true,
          data: property
        });

        // Act
        const response = await request(app)
          .get(`/api/v1/clients/${cid}/properties/${pid}`)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(property);
        expect(response.body.data.unitInfo).toBeDefined();
        
        expect(mockPropertyService.getClientProperty).toHaveBeenCalledWith(
          cid,
          pid,
          expect.any(Object) // currentUser
        );
      });
    });

    describe('Property Retrieval Errors', () => {
      it('should handle property not found', async () => {
        // Arrange
        const cid = 'client-123';
        const pid = 'non-existent-property';

        mockPropertyService.getClientProperty.mockRejectedValue(
          new Error('Property not found')
        );

        // Act
        await request(app)
          .get(`/api/v1/clients/${cid}/properties/${pid}`)
          .expect(500);

        // Assert
        expect(mockPropertyService.getClientProperty).toHaveBeenCalled();
      });
    });
  });

  describe('PUT /api/v1/clients/:cid/properties/:pid', () => {
    describe('Successful Property Updates', () => {
      it('should update property information', async () => {
        // Arrange
        const cid = 'client-123';
        const pid = 'property-456';
        const updateData = {
          name: 'Updated Property Name',
          description: { text: 'Updated description' },
          specifications: { bedrooms: 4, bathrooms: 3 }
        };

        const updatedProperty = {
          ...PropertyTestFactory.createPropertyData(),
          ...updateData,
          id: pid
        };

        mockPropertyService.updateClientProperty.mockResolvedValue({
          success: true,
          data: updatedProperty,
          message: 'Property updated successfully'
        });

        // Act
        const response = await request(app)
          .put(`/api/v1/clients/${cid}/properties/${pid}`)
          .send(updateData)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual(updatedProperty);
        
        expect(mockPropertyService.updateClientProperty).toHaveBeenCalledWith(
          expect.objectContaining({
            cid,
            pid,
            currentuser: expect.any(Object)
          }),
          updateData
        );
      });

      it('should handle partial updates', async () => {
        // Arrange
        const cid = 'client-123';
        const pid = 'property-456';
        const partialUpdateData = {
          specifications: { bedrooms: 3 }
        };

        mockPropertyService.updateClientProperty.mockResolvedValue({
          success: true,
          data: PropertyTestFactory.createPropertyData(),
          message: 'Property updated successfully'
        });

        // Act
        const response = await request(app)
          .put(`/api/v1/clients/${cid}/properties/${pid}`)
          .send(partialUpdateData)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(mockPropertyService.updateClientProperty).toHaveBeenCalledWith(
          expect.any(Object),
          partialUpdateData
        );
      });
    });

    describe('Property Update Errors', () => {
      it('should handle validation errors', async () => {
        // Arrange
        const cid = 'client-123';
        const pid = 'property-456';
        const invalidUpdateData = {
          specifications: { bedrooms: -1 } // Invalid data
        };

        mockPropertyService.updateClientProperty.mockRejectedValue(
          new Error('Validation failed')
        );

        // Act
        await request(app)
          .put(`/api/v1/clients/${cid}/properties/${pid}`)
          .send(invalidUpdateData)
          .expect(500);

        // Assert
        expect(mockPropertyService.updateClientProperty).toHaveBeenCalled();
      });
    });
  });

  describe('DELETE /api/v1/clients/:cid/properties/:pid', () => {
    describe('Successful Property Archival', () => {
      it('should archive property', async () => {
        // Arrange
        const cid = 'client-123';
        const pid = 'property-456';

        mockPropertyService.archiveClientProperty.mockResolvedValue({
          success: true,
          data: null,
          message: 'Property archived successfully'
        });

        // Act
        const response = await request(app)
          .delete(`/api/v1/clients/${cid}/properties/${pid}`)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.message).toBe('Property archived successfully');
        
        expect(mockPropertyService.archiveClientProperty).toHaveBeenCalledWith(
          cid,
          pid,
          expect.any(Object) // currentUser
        );
      });
    });

    describe('Property Archival Errors', () => {
      it('should handle property not found', async () => {
        // Arrange
        const cid = 'client-123';
        const pid = 'non-existent-property';

        mockPropertyService.archiveClientProperty.mockRejectedValue(
          new Error('Property not found')
        );

        // Act
        await request(app)
          .delete(`/api/v1/clients/${cid}/properties/${pid}`)
          .expect(500);

        // Assert
        expect(mockPropertyService.archiveClientProperty).toHaveBeenCalled();
      });
    });
  });

  describe('POST /api/v1/clients/:cid/properties/validate-csv', () => {
    describe('Successful CSV Validation', () => {
      it('should start CSV validation process', async () => {
        // Arrange
        const cid = 'client-123';
        const csvFileData = {
          scannedFiles: [
            {
              filename: 'properties.csv',
              originalName: 'properties.csv',
              path: '/tmp/properties.csv',
              size: 1024,
              mimetype: 'text/csv'
            }
          ]
        };

        mockPropertyService.validateCsv.mockResolvedValue({
          success: true,
          data: { processId: 'job-123' },
          message: 'CSV validation process started.'
        });

        // Act
        const response = await request(app)
          .post(`/api/v1/clients/${cid}/properties/validate-csv`)
          .send(csvFileData)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data.processId).toBe('job-123');
        
        expect(mockPropertyService.validateCsv).toHaveBeenCalledWith(
          cid,
          csvFileData.scannedFiles[0],
          expect.any(Object) // currentUser
        );
      });
    });

    describe('CSV Validation Errors', () => {
      it('should handle missing CSV file', async () => {
        // Arrange
        const cid = 'client-123';
        const emptyFileData = {};

        // Act
        const response = await request(app)
          .post(`/api/v1/clients/${cid}/properties/validate-csv`)
          .send(emptyFileData)
          .expect(httpStatusCodes.BAD_REQUEST);

        // Assert
        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('No CSV file uploaded');
        expect(mockPropertyService.validateCsv).not.toHaveBeenCalled();
      });

      it('should handle service validation errors', async () => {
        // Arrange
        const cid = 'client-123';
        const csvFileData = {
          scannedFiles: [
            {
              filename: 'invalid.csv',
              path: '/tmp/invalid.csv',
              size: 15 * 1024 * 1024 // Too large
            }
          ]
        };

        mockPropertyService.validateCsv.mockRejectedValue(
          new Error('File size too large for processing.')
        );

        // Act
        await request(app)
          .post(`/api/v1/clients/${cid}/properties/validate-csv`)
          .send(csvFileData)
          .expect(500);

        // Assert
        expect(mockPropertyService.validateCsv).toHaveBeenCalled();
      });
    });
  });

  describe('POST /api/v1/clients/:cid/properties/import-csv', () => {
    describe('Successful CSV Import', () => {
      it('should start CSV import process', async () => {
        // Arrange
        const cid = 'client-123';
        const csvFileData = {
          scannedFiles: [
            {
              filename: 'properties.csv',
              path: '/tmp/properties.csv',
              size: 1024
            }
          ]
        };

        mockPropertyService.addPropertiesFromCsv.mockResolvedValue({
          success: true,
          data: { processId: 'job-456' },
          message: 'CSV import job started'
        });

        // Act
        const response = await request(app)
          .post(`/api/v1/clients/${cid}/properties/import-csv`)
          .send(csvFileData)
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data.processId).toBe('job-456');
        
        expect(mockPropertyService.addPropertiesFromCsv).toHaveBeenCalledWith(
          cid,
          csvFileData.scannedFiles[0].path,
          expect.any(String) // currentUser.sub
        );
      });
    });

    describe('CSV Import Errors', () => {
      it('should handle missing CSV file', async () => {
        // Arrange
        const cid = 'client-123';
        const emptyFileData = {};

        // Act
        const response = await request(app)
          .post(`/api/v1/clients/${cid}/properties/import-csv`)
          .send(emptyFileData)
          .expect(httpStatusCodes.BAD_REQUEST);

        // Assert
        expect(response.body.success).toBe(false);
        expect(response.body.message).toBe('No CSV file uploaded');
        expect(mockPropertyService.addPropertiesFromCsv).not.toHaveBeenCalled();
      });
    });
  });

  describe('GET /api/v1/properties/form-metadata', () => {
    describe('Successful Metadata Retrieval', () => {
      it('should return property form metadata', async () => {
        // Act
        const response = await request(app)
          .get('/api/v1/properties/form-metadata')
          .query({ formType: 'propertyForm' })
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
      });

      it('should return unit form metadata', async () => {
        // Act
        const response = await request(app)
          .get('/api/v1/properties/form-metadata')
          .query({ formType: 'unitForm' })
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data).toBeDefined();
      });

      it('should return empty object for no form type', async () => {
        // Act
        const response = await request(app)
          .get('/api/v1/properties/form-metadata')
          .expect(httpStatusCodes.OK);

        // Assert
        expect(response.body.success).toBe(true);
        expect(response.body.data).toEqual({});
      });
    });

    describe('Metadata Retrieval Errors', () => {
      it('should handle invalid form type', async () => {
        // Act
        const response = await request(app)
          .get('/api/v1/properties/form-metadata')
          .query({ formType: 'invalidForm' })
          .expect(httpStatusCodes.BAD_REQUEST);

        // Assert
        expect(response.body.success).toBe(false);
        expect(response.body.message).toContain('Invalid form type: invalidForm');
      });
    });
  });

  describe('Middleware Integration', () => {
    it('should handle authentication context correctly', async () => {
      // Arrange
      const cid = 'client-123';
      
      mockPropertyService.getClientProperties.mockImplementation(
        (clientId, queryParams, context) => {
          // Verify context is passed through
          expect(context).toBeDefined();
          return Promise.resolve({
            success: true,
            data: { items: [], pagination: { page: 1, limit: 10, total: 0, pages: 0 } }
          });
        }
      );

      // Act
      await request(app)
        .get(`/api/v1/clients/${cid}/properties`)
        .expect(httpStatusCodes.OK);

      // Assert
      expect(mockPropertyService.getClientProperties).toHaveBeenCalled();
    });

    it('should handle request parameter extraction', async () => {
      // Arrange
      const cid = 'test-client-456';
      const pid = 'test-property-789';

      mockPropertyService.getClientProperty.mockResolvedValue({
        success: true,
        data: PropertyTestFactory.createPropertyData()
      });

      // Act
      await request(app)
        .get(`/api/v1/clients/${cid}/properties/${pid}`)
        .expect(httpStatusCodes.OK);

      // Assert
      expect(mockPropertyService.getClientProperty).toHaveBeenCalledWith(
        cid,
        pid,
        expect.any(Object)
      );
    });

    it('should handle request body parsing', async () => {
      // Arrange
      const cid = 'client-123';
      const complexPropertyData = {
        ...PropertyTestFactory.createPropertyData(),
        specifications: {
          bedrooms: 3,
          bathrooms: 2.5,
          totalArea: 1800,
          amenities: ['pool', 'gym', 'parking']
        },
        fees: {
          rentalAmount: 2500,
          securityDeposit: 2500,
          applicationFee: 50
        }
      };

      mockPropertyService.addProperty.mockResolvedValue({
        success: true,
        data: complexPropertyData,
        message: 'Property created successfully.'
      });

      // Act
      await request(app)
        .post(`/api/v1/clients/${cid}/properties`)
        .send(complexPropertyData)
        .expect(httpStatusCodes.OK);

      // Assert
      expect(mockPropertyService.addProperty).toHaveBeenCalledWith(
        expect.any(Object),
        complexPropertyData
      );
    });
  });
});