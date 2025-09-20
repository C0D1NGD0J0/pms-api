import { PropertyTypeManager } from '@utils/PropertyTypeManager';
import { NewPropertyType } from '@interfaces/property.interface';

export interface ValidationError {
  message: string;
  field: string;
  code: string;
}

export interface ValidationResult {
  errors: ValidationError[];
  valid: boolean;
}

export class PropertyValidationService {
  static validateCurrency(
    value: number | string,
    fieldName: string,
    options: {
      min?: number;
      max?: number;
      required?: boolean;
    } = {}
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const numValue = typeof value === 'string' ? parseFloat(value) : value;

    if (options.required && (value === undefined || value === null || value === '')) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        code: 'REQUIRED_FIELD',
      });
      return errors;
    }

    if (value === undefined || value === null || value === '') {
      return errors;
    }

    if (isNaN(numValue)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a valid number`,
        code: 'INVALID_NUMBER',
      });
      return errors;
    }

    if (options.min !== undefined && numValue < options.min) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be at least $${options.min}`,
        code: 'BELOW_MINIMUM',
      });
    }

    // Check maximum value
    if (options.max !== undefined && numValue > options.max) {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot exceed $${options.max}`,
        code: 'ABOVE_MAXIMUM',
      });
    }

    // Check for reasonable values (no negative currency values)
    if (numValue < 0) {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot be negative`,
        code: 'NEGATIVE_VALUE',
      });
    }

    return errors;
  }

  /**
   * Validates date fields
   */
  static validateDate(
    value: Date | string,
    fieldName: string,
    options: {
      minDate?: Date;
      maxDate?: Date;
      required?: boolean;
      allowFuture?: boolean;
    } = {}
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check if required
    if (
      options.required &&
      (value === undefined ||
        value === null ||
        value === '' ||
        (typeof value === 'string' && value.trim() === ''))
    ) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required`,
        code: 'REQUIRED_FIELD',
      });
      return errors;
    }

    // Skip validation if not provided and not required
    if (
      value === undefined ||
      value === null ||
      value === '' ||
      (typeof value === 'string' && value.trim() === '')
    ) {
      return errors;
    }

    let dateValue: Date;
    try {
      dateValue = typeof value === 'string' ? new Date(value) : value;
    } catch {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a valid date`,
        code: 'INVALID_DATE',
      });
      return errors;
    }

    // Check if valid date
    if (isNaN(dateValue.getTime())) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a valid date`,
        code: 'INVALID_DATE',
      });
      return errors;
    }

    // Check future dates
    if (options.allowFuture === false && dateValue > new Date()) {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot be in the future`,
        code: 'FUTURE_DATE',
      });
    }

    // Check minimum date
    if (options.minDate && dateValue < options.minDate) {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot be before ${options.minDate.toDateString()}`,
        code: 'BEFORE_MIN_DATE',
      });
    }

    // Check maximum date
    if (options.maxDate && dateValue > options.maxDate) {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot be after ${options.maxDate.toDateString()}`,
        code: 'AFTER_MAX_DATE',
      });
    }

    return errors;
  }

  /**
   * Validates numeric fields with property type context
   */
  static validateNumericField(
    value: number,
    fieldName: string,
    propertyType: string,
    options: {
      min?: number;
      max?: number;
      required?: boolean;
      integer?: boolean;
    } = {}
  ): ValidationError[] {
    const errors: ValidationError[] = [];

    // Check if required
    if (options.required && (value === undefined || value === null)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} is required for ${propertyType} properties`,
        code: 'REQUIRED_FIELD',
      });
      return errors;
    }

    // Skip validation if not provided and not required
    if (value === undefined || value === null) {
      return errors;
    }

    // Check if valid number
    if (isNaN(value)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a valid number`,
        code: 'INVALID_NUMBER',
      });
      return errors;
    }

    // Check if integer when required
    if (options.integer && !Number.isInteger(value)) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be a whole number`,
        code: 'NOT_INTEGER',
      });
    }

    // Check minimum value
    if (options.min !== undefined && value < options.min) {
      errors.push({
        field: fieldName,
        message: `${fieldName} must be at least ${options.min}`,
        code: 'BELOW_MINIMUM',
      });
    }

    // Check maximum value
    if (options.max !== undefined && value > options.max) {
      errors.push({
        field: fieldName,
        message: `${fieldName} cannot exceed ${options.max}`,
        code: 'ABOVE_MAXIMUM',
      });
    }

    return errors;
  }

  static validateProperty(
    propertyData: NewPropertyType,
    isUpdate: boolean = false
  ): ValidationResult {
    const errors: ValidationError[] = [];
    const { propertyType, maxAllowedUnits = 1 } = propertyData;

    if (!isUpdate) {
      if (!propertyData.name || propertyData.name.trim().length < 3) {
        errors.push({
          field: 'name',
          message: 'Property name must be at least 3 characters',
          code: 'INVALID_NAME',
        });
      }

      if (!propertyData.fullAddress || propertyData.fullAddress.trim().length < 5) {
        errors.push({
          field: 'fullAddress',
          message: 'Property address must be at least 5 characters',
          code: 'INVALID_ADDRESS',
        });
      }
    } else {
      if (
        propertyData.name !== undefined &&
        (!propertyData.name || propertyData.name.trim().length < 3)
      ) {
        errors.push({
          field: 'name',
          message: 'Property name must be at least 3 characters',
          code: 'INVALID_NAME',
        });
      }

      if (
        propertyData.fullAddress !== undefined &&
        (!propertyData.fullAddress || propertyData.fullAddress.trim().length < 5)
      ) {
        errors.push({
          field: 'fullAddress',
          message: 'Property address must be at least 5 characters',
          code: 'INVALID_ADDRESS',
        });
      }
    }

    if (propertyType) {
      if (!isUpdate || propertyData.maxAllowedUnits !== undefined) {
        const unitValidation = PropertyTypeManager.validateUnitCount(propertyType, maxAllowedUnits);
        if (!unitValidation.valid) {
          errors.push({
            field: 'maxAllowedUnits',
            message: unitValidation.message!,
            code: 'INVALID_UNIT_COUNT',
          });
        }
      }

      if (propertyData.specifications?.totalArea) {
        const areaValidation = PropertyTypeManager.validateTotalArea(
          propertyType,
          propertyData.specifications.totalArea
        );
        if (!areaValidation.valid) {
          errors.push({
            field: 'totalArea',
            message: areaValidation.message!,
            code: 'INVALID_TOTAL_AREA',
          });
        }
      }

      if (
        propertyData.specifications?.bedrooms !== undefined &&
        !PropertyTypeManager.allowsBedroomsAtPropertyLevel(propertyType)
      ) {
        errors.push({
          field: 'bedrooms',
          message: `${propertyType} properties should manage bedrooms at the unit level`,
          code: 'INVALID_FIELD_FOR_PROPERTY_TYPE',
        });
      }

      if (
        propertyData.specifications?.bathrooms !== undefined &&
        !PropertyTypeManager.allowsBathroomsAtPropertyLevel(propertyType)
      ) {
        errors.push({
          field: 'bathrooms',
          message: `${propertyType} properties should manage bathrooms at the unit level`,
          code: 'INVALID_FIELD_FOR_PROPERTY_TYPE',
        });
      }

      // Only validate required fields during creation
      if (!isUpdate) {
        const requiredFields = PropertyTypeManager.getRules(propertyType).requiredFields;
        requiredFields.forEach((field) => {
          if (field === 'totalArea' && !propertyData.specifications?.totalArea) {
            errors.push({
              field: 'totalArea',
              message: `Total area is required for ${propertyType} properties`,
              code: 'REQUIRED_FIELD',
            });
          }
          if (field === 'lotSize' && !propertyData.specifications?.lotSize) {
            errors.push({
              field: 'lotSize',
              message: `Lot size is required for ${propertyType} properties`,
              code: 'REQUIRED_FIELD',
            });
          }
        });
      }
    }

    if (propertyData.financialDetails) {
      if (propertyData.financialDetails.purchasePrice !== undefined) {
        errors.push(
          ...this.validateCurrency(propertyData.financialDetails.purchasePrice, 'purchasePrice', {
            min: 0,
            max: 100000000,
          })
        );
      }

      if (propertyData.financialDetails.marketValue !== undefined) {
        errors.push(
          ...this.validateCurrency(propertyData.financialDetails.marketValue, 'marketValue', {
            min: 0,
            max: 100000000,
          })
        );
      }

      if (propertyData.financialDetails.propertyTax !== undefined) {
        errors.push(
          ...this.validateCurrency(propertyData.financialDetails.propertyTax, 'propertyTax', {
            min: 0,
            max: 1000000,
          })
        );
      }

      if (
        propertyData.financialDetails.purchaseDate &&
        propertyData.financialDetails.purchaseDate.toString().trim() !== ''
      ) {
        errors.push(
          ...this.validateDate(propertyData.financialDetails.purchaseDate, 'purchaseDate', {
            allowFuture: false,
            minDate: new Date('1800-01-01'),
          })
        );
      }

      if (
        propertyData.financialDetails.lastAssessmentDate &&
        propertyData.financialDetails.lastAssessmentDate.toString().trim() !== ''
      ) {
        errors.push(
          ...this.validateDate(
            propertyData.financialDetails.lastAssessmentDate,
            'lastAssessmentDate',
            {
              allowFuture: false,
              minDate: new Date('1800-01-01'),
            }
          )
        );
      }
    }

    if (propertyData.fees) {
      errors.push(
        ...this.validateCurrency(propertyData.fees.rentalAmount, 'rentalAmount', {
          min: 0,
          max: 100000,
        })
      );

      if (propertyData.fees.managementFees) {
        errors.push(
          ...this.validateCurrency(propertyData.fees.managementFees, 'managementFees', {
            min: 0,
            max: 50000,
          })
        );
      }

      if (propertyData.fees.taxAmount) {
        errors.push(
          ...this.validateCurrency(propertyData.fees.taxAmount, 'taxAmount', {
            min: 0,
            max: 100000,
          })
        );
      }
    }

    if (propertyData.specifications) {
      const specs = propertyData.specifications;

      if (specs.bedrooms !== undefined) {
        errors.push(
          ...this.validateNumericField(specs.bedrooms, 'bedrooms', propertyType, {
            min: 0,
            max: 20,
            integer: true,
          })
        );
      }

      // Bathrooms validation
      if (specs.bathrooms !== undefined) {
        errors.push(
          ...this.validateNumericField(specs.bathrooms, 'bathrooms', propertyType, {
            min: 0,
            max: 20,
          })
        );
      }

      // Floors validation
      if (specs.floors !== undefined) {
        errors.push(
          ...this.validateNumericField(specs.floors, 'floors', propertyType, {
            min: 1,
            max: 200,
            integer: true,
          })
        );
      }

      // Garage spaces validation
      if (specs.garageSpaces !== undefined) {
        errors.push(
          ...this.validateNumericField(specs.garageSpaces, 'garageSpaces', propertyType, {
            min: 0,
            max: 50,
            integer: true,
          })
        );
      }

      // Max occupants validation
      if (specs.maxOccupants !== undefined) {
        errors.push(
          ...this.validateNumericField(specs.maxOccupants, 'maxOccupants', propertyType, {
            min: 1,
            max: 1000,
            integer: true,
          })
        );
      }
    }

    if (propertyData.yearBuilt !== undefined) {
      const currentYear = new Date().getFullYear();
      errors.push(
        ...this.validateNumericField(propertyData.yearBuilt, 'yearBuilt', propertyType, {
          min: 1800,
          max: currentYear + 10,
          integer: true,
        })
      );
    }

    this.validateBusinessRules(propertyData, errors, isUpdate);

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Validate business rules based on property type and occupancy
   */
  private static validateBusinessRules(
    propertyData: NewPropertyType,
    errors: ValidationError[],
    isUpdate: boolean = false
  ): void {
    const { propertyType, occupancyStatus, maxAllowedUnits = 1, fees } = propertyData;

    if (occupancyStatus === 'occupied') {
      const rentalAmount =
        typeof fees?.rentalAmount === 'string' ? parseFloat(fees.rentalAmount) : fees?.rentalAmount;

      if (!rentalAmount || rentalAmount <= 0) {
        errors.push({
          field: 'rentalAmount',
          message: 'Occupied properties must have a rental amount greater than 0',
          code: 'BUSINESS_RULE_VIOLATION',
        });
      }
    }

    if (
      occupancyStatus === 'partially_occupied' &&
      (!isUpdate || propertyData.maxAllowedUnits !== undefined) &&
      maxAllowedUnits <= 1
    ) {
      errors.push({
        field: 'occupancyStatus',
        message: 'Single-unit properties cannot be partially occupied',
        code: 'BUSINESS_RULE_VIOLATION',
      });
    }

    if (
      propertyType === 'commercial' &&
      propertyData.specifications?.bedrooms !== undefined &&
      propertyData.specifications.bedrooms > 0
    ) {
      errors.push({
        field: 'bedrooms',
        message: 'Commercial properties typically should not have bedrooms',
        code: 'BUSINESS_RULE_WARNING',
      });
    }

    if (
      propertyType &&
      PropertyTypeManager.supportsMultipleUnits(propertyType) &&
      (!isUpdate || propertyData.maxAllowedUnits !== undefined)
    ) {
      const minUnits = PropertyTypeManager.getMinUnits(propertyType);
      if (maxAllowedUnits < minUnits) {
        errors.push({
          field: 'maxAllowedUnits',
          message: `${propertyType} properties typically require at least ${minUnits} units`,
          code: 'BUSINESS_RULE_WARNING',
        });
      }
    }
  }

  static validateFieldByType(
    value: any,
    fieldType: 'currency' | 'date' | 'numeric' | 'text',
    fieldName: string,
    options: any = {}
  ): ValidationError[] {
    switch (fieldType) {
      case 'currency':
        return this.validateCurrency(value, fieldName, options);
      case 'numeric':
        return this.validateNumericField(value, fieldName, 'house', options);
      case 'date':
        return this.validateDate(value, fieldName, options);
      case 'text':
        if (options.required && (!value || value.trim().length === 0)) {
          return [
            {
              field: fieldName,
              message: `${fieldName} is required`,
              code: 'REQUIRED_FIELD',
            },
          ];
        }
        if (options.minLength && value && value.length < options.minLength) {
          return [
            {
              field: fieldName,
              message: `${fieldName} must be at least ${options.minLength} characters`,
              code: 'TOO_SHORT',
            },
          ];
        }
        if (options.maxLength && value && value.length > options.maxLength) {
          return [
            {
              field: fieldName,
              message: `${fieldName} cannot exceed ${options.maxLength} characters`,
              code: 'TOO_LONG',
            },
          ];
        }
        return [];
      default:
        return [];
    }
  }
}
