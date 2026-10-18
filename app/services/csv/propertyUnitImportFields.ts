export interface UnitImportableField {
  group: 'basic' | 'specifications' | 'fees' | 'amenities' | 'utilities';
  synonyms: string[];
  required: boolean;
  label: string;
  key: string;
}

/**
 * Every column the unit importer accepts, with human labels and fuzzy-match synonyms for the
 * mapping step's auto-fill pass. Keys match the CSV schema (PropertyUnitValidations.csvSchema),
 * which stays the source of truth for validation. Bedrooms and bathrooms aren't required columns
 * because only residential units need them — the schema checks that per row.
 */
export const UNIT_IMPORTABLE_FIELDS: UnitImportableField[] = [
  {
    key: 'unitNumber',
    label: 'Unit Number',
    group: 'basic',
    required: true,
    synonyms: ['unit number', 'unit', 'unit #', 'unit no', 'suite', 'apt', 'apartment number'],
  },
  {
    key: 'unitType',
    label: 'Unit Type (residential, commercial, storage or other)',
    group: 'basic',
    required: true,
    synonyms: ['unit type', 'type'],
  },
  {
    key: 'floor',
    label: 'Floor',
    group: 'basic',
    required: true,
    synonyms: ['floor', 'level', 'storey', 'story'],
  },
  {
    key: 'status',
    label: 'Status (available, occupied, reserved, maintenance or inactive)',
    group: 'basic',
    required: true,
    synonyms: ['status', 'unit status', 'availability'],
  },
  {
    key: 'description',
    label: 'Description',
    group: 'basic',
    required: false,
    synonyms: ['description', 'notes'],
  },
  {
    key: 'specifications_totalArea',
    label: 'Total Area (sq ft)',
    group: 'specifications',
    required: true,
    synonyms: ['total area', 'area', 'square feet', 'sq ft', 'sqft', 'size'],
  },
  {
    key: 'specifications_bedrooms',
    label: 'Bedrooms (residential units)',
    group: 'specifications',
    required: false,
    synonyms: ['bedrooms', 'beds', 'bed', 'bedroom count'],
  },
  {
    key: 'specifications_bathrooms',
    label: 'Bathrooms (residential units)',
    group: 'specifications',
    required: false,
    synonyms: ['bathrooms', 'baths', 'bath', 'bathroom count'],
  },
  {
    key: 'specifications_maxOccupants',
    label: 'Max Occupants',
    group: 'specifications',
    required: false,
    synonyms: ['max occupants', 'occupants', 'occupancy limit'],
  },
  {
    key: 'fees_rentAmount',
    label: 'Rent Amount',
    group: 'fees',
    required: true,
    synonyms: ['rent amount', 'rent', 'market rent', 'monthly rent', 'rental amount'],
  },
  {
    key: 'fees_securityDeposit',
    label: 'Security Deposit',
    group: 'fees',
    required: true,
    synonyms: ['security deposit', 'deposit'],
  },
  ...[
    ['amenities_washerDryer', 'Washer/Dryer', ['washer dryer', 'laundry in unit']],
    ['amenities_dishwasher', 'Dishwasher', ['dishwasher']],
    ['amenities_parking', 'Parking', ['parking']],
    ['amenities_cableTV', 'Cable TV', ['cable tv', 'cable']],
    ['amenities_internet', 'Internet', ['internet', 'wifi']],
    ['amenities_storage', 'Storage', ['storage']],
  ].map(([key, label, synonyms]) => ({
    key: key as string,
    label: label as string,
    group: 'amenities' as const,
    required: false,
    synonyms: synonyms as string[],
  })),
  ...[
    ['utilities_water', 'Water Included', ['water']],
    ['utilities_centralAC', 'Central A/C Included', ['central ac', 'air conditioning', 'ac']],
    ['utilities_heating', 'Heating Included', ['heating', 'heat']],
    ['utilities_gas', 'Gas Included', ['gas']],
    ['utilities_trash', 'Trash Included', ['trash', 'garbage']],
  ].map(([key, label, synonyms]) => ({
    key: key as string,
    label: label as string,
    group: 'utilities' as const,
    required: false,
    synonyms: synonyms as string[],
  })),
];

export const UNIT_ACCEPTED_FIELD_KEYS = UNIT_IMPORTABLE_FIELDS.map((field) => field.key);

export const UNIT_REQUIRED_FIELD_KEYS = UNIT_IMPORTABLE_FIELDS.filter(
  (field) => field.required
).map((field) => field.key);

export function getUnitImportFieldsResponse(): {
  fields: UnitImportableField[];
  presetMapping: null;
} {
  // No third-party presets for units — every file goes through the mapping step.
  return { fields: UNIT_IMPORTABLE_FIELDS, presetMapping: null };
}

export function isKnownUnitImportField(key: string): boolean {
  return UNIT_ACCEPTED_FIELD_KEYS.includes(key);
}
