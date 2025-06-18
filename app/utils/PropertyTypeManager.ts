import { PropertyTypeRules, PropertyTypeRule, IProperty } from '@interfaces/property.interface';

/**
 * Schema-based validation for backend property objects
 * Validates against actual TypeScript interface structure
 */
function createRule(rule: PropertyTypeRule): PropertyTypeRule {
  return rule;
}

export const propertyTypeRules: PropertyTypeRules = {
  apartment: createRule({
    minUnits: 2,
    validateBedBath: false,
    isMultiUnit: true,
    defaultUnits: 4,
    visibleFields: {
      core: [],
      specifications: [],
      financial: [],
      amenities: [],
      documents: [],
      unit: [],
    },
    requiredFields: ['name', 'propertyType', 'address', 'totalUnits'],
    validationRules: {
      minTotalArea: 500,
      maxUnits: 500,
      allowBedrooms: false, // Managed at unit level
      allowBathrooms: false, // Managed at unit level
    },
    helpText: {},
  }),

  commercial: createRule({
    minUnits: 1,
    validateBedBath: false,
    isMultiUnit: true,
    defaultUnits: 4,
    visibleFields: {
      core: [],
      specifications: [],
      financial: [],
      amenities: [],
      documents: [],
      unit: [],
    },
    requiredFields: ['name', 'propertyType', 'address', 'totalUnits'],
    validationRules: {
      minTotalArea: 200,
      maxUnits: 100,
      allowBedrooms: false, // Commercial properties shouldn't have bedrooms at property level
      allowBathrooms: true, // Can have restrooms
    },
    helpText: {},
  }),

  condominium: createRule({
    minUnits: 4,
    defaultUnits: 4,
    isMultiUnit: true,
    validateBedBath: false,
    visibleFields: {
      core: [],
      specifications: [],
      financial: [],
      amenities: [],
      documents: [],
      unit: [],
    },
    requiredFields: ['name', 'propertyType', 'address', 'totalUnits'],
    validationRules: {
      minTotalArea: 1000,
      maxUnits: 1000,
      allowBedrooms: false,
      allowBathrooms: false,
      requiresElevator: true,
    },
    helpText: {},
  }),

  house: createRule({
    minUnits: 1,
    validateBedBath: true,
    isMultiUnit: false,
    defaultUnits: 1,
    visibleFields: {
      core: [],
      specifications: [],
      financial: [],
      amenities: [],
      documents: [],
      unit: [],
    },
    requiredFields: ['name', 'propertyType', 'address', 'specifications'],
    validationRules: {
      minTotalArea: 500,
      maxUnits: 3, // Houses can be duplexes/triplexes
      allowBedrooms: true,
      allowBathrooms: true,
    },
    helpText: {},
  }),

  industrial: createRule({
    minUnits: 1,
    validateBedBath: false,
    isMultiUnit: false,
    defaultUnits: 1,
    visibleFields: {
      core: [],
      specifications: [],
      financial: [],
      amenities: [],
      documents: [],
      unit: [],
    },
    requiredFields: ['name', 'propertyType', 'address', 'specifications'],
    validationRules: {
      minTotalArea: 1000,
      maxUnits: 10,
      allowBedrooms: false,
      allowBathrooms: true,
    },
    helpText: {},
  }),

  townhouse: createRule({
    minUnits: 1,
    validateBedBath: true,
    isMultiUnit: false,
    defaultUnits: 1,
    visibleFields: {
      core: [],
      specifications: [],
      financial: [],
      amenities: [],
      documents: [],
      unit: [],
    },
    requiredFields: ['name', 'propertyType', 'address', 'specifications'],
    validationRules: {
      minTotalArea: 800,
      maxUnits: 4, // Some townhouses can be duplexes/triplexes
      allowBedrooms: true,
      allowBathrooms: true,
    },
    helpText: {},
  }),
};

/**
 * PropertyTypeManager - Manages property type validation and business rules
 * Focuses on data validation and business logic for backend operations
 */
export class PropertyTypeManager {
  /**
   * Validates that a property has all required fields for its type using schema-based validation
   *
   * @param propertyType The type of property
   * @param propertyData The property data to validate (matches IProperty interface)
   * @returns Object with isValid boolean and missing fields array
   */
  static validateRequiredFields(
    propertyType: string,
    propertyData: Partial<IProperty>
  ): { isValid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];

    // Core required fields for all properties
    if (!propertyData.name || propertyData.name.trim() === '') {
      missingFields.push('name');
    }

    if (!propertyData.propertyType) {
      missingFields.push('propertyType');
    }

    if (!propertyData.address) {
      missingFields.push('address');
    } else {
      // Validate address object structure
      if (!propertyData.address.fullAddress || propertyData.address.fullAddress.trim() === '') {
        missingFields.push('address.fullAddress');
      }
    }

    // Property type specific validation
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;

    // Multi-unit properties require totalUnits
    if (rules.isMultiUnit) {
      if (!propertyData.totalUnits || propertyData.totalUnits <= 0) {
        missingFields.push('totalUnits');
      }
    }

    // Properties that need specifications
    if (propertyType !== 'land') {
      if (!propertyData.specifications) {
        missingFields.push('specifications');
      } else {
        // Validate specifications object
        if (!propertyData.specifications.totalArea || propertyData.specifications.totalArea <= 0) {
          missingFields.push('specifications.totalArea');
        }

        // Industrial properties require lot size
        if (propertyType === 'industrial') {
          if (!propertyData.specifications.lotSize || propertyData.specifications.lotSize <= 0) {
            missingFields.push('specifications.lotSize');
          }
        }

        // Single-family properties should have bedroom/bathroom info
        if (['townhouse', 'house'].includes(propertyType) && !rules.isMultiUnit) {
          if (
            propertyData.specifications.bedrooms === undefined ||
            propertyData.specifications.bedrooms < 0
          ) {
            missingFields.push('specifications.bedrooms');
          }
          if (
            propertyData.specifications.bathrooms === undefined ||
            propertyData.specifications.bathrooms < 0
          ) {
            missingFields.push('specifications.bathrooms');
          }
        }
      }
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Validates property data integrity based on property type business rules
   *
   * @param propertyType The type of property
   * @param propertyData The property data to validate
   * @returns Object with validation results and errors
   */
  static validatePropertyIntegrity(
    propertyType: string,
    propertyData: Partial<IProperty>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;

    // Validate total units
    if (propertyData.totalUnits !== undefined) {
      const unitValidation = this.validateUnitCount(propertyType, propertyData.totalUnits);
      if (!unitValidation.valid && unitValidation.message) {
        errors.push(unitValidation.message);
      }
    }

    // Validate specifications object
    if (propertyData.specifications) {
      const areaValidation = this.validateTotalArea(
        propertyType,
        propertyData.specifications.totalArea
      );
      if (!areaValidation.valid && areaValidation.message) {
        errors.push(areaValidation.message);
      }

      // Multi-unit properties should not have bedrooms/bathrooms at property level
      if (rules.isMultiUnit && propertyData.totalUnits && propertyData.totalUnits > 1) {
        if (propertyData.specifications.bedrooms && propertyData.specifications.bedrooms > 0) {
          errors.push('Multi-unit properties should manage bedrooms at the unit level');
        }
        if (propertyData.specifications.bathrooms && propertyData.specifications.bathrooms > 0) {
          errors.push('Multi-unit properties should manage bathrooms at the unit level');
        }
      }

      // Commercial/Industrial properties should not have bedrooms at property level
      if (['commercial', 'industrial'].includes(propertyType)) {
        if (propertyData.specifications.bedrooms && propertyData.specifications.bedrooms > 0) {
          errors.push(`${propertyType} properties should not have bedrooms`);
        }
      }
    }

    // Validate occupancy status and related business rules
    if (propertyData.occupancyStatus) {
      const occupancyValidation = this.validateOccupancyStatus(propertyType, propertyData);
      if (!occupancyValidation.isValid) {
        errors.push(...occupancyValidation.errors);
      }
    }

    // Validate year built is reasonable
    if (propertyData.yearBuilt !== undefined) {
      const currentYear = new Date().getFullYear();
      if (propertyData.yearBuilt < 1800 || propertyData.yearBuilt > currentYear + 5) {
        errors.push('Year built must be between 1800 and 5 years in the future');
      }
    }

    // Validate financial data
    if (propertyData.financialDetails?.purchasePrice !== undefined) {
      if (propertyData.financialDetails.purchasePrice < 0) {
        errors.push('Purchase price cannot be negative');
      }
      if (propertyData.financialDetails.purchasePrice > 100000000) {
        errors.push('Purchase price seems unreasonably high');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates occupancy status and related business rules
   *
   * @param propertyType The type of property
   * @param propertyData The property data to validate
   * @returns Object with validation results and errors
   */
  static validateOccupancyStatus(
    propertyType: string,
    propertyData: Partial<IProperty>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];
    const totalUnits = propertyData.totalUnits || 1;

    // Validate occupied properties have rental amount
    if (propertyData.occupancyStatus === 'occupied') {
      const rentalValidation = this.validateRentalAmount(propertyData.fees?.rentalAmount);
      if (!rentalValidation.isValid) {
        errors.push('Occupied properties must have a valid rental amount');
      }
    }

    // Validate partially occupied properties are multi-unit
    if (propertyData.occupancyStatus === 'partially_occupied') {
      if (totalUnits <= 1) {
        errors.push('Single-unit properties cannot be partially occupied');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates and normalizes rental amount
   *
   * @param amount The rental amount to validate (can be string or number)
   * @returns Object with validation result and normalized amount
   */
  static validateRentalAmount(amount: any): { isValid: boolean; normalizedAmount?: number } {
    if (amount === undefined || amount === null || amount === '') {
      return { isValid: false };
    }

    const normalizedAmount = typeof amount === 'string' ? parseFloat(amount) : amount;

    if (isNaN(normalizedAmount) || normalizedAmount <= 0) {
      return { isValid: false };
    }

    return {
      isValid: true,
      normalizedAmount,
    };
  }

  /**
   * Determines if a field is required based on property type rules
   *
   * @param propertyType The type of property
   * @param fieldName The field to check
   * @returns Whether the field is required
   */
  static isFieldRequired(propertyType: string, fieldName: string): boolean {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.requiredFields?.includes(fieldName) || false;
  }

  /**
   * Gets validation rules for a property type
   *
   * @param propertyType The type of property
   * @returns The validation rules object
   */
  static getValidationRules(propertyType: string): PropertyTypeRule['validationRules'] {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.validationRules;
  }

  /**
   * Determines if a property type supports multiple units
   *
   * @param propertyType The type of property
   * @returns Whether the property type supports multiple units
   */
  static supportsMultipleUnits(propertyType: string): boolean {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.isMultiUnit;
  }

  /**
   * Determines if a property should validate bedroom/bathroom at property level
   *
   * @param propertyType The type of property
   * @param totalUnits The number of units in the property
   * @returns Whether bedroom/bathroom fields should be validated
   */
  static shouldValidateBedBath(propertyType: string, totalUnits: number): boolean {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;

    // Don't validate bed/bath at property level for:
    // 1. Multi-unit property types (like apartments)
    // 2. Single-family homes that have been converted to multiple units
    if ((rules.isMultiUnit || totalUnits > 1) && !rules.validateBedBath) {
      return false;
    }

    return true;
  }

  /**
   * Gets the minimum number of units for a property type
   *
   * @param propertyType The type of property
   * @returns Minimum number of units
   */
  static getMinUnits(propertyType: string): number {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.minUnits;
  }

  /**
   * Gets the default number of units for a property type
   *
   * @param propertyType The type of property
   * @returns Default number of units
   */
  static getDefaultUnits(propertyType: string): number {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.defaultUnits;
  }

  /**
   * Gets the rule object for a specific property type
   *
   * @param propertyType The type of property
   * @returns The rule object for the property type
   */
  static getRules(propertyType: string): PropertyTypeRule {
    return propertyTypeRules[propertyType] || propertyTypeRules.house;
  }

  /**
   * Determines if bedrooms are allowed at property level
   *
   * @param propertyType The type of property
   * @returns Whether bedrooms are allowed at property level
   */
  static allowsBedroomsAtPropertyLevel(propertyType: string): boolean {
    const rules = this.getValidationRules(propertyType);
    return rules?.allowBedrooms !== false;
  }

  /**
   * Determines if bathrooms are allowed at property level
   *
   * @param propertyType The type of property
   * @returns Whether bathrooms are allowed at property level
   */
  static allowsBathroomsAtPropertyLevel(propertyType: string): boolean {
    const rules = this.getValidationRules(propertyType);
    return rules?.allowBathrooms !== false;
  }

  /**
   * Validates total area for a property type
   *
   * @param propertyType The type of property
   * @param totalArea The total area to validate
   * @returns Object with validation result and message
   */
  static validateTotalArea(
    propertyType: string,
    totalArea: number
  ): { valid: boolean; message?: string } {
    const rules = this.getValidationRules(propertyType);

    if (totalArea <= 0) {
      return {
        valid: false,
        message: 'Total area must be greater than 0',
      };
    }

    if (rules?.minTotalArea && totalArea < rules.minTotalArea) {
      return {
        valid: false,
        message: `${propertyType} properties must have at least ${rules.minTotalArea} sq ft`,
      };
    }

    if (rules?.maxTotalArea && totalArea > rules.maxTotalArea) {
      return {
        valid: false,
        message: `${propertyType} properties cannot exceed ${rules.maxTotalArea} sq ft`,
      };
    }

    return { valid: true };
  }

  /**
   * Validates unit count for a property type
   *
   * @param propertyType The type of property
   * @param totalUnits The number of units to validate
   * @returns Object with validation result and message
   */
  static validateUnitCount(
    propertyType: string,
    totalUnits: number
  ): { valid: boolean; message?: string } {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;

    if (totalUnits <= 0) {
      return {
        valid: false,
        message: 'Total units must be greater than 0',
      };
    }

    if (totalUnits < rules.minUnits) {
      return {
        valid: false,
        message: `${propertyType} properties must have at least ${rules.minUnits} unit(s)`,
      };
    }

    const validationRules = this.getValidationRules(propertyType);
    if (validationRules?.maxUnits && totalUnits > validationRules.maxUnits) {
      return {
        valid: false,
        message: `${propertyType} properties cannot exceed ${validationRules.maxUnits} units`,
      };
    }

    return { valid: true };
  }

  /**
   * Gets all required fields for a property type
   *
   * @param propertyType The type of property
   * @returns Array of required field names
   */
  static getRequiredFields(propertyType: string): string[] {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.requiredFields || [];
  }

  /**
   * Validates if the property type and its configuration are compatible
   *
   * @param propertyType The type of property
   * @param propertyData The property data to validate
   * @returns Object with validation result and message
   */
  static validatePropertyTypeCompatibility(
    propertyType: string,
    propertyData: Partial<IProperty>
  ): { isCompatible: boolean; message?: string } {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;

    // Check if multi-unit property has appropriate unit count
    if (rules.isMultiUnit && (!propertyData.totalUnits || propertyData.totalUnits <= 1)) {
      return {
        isCompatible: false,
        message: `${propertyType} properties are multi-unit and must have more than 1 unit`,
      };
    }

    // Check if single-unit property type has too many units
    const maxUnitsAllowed = rules.validationRules?.maxUnits;
    if (
      !rules.isMultiUnit &&
      maxUnitsAllowed &&
      propertyData.totalUnits &&
      propertyData.totalUnits > maxUnitsAllowed
    ) {
      return {
        isCompatible: false,
        message: `${propertyType} properties should typically have ${maxUnitsAllowed} or fewer units`,
      };
    }

    return { isCompatible: true };
  }

  /**
   * Validates occupancy status change from existing to new
   *
   * @param propertyType The type of property
   * @param existingData The current property data
   * @param newData The new property data
   * @returns Object with validation result and errors
   */
  static validateOccupancyStatusChange(
    propertyType: string,
    existingData: Partial<IProperty>,
    newData: Partial<IProperty>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (newData.occupancyStatus === 'occupied' && existingData.occupancyStatus !== 'occupied') {
      // Check if rental amount is set
      const hasRentalAmount = existingData.fees?.rentalAmount || newData.fees?.rentalAmount;
      if (!hasRentalAmount) {
        errors.push('Occupied properties must have a rental amount');
      }
    }

    if (newData.occupancyStatus === 'partially_occupied') {
      const totalUnits = newData.totalUnits || existingData.totalUnits || 1;
      if (totalUnits <= 1) {
        errors.push('Single-unit properties cannot be partially occupied');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }
}
