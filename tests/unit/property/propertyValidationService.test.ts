/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { 
  PropertyValidationService,
  ValidationError,
  ValidationResult 
} from '@services/property/propertyValidation.service';
import { 
  TestDataFactory 
} from '@tests/utils/testHelpers';

// Mock PropertyTypeManager
jest.mock('@utils/PropertyTypeManager', () => ({
  PropertyTypeManager: {
    getRequiredFields: jest.fn(),
    isValidPropertyType: jest.fn(),
    getFieldConstraints: jest.fn(),
    validateFieldValue: jest.fn(),
  },
}));

describe('PropertyValidationService - Unit Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateCurrency', () => {
    describe('Valid currency validation', () => {
      it('should validate valid currency values', () => {
        // Test valid numbers
        expect(PropertyValidationService.validateCurrency(100, 'rent')).toEqual([]);
        expect(PropertyValidationService.validateCurrency(1500.50, 'deposit')).toEqual([]);
        expect(PropertyValidationService.validateCurrency('2000', 'price')).toEqual([]);
        expect(PropertyValidationService.validateCurrency('999.99', 'fee')).toEqual([]);
      });

      it('should allow undefined/null for non-required fields', () => {
        expect(PropertyValidationService.validateCurrency(undefined, 'optionalFee')).toEqual([]);
        expect(PropertyValidationService.validateCurrency(null, 'optionalFee')).toEqual([]);
        expect(PropertyValidationService.validateCurrency('', 'optionalFee')).toEqual([]);
      });

      it('should validate with minimum constraints', () => {
        const options = { min: 500 };
        
        expect(PropertyValidationService.validateCurrency(600, 'rent', options)).toEqual([]);
        expect(PropertyValidationService.validateCurrency(500, 'rent', options)).toEqual([]);
        expect(PropertyValidationService.validateCurrency('750.50', 'rent', options)).toEqual([]);
      });

      it('should validate with maximum constraints', () => {
        const options = { max: 5000 };
        
        expect(PropertyValidationService.validateCurrency(4000, 'rent', options)).toEqual([]);
        expect(PropertyValidationService.validateCurrency(5000, 'rent', options)).toEqual([]);
        expect(PropertyValidationService.validateCurrency('3500.25', 'rent', options)).toEqual([]);
      });

      it('should validate with both min and max constraints', () => {
        const options = { min: 1000, max: 3000 };
        
        expect(PropertyValidationService.validateCurrency(1500, 'rent', options)).toEqual([]);
        expect(PropertyValidationService.validateCurrency(1000, 'rent', options)).toEqual([]);
        expect(PropertyValidationService.validateCurrency(3000, 'rent', options)).toEqual([]);
        expect(PropertyValidationService.validateCurrency('2250.75', 'rent', options)).toEqual([]);
      });
    });

    describe('Invalid currency validation', () => {
      it('should return error for required field when missing', () => {
        const options = { required: true };
        
        const undefinedResult = PropertyValidationService.validateCurrency(undefined, 'rent', options);
        expect(undefinedResult).toHaveLength(1);
        expect(undefinedResult[0]).toEqual({
          field: 'rent',
          message: 'rent is required',
          code: 'REQUIRED_FIELD',
        });

        const nullResult = PropertyValidationService.validateCurrency(null, 'rent', options);
        expect(nullResult).toHaveLength(1);
        expect(nullResult[0].code).toBe('REQUIRED_FIELD');

        const emptyResult = PropertyValidationService.validateCurrency('', 'rent', options);
        expect(emptyResult).toHaveLength(1);
        expect(emptyResult[0].code).toBe('REQUIRED_FIELD');
      });

      it('should return error for invalid number format', () => {
        const invalidValues = ['abc', 'not-a-number', '12.34.56', '$100'];
        
        invalidValues.forEach(value => {
          const result = PropertyValidationService.validateCurrency(value, 'rent');
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({
            field: 'rent',
            message: 'rent must be a valid number',
            code: 'INVALID_NUMBER',
          });
        });
      });

      it('should return error for negative values', () => {
        const negativeValues = [-100, -0.01, '-500', '-1250.75'];
        
        negativeValues.forEach(value => {
          const result = PropertyValidationService.validateCurrency(value, 'rent');
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({
            field: 'rent',
            message: 'rent cannot be negative',
            code: 'NEGATIVE_VALUE',
          });
        });
      });

      it('should return error for values below minimum', () => {
        const options = { min: 1000 };
        
        const belowMinValues = [500, 999.99, '750', '0'];
        
        belowMinValues.forEach(value => {
          const result = PropertyValidationService.validateCurrency(value, 'rent', options);
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({
            field: 'rent',
            message: 'rent must be at least $1000',
            code: 'BELOW_MINIMUM',
          });
        });
      });

      it('should return error for values above maximum', () => {
        const options = { max: 3000 };
        
        const aboveMaxValues = [3001, 5000, '3500.50', '10000'];
        
        aboveMaxValues.forEach(value => {
          const result = PropertyValidationService.validateCurrency(value, 'rent', options);
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({
            field: 'rent',
            message: 'rent cannot exceed $3000',
            code: 'ABOVE_MAXIMUM',
          });
        });
      });

      it('should return multiple errors for multiple violations', () => {
        const options = { min: 1000, max: 3000 };
        
        // Test negative value that's also below minimum
        const result = PropertyValidationService.validateCurrency(-500, 'rent', options);
        expect(result).toHaveLength(2);
        expect(result.some(error => error.code === 'BELOW_MINIMUM')).toBe(true);
        expect(result.some(error => error.code === 'NEGATIVE_VALUE')).toBe(true);
      });
    });
  });

  describe('validateDate', () => {
    describe('Valid date validation', () => {
      it('should validate valid date values', () => {
        const validDates = [
          new Date('2024-01-01'),
          new Date('2023-12-31'),
          '2024-06-15',
          '2023-01-01T00:00:00Z',
        ];
        
        validDates.forEach(date => {
          const result = PropertyValidationService.validateDate(date, 'availableDate');
          expect(result).toEqual([]);
        });
      });

      it('should allow undefined/null for non-required fields', () => {
        expect(PropertyValidationService.validateDate(undefined, 'optionalDate')).toEqual([]);
        expect(PropertyValidationService.validateDate(null, 'optionalDate')).toEqual([]);
        expect(PropertyValidationService.validateDate('', 'optionalDate')).toEqual([]);
      });

      it('should validate with future dates allowed', () => {
        const futureDate = new Date();
        futureDate.setFullYear(futureDate.getFullYear() + 1);
        
        const options = { allowFuture: true };
        const result = PropertyValidationService.validateDate(futureDate, 'futureDate', options);
        expect(result).toEqual([]);
      });

      it('should validate with date range constraints', () => {
        const minDate = new Date('2023-01-01');
        const maxDate = new Date('2024-12-31');
        const testDate = new Date('2024-06-15');
        
        const options = { minDate, maxDate };
        const result = PropertyValidationService.validateDate(testDate, 'testDate', options);
        expect(result).toEqual([]);
      });
    });

    describe('Invalid date validation', () => {
      it('should return error for required field when missing', () => {
        const options = { required: true };
        
        const undefinedResult = PropertyValidationService.validateDate(undefined, 'requiredDate', options);
        expect(undefinedResult).toHaveLength(1);
        expect(undefinedResult[0]).toEqual({
          field: 'requiredDate',
          message: 'requiredDate is required',
          code: 'REQUIRED_FIELD',
        });
      });

      it('should return error for invalid date format', () => {
        const invalidDates = [
          'not-a-date',
          '2024-13-01', // Invalid month
          '2024-02-30', // Invalid day
          'abc123',
          '32/12/2024',
        ];
        
        invalidDates.forEach(date => {
          const result = PropertyValidationService.validateDate(date, 'testDate');
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({
            field: 'testDate',
            message: 'testDate must be a valid date',
            code: 'INVALID_DATE',
          });
        });
      });

      it('should return error for future dates when not allowed', () => {
        const futureDate = new Date();
        futureDate.setDate(futureDate.getDate() + 1);
        
        const options = { allowFuture: false };
        const result = PropertyValidationService.validateDate(futureDate, 'pastDate', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'pastDate',
          message: 'pastDate cannot be in the future',
          code: 'FUTURE_DATE',
        });
      });

      it('should return error for dates before minimum', () => {
        const minDate = new Date('2023-01-01');
        const testDate = new Date('2022-12-31');
        
        const options = { minDate };
        const result = PropertyValidationService.validateDate(testDate, 'testDate', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'testDate',
          message: `testDate cannot be before ${minDate.toDateString()}`,
          code: 'BEFORE_MIN_DATE',
        });
      });

      it('should return error for dates after maximum', () => {
        const maxDate = new Date('2024-12-31');
        const testDate = new Date('2025-01-01');
        
        const options = { maxDate };
        const result = PropertyValidationService.validateDate(testDate, 'testDate', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'testDate',
          message: `testDate cannot be after ${maxDate.toDateString()}`,
          code: 'AFTER_MAX_DATE',
        });
      });
    });
  });

  describe('validateNumericField', () => {
    describe('Valid numeric validation', () => {
      it('should validate valid numeric values', () => {
        expect(PropertyValidationService.validateNumericField(5, 'bedrooms')).toEqual([]);
        expect(PropertyValidationService.validateNumericField(2.5, 'bathrooms')).toEqual([]);
        expect(PropertyValidationService.validateNumericField('3', 'floors')).toEqual([]);
        expect(PropertyValidationService.validateNumericField('1200.50', 'squareFeet')).toEqual([]);
        expect(PropertyValidationService.validateNumericField(0, 'parking')).toEqual([]);
      });

      it('should allow undefined/null for non-required fields', () => {
        expect(PropertyValidationService.validateNumericField(undefined, 'optionalField')).toEqual([]);
        expect(PropertyValidationService.validateNumericField(null, 'optionalField')).toEqual([]);
        expect(PropertyValidationService.validateNumericField('', 'optionalField')).toEqual([]);
      });

      it('should validate with minimum constraints', () => {
        const options = { min: 1 };
        
        expect(PropertyValidationService.validateNumericField(1, 'bedrooms', options)).toEqual([]);
        expect(PropertyValidationService.validateNumericField(5, 'bedrooms', options)).toEqual([]);
        expect(PropertyValidationService.validateNumericField('3', 'bedrooms', options)).toEqual([]);
      });

      it('should validate with maximum constraints', () => {
        const options = { max: 10 };
        
        expect(PropertyValidationService.validateNumericField(5, 'bedrooms', options)).toEqual([]);
        expect(PropertyValidationService.validateNumericField(10, 'bedrooms', options)).toEqual([]);
        expect(PropertyValidationService.validateNumericField('8', 'bedrooms', options)).toEqual([]);
      });

      it('should validate integers when required', () => {
        const options = { integer: true };
        
        expect(PropertyValidationService.validateNumericField(5, 'bedrooms', options)).toEqual([]);
        expect(PropertyValidationService.validateNumericField('3', 'bedrooms', options)).toEqual([]);
        expect(PropertyValidationService.validateNumericField(0, 'parking', options)).toEqual([]);
      });
    });

    describe('Invalid numeric validation', () => {
      it('should return error for required field when missing', () => {
        const options = { required: true };
        
        const result = PropertyValidationService.validateNumericField(undefined, 'bedrooms', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'bedrooms',
          message: 'bedrooms is required',
          code: 'REQUIRED_FIELD',
        });
      });

      it('should return error for invalid number format', () => {
        const invalidValues = ['abc', 'not-a-number', '12.34.56'];
        
        invalidValues.forEach(value => {
          const result = PropertyValidationService.validateNumericField(value, 'bedrooms');
          expect(result).toHaveLength(1);
          expect(result[0]).toEqual({
            field: 'bedrooms',
            message: 'bedrooms must be a valid number',
            code: 'INVALID_NUMBER',
          });
        });
      });

      it('should return error for negative values when not allowed', () => {
        const options = { allowNegative: false };
        
        const result = PropertyValidationService.validateNumericField(-1, 'bedrooms', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'bedrooms',
          message: 'bedrooms cannot be negative',
          code: 'NEGATIVE_VALUE',
        });
      });

      it('should return error for values below minimum', () => {
        const options = { min: 1 };
        
        const result = PropertyValidationService.validateNumericField(0, 'bedrooms', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'bedrooms',
          message: 'bedrooms must be at least 1',
          code: 'BELOW_MINIMUM',
        });
      });

      it('should return error for values above maximum', () => {
        const options = { max: 10 };
        
        const result = PropertyValidationService.validateNumericField(15, 'bedrooms', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'bedrooms',
          message: 'bedrooms cannot exceed 10',
          code: 'ABOVE_MAXIMUM',
        });
      });

      it('should return error for non-integers when integer required', () => {
        const options = { integer: true };
        
        const result = PropertyValidationService.validateNumericField(2.5, 'bedrooms', options);
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          field: 'bedrooms',
          message: 'bedrooms must be a whole number',
          code: 'NOT_INTEGER',
        });
      });
    });
  });

  describe('validateProperty', () => {
    describe('Valid property validation', () => {
      it('should validate a complete valid property', () => {
        const validProperty = TestDataFactory.createProperty({
          name: 'Test Property',
          propertyType: 'RESIDENTIAL',
          address: {
            street: '123 Main St',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
            country: 'Test Country',
            fullAddress: '123 Main St, Test City, TS 12345',
          },
          description: 'A beautiful test property',
          bedrooms: 3,
          bathrooms: 2,
          squareFeet: 1200,
          rent: 1500,
          deposit: 1500,
        });

        // Mock PropertyTypeManager responses
        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(true);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(validProperty);
        
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should validate minimal required property data', () => {
        const minimalProperty = {
          name: 'Minimal Property',
          propertyType: 'RESIDENTIAL',
          address: {
            street: '456 Oak Ave',
            city: 'Min City',
            state: 'MC',
            zipCode: '54321',
          },
        };

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(true);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(minimalProperty);
        
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });

      it('should validate commercial property with different constraints', () => {
        const commercialProperty = TestDataFactory.createProperty({
          name: 'Commercial Building',
          propertyType: 'COMMERCIAL',
          address: {
            street: '789 Business Blvd',
            city: 'Commerce City',
            state: 'CC',
            zipCode: '98765',
          },
          totalSquareFeet: 5000,
          parkingSpaces: 20,
          amenities: ['elevator', 'conference_room', 'parking'],
        });

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(true);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(commercialProperty);
        
        expect(result.valid).toBe(true);
        expect(result.errors).toEqual([]);
      });
    });

    describe('Invalid property validation', () => {
      it('should return errors for missing required fields', () => {
        const incompleteProperty = {
          // Missing name
          propertyType: 'RESIDENTIAL',
          // Missing address
        };

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(true);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(incompleteProperty);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors.some(error => error.field === 'name')).toBe(true);
        expect(result.errors.some(error => error.field === 'address')).toBe(true);
      });

      it('should return error for invalid property type', () => {
        const invalidProperty = {
          name: 'Invalid Property',
          propertyType: 'INVALID_TYPE',
          address: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
          },
        };

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(false);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([
          {
            field: 'propertyType',
            message: 'Invalid property type',
            code: 'INVALID_PROPERTY_TYPE',
          },
        ]);

        const result = PropertyValidationService.validateProperty(invalidProperty);
        
        expect(result.valid).toBe(false);
        expect(result.errors.some(error => error.field === 'propertyType')).toBe(true);
      });

      it('should return errors for invalid numeric fields', () => {
        const invalidProperty = TestDataFactory.createProperty({
          name: 'Test Property',
          propertyType: 'RESIDENTIAL',
          address: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
          },
          bedrooms: -1, // Invalid negative
          bathrooms: 'not-a-number', // Invalid format
          squareFeet: 0, // Invalid zero
          rent: -500, // Invalid negative
        });

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(true);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(invalidProperty);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Should have errors for negative bedrooms, invalid bathrooms format, etc.
        const errorFields = result.errors.map(error => error.field);
        expect(errorFields).toContain('bedrooms');
        expect(errorFields).toContain('bathrooms');
        expect(errorFields).toContain('rent');
      });

      it('should return errors for invalid address data', () => {
        const invalidProperty = {
          name: 'Test Property',
          propertyType: 'RESIDENTIAL',
          address: {
            // Missing required address fields
            street: '',
            city: '',
            state: '',
            zipCode: 'invalid-zip',
          },
        };

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(true);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(invalidProperty);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Should have errors for missing address components
        const errorFields = result.errors.map(error => error.field);
        expect(errorFields.some(field => field.includes('address'))).toBe(true);
      });

      it('should return errors for business rule violations', () => {
        const violatingProperty = TestDataFactory.createProperty({
          name: 'Violating Property',
          propertyType: 'RESIDENTIAL',
          address: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
          },
          bedrooms: 10, // Too many bedrooms for residential
          bathrooms: 1, // Too few bathrooms for number of bedrooms
          squareFeet: 100, // Too small for number of bedrooms
          rent: 50, // Too low rent
          deposit: 10000, // Deposit too high compared to rent
        });

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(true);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(violatingProperty);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        
        // Should have business rule violation errors
        const businessRuleErrors = result.errors.filter(error => 
          error.code.includes('BUSINESS_RULE') || 
          error.message.includes('ratio') ||
          error.message.includes('reasonable')
        );
        expect(businessRuleErrors.length).toBeGreaterThan(0);
      });
    });

    describe('Edge cases and complex validation', () => {
      it('should handle empty property object', () => {
        const emptyProperty = {};

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(false);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([]);

        const result = PropertyValidationService.validateProperty(emptyProperty);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it('should handle null/undefined property', () => {
        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);

        const nullResult = PropertyValidationService.validateProperty(null);
        expect(nullResult.valid).toBe(false);
        expect(nullResult.errors.length).toBeGreaterThan(0);

        const undefinedResult = PropertyValidationService.validateProperty(undefined);
        expect(undefinedResult.valid).toBe(false);
        expect(undefinedResult.errors.length).toBeGreaterThan(0);
      });

      it('should accumulate multiple validation errors correctly', () => {
        const multiErrorProperty = {
          // Multiple field violations
          name: '', // Empty required field
          propertyType: 'INVALID', // Invalid type
          address: null, // Null required field
          bedrooms: -1, // Negative number
          bathrooms: 'invalid', // Invalid format
          rent: 'not-a-number', // Invalid currency format
          availableDate: 'not-a-date', // Invalid date
        };

        const { PropertyTypeManager } = require('@utils/PropertyTypeManager');
        PropertyTypeManager.isValidPropertyType.mockReturnValue(false);
        PropertyTypeManager.getRequiredFields.mockReturnValue(['name', 'propertyType', 'address']);
        PropertyTypeManager.validateFieldValue.mockReturnValue([
          {
            field: 'propertyType',
            message: 'Invalid property type',
            code: 'INVALID_PROPERTY_TYPE',
          },
        ]);

        const result = PropertyValidationService.validateProperty(multiErrorProperty);
        
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(5); // Should have multiple errors
        
        // Verify we have errors for different types of violations
        const errorCodes = result.errors.map(error => error.code);
        expect(errorCodes).toContain('REQUIRED_FIELD');
        expect(errorCodes).toContain('INVALID_NUMBER');
        expect(errorCodes).toContain('NEGATIVE_VALUE');
      });
    });
  });
});