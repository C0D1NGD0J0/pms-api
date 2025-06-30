/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { Request, Response } from 'express';
import { PropertyController } from '@controllers/PropertyController';
import { httpStatusCodes } from '@utils/index';
import { 
  mockPropertyService, 
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  AssertionHelpers,
  HttpTestHelpers, 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';

describe('PropertyController - API Tests', () => {
  let propertyController: PropertyController;
  let req: Partial<Request>;
  let res: Partial<Response>;

  beforeAll(() => {
    // Initialize controller with mocked dependencies
    propertyController = new PropertyController({
      propertyService: mockPropertyService,
    });
  });

  beforeEach(() => {
    // Reset all mocks and container state
    resetTestContainer();
    
    // Setup fresh request and response objects
    req = TestSuiteHelpers.setupMockRequest();
    res = TestSuiteHelpers.setupMockResponse();
  });

  afterEach(() => {
    // Additional cleanup if needed
    jest.clearAllMocks();
  });

  describe('POST /properties', () => {
    describe('Successful property creation', () => {
      it('should create a new property successfully', async () => {
        // Arrange
        const userData = TestDataFactory.createUser();
        const propertyData = TestDataFactory.createProperty();
        
        req = HttpTestHelpers.createAuthRequest(userData, {
          body: propertyData,
        });

        const expectedResponse = {
          success: true,
          data: { ...propertyData, _id: 'property-123' },
        };

        mockPropertyService.addProperty.mockResolvedValue(expectedResponse.data);

        // Act
        await propertyController.create(req, res);

        // Assert
        AssertionHelpers.expectSuccessResponse(res, {
          data: expectedResponse.data,
        });
        expect(mockPropertyService.addProperty).toHaveBeenCalledWith(
          req.context,
          propertyData
        );
      });

      it('should handle residential property creation', async () => {
        // Arrange
        const userData = TestDataFactory.createUser();
        const propertyData = TestDataFactory.createProperty({
          propertyType: 'RESIDENTIAL',
          units: [
            TestDataFactory.createPropertyUnit({ unitNumber: '101' }),
            TestDataFactory.createPropertyUnit({ unitNumber: '102' }),
          ],
        });
        
        req = HttpTestHelpers.createAuthRequest(userData, {
          body: propertyData,
        });

        mockPropertyService.addProperty.mockResolvedValue(propertyData);

        // Act
        await propertyController.create(req, res);

        // Assert
        AssertionHelpers.expectSuccessResponse(res);
        expect(mockPropertyService.addProperty).toHaveBeenCalledWith(
          expect.objectContaining({ currentuser: userData }),
          expect.objectContaining({ propertyType: 'RESIDENTIAL' })
        );
      });
    });

    describe('Property creation errors', () => {
      it('should handle validation errors', async () => {
        // Arrange
        const userData = TestDataFactory.createUser();
        const invalidPropertyData = {
          name: '', // Invalid empty name
          address: {}, // Invalid incomplete address
        };
        
        req = HttpTestHelpers.createAuthRequest(userData, {
          body: invalidPropertyData,
        });

        const error = {
          statusCode: httpStatusCodes.BAD_REQUEST,
          message: 'Validation failed',
          errors: ['Property name is required', 'Address is incomplete'],
        };

        mockPropertyService.addProperty.mockRejectedValue(error);

        // Act & Assert
        await expect(propertyController.create(req, res))
          .rejects.toEqual(error);
      });
    });
  });

  describe('POST /properties/:cid/validate-csv', () => {
    describe('Successful CSV validation', () => {
      it('should validate CSV file successfully', async () => {
        // Arrange
        const userData = TestDataFactory.createUser();
        const clientId = 'client-123';
        const csvFile = {
          path: '/tmp/properties.csv',
          filename: 'properties.csv',
          mimetype: 'text/csv',
          size: 1024,
        };
        
        req = HttpTestHelpers.createAuthRequest(userData, {
          params: { cid: clientId },
          body: { scannedFiles: [csvFile] },
        });

        const validationResult = {
          success: true,
          validRows: 10,
          invalidRows: 0,
          errors: [],
          preview: [
            { name: 'Property 1', address: '123 Main St' },
            { name: 'Property 2', address: '456 Oak Ave' },
          ],
        };

        mockPropertyService.validateCsv.mockResolvedValue(validationResult);

        // Act
        await propertyController.validateCsv(req, res);

        // Assert
        AssertionHelpers.expectSuccessResponse(res);
        expect(mockPropertyService.validateCsv).toHaveBeenCalledWith(
          clientId,
          csvFile,
          userData
        );
      });
    });

    describe('CSV validation errors', () => {
      it('should handle missing CSV file', async () => {
        // Arrange
        const userData = TestDataFactory.createUser();
        const clientId = 'client-123';
        
        req = HttpTestHelpers.createAuthRequest(userData, {
          params: { cid: clientId },
          body: {}, // No scannedFiles
        });

        // Act
        await propertyController.validateCsv(req, res);

        // Assert
        AssertionHelpers.expectErrorResponse(
          res, 
          httpStatusCodes.BAD_REQUEST, 
          'No CSV file uploaded'
        );
      });
    });
  });

  describe('POST /properties/:cid/import-csv', () => {
    describe('Successful CSV import', () => {
      it('should import properties from CSV successfully', async () => {
        // Arrange
        const userData = TestDataFactory.createUser();
        const clientId = 'client-123';
        const csvFile = {
          path: '/tmp/properties-import.csv',
          filename: 'properties-import.csv',
          mimetype: 'text/csv',
          size: 4096,
        };
        
        req = HttpTestHelpers.createAuthRequest(userData, {
          params: { cid: clientId },
          body: { scannedFiles: [csvFile] },
        });

        const importResult = {
          success: true,
          imported: 15,
          failed: 0,
          properties: [
            TestDataFactory.createProperty({ name: 'Imported Property 1' }),
            TestDataFactory.createProperty({ name: 'Imported Property 2' }),
          ],
        };

        mockPropertyService.addPropertiesFromCsv.mockResolvedValue(importResult);

        // Act
        await propertyController.createPropertiesFromCsv(req, res);

        // Assert
        AssertionHelpers.expectSuccessResponse(res);
        expect(mockPropertyService.addPropertiesFromCsv).toHaveBeenCalledWith(
          clientId,
          csvFile.path,
          userData.sub
        );
      });
    });

    describe('CSV import errors', () => {
      it('should handle missing CSV file for import', async () => {
        // Arrange
        const userData = TestDataFactory.createUser();
        const clientId = 'client-123';
        
        req = HttpTestHelpers.createAuthRequest(userData, {
          params: { cid: clientId },
          body: {}, // No scannedFiles
        });

        // Act
        await propertyController.createPropertiesFromCsv(req, res);

        // Assert
        AssertionHelpers.expectErrorResponse(
          res, 
          httpStatusCodes.BAD_REQUEST, 
          'No CSV file uploaded'
        );
      });
    });
  });
});