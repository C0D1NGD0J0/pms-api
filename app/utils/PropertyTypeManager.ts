import { PropertyTypeRule, PropertyTypeRules } from '@interfaces/property.interface';

// base field definitions
const BASE_FIELDS = {
  core: ['name', 'propertyType', 'status', 'managedBy', 'yearBuilt', 'occupancyStatus'],
  requiredBase: ['name', 'propertyType', 'address', 'totalArea'],
  financial: [
    'purchasePrice',
    'purchaseDate',
    'marketValue',
    'propertyTax',
    'lastAssessmentDate',
    'rentalAmount',
    'securityDeposit',
    'managementFees',
    'taxAmount',
    'currency',
  ],
  baseSpecifications: ['totalArea', 'floors'],
  residentialSpecifications: ['bedrooms', 'bathrooms', 'maxOccupants'],
  singleFamilySpecifications: ['bedrooms', 'bathrooms', 'lotSize'],
  documents: ['deed', 'tax', 'insurance', 'inspection', 'lease', 'other'],
  allAmenities: [
    'airConditioning',
    'heating',
    'washerDryer',
    'dishwasher',
    'fridge',
    'furnished',
    'storageSpace',
    'swimmingPool',
    'fitnessCenter',
    'elevator',
    'parking',
    'securitySystem',
    'petFriendly',
    'laundryFacility',
    'doorman',
  ],
  basicAmenities: ['airConditioning', 'heating', 'parking', 'securitySystem'],
  commercialAmenities: ['elevator', 'parking', 'securitySystem', 'doorman'],
  unitFields: {
    residential: [
      'unitNumber',
      'unitType',
      'unitArea',
      'unitBedrooms',
      'unitBathrooms',
      'unitRent',
    ],
    commercial: ['unitNumber', 'unitType', 'unitArea', 'unitRent', 'unitPurpose'],
    mixed: [
      'unitNumber',
      'unitType',
      'unitArea',
      'unitBedrooms',
      'unitBathrooms',
      'unitRent',
      'unitPurpose',
    ],
  },
};

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
      core: BASE_FIELDS.core,
      specifications: [...BASE_FIELDS.baseSpecifications, ...BASE_FIELDS.residentialSpecifications],
      financial: BASE_FIELDS.financial,
      amenities: BASE_FIELDS.allAmenities,
      documents: BASE_FIELDS.documents,
      unit: BASE_FIELDS.unitFields.residential,
    },
    requiredFields: [...BASE_FIELDS.requiredBase, 'totalUnits'],
    validationRules: {
      minTotalArea: 500,
      maxUnits: 500,
      allowBedrooms: false, // Managed at unit level
      allowBathrooms: false, // Managed at unit level
    },
    helpText: {
      name: 'Name of the apartment building or complex',
      totalUnits: 'Number of apartment units in the building you manage (typically 2+)',
      floors: 'Total number of floors in the apartment building',
      totalArea: 'Total area of the entire apartment building',
      address: 'Full address of the apartment building',
    },
  }),

  condominium: createRule({
    minUnits: 4,
    defaultUnits: 4,
    isMultiUnit: true,
    validateBedBath: false,
    visibleFields: {
      core: BASE_FIELDS.core,
      specifications: [...BASE_FIELDS.baseSpecifications, 'maxOccupants', 'garageSpaces'],
      financial: BASE_FIELDS.financial,
      amenities: BASE_FIELDS.allAmenities,
      documents: BASE_FIELDS.documents,
      unit: BASE_FIELDS.unitFields.residential,
    },
    requiredFields: [...BASE_FIELDS.requiredBase, 'totalUnits'],
    validationRules: {
      minTotalArea: 1000,
      maxUnits: 1000,
      allowBedrooms: false,
      allowBathrooms: false,
      requiresElevator: true,
    },
    helpText: {
      name: 'Name of the condominium building or complex',
      totalUnits: "For condominium buildings, each unit's details will be managed separately",
      address: 'Full address of the condominium building',
    },
  }),

  commercial: createRule({
    minUnits: 1,
    validateBedBath: false,
    isMultiUnit: true,
    defaultUnits: 4,
    visibleFields: {
      core: BASE_FIELDS.core,
      specifications: [...BASE_FIELDS.baseSpecifications, ...BASE_FIELDS.residentialSpecifications],
      financial: BASE_FIELDS.financial,
      amenities: BASE_FIELDS.commercialAmenities,
      documents: BASE_FIELDS.documents,
      unit: BASE_FIELDS.unitFields.commercial,
    },
    requiredFields: [...BASE_FIELDS.requiredBase, 'totalUnits'],
    validationRules: {
      minTotalArea: 200,
      maxUnits: 100,
      allowBedrooms: false, // Commercial properties shouldn't have bedrooms at property level
      allowBathrooms: true, // Can have restrooms
    },
    helpText: {
      name: 'Name of the commercial property or building',
      totalUnits: "For commercial properties, each unit's details will be managed separately",
      address: 'Full address of the commercial property',
    },
  }),

  industrial: createRule({
    minUnits: 1,
    validateBedBath: false,
    isMultiUnit: false,
    defaultUnits: 1,
    visibleFields: {
      core: BASE_FIELDS.core,
      specifications: [...BASE_FIELDS.baseSpecifications, 'lotSize', 'garageSpaces'],
      financial: BASE_FIELDS.financial,
      amenities: BASE_FIELDS.basicAmenities,
      documents: BASE_FIELDS.documents,
      unit: BASE_FIELDS.unitFields.commercial,
    },
    requiredFields: [...BASE_FIELDS.requiredBase, 'lotSize'],
    validationRules: {
      minTotalArea: 1000,
      maxUnits: 10,
      allowBedrooms: false,
      allowBathrooms: true,
    },
    helpText: {
      name: 'Name of the industrial property or facility',
      totalUnits: "For industrial properties, each unit's details will be managed separately",
      address: 'Full address of the industrial property',
    },
  }),

  townhouse: createRule({
    minUnits: 1,
    validateBedBath: true,
    isMultiUnit: false,
    defaultUnits: 1,
    visibleFields: {
      core: BASE_FIELDS.core,
      specifications: [
        ...BASE_FIELDS.baseSpecifications,
        ...BASE_FIELDS.residentialSpecifications,
        ...BASE_FIELDS.singleFamilySpecifications,
      ],
      financial: BASE_FIELDS.financial,
      amenities: BASE_FIELDS.allAmenities,
      documents: BASE_FIELDS.documents,
      unit: [],
    },
    requiredFields: [...BASE_FIELDS.requiredBase, ...BASE_FIELDS.singleFamilySpecifications],
    validationRules: {
      minTotalArea: 800,
      maxUnits: 4, // Some townhouses can be duplexes/triplexes
      allowBedrooms: true,
      allowBathrooms: true,
    },
    helpText: {
      name: 'Name or address identifier for the townhouse',
      totalUnits:
        'Typically 1 for a single townhouse, increase if property contains multiple units',
      bedrooms: 'Number of bedrooms in the entire townhouse',
      bathrooms: 'Number of bathrooms in the entire townhouse',
      address: 'Full address of the townhouse',
    },
  }),

  house: createRule({
    minUnits: 1,
    validateBedBath: true,
    isMultiUnit: false,
    defaultUnits: 1,
    visibleFields: {
      core: BASE_FIELDS.core,
      specifications: [
        ...BASE_FIELDS.baseSpecifications,
        ...BASE_FIELDS.residentialSpecifications,
        ...BASE_FIELDS.singleFamilySpecifications,
      ],
      financial: BASE_FIELDS.financial,
      amenities: BASE_FIELDS.allAmenities,
      documents: BASE_FIELDS.documents,
      unit: [],
    },
    requiredFields: [...BASE_FIELDS.requiredBase, ...BASE_FIELDS.singleFamilySpecifications],
    validationRules: {
      minTotalArea: 500,
      maxUnits: 3, // Houses can be duplexes/triplexes
      allowBedrooms: true,
      allowBathrooms: true,
    },
    helpText: {
      name: 'Name or address identifier for the house',
      totalUnits: 'For single-family homes, this is typically 1',
      bedrooms: 'Number of bedrooms in the entire house',
      bathrooms: 'Number of bathrooms in the entire house',
      address: 'Full address of the house',
    },
  }),
};

export class PropertyTypeManager {
  static isFieldVisible(
    propertyType: string,
    fieldName: string,
    totalUnits: number,
    category?: string
  ): boolean {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    const allVisibleFields = [
      ...rules.visibleFields.core,
      ...rules.visibleFields.specifications,
      ...rules.visibleFields.financial,
      ...rules.visibleFields.amenities,
      ...rules.visibleFields.documents,
    ];

    if (category && rules.visibleFields[category as keyof typeof rules.visibleFields]) {
      const categoryFields = rules.visibleFields[category as keyof typeof rules.visibleFields];
      if (!categoryFields.includes(fieldName)) {
        return false;
      }
    } else {
      if (!allVisibleFields.includes(fieldName)) {
        return false;
      }
    }

    if ((rules.isMultiUnit || totalUnits > 1) && rules.visibleFields.unit.includes(fieldName)) {
      return false;
    }

    return true;
  }

  static isFieldRequired(propertyType: string, fieldName: string): boolean {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.requiredFields?.includes(fieldName) || false;
  }

  static getValidationRules(propertyType: string): PropertyTypeRule['validationRules'] {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.validationRules;
  }

  static supportsMultipleUnits(propertyType: string): boolean {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.isMultiUnit;
  }

  static shouldValidateBedBath(propertyType: string, totalUnits: number): boolean {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    if ((rules.isMultiUnit || totalUnits > 1) && !rules.validateBedBath) {
      return false;
    }

    return true;
  }

  static getMinUnits(propertyType: string): number {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.minUnits;
  }

  static getDefaultUnits(propertyType: string): number {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.defaultUnits;
  }

  static getRules(propertyType: string): PropertyTypeRule {
    return propertyTypeRules[propertyType] || propertyTypeRules.house;
  }

  static allowsBedroomsAtPropertyLevel(propertyType: string): boolean {
    const rules = this.getValidationRules(propertyType);
    return rules?.allowBedrooms !== false;
  }

  static allowsBathroomsAtPropertyLevel(propertyType: string): boolean {
    const rules = this.getValidationRules(propertyType);
    return rules?.allowBathrooms !== false;
  }

  static getHelpText(propertyType: string, fieldName: string): string {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;
    return rules.helpText[fieldName] || '';
  }

  static validateTotalArea(
    propertyType: string,
    totalArea: number
  ): { valid: boolean; message?: string } {
    const rules = this.getValidationRules(propertyType);

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

  static validateUnitCount(
    propertyType: string,
    totalUnits: number
  ): { valid: boolean; message?: string } {
    const rules = propertyTypeRules[propertyType] || propertyTypeRules.house;

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
}
