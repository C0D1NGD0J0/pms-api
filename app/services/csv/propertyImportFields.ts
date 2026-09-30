export interface ImportableField {
  group: 'basic' | 'address' | 'specifications' | 'fees' | 'utilities' | 'amenities' | 'owner';
  synonyms: string[];
  required: boolean;
  label: string;
  key: string;
}

export type SourcePlatform = 'appfolio' | 'buildium' | 'yardi' | 'rentec' | 'other';

/**
 * Every field the property importer accepts, with human labels and fuzzy-match
 * synonyms for the mapping step's auto-fill pass. Kept separate from
 * PropertyCsvProcessor's own `allowedHeaders` (the source of truth for what's
 * actually accepted) — this file is presentation/matching metadata, not validation.
 */
export const IMPORTABLE_FIELDS: ImportableField[] = [
  {
    key: 'name',
    label: 'Property Name',
    group: 'basic',
    required: true,
    synonyms: ['property name', 'building', 'building name', 'property'],
  },
  {
    key: 'propertyType',
    label: 'Property Type',
    group: 'basic',
    required: true,
    synonyms: ['type', 'property type', 'unit type'],
  },
  {
    key: 'fullAddress',
    label: 'Full Address',
    group: 'address',
    required: false,
    synonyms: ['address', 'full address', 'street address', 'property address'],
  },
  {
    key: 'address_street',
    label: 'Street',
    group: 'address',
    required: false,
    synonyms: ['street', 'street name', 'address line 1'],
  },
  {
    key: 'address_city',
    label: 'City',
    group: 'address',
    required: false,
    synonyms: ['city', 'town'],
  },
  {
    key: 'address_state',
    label: 'State/Province',
    group: 'address',
    required: false,
    synonyms: ['state', 'province', 'region'],
  },
  {
    key: 'address_postCode',
    label: 'Postal/ZIP Code',
    group: 'address',
    required: false,
    synonyms: ['zip', 'zip code', 'postal code', 'post code'],
  },
  {
    key: 'address_country',
    label: 'Country',
    group: 'address',
    required: false,
    synonyms: ['country'],
  },
  {
    key: 'address_unitNumber',
    label: 'Unit Number',
    group: 'address',
    required: false,
    synonyms: ['unit', 'unit #', 'unit number', 'suite'],
  },
  {
    key: 'status',
    label: 'Status',
    group: 'basic',
    required: false,
    synonyms: ['status', 'operational status', 'property status'],
  },
  {
    key: 'occupancyStatus',
    label: 'Occupancy Status',
    group: 'basic',
    required: false,
    synonyms: ['occupancy', 'occupancy status'],
  },
  {
    key: 'maxAllowedUnits',
    label: 'Max Units',
    group: 'basic',
    required: false,
    synonyms: ['units', 'max units', 'number of units', 'unit count'],
  },
  {
    key: 'yearBuilt',
    label: 'Year Built',
    group: 'basic',
    required: false,
    synonyms: ['year built', 'built', 'construction year'],
  },
  {
    key: 'managedBy',
    label: 'Managed By (email)',
    group: 'basic',
    required: false,
    synonyms: ['manager', 'managed by', 'property manager', 'manager email'],
  },
  {
    key: 'description_text',
    label: 'Description',
    group: 'basic',
    required: false,
    synonyms: ['description', 'notes', 'summary'],
  },
  {
    key: 'specifications_totalArea',
    label: 'Total Area',
    group: 'specifications',
    required: false,
    synonyms: ['total area', 'square footage', 'sqft', 'size'],
  },
  {
    key: 'specifications_bedrooms',
    label: 'Bedrooms',
    group: 'specifications',
    required: false,
    synonyms: ['bedrooms', 'beds', 'bed'],
  },
  {
    key: 'specifications_bathrooms',
    label: 'Bathrooms',
    group: 'specifications',
    required: false,
    synonyms: ['bathrooms', 'baths', 'bath'],
  },
  {
    key: 'specifications_floors',
    label: 'Floors',
    group: 'specifications',
    required: false,
    synonyms: ['floors', 'stories', 'levels'],
  },
  {
    key: 'specifications_garageSpaces',
    label: 'Garage Spaces',
    group: 'specifications',
    required: false,
    synonyms: ['garage', 'garage spaces', 'parking spaces'],
  },
  {
    key: 'specifications_maxOccupants',
    label: 'Max Occupants',
    group: 'specifications',
    required: false,
    synonyms: ['max occupants', 'occupant limit'],
  },
  {
    key: 'specifications_lotSize',
    label: 'Lot Size',
    group: 'specifications',
    required: false,
    synonyms: ['lot size', 'land size'],
  },
  {
    key: 'fees_rentalAmount',
    label: 'Rent Amount',
    group: 'fees',
    required: false,
    synonyms: ['rent', 'rent amount', 'market rent', 'monthly rent'],
  },
  {
    key: 'fees_managementFees',
    label: 'Management Fees',
    group: 'fees',
    required: false,
    synonyms: ['management fee', 'management fees', 'mgmt fee'],
  },
  {
    key: 'fees_securityDeposit',
    label: 'Security Deposit',
    group: 'fees',
    required: false,
    synonyms: ['security deposit', 'deposit'],
  },
  {
    key: 'fees_currency',
    label: 'Currency',
    group: 'fees',
    required: false,
    synonyms: ['currency'],
  },
  {
    key: 'utilities_water',
    label: 'Water Included',
    group: 'utilities',
    required: false,
    synonyms: ['water'],
  },
  {
    key: 'utilities_gas',
    label: 'Gas Included',
    group: 'utilities',
    required: false,
    synonyms: ['gas'],
  },
  {
    key: 'utilities_electricity',
    label: 'Electricity Included',
    group: 'utilities',
    required: false,
    synonyms: ['electricity', 'electric'],
  },
  {
    key: 'utilities_internet',
    label: 'Internet Included',
    group: 'utilities',
    required: false,
    synonyms: ['internet', 'wifi'],
  },
  {
    key: 'utilities_trash',
    label: 'Trash Included',
    group: 'utilities',
    required: false,
    synonyms: ['trash', 'garbage'],
  },
  {
    key: 'utilities_cabletv',
    label: 'Cable TV Included',
    group: 'utilities',
    required: false,
    synonyms: ['cable', 'cable tv'],
  },
  {
    key: 'interiorAmenities_airConditioning',
    label: 'Air Conditioning',
    group: 'amenities',
    required: false,
    synonyms: ['air conditioning', 'ac', 'a/c'],
  },
  {
    key: 'interiorAmenities_heating',
    label: 'Heating',
    group: 'amenities',
    required: false,
    synonyms: ['heating', 'heat'],
  },
  {
    key: 'interiorAmenities_washerDryer',
    label: 'Washer/Dryer',
    group: 'amenities',
    required: false,
    synonyms: ['washer dryer', 'washer/dryer', 'laundry'],
  },
  {
    key: 'interiorAmenities_dishwasher',
    label: 'Dishwasher',
    group: 'amenities',
    required: false,
    synonyms: ['dishwasher'],
  },
  {
    key: 'interiorAmenities_fridge',
    label: 'Fridge',
    group: 'amenities',
    required: false,
    synonyms: ['fridge', 'refrigerator'],
  },
  {
    key: 'interiorAmenities_furnished',
    label: 'Furnished',
    group: 'amenities',
    required: false,
    synonyms: ['furnished'],
  },
  {
    key: 'interiorAmenities_storageSpace',
    label: 'Storage Space',
    group: 'amenities',
    required: false,
    synonyms: ['storage', 'storage space'],
  },
  {
    key: 'communityAmenities_petFriendly',
    label: 'Pet Friendly',
    group: 'amenities',
    required: false,
    synonyms: ['pet friendly', 'pets allowed'],
  },
  {
    key: 'communityAmenities_swimmingPool',
    label: 'Swimming Pool',
    group: 'amenities',
    required: false,
    synonyms: ['pool', 'swimming pool'],
  },
  {
    key: 'communityAmenities_fitnessCenter',
    label: 'Fitness Center',
    group: 'amenities',
    required: false,
    synonyms: ['gym', 'fitness center', 'fitness room'],
  },
  {
    key: 'communityAmenities_elevator',
    label: 'Elevator',
    group: 'amenities',
    required: false,
    synonyms: ['elevator', 'lift'],
  },
  {
    key: 'communityAmenities_parking',
    label: 'Parking',
    group: 'amenities',
    required: false,
    synonyms: ['parking'],
  },
  {
    key: 'communityAmenities_securitySystem',
    label: 'Security System',
    group: 'amenities',
    required: false,
    synonyms: ['security', 'security system'],
  },
  {
    key: 'communityAmenities_laundryFacility',
    label: 'Laundry Facility',
    group: 'amenities',
    required: false,
    synonyms: ['laundry facility', 'laundry room'],
  },
  {
    key: 'communityAmenities_doorman',
    label: 'Doorman',
    group: 'amenities',
    required: false,
    synonyms: ['doorman', 'concierge'],
  },
  {
    key: 'owner_type',
    label: 'Owner Type',
    group: 'owner',
    required: false,
    synonyms: ['owner type', 'ownership type'],
  },
  {
    key: 'owner_name',
    label: 'Owner Name',
    group: 'owner',
    required: false,
    synonyms: ['owner', 'owner name', 'rental owner'],
  },
  {
    key: 'owner_email',
    label: 'Owner Email',
    group: 'owner',
    required: false,
    synonyms: ['owner email'],
  },
  {
    key: 'owner_phone',
    label: 'Owner Phone',
    group: 'owner',
    required: false,
    synonyms: ['owner phone'],
  },
  {
    key: 'owner_taxId',
    label: 'Owner Tax ID',
    group: 'owner',
    required: false,
    synonyms: ['tax id', 'owner tax id', 'ein'],
  },
];

/**
 * Curated exact-header presets per platform, built from each platform's typical
 * CSV/report export column names. This is a starting point, not exhaustive —
 * add to it as real imports from a platform surface headers it's missing.
 */
export const SOURCE_PLATFORM_PRESETS: Record<
  Exclude<SourcePlatform, 'other'>,
  Record<string, string>
> = {
  appfolio: {
    Property: 'name',
    'Property Name': 'name',
    'Property Type': 'propertyType',
    Address: 'fullAddress',
    Unit: 'address_unitNumber',
    City: 'address_city',
    State: 'address_state',
    Zip: 'address_postCode',
    Country: 'address_country',
    'Year Built': 'yearBuilt',
    'Property Manager': 'managedBy',
    'Market Rent': 'fees_rentalAmount',
    Deposit: 'fees_securityDeposit',
    Bedrooms: 'specifications_bedrooms',
    Bathrooms: 'specifications_bathrooms',
    'Square Feet': 'specifications_totalArea',
  },
  buildium: {
    'Property Name': 'name',
    'Rental Type': 'propertyType',
    'Address Line 1': 'address_street',
    'Address Line 2': 'address_unitNumber',
    City: 'address_city',
    State: 'address_state',
    'Postal Code': 'address_postCode',
    Country: 'address_country',
    'Rental Owner': 'owner_name',
    'Rent Amount': 'fees_rentalAmount',
    'Security Deposit': 'fees_securityDeposit',
    Bedrooms: 'specifications_bedrooms',
    Bathrooms: 'specifications_bathrooms',
    'Square Footage': 'specifications_totalArea',
    'Year Built': 'yearBuilt',
  },
  yardi: {
    'Property Code': 'name',
    'Property Name': 'name',
    'Property Type': 'propertyType',
    Address: 'fullAddress',
    'Unit Type': 'address_unitNumber',
    City: 'address_city',
    State: 'address_state',
    'Zip Code': 'address_postCode',
    'Market Rent': 'fees_rentalAmount',
    'Security Deposit': 'fees_securityDeposit',
    Beds: 'specifications_bedrooms',
    Baths: 'specifications_bathrooms',
    'Sq Ft': 'specifications_totalArea',
    'Year Built': 'yearBuilt',
  },
  rentec: {
    Property: 'name',
    Type: 'propertyType',
    'Street Address': 'address_street',
    'Unit #': 'address_unitNumber',
    City: 'address_city',
    State: 'address_state',
    Zip: 'address_postCode',
    Owner: 'owner_name',
    Rent: 'fees_rentalAmount',
    Deposit: 'fees_securityDeposit',
    Bedrooms: 'specifications_bedrooms',
    Bathrooms: 'specifications_bathrooms',
    'Sq Feet': 'specifications_totalArea',
  },
};

const VALID_FIELD_KEYS = new Set(IMPORTABLE_FIELDS.map((f) => f.key));

export function getImportFieldsResponse(platform?: string): {
  fields: ImportableField[];
  presetMapping: Record<string, string> | null;
} {
  const preset =
    platform && platform !== 'other' && platform in SOURCE_PLATFORM_PRESETS
      ? SOURCE_PLATFORM_PRESETS[platform as Exclude<SourcePlatform, 'other'>]
      : null;

  return {
    fields: IMPORTABLE_FIELDS,
    presetMapping: preset,
  };
}

export function isKnownImportField(key: string): boolean {
  return VALID_FIELD_KEYS.has(key);
}
