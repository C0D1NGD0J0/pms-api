import { PropertyUnitType, IPropertyUnit, UnitTypeRule } from '@interfaces/propertyUnit.interface';

import { unitTypeRules } from './unitTypeConstants';

/**
 * UnitTypeManager - Manages unit type validation and business rules
 * Focuses on data validation and business logic for backend operations
 */
export class UnitTypeManager {
  /**
   * Validates that a unit has all required fields for its type using schema-based validation
   *
   * @param unitType The type of unit
   * @param unitData The unit data to validate (matches IPropertyUnit interface)
   * @returns Object with isValid boolean and missing fields array
   */
  static validateRequiredFields(
    unitType: PropertyUnitType | string,
    unitData: Partial<IPropertyUnit>
  ): { isValid: boolean; missingFields: string[] } {
    const missingFields: string[] = [];

    // Core required fields for all units
    if (!unitData.unitNumber || unitData.unitNumber.trim() === '') {
      missingFields.push('unitNumber');
    }

    if (!unitData.unitType) {
      missingFields.push('unitType');
    }

    // Validate specifications object
    if (!unitData.specifications) {
      missingFields.push('specifications');
    } else {
      // All units need total area
      if (!unitData.specifications.totalArea || unitData.specifications.totalArea <= 0) {
        missingFields.push('specifications.totalArea');
      }

      // Residential units should have bedroom/bathroom info
      if (unitType === 'residential') {
        if (
          unitData.specifications.bedrooms === undefined ||
          unitData.specifications.bedrooms < 0
        ) {
          missingFields.push('specifications.bedrooms');
        }
        if (
          unitData.specifications.bathrooms === undefined ||
          unitData.specifications.bathrooms < 0
        ) {
          missingFields.push('specifications.bathrooms');
        }
      }
    }

    // Validate fees object for units that should have rent
    if (unitType !== 'storage') {
      if (!unitData.fees) {
        missingFields.push('fees');
      } else {
        if (!unitData.fees.rentAmount || unitData.fees.rentAmount <= 0) {
          missingFields.push('fees.rentAmount');
        }
      }
    }

    return {
      isValid: missingFields.length === 0,
      missingFields,
    };
  }

  /**
   * Validates unit data integrity based on unit type business rules
   *
   * @param unitType The type of unit
   * @param unitData The unit data to validate
   * @returns Object with validation results and errors
   */
  static validateUnitIntegrity(
    unitType: PropertyUnitType | string,
    unitData: Partial<IPropertyUnit>
  ): { isValid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Storage units should not have bedrooms or bathrooms
    if (unitType === 'storage') {
      if (unitData.specifications?.bedrooms && unitData.specifications.bedrooms > 0) {
        errors.push('Storage units cannot have bedrooms');
      }
      if (unitData.specifications?.bathrooms && unitData.specifications.bathrooms > 0) {
        errors.push('Storage units cannot have bathrooms');
      }
      if (unitData.specifications?.maxOccupants && unitData.specifications.maxOccupants > 0) {
        errors.push('Storage units cannot have occupants');
      }
    }

    // Commercial units should not have bedrooms
    if (unitType === 'commercial') {
      if (unitData.specifications?.bedrooms && unitData.specifications.bedrooms > 0) {
        errors.push('Commercial units should not have bedrooms');
      }
    }

    // Residential units should have reasonable bedroom/bathroom ratios
    if (unitType === 'residential') {
      const bedrooms = unitData.specifications?.bedrooms || 0;
      const bathrooms = unitData.specifications?.bathrooms || 0;

      if (bedrooms > 0 && bathrooms === 0) {
        errors.push('Residential units with bedrooms must have at least one bathroom');
      }
    }

    // Validate rental amount is reasonable
    if (unitData.fees?.rentAmount !== undefined) {
      if (unitData.fees.rentAmount < 0) {
        errors.push('Rental amount cannot be negative');
      }
      if (unitData.fees.rentAmount > 100000) {
        errors.push('Rental amount seems unreasonably high');
      }
    }

    // Validate area is reasonable
    if (unitData.specifications?.totalArea !== undefined) {
      if (unitData.specifications.totalArea <= 0) {
        errors.push('Total area must be greater than 0');
      }
      if (unitData.specifications.totalArea > 50000) {
        errors.push('Total area seems unreasonably large');
      }
    }

    // Validate unit status
    if (
      unitData.status &&
      !['maintenance', 'available', 'occupied', 'reserved', 'inactive'].includes(unitData.status)
    ) {
      errors.push('Invalid unit status');
    }

    return {
      isValid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validates if a unit type is compatible with a property type
   *
   * @param propertyType The type of property
   * @param unitType The type of unit
   * @returns Object with validation result and message
   */
  static validateUnitPropertyCompatibility(
    propertyType: string,
    unitType: PropertyUnitType | string
  ): { isCompatible: boolean; message?: string } {
    // Storage units should only be in storage or mixed-use properties
    if (unitType === 'storage') {
      if (!['condominium', 'industrial', 'storage', 'mixed'].includes(propertyType)) {
        return {
          isCompatible: false,
          message:
            'Storage units are only allowed in condominium, mixed-use, or industrial properties',
        };
      }
    }

    // Commercial units should only be in commercial or mixed-use properties
    if (unitType === 'commercial') {
      if (!['commercial', 'industrial', 'mixed'].includes(propertyType)) {
        return {
          isCompatible: false,
          message:
            'Commercial units are only allowed in commercial, mixed-use, or industrial properties',
        };
      }
    }

    // Residential units should only be in residential properties
    if (unitType === 'residential') {
      if (!['condominium', 'apartment', 'townhouse', 'house', 'mixed'].includes(propertyType)) {
        return {
          isCompatible: false,
          message: 'Residential units are only allowed in residential or mixed-use properties',
        };
      }
    }

    return { isCompatible: true };
  }

  /**
   * Gets all required fields for a unit type
   *
   * @param unitType The type of unit
   * @returns Array of required field names
   */
  static getRequiredFields(unitType: PropertyUnitType | string): string[] {
    const rules = unitTypeRules[unitType] || unitTypeRules.residential;
    return rules.requiredFields || [];
  }

  /**
   * Gets the rule object for a specific unit type
   *
   * @param unitType The type of unit
   * @returns The rule object for the unit type
   */
  static getRules(unitType: PropertyUnitType | string): UnitTypeRule {
    return unitTypeRules[unitType] || unitTypeRules.residential;
  }

  /**
   * Determines if a field is required based on unit type rules
   *
   * @param unitType The type of unit
   * @param fieldName The field to check
   * @returns Whether the field is required
   */
  static isFieldRequired(unitType: PropertyUnitType | string, fieldName: string): boolean {
    const rules = unitTypeRules[unitType] || unitTypeRules.residential;
    return rules.requiredFields?.includes(fieldName) || false;
  }

  /**
   * Validates unit number format
   *
   * @param unitNumber The unit number to validate
   * @param _propertyType The type of property (currently unused but reserved for future use)
   * @returns Object with validation result and message
   */
  static validateUnitNumber(
    unitNumber: string,
    _propertyType: string
  ): { isValid: boolean; message?: string } {
    if (!unitNumber || unitNumber.trim().length === 0) {
      return { isValid: false, message: 'Unit number is required' };
    }

    const trimmed = unitNumber.trim();

    if (trimmed.length > 9) {
      return { isValid: false, message: 'Unit number is too long (max 9 characters)' };
    }

    const validFormat = /^[A-Za-z0-9\-_#.]+$/;
    if (!validFormat.test(trimmed)) {
      return { isValid: false, message: 'Unit number contains invalid characters' };
    }

    return { isValid: true };
  }

  /**
   * Validates unit rent amount change
   *
   * @param currentRent The current rent amount
   * @param newRent The new rent amount
   * @param maxChangePercent Maximum allowed percentage change (default 20%)
   * @returns Object with validation result and message
   */
  static validateRentChange(
    currentRent: number,
    newRent: number,
    maxChangePercent: number = 20
  ): { isValid: boolean; message?: string } {
    if (currentRent <= 0 || newRent <= 0) {
      return { isValid: false, message: 'Rent amounts must be positive' };
    }

    const changePercent = Math.abs((newRent - currentRent) / currentRent) * 100;

    if (changePercent > maxChangePercent) {
      return {
        isValid: false,
        message: `Rent change of ${changePercent.toFixed(1)}% exceeds maximum allowed change of ${maxChangePercent}%`,
      };
    }

    return { isValid: true };
  }

  /**
   * Validates unit status transition
   *
   * @param currentStatus The current unit status
   * @param newStatus The new unit status
   * @returns Object with validation result and message
   */
  static validateStatusTransition(
    currentStatus: string,
    newStatus: string
  ): { isValid: boolean; message?: string } {
    const validTransitions: { [key: string]: string[] } = {
      available: ['occupied', 'reserved', 'maintenance', 'inactive'],
      occupied: ['available', 'maintenance'],
      reserved: ['available', 'occupied', 'maintenance'],
      maintenance: ['available', 'inactive'],
      inactive: ['available', 'maintenance'],
    };

    if (!validTransitions[currentStatus]) {
      return { isValid: false, message: `Invalid current status: ${currentStatus}` };
    }

    if (!validTransitions[currentStatus].includes(newStatus)) {
      return {
        isValid: false,
        message: `Cannot transition from ${currentStatus} to ${newStatus}`,
      };
    }

    return { isValid: true };
  }
}
