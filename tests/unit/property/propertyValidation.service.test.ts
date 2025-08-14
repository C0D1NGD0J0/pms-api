import { createMockNewProperty } from '@tests/helpers';
import { PropertyValidationService } from '@services/property/propertyValidation.service';

describe('PropertyValidationService', () => {
  describe('validateCurrency', () => {
    it('should validate valid currency values', () => {
      // Act
      const result = PropertyValidationService.validateCurrency(1000, 'rentAmount', {
        min: 0,
        max: 10000,
      });

      // Assert
      expect(result).toEqual([]);
    });

    it('should reject negative currency values', () => {
      // Act
      const result = PropertyValidationService.validateCurrency(-500, 'rentAmount');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'rentAmount',
        message: 'rentAmount cannot be negative',
        code: 'NEGATIVE_VALUE',
      });
    });

    it('should reject NaN currency values', () => {
      // Act
      const result = PropertyValidationService.validateCurrency(NaN, 'rentAmount');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'rentAmount',
        message: 'rentAmount must be a valid number',
        code: 'INVALID_NUMBER',
      });
    });

    it('should enforce minimum bounds', () => {
      // Act
      const result = PropertyValidationService.validateCurrency(50, 'rentAmount', {
        min: 100,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'rentAmount',
        message: 'rentAmount must be at least $100',
        code: 'BELOW_MINIMUM',
      });
    });

    it('should enforce maximum bounds', () => {
      // Act
      const result = PropertyValidationService.validateCurrency(15000, 'rentAmount', {
        max: 10000,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'rentAmount',
        message: 'rentAmount cannot exceed $10000',
        code: 'ABOVE_MAXIMUM',
      });
    });
  });

  describe('validateDate', () => {
    it('should validate valid date values', () => {
      // Arrange
      const validDate = new Date('2020-01-01');

      // Act
      const result = PropertyValidationService.validateDate(validDate, 'purchaseDate', {
        allowFuture: false,
      });

      // Assert
      expect(result).toEqual([]);
    });

    it('should reject invalid date formats', () => {
      // Act
      const result = PropertyValidationService.validateDate('invalid-date', 'purchaseDate');

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'purchaseDate',
        message: 'purchaseDate must be a valid date',
        code: 'INVALID_DATE',
      });
    });

    it('should reject future dates when not allowed', () => {
      // Arrange
      const futureDate = new Date(Date.now() + 24 * 60 * 60 * 1000);

      // Act
      const result = PropertyValidationService.validateDate(futureDate, 'purchaseDate', {
        allowFuture: false,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'purchaseDate',
        message: 'purchaseDate cannot be in the future',
        code: 'FUTURE_DATE',
      });
    });
  });

  describe('validateNumericField', () => {
    it('should validate valid numeric values', () => {
      // Act
      const result = PropertyValidationService.validateNumericField(3, 'bedrooms', 'house', {
        min: 1,
        max: 10,
        integer: true,
      });

      // Assert
      expect(result).toEqual([]);
    });

    it('should reject non-integer values when integer required', () => {
      // Act
      const result = PropertyValidationService.validateNumericField(2.5, 'bedrooms', 'house', {
        integer: true,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'bedrooms',
        message: 'bedrooms must be a whole number',
        code: 'NOT_INTEGER',
      });
    });

    it('should enforce numeric field bounds', () => {
      // Act
      const result = PropertyValidationService.validateNumericField(0, 'bedrooms', 'house', {
        min: 1,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'bedrooms',
        message: 'bedrooms must be at least 1',
        code: 'BELOW_MINIMUM',
      });
    });
  });

  describe('validateProperty', () => {
    it('should validate a valid property for creation', () => {
      // Arrange
      const validPropertyData = createMockNewProperty({
        name: 'Test Property',
        address: {
          fullAddress: '123 Main St, City, State',
        },
        propertyType: 'house',
        maxAllowedUnits: 1,
        occupancyStatus: 'vacant', // Ensure compatible with single-unit property
        specifications: {
          totalArea: 1500,
          bedrooms: 3,
          bathrooms: 2,
        },
      });

      // Act
      const result = PropertyValidationService.validateProperty(validPropertyData, false);

      // Assert
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject property with invalid name length', () => {
      // Arrange
      const invalidPropertyData = createMockNewProperty({
        name: 'AB', // Too short
        fullAddress: '123 Main St, City, State',
      });

      // Act
      const result = PropertyValidationService.validateProperty(invalidPropertyData, false);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'name')).toBe(true);
    });

    it('should reject property with invalid address length', () => {
      // Arrange
      const invalidPropertyData = createMockNewProperty({
        name: 'Valid Property Name',
        fullAddress: '123', // Too short
      });

      // Act
      const result = PropertyValidationService.validateProperty(invalidPropertyData, false);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'fullAddress')).toBe(true);
    });

    it('should validate business rules for occupied properties', () => {
      // Arrange
      const occupiedPropertyData = createMockNewProperty({
        name: 'Test Property',
        fullAddress: '123 Main St, City, State',
        occupancyStatus: 'occupied',
        fees: {
          rentalAmount: 0, // Invalid for occupied property
          managementFees: 100,
          taxAmount: 200,
          currency: 'USD' as const,
        },
      });

      // Act
      const result = PropertyValidationService.validateProperty(occupiedPropertyData, false);

      // Assert
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === 'rentalAmount')).toBe(true);
    });
  });

  describe('validateFieldByType', () => {
    it('should validate currency field type', () => {
      // Act
      const result = PropertyValidationService.validateFieldByType(1000, 'currency', 'rentAmount', {
        min: 0,
        max: 10000,
      });

      // Assert
      expect(result).toEqual([]);
    });

    it('should validate text field type with required validation', () => {
      // Act
      const result = PropertyValidationService.validateFieldByType('', 'text', 'propertyName', {
        required: true,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'propertyName',
        message: 'propertyName is required',
        code: 'REQUIRED_FIELD',
      });
    });

    it('should validate text field length constraints', () => {
      // Act
      const result = PropertyValidationService.validateFieldByType('AB', 'text', 'propertyName', {
        minLength: 5,
      });

      // Assert
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        field: 'propertyName',
        message: 'propertyName must be at least 5 characters',
        code: 'TOO_SHORT',
      });
    });
  });
});
