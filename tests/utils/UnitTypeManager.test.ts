import { UnitTypeManager } from '@utils/UnitTypeManager';
import { CURRENCIES } from '@interfaces/utils.interface';
import { PropertyUnitType, IPropertyUnit } from '@interfaces/propertyUnit.interface';

describe('UnitTypeManager', () => {
  describe('validateRequiredFields', () => {
    it('should validate required fields for different unit types', () => {
      const residentialUnit: Partial<IPropertyUnit> = {
        unitNumber: 'A101',
        unitType: 'residential' as PropertyUnitType,
        specifications: {
          totalArea: 850,
          bedrooms: 2,
          bathrooms: 1,
        },
        fees: {
          rentAmount: 1200,
          currency: CURRENCIES.USD,
        },
      };
      const residentialResult = UnitTypeManager.validateRequiredFields(
        'residential',
        residentialUnit
      );
      expect(residentialResult.isValid).toBe(true);
      expect(residentialResult.missingFields).toEqual([]);

      const storageUnit: Partial<IPropertyUnit> = {
        unitNumber: 'S001',
        unitType: 'storage' as PropertyUnitType,
        specifications: {
          totalArea: 100,
        },
      };
      const storageResult = UnitTypeManager.validateRequiredFields('storage', storageUnit);
      expect(storageResult.isValid).toBe(true);
      expect(storageResult.missingFields).toEqual([]);

      const incompleteUnit: Partial<IPropertyUnit> = {
        unitType: 'residential' as PropertyUnitType,
      };
      const incompleteResult = UnitTypeManager.validateRequiredFields(
        'residential',
        incompleteUnit
      );
      expect(incompleteResult.isValid).toBe(false);
      expect(incompleteResult.missingFields).toContain('unitNumber');
      expect(incompleteResult.missingFields).toContain('specifications');
    });

    it('should validate residential unit bedroom/bathroom requirements', () => {
      const residentialWithoutBedrooms: Partial<IPropertyUnit> = {
        unitNumber: 'A101',
        unitType: 'residential' as PropertyUnitType,
        specifications: {
          totalArea: 850,
        },
        fees: {
          rentAmount: 1200,
          currency: CURRENCIES.USD,
        },
      };
      const result = UnitTypeManager.validateRequiredFields(
        'residential',
        residentialWithoutBedrooms
      );
      expect(result.isValid).toBe(false);
      expect(result.missingFields).toContain('specifications.bedrooms');
      expect(result.missingFields).toContain('specifications.bathrooms');
    });
  });

  describe('validateUnitIntegrity', () => {
    it('should validate unit data integrity based on unit type business rules', () => {
      const validResidential: Partial<IPropertyUnit> = {
        unitType: 'residential' as PropertyUnitType,
        specifications: {
          totalArea: 1200,
          bedrooms: 3,
          bathrooms: 2,
        },
        fees: {
          rentAmount: 1500,
          currency: CURRENCIES.USD,
        },
        status: 'available',
      };
      const validResult = UnitTypeManager.validateUnitIntegrity('residential', validResidential);
      expect(validResult.isValid).toBe(true);
      expect(validResult.errors).toEqual([]);

      const invalidStorage: Partial<IPropertyUnit> = {
        unitType: 'storage' as PropertyUnitType,
        specifications: {
          totalArea: 100,
          bedrooms: 2,
          bathrooms: 1,
        },
      };
      const storageResult = UnitTypeManager.validateUnitIntegrity('storage', invalidStorage);
      expect(storageResult.isValid).toBe(false);
      expect(storageResult.errors).toContain('Storage units cannot have bedrooms');
      expect(storageResult.errors).toContain('Storage units cannot have bathrooms');

      const commercialWithBedrooms: Partial<IPropertyUnit> = {
        unitType: 'commercial' as PropertyUnitType,
        specifications: {
          totalArea: 2000,
          bedrooms: 3,
        },
      };
      const commercialResult = UnitTypeManager.validateUnitIntegrity(
        'commercial',
        commercialWithBedrooms
      );
      expect(commercialResult.isValid).toBe(false);
      expect(commercialResult.errors).toContain('Commercial units should not have bedrooms');
    });

    it('should validate rental amounts and area constraints', () => {
      const negativeRent: Partial<IPropertyUnit> = {
        unitType: 'residential' as PropertyUnitType,
        fees: {
          rentAmount: -500,
          currency: CURRENCIES.USD,
        },
      };
      const rentResult = UnitTypeManager.validateUnitIntegrity('residential', negativeRent);
      expect(rentResult.isValid).toBe(false);
      expect(rentResult.errors).toContain('Rental amount cannot be negative');

      const highRent: Partial<IPropertyUnit> = {
        unitType: 'residential' as PropertyUnitType,
        fees: {
          rentAmount: 150000,
          currency: CURRENCIES.USD,
        },
      };
      const highRentResult = UnitTypeManager.validateUnitIntegrity('residential', highRent);
      expect(highRentResult.isValid).toBe(false);
      expect(highRentResult.errors).toContain('Rental amount seems unreasonably high');

      const invalidArea: Partial<IPropertyUnit> = {
        unitType: 'residential' as PropertyUnitType,
        specifications: {
          totalArea: -100,
        },
      };
      const areaResult = UnitTypeManager.validateUnitIntegrity('residential', invalidArea);
      expect(areaResult.isValid).toBe(false);
      expect(areaResult.errors).toContain('Total area must be greater than 0');
    });

    it('should validate residential unit bedroom/bathroom logic', () => {
      const bedroomsNoBathrooms: Partial<IPropertyUnit> = {
        unitType: 'residential' as PropertyUnitType,
        specifications: {
          totalArea: 850,
          bedrooms: 2,
          bathrooms: 0,
        },
      };
      const result = UnitTypeManager.validateUnitIntegrity('residential', bedroomsNoBathrooms);
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(
        'Residential units with bedrooms must have at least one bathroom'
      );
    });
  });

  describe('validateUnitPropertyCompatibility', () => {
    it('should validate unit type compatibility with property types', () => {
      const validResidential = UnitTypeManager.validateUnitPropertyCompatibility(
        'apartment',
        'residential'
      );
      expect(validResidential.isCompatible).toBe(true);

      const validCommercial = UnitTypeManager.validateUnitPropertyCompatibility(
        'commercial',
        'commercial'
      );
      expect(validCommercial.isCompatible).toBe(true);

      const validStorage = UnitTypeManager.validateUnitPropertyCompatibility(
        'condominium',
        'storage'
      );
      expect(validStorage.isCompatible).toBe(true);

      const invalidStorage = UnitTypeManager.validateUnitPropertyCompatibility(
        'apartment',
        'storage'
      );
      expect(invalidStorage.isCompatible).toBe(false);
      expect(invalidStorage.message).toContain(
        'Storage units are only allowed in condominium, mixed-use, or industrial properties'
      );

      const invalidCommercial = UnitTypeManager.validateUnitPropertyCompatibility(
        'apartment',
        'commercial'
      );
      expect(invalidCommercial.isCompatible).toBe(false);
      expect(invalidCommercial.message).toContain(
        'Commercial units are only allowed in commercial, mixed-use, or industrial properties'
      );

      const invalidResidential = UnitTypeManager.validateUnitPropertyCompatibility(
        'commercial',
        'residential'
      );
      expect(invalidResidential.isCompatible).toBe(false);
      expect(invalidResidential.message).toContain(
        'Residential units are only allowed in residential or mixed-use properties'
      );
    });
  });

  describe('validateRentChange', () => {
    it('should validate rental amount changes within acceptable limits', () => {
      const validChange = UnitTypeManager.validateRentChange(1000, 1150);
      expect(validChange.isValid).toBe(true);

      const invalidChange = UnitTypeManager.validateRentChange(1000, 1300);
      expect(invalidChange.isValid).toBe(false);
      expect(invalidChange.message).toContain(
        'Rent change of 30.0% exceeds maximum allowed change of 20%'
      );

      const customLimitChange = UnitTypeManager.validateRentChange(1000, 1400, 50);
      expect(customLimitChange.isValid).toBe(true);

      const negativeRent = UnitTypeManager.validateRentChange(-100, 1000);
      expect(negativeRent.isValid).toBe(false);
      expect(negativeRent.message).toBe('Rent amounts must be positive');
    });
  });

  describe('validateStatusTransition', () => {
    it('should validate unit status transitions according to business rules', () => {
      expect(UnitTypeManager.validateStatusTransition('available', 'occupied').isValid).toBe(true);
      expect(UnitTypeManager.validateStatusTransition('occupied', 'maintenance').isValid).toBe(
        true
      );
      expect(UnitTypeManager.validateStatusTransition('maintenance', 'available').isValid).toBe(
        true
      );
      expect(UnitTypeManager.validateStatusTransition('reserved', 'occupied').isValid).toBe(true);

      const invalidTransition = UnitTypeManager.validateStatusTransition('occupied', 'reserved');
      expect(invalidTransition.isValid).toBe(false);
      expect(invalidTransition.message).toBe('Cannot transition from occupied to reserved');

      const invalidCurrentStatus = UnitTypeManager.validateStatusTransition(
        'invalid_status',
        'available'
      );
      expect(invalidCurrentStatus.isValid).toBe(false);
      expect(invalidCurrentStatus.message).toBe('Invalid current status: invalid_status');
    });
  });

  describe('utility methods', () => {
    it('should provide correct utility method results', () => {
      const residentialFields = UnitTypeManager.getRequiredFields('residential');
      expect(Array.isArray(residentialFields)).toBe(true);

      expect(UnitTypeManager.isFieldRequired('residential', 'unitNumber')).toBeDefined();

      const validUnitNumber = UnitTypeManager.validateUnitNumber('A101', 'apartment');
      expect(validUnitNumber.isValid).toBe(true);

      const invalidUnitNumber = UnitTypeManager.validateUnitNumber('', 'apartment');
      expect(invalidUnitNumber.isValid).toBe(false);
      expect(invalidUnitNumber.message).toBe('Unit number is required');

      const tooLongUnitNumber = UnitTypeManager.validateUnitNumber('1234567890', 'apartment');
      expect(tooLongUnitNumber.isValid).toBe(false);
      expect(tooLongUnitNumber.message).toBe('Unit number is too long (max 9 characters)');

      const invalidCharacters = UnitTypeManager.validateUnitNumber('A@101', 'apartment');
      expect(invalidCharacters.isValid).toBe(false);
      expect(invalidCharacters.message).toBe('Unit number contains invalid characters');

      const rules = UnitTypeManager.getRules('residential');
      expect(rules).toBeDefined();
      expect(rules.requiredFields).toBeDefined();
    });
  });
});
