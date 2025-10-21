import { CURRENCIES } from '@interfaces/utils.interface';
import { OccupancyStatus, IProperty } from '@interfaces/property.interface';
import { PropertyTypeManager } from '@services/property/PropertyTypeManager';

describe('PropertyTypeManager', () => {
  describe('validateRequiredFields', () => {
    it('should validate required fields for different property types', () => {
      // Valid house property
      const houseData: Partial<IProperty> = {
        name: 'Test House',
        propertyType: 'house',
        address: { fullAddress: '123 Main St' },
        specifications: {
          totalArea: 1200,
          bedrooms: 3,
          bathrooms: 2,
        },
      };
      const houseResult = PropertyTypeManager.validateRequiredFields('house', houseData);
      expect(houseResult.isValid).toBe(true);
      expect(houseResult.missingFields).toEqual([]);

      // Valid apartment property (multi-unit)
      const apartmentData: Partial<IProperty> = {
        name: 'Test Apartment',
        propertyType: 'apartment',
        address: { fullAddress: '456 Oak Ave' },
        maxAllowedUnits: 10,
        specifications: { totalArea: 5000 },
      };
      const apartmentResult = PropertyTypeManager.validateRequiredFields(
        'apartment',
        apartmentData
      );
      expect(apartmentResult.isValid).toBe(true);
      expect(apartmentResult.missingFields).toEqual([]);

      // Missing required fields
      const incompleteData: Partial<IProperty> = {
        propertyType: 'house',
      };
      const incompleteResult = PropertyTypeManager.validateRequiredFields('house', incompleteData);
      expect(incompleteResult.isValid).toBe(false);
      expect(incompleteResult.missingFields).toContain('name');
      expect(incompleteResult.missingFields).toContain('address');
    });

    it('should validate address structure properly', () => {
      const dataWithInvalidAddress: Partial<IProperty> = {
        name: 'Test Property',
        propertyType: 'house',
        address: { fullAddress: '' }, // Empty address
        specifications: { totalArea: 1000, bedrooms: 2, bathrooms: 1 },
      };
      const result = PropertyTypeManager.validateRequiredFields('house', dataWithInvalidAddress);
      expect(result.isValid).toBe(false);
      expect(result.missingFields).toContain('address.fullAddress');
    });
  });

  describe('validatePropertyIntegrity', () => {
    it('should validate property integrity based on business rules', () => {
      // Valid property data
      const validData: Partial<IProperty> = {
        name: 'Valid Property',
        propertyType: 'house',
        maxAllowedUnits: 1,
        specifications: { totalArea: 1500 },
        yearBuilt: 2020,
        financialDetails: { purchasePrice: 300000 },
      };
      const validResult = PropertyTypeManager.validatePropertyIntegrity('house', validData);
      expect(validResult.isValid).toBe(true);
      expect(validResult.errors).toEqual([]);

      // Multi-unit property with bedrooms at property level (should be invalid)
      const multiUnitWithBedrooms: Partial<IProperty> = {
        propertyType: 'apartment',
        maxAllowedUnits: 5,
        specifications: { totalArea: 3000, bedrooms: 20 }, // Should manage at unit level
      };
      const multiUnitResult = PropertyTypeManager.validatePropertyIntegrity(
        'apartment',
        multiUnitWithBedrooms
      );
      expect(multiUnitResult.isValid).toBe(false);
      expect(multiUnitResult.errors).toContain(
        'Multi-unit properties should manage bedrooms at the unit level'
      );

      // Commercial property with bedrooms (invalid)
      const commercialWithBedrooms: Partial<IProperty> = {
        propertyType: 'commercial',
        specifications: { totalArea: 2000, bedrooms: 5 },
      };
      const commercialResult = PropertyTypeManager.validatePropertyIntegrity(
        'commercial',
        commercialWithBedrooms
      );
      expect(commercialResult.isValid).toBe(false);
      expect(commercialResult.errors).toContain('commercial properties should not have bedrooms');
    });

    it('should validate financial and year built constraints', () => {
      // Invalid year built
      const invalidYearData: Partial<IProperty> = {
        propertyType: 'house',
        yearBuilt: 1750, // Too old
      };
      const yearResult = PropertyTypeManager.validatePropertyIntegrity('house', invalidYearData);
      expect(yearResult.isValid).toBe(false);
      expect(yearResult.errors).toContain(
        'Year built must be between 1800 and 5 years in the future'
      );

      // Invalid purchase price
      const invalidPriceData: Partial<IProperty> = {
        propertyType: 'house',
        financialDetails: { purchasePrice: -50000 }, // Negative price
      };
      const priceResult = PropertyTypeManager.validatePropertyIntegrity('house', invalidPriceData);
      expect(priceResult.isValid).toBe(false);
      expect(priceResult.errors).toContain('Purchase price cannot be negative');
    });
  });

  describe('validateUnitCount', () => {
    it('should validate unit count constraints for different property types', () => {
      // Valid unit counts
      expect(PropertyTypeManager.validateUnitCount('house', 1).valid).toBe(true);
      expect(PropertyTypeManager.validateUnitCount('apartment', 5).valid).toBe(true);
      expect(PropertyTypeManager.validateUnitCount('condominium', 10).valid).toBe(true);

      // Invalid unit counts
      const invalidHouse = PropertyTypeManager.validateUnitCount('house', 0);
      expect(invalidHouse.valid).toBe(false);
      expect(invalidHouse.message).toContain('must be greater than 0');

      const invalidCondominium = PropertyTypeManager.validateUnitCount('condominium', 2);
      expect(invalidCondominium.valid).toBe(false);
      expect(invalidCondominium.message).toContain('must have at least 4 unit(s)');

      // Exceeding max units
      const tooManyUnits = PropertyTypeManager.validateUnitCount('house', 10);
      expect(tooManyUnits.valid).toBe(false);
      expect(tooManyUnits.message).toContain('cannot exceed');
    });
  });

  describe('validateTotalArea', () => {
    it('should validate area constraints for different property types', () => {
      // Valid areas
      expect(PropertyTypeManager.validateTotalArea('house', 800).valid).toBe(true);
      expect(PropertyTypeManager.validateTotalArea('apartment', 1000).valid).toBe(true);
      expect(PropertyTypeManager.validateTotalArea('commercial', 500).valid).toBe(true);

      // Invalid areas
      const negativeArea = PropertyTypeManager.validateTotalArea('house', -100);
      expect(negativeArea.valid).toBe(false);
      expect(negativeArea.message).toBe('Total area must be greater than 0');

      const tooSmallHouse = PropertyTypeManager.validateTotalArea('house', 300);
      expect(tooSmallHouse.valid).toBe(false);
      expect(tooSmallHouse.message).toContain('must have at least 500 sq ft');

      const tooSmallApartment = PropertyTypeManager.validateTotalArea('apartment', 200);
      expect(tooSmallApartment.valid).toBe(false);
      expect(tooSmallApartment.message).toContain('must have at least 500 sq ft');
    });
  });

  describe('validatePropertyTypeCompatibility', () => {
    it('should validate property type and configuration compatibility', () => {
      // Valid compatibilities
      const validApartment = PropertyTypeManager.validatePropertyTypeCompatibility('apartment', {
        maxAllowedUnits: 10,
      });
      expect(validApartment.isCompatible).toBe(true);

      const validHouse = PropertyTypeManager.validatePropertyTypeCompatibility('house', {
        maxAllowedUnits: 1,
      });
      expect(validHouse.isCompatible).toBe(true);

      // Invalid compatibilities
      const invalidApartment = PropertyTypeManager.validatePropertyTypeCompatibility('apartment', {
        maxAllowedUnits: 1, // Multi-unit type with single unit
      });
      expect(invalidApartment.isCompatible).toBe(false);
      expect(invalidApartment.message).toContain('multi-unit and must have more than 1 unit');

      const invalidHouse = PropertyTypeManager.validatePropertyTypeCompatibility('house', {
        maxAllowedUnits: 10, // Single-unit type with too many units
      });
      expect(invalidHouse.isCompatible).toBe(false);
      expect(invalidHouse.message).toContain('should typically have');
    });
  });

  describe('validateOccupancyStatusChange', () => {
    it('should validate occupancy status transitions', () => {
      const existingData: Partial<IProperty> = {
        occupancyStatus: 'vacant' as OccupancyStatus,
        maxAllowedUnits: 1,
      };

      // Valid transition with rental amount
      const newDataWithRental: Partial<IProperty> = {
        occupancyStatus: 'occupied' as OccupancyStatus,
        fees: {
          rentalAmount: 1500,
          taxAmount: 100,
          currency: CURRENCIES.USD,
          managementFees: 150,
        },
      };
      const validTransition = PropertyTypeManager.validateOccupancyStatusChange(
        'house',
        existingData,
        newDataWithRental
      );
      expect(validTransition.isValid).toBe(true);
      expect(validTransition.errors).toEqual([]);

      // Invalid transition without rental amount
      const newDataWithoutRental: Partial<IProperty> = {
        occupancyStatus: 'occupied' as OccupancyStatus,
      };
      const invalidTransition = PropertyTypeManager.validateOccupancyStatusChange(
        'house',
        existingData,
        newDataWithoutRental
      );
      expect(invalidTransition.isValid).toBe(false);
      expect(invalidTransition.errors).toContain('Occupied properties must have a rental amount');

      // Invalid partial occupancy for single unit
      const partiallyOccupied: Partial<IProperty> = {
        occupancyStatus: 'partially_occupied' as OccupancyStatus,
        maxAllowedUnits: 1,
      };
      const partialResult = PropertyTypeManager.validateOccupancyStatusChange(
        'house',
        existingData,
        partiallyOccupied
      );
      expect(partialResult.isValid).toBe(false);
      expect(partialResult.errors).toContain('Single-unit properties cannot be partially occupied');
    });
  });

  describe('utility methods', () => {
    it('should provide correct utility method results', () => {
      // Field requirement checks
      expect(PropertyTypeManager.isFieldRequired('house', 'name')).toBe(true);
      expect(PropertyTypeManager.isFieldRequired('apartment', 'maxAllowedUnits')).toBe(true);

      // Multi-unit support checks
      expect(PropertyTypeManager.supportsMultipleUnits('apartment')).toBe(true);
      expect(PropertyTypeManager.supportsMultipleUnits('house')).toBe(false);

      // Bedroom/bathroom validation
      expect(PropertyTypeManager.shouldValidateBedBath('house', 1)).toBe(true);
      expect(PropertyTypeManager.shouldValidateBedBath('apartment', 10)).toBe(false);

      // Min/default units
      expect(PropertyTypeManager.getMinUnits('condominium')).toBe(4);
      expect(PropertyTypeManager.getDefaultUnits('apartment')).toBe(4);

      // Property level bedroom/bathroom allowance
      expect(PropertyTypeManager.allowsBedroomsAtPropertyLevel('house')).toBe(true);
      expect(PropertyTypeManager.allowsBedroomsAtPropertyLevel('commercial')).toBe(false);
    });
  });
});
