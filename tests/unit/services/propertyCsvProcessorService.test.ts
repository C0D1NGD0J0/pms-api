/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import fs from 'fs';
import { PropertyCsvProcessor } from '@services/csv/propertyCsvProcessor';
import { BaseCSVProcessorService } from '@services/csv/base';
import { 
  mockGeoCoderService,
  mockPropertyDAO,
  mockClientDAO,
  mockUserDAO,
  resetTestContainer 
} from '@tests/mocks/di';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { PropertyValidations } from '@shared/validations/PropertyValidation';

// Mock file system operations
jest.mock('fs');
jest.mock('csv-parser', () => {
  return jest.fn(() => ({
    on: jest.fn(),
    pipe: jest.fn().mockReturnThis(),
  }));
});

jest.mock('@utils/index', () => ({
  createLogger: jest.fn(() => ({
    info: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  })),
}));

// Mock PropertyValidations
jest.mock('@shared/validations/PropertyValidation', () => ({
  PropertyValidations: {
    propertyCsv: {
      safeParseAsync: jest.fn()
    }
  }
}));

describe('PropertyCsvProcessor - Unit Tests', () => {
  let propertyCsvProcessor: PropertyCsvProcessor;
  const mockFilePath = '/path/to/test.csv';

  beforeAll(() => {
    propertyCsvProcessor = new PropertyCsvProcessor({
      geoCoderService: mockGeoCoderService,
      propertyDAO: mockPropertyDAO,
      clientDAO: mockClientDAO,
      userDAO: mockUserDAO,
    });
  });

  beforeEach(() => {
    resetTestContainer();
    jest.clearAllMocks();
  });

  describe('validateCsv', () => {
    const mockContext = {
      userId: '60f5e5b2a47c123456789013',
      cid: 'client-123'
    };

    it('should validate CSV successfully', async () => {
      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockProperties = [TestDataFactory.createProperty({ name: 'Property 1' })];

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      jest.spyOn(BaseCSVProcessorService, 'processCsvFile').mockResolvedValue({
        validItems: mockProperties,
        totalRows: 1,
        finishedAt: new Date(),
        errors: null
      });

      const result = await propertyCsvProcessor.validateCsv(mockFilePath, mockContext);

      expect(result.validProperties).toHaveLength(1);
      expect(result.errors).toBeNull();
    });

    it('should handle client not found', async () => {
      mockClientDAO.getClientByCid.mockResolvedValue(null);

      await expect(propertyCsvProcessor.validateCsv(mockFilePath, mockContext))
        .rejects.toThrow('Client with ID client-123 not found');
    });

    it('should handle processing errors', async () => {
      const mockClient = TestDataFactory.createClient({ _id: 'client-123' });
      const mockErrors = [{ rowNumber: 1, errors: [{ field: 'name', error: 'Name is required' }] }];

      mockClientDAO.getClientByCid.mockResolvedValue(mockClient);
      jest.spyOn(BaseCSVProcessorService, 'processCsvFile').mockResolvedValue({
        validItems: [],
        totalRows: 1,
        finishedAt: new Date(),
        errors: mockErrors
      });

      const result = await propertyCsvProcessor.validateCsv(mockFilePath, mockContext);
      expect(result.errors).toEqual(mockErrors);
    });
  });

  describe('validatePropertyRow', () => {
    const mockContext = { userId: '60f5e5b2a47c123456789013', cid: 'client-123' };

    it('should validate valid row data', async () => {
      const mockRow = {
        name: 'Test Property',
        fullAddress: '123 Main St',
        propertyType: 'apartment',
        specifications_totalArea: 1200,
        cid: 'client-123'
      };

      PropertyValidations.propertyCsv.safeParseAsync.mockResolvedValue({
        success: true,
        data: mockRow
      });

      const result = await propertyCsvProcessor.validatePropertyRow(mockRow, mockContext);
      expect(result.isValid).toBe(true);
    });

    it('should validate manager email', async () => {
      const mockRow = {
        name: 'Test Property',
        fullAddress: '123 Main St',
        propertyType: 'apartment',
        specifications_totalArea: 1200,
        managedBy: 'manager@example.com',
        cid: 'client-123'
      };

      const mockUser = TestDataFactory.createUser({ 
        email: 'manager@example.com',
        cids: [{ cid: 'client-123', isConnected: true, roles: ['manager'] }]
      });

      PropertyValidations.propertyCsv.safeParseAsync.mockResolvedValue({ success: true, data: mockRow });
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);

      const result = await propertyCsvProcessor.validatePropertyRow(mockRow, mockContext);
      expect(result.isValid).toBe(true);
    });

    it('should reject invalid data', async () => {
      const mockValidationError = {
        success: false,
        error: {
          errors: [
            { path: ['name'], message: 'Required' },
            { path: ['fullAddress'], message: 'Required' },
            { path: ['propertyType'], message: 'Required' },
            { path: ['specifications_totalArea'], message: 'Expected number, received nan' }
          ]
        }
      };

      PropertyValidations.propertyCsv.safeParseAsync.mockResolvedValue(mockValidationError);

      const result = await propertyCsvProcessor.validatePropertyRow({}, mockContext);
      expect(result.isValid).toBe(false);
      expect(result.errors).toHaveLength(4);
    });
  });

  describe('transformPropertyRow', () => {
    const mockContext = { userId: '60f5e5b2a47c123456789013', cid: 'client-123' };

    it('should transform basic property data', async () => {
      const mockRow = {
        name: 'Test Property',
        fullAddress: '123 Main St',
        propertyType: 'apartment',
        status: 'available',
        totalUnits: '5'
      };

      const result = await propertyCsvProcessor.transformPropertyRow(mockRow, mockContext);

      expect(result.name).toBe('Test Property');
      expect(result.propertyType).toBe('apartment');
      expect(result.totalUnits).toBe(5);
      expect(result.cid).toBe('client-123');
    });

    it('should transform specifications and fees', async () => {
      const mockRow = {
        name: 'Test Property',
        specifications_totalArea: '1200',
        bedrooms: true,
        specifications_bedrooms: '3',
        fees_taxamount: '2400',
        fees_currency: 'USD'
      };

      const result = await propertyCsvProcessor.transformPropertyRow(mockRow, mockContext);

      expect(result.specifications.totalArea).toBe(1200);
      expect(result.specifications.bedrooms).toBe(3);
      expect(result.fees.taxAmount).toBe(2400);
      expect(result.fees.currency).toBe('USD');
    });

    it('should handle manager resolution', async () => {
      const mockRow = {
        name: 'Test Property',
        managedBy: 'manager@example.com'
      };

      const validObjectId = '60f5e5b2a47c123456789012';
      const mockUser = TestDataFactory.createUser({ 
        _id: validObjectId,
        email: 'manager@example.com',
        cids: [{ cid: 'client-123', isConnected: true, roles: ['manager'] }]
      });

      mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);

      const result = await propertyCsvProcessor.transformPropertyRow(mockRow, mockContext);
      expect(result.managedBy.toString()).toBe(validObjectId);
    });
  });

  describe('postProcessProperties', () => {
    const mockContext = { userId: '60f5e5b2a47c123456789013', cid: 'client-123' };

    it('should process valid geocoding', async () => {
      const mockProperties = [{ ...TestDataFactory.createProperty(), fullAddress: '123 Main St' }];

      const mockGeocodingResult = {
        success: true,
        data: {
          coordinates: [-74.006, 40.7128],
          city: 'New York',
          state: 'NY'
        }
      };

      mockGeoCoderService.parseLocation.mockResolvedValue(mockGeocodingResult);

      const result = await propertyCsvProcessor.postProcessProperties(mockProperties, mockContext);

      expect(result.validItems).toHaveLength(1);
      expect(result.validItems[0].address.city).toBe('New York');
    });

    it('should handle geocoding failures', async () => {
      const mockProperties = [{ ...TestDataFactory.createProperty(), fullAddress: 'Invalid Address' }];

      mockGeoCoderService.parseLocation.mockResolvedValue({ success: false, data: null });

      const result = await propertyCsvProcessor.postProcessProperties(mockProperties, mockContext);

      expect(result.validItems).toHaveLength(0);
      expect(result.invalidItems).toHaveLength(1);
    });

    it('should handle service errors', async () => {
      const mockProperties = [{ ...TestDataFactory.createProperty(), fullAddress: '123 Main St' }];

      mockGeoCoderService.parseLocation.mockRejectedValue(new Error('Service unavailable'));

      const result = await propertyCsvProcessor.postProcessProperties(mockProperties, mockContext);

      expect(result.validItems).toHaveLength(0);
      expect(result.invalidItems[0].error).toContain('Error during geocoding');
    });
  });

  describe('validateAndResolveManagedBy', () => {
    it('should validate valid manager email', async () => {
      const validManagerId = '60f5e5b2a47c123456789014';
      const mockUser = TestDataFactory.createUser({
        _id: validManagerId,
        email: 'manager@example.com',
        cids: [{ cid: 'client-123', isConnected: true, roles: ['manager'] }]
      });

      mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);

      const result = await propertyCsvProcessor.validateAndResolveManagedBy('manager@example.com', 'client-123');

      expect(result.valid).toBe(true);
      expect(result.userId).toBe(validManagerId);
    });

    it('should reject non-existent email', async () => {
      mockUserDAO.getActiveUserByEmail.mockResolvedValue(null);

      const result = await propertyCsvProcessor.validateAndResolveManagedBy('nonexistent@example.com', 'client-123');

      expect(result.valid).toBe(false);
      expect(result.error).toContain('No user found');
    });

    it('should reject invalid roles', async () => {
      const mockUser = TestDataFactory.createUser({
        email: 'user@example.com',
        cids: [{ cid: 'client-123', isConnected: true, roles: ['tenant'] }]
      });

      mockUserDAO.getActiveUserByEmail.mockResolvedValue(mockUser);

      const result = await propertyCsvProcessor.validateAndResolveManagedBy('user@example.com', 'client-123');

      expect(result.valid).toBe(false);
      expect(result.error).toBe('User role not permitted for this action.');
    });
  });

  describe('extractDocumentsFromRow', () => {
    const mockContext = { userId: '60f5e5b2a47c123456789013', cid: 'client-123' };

    it('should extract multiple documents with complete metadata', async () => {
      const mockRow = {
        document_1_url: 'https://example.com/doc1.pdf',
        document_1_type: 'deed',
        document_1_description: 'Property deed',
        document_2_url: 'https://example.com/doc2.pdf',
        document_2_type: 'inspection'
      };

      const result = await propertyCsvProcessor.extractDocumentsFromRow(mockRow, mockContext);

      expect(result).toHaveLength(2);
      expect(result[0].documentType).toBe('deed');
      expect(result[0].description).toBe('Property deed');
      expect(result[1].documentType).toBe('inspection');
    });

    it('should return empty array for rows without documents', async () => {
      const mockRow = { name: 'Test Property', address: '123 Main St' };
      const result = await propertyCsvProcessor.extractDocumentsFromRow(mockRow, mockContext);
      expect(result).toHaveLength(0);
    });

    it('should default invalid document types to other', async () => {
      const mockRow = {
        document_1_url: 'https://example.com/doc1.pdf',
        document_1_type: 'invalid_type'
      };
      const result = await propertyCsvProcessor.extractDocumentsFromRow(mockRow, mockContext);
      expect(result[0].documentType).toBe('other');
    });
  });
});

describe('BaseCSVProcessorService - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseBoolean', () => {
    it('should parse truthy values correctly', () => {
      expect(BaseCSVProcessorService.parseBoolean(true)).toBe(true);
      expect(BaseCSVProcessorService.parseBoolean('yes')).toBe(true);
      expect(BaseCSVProcessorService.parseBoolean('TRUE')).toBe(true);
      expect(BaseCSVProcessorService.parseBoolean(1)).toBe(true);
    });

    it('should parse falsy values correctly', () => {
      expect(BaseCSVProcessorService.parseBoolean(false)).toBe(false);
      expect(BaseCSVProcessorService.parseBoolean('no')).toBe(false);
      expect(BaseCSVProcessorService.parseBoolean(null)).toBe(false);
      expect(BaseCSVProcessorService.parseBoolean('random')).toBe(false);
    });
  });

  describe('parseNumber', () => {
    it('should parse valid numbers', () => {
      expect(BaseCSVProcessorService.parseNumber('123')).toBe(123);
      expect(BaseCSVProcessorService.parseNumber('123.45')).toBe(123.45);
      expect(BaseCSVProcessorService.parseNumber(-123)).toBe(-123);
    });

    it('should handle invalid inputs with defaults', () => {
      expect(BaseCSVProcessorService.parseNumber('abc')).toBe(0);
      expect(BaseCSVProcessorService.parseNumber(null)).toBe(0);
      expect(BaseCSVProcessorService.parseNumber('invalid', 100)).toBe(100);
    });
  });
});