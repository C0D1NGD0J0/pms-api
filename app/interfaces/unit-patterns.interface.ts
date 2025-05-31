export interface ClientUnitPreferences {
  patterns: {
    [propertyType: string]: {
      createdAt: Date;
      lastUsedNumber: number;
      patternId: string;
      updatedAt: Date;
    };
  };
}

export interface UnitNumberPattern {
  description: string;
  example: string;
  id: string;
  name: string;
  propertyTypes: string[];
  regex: RegExp;
  template: string;
}

export interface UnitNumberSuggestion {
  isBasedOnUserPreference: boolean;
  pattern: UnitNumberPattern;
  suggestion: string;
  nextInSequence?: string;
}

export interface UnitNumberValidationRules {
  allowedSeparators: ['-', '_'];
  maxNumberDigits: 4;
  maxPrefixLength: 3;
  maxTotalLength: 8;
}

export interface ValidationResult {
  error?: string;
  valid: boolean;
}

// Allowed unit number patterns as an object
export const UNIT_NUMBER_PATTERNS: { [key: string]: UnitNumberPattern } = {
  sequential: {
    description: 'Simple sequential numbering starting from 1 or 101',
    example: '1, 2, 3, 101, 102, 103',
    id: 'sequential',
    name: 'Sequential Numbers',
    propertyTypes: ['house', 'townhouse'],
    regex: /^\d{1,4}$/,
    template: '{number}',
  },
  floor_based: {
    description: 'Floor number followed by unit number (Floor 1: 101-199, Floor 2: 201-299)',
    example: '101, 102, 201, 202',
    id: 'floor_based',
    name: 'Floor-Unit Format',
    propertyTypes: ['apartment', 'condominium'],
    regex: /^\d{1,2}\d{2}$/,
    template: '{floor}{unit}',
  },
  alpha_numeric: {
    description: 'Letter prefix followed by number (A-1001, B-1001, etc.)',
    example: 'A-1001, B-1001, C-1001',
    id: 'alpha_numeric',
    name: 'Letter-Number Format',
    propertyTypes: ['commercial', 'industrial'],
    regex: /^[A-Z]{1,2}-\d{3,4}$/,
    template: '{letter}-{number}',
  },
  building_unit: {
    description: 'Building identifier followed by unit identifier',
    example: 'B1U01, B1U02, B2U01',
    id: 'building_unit',
    name: 'Building-Unit Format',
    propertyTypes: ['apartment', 'commercial', 'mixed_use'],
    regex: /^B\d{1,2}U\d{2}$/,
    template: 'B{building}U{unit}',
  },
  wing_unit: {
    description: 'Wing letter followed by 3-digit unit number',
    example: 'A101, B201, C301',
    id: 'wing_unit',
    name: 'Wing-Unit Format',
    propertyTypes: ['apartment', 'condominium', 'commercial'],
    regex: /^[A-Z]\d{3}$/,
    template: '{wing}{unit}',
  },
};

export type UnitNumberPatternId = keyof typeof UNIT_NUMBER_PATTERNS;
