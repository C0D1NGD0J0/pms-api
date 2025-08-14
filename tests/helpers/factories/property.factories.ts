import { faker } from '@faker-js/faker';
import { Types } from 'mongoose';
import { createMockMulterFile } from '../testUtils';

// Property Data Factory
export const createMockPropertyData = (overrides = {}) => ({
  name: faker.company.name() + ' Property',
  propertyType: faker.helpers.arrayElement([
    'apartment',
    'house',
    'condominium',
    'townhouse',
    'commercial',
    'industrial',
  ]),
  status: faker.helpers.arrayElement([
    'available',
    'occupied',
    'maintenance',
    'construction',
    'inactive',
  ]),
  managedBy: new Types.ObjectId().toString(),
  yearBuilt: faker.number.int({ min: 1900, max: 2024 }),
  fullAddress: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} ${faker.location.zipCode()}`,
  occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied']),
  maxAllowedUnits: faker.number.int({ min: 1, max: 50 }),
  cuid: new Types.ObjectId().toString(),
  description: {
    text: faker.lorem.paragraphs(2),
    html: `<p>${faker.lorem.paragraphs(2)}</p>`,
  },
  address: {
    fullAddress: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} ${faker.location.zipCode()}`,
    street: faker.location.street(),
    streetNumber: faker.location.buildingNumber(),
    coordinates: [faker.location.longitude(), faker.location.latitude()],
    city: faker.location.city(),
    state: faker.location.state(),
    postCode: faker.location.zipCode(),
    country: faker.location.country(),
  },
  specifications: {
    totalArea: faker.number.int({ min: 500, max: 5000 }),
    lotSize: faker.number.int({ min: 1000, max: 10000 }),
    bedrooms: faker.number.int({ min: 1, max: 5 }),
    bathrooms: faker.number.float({ min: 1, max: 4, fractionDigits: 1 }),
    floors: faker.number.int({ min: 1, max: 3 }),
    garageSpaces: faker.number.int({ min: 0, max: 3 }),
    maxOccupants: faker.number.int({ min: 1, max: 8 }),
  },
  financialDetails: {
    purchasePrice: faker.number.int({ min: 100000, max: 2000000 }),
    purchaseDate: faker.date.past(),
    marketValue: faker.number.int({ min: 150000, max: 2500000 }),
    propertyTax: faker.number.int({ min: 5000, max: 50000 }),
    lastAssessmentDate: faker.date.recent(),
  },
  fees: {
    currency: faker.helpers.arrayElement(['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY']),
    taxAmount: faker.number.float({ min: 100, max: 1000, fractionDigits: 2 }),
    rentalAmount: faker.number.float({ min: 1000, max: 5000, fractionDigits: 2 }),
    managementFees: faker.number.float({ min: 50, max: 500, fractionDigits: 2 }),
    securityDeposit: faker.number.float({ min: 500, max: 2000, fractionDigits: 2 }),
  },
  utilities: {
    water: faker.datatype.boolean(),
    gas: faker.datatype.boolean(),
    electricity: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
    trash: faker.datatype.boolean(),
    cableTV: faker.datatype.boolean(),
  },
  interiorAmenities: {
    airConditioning: faker.datatype.boolean(),
    heating: faker.datatype.boolean(),
    washerDryer: faker.datatype.boolean(),
    dishwasher: faker.datatype.boolean(),
    fridge: faker.datatype.boolean(),
    furnished: faker.datatype.boolean(),
    storageSpace: faker.datatype.boolean(),
  },
  communityAmenities: {
    petFriendly: faker.datatype.boolean(),
    swimmingPool: faker.datatype.boolean(),
    fitnessCenter: faker.datatype.boolean(),
    elevator: faker.datatype.boolean(),
    parking: faker.datatype.boolean(),
    securitySystem: faker.datatype.boolean(),
    laundryFacility: faker.datatype.boolean(),
    doorman: faker.datatype.boolean(),
  },
  documents: [],
  ...overrides,
});

// Property Response Factory
export const createMockProperty = (overrides = {}) => ({
  _id: new Types.ObjectId(),
  pid: faker.string.uuid(),
  cuid: new Types.ObjectId().toString(),
  name: faker.company.name() + ' Property',
  propertyType: faker.helpers.arrayElement([
    'apartment',
    'house',
    'condominium',
    'townhouse',
    'commercial',
    'industrial',
  ]),
  status: faker.helpers.arrayElement([
    'available',
    'occupied',
    'maintenance',
    'construction',
    'inactive',
  ]),
  occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied']),
  managedBy: new Types.ObjectId(),
  yearBuilt: faker.number.int({ min: 1900, max: 2024 }),
  maxAllowedUnits: faker.number.int({ min: 1, max: 50 }),
  totalUnits: faker.number.int({ min: 0, max: 50 }),
  address: {
    fullAddress: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} ${faker.location.zipCode()}`,
    street: faker.location.street(),
    streetNumber: faker.location.buildingNumber(),
    coordinates: [faker.location.longitude(), faker.location.latitude()],
    city: faker.location.city(),
    state: faker.location.state(),
    postCode: faker.location.zipCode(),
    country: faker.location.country(),
  },
  specifications: {
    totalArea: faker.number.int({ min: 500, max: 5000 }),
    lotSize: faker.number.int({ min: 1000, max: 10000 }),
    bedrooms: faker.number.int({ min: 1, max: 5 }),
    bathrooms: faker.number.float({ min: 1, max: 4, fractionDigits: 1 }),
    floors: faker.number.int({ min: 1, max: 3 }),
    garageSpaces: faker.number.int({ min: 0, max: 3 }),
    maxOccupants: faker.number.int({ min: 1, max: 8 }),
  },
  fees: {
    currency: faker.helpers.arrayElement(['USD', 'CAD', 'EUR', 'GBP', 'AUD', 'JPY']),
    taxAmount: faker.number.float({ min: 100, max: 1000, fractionDigits: 2 }),
    rentalAmount: faker.number.float({ min: 1000, max: 5000, fractionDigits: 2 }),
    managementFees: faker.number.float({ min: 50, max: 500, fractionDigits: 2 }),
    securityDeposit: faker.number.float({ min: 500, max: 2000, fractionDigits: 2 }),
  },
  description: {
    text: faker.lorem.paragraphs(2),
    html: `<p>${faker.lorem.paragraphs(2)}</p>`,
  },
  createdAt: faker.date.recent(),
  updatedAt: faker.date.recent(),
  ...overrides,
});

// Property Unit Data Factory
export const createMockPropertyUnitData = (overrides = {}) => ({
  unitNumber: faker.string.alphanumeric(5).toUpperCase(),
  unitType: faker.helpers.arrayElement(['studio', '1br', '2br', '3br', '4br', 'penthouse']),
  status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance', 'construction']),
  rentAmount: faker.number.float({ min: 800, max: 3000, fractionDigits: 2 }),
  securityDeposit: faker.number.float({ min: 800, max: 3000, fractionDigits: 2 }),
  specifications: {
    area: faker.number.int({ min: 400, max: 1500 }),
    bedrooms: faker.number.int({ min: 0, max: 4 }),
    bathrooms: faker.number.float({ min: 1, max: 3, fractionDigits: 1 }),
    balcony: faker.datatype.boolean(),
    terrace: faker.datatype.boolean(),
  },
  utilities: {
    water: faker.datatype.boolean(),
    gas: faker.datatype.boolean(),
    electricity: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
  },
  amenities: {
    airConditioning: faker.datatype.boolean(),
    heating: faker.datatype.boolean(),
    washerDryer: faker.datatype.boolean(),
    dishwasher: faker.datatype.boolean(),
    fridge: faker.datatype.boolean(),
    furnished: faker.datatype.boolean(),
  },
  media: [],
  ...overrides,
});

// Property Unit Response Factory
export const createMockPropertyUnit = (overrides = {}) => ({
  _id: new Types.ObjectId(),
  puid: faker.string.uuid(),
  pid: faker.string.uuid(),
  cuid: new Types.ObjectId().toString(),
  unitNumber: faker.string.alphanumeric(5).toUpperCase(),
  unitType: faker.helpers.arrayElement(['studio', '1br', '2br', '3br', '4br', 'penthouse']),
  status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance', 'construction']),
  rentAmount: faker.number.float({ min: 800, max: 3000, fractionDigits: 2 }),
  securityDeposit: faker.number.float({ min: 800, max: 3000, fractionDigits: 2 }),
  specifications: {
    area: faker.number.int({ min: 400, max: 1500 }),
    bedrooms: faker.number.int({ min: 0, max: 4 }),
    bathrooms: faker.number.float({ min: 1, max: 3, fractionDigits: 1 }),
    balcony: faker.datatype.boolean(),
    terrace: faker.datatype.boolean(),
  },
  currentTenant: faker.datatype.boolean()
    ? {
        name: faker.person.fullName(),
        email: faker.internet.email(),
        phone: faker.phone.number(),
        leaseStartDate: faker.date.past(),
        leaseEndDate: faker.date.future(),
      }
    : null,
  createdAt: faker.date.recent(),
  updatedAt: faker.date.recent(),
  ...overrides,
});

// Property Statistics Factory
export const createMockPropertyStats = (overrides = {}) => ({
  totalProperties: faker.number.int({ min: 0, max: 100 }),
  totalUnits: faker.number.int({ min: 0, max: 500 }),
  occupiedUnits: faker.number.int({ min: 0, max: 500 }),
  vacantUnits: faker.number.int({ min: 0, max: 500 }),
  maintenanceUnits: faker.number.int({ min: 0, max: 50 }),
  occupancyRate: faker.number.float({ min: 0, max: 100, fractionDigits: 2 }),
  averageRent: faker.number.float({ min: 1000, max: 3000, fractionDigits: 2 }),
  totalRevenue: faker.number.float({ min: 10000, max: 500000, fractionDigits: 2 }),
  propertiesByType: {
    apartment: faker.number.int({ min: 0, max: 50 }),
    house: faker.number.int({ min: 0, max: 30 }),
    condominium: faker.number.int({ min: 0, max: 20 }),
    townhouse: faker.number.int({ min: 0, max: 15 }),
    commercial: faker.number.int({ min: 0, max: 10 }),
    industrial: faker.number.int({ min: 0, max: 5 }),
  },
  ...overrides,
});

// Property Search Filter Factory
export const createMockPropertySearchFilters = (overrides = {}) => ({
  propertyType: faker.helpers.arrayElement([
    'apartment',
    'house',
    'condominium',
    'townhouse',
    'commercial',
    'industrial',
  ]),
  status: faker.helpers.arrayElement([
    'available',
    'occupied',
    'maintenance',
    'construction',
    'inactive',
  ]),
  occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied']),
  minPrice: faker.number.int({ min: 100000, max: 500000 }),
  maxPrice: faker.number.int({ min: 500000, max: 2000000 }),
  searchTerm: faker.company.name(),
  city: faker.location.city(),
  state: faker.location.state(),
  ...overrides,
});

// CSV Test Data Factory
export const createMockPropertyCsvData = () => {
  const properties = [];
  const numProperties = faker.number.int({ min: 3, max: 10 });

  for (let i = 0; i < numProperties; i++) {
    properties.push({
      name: faker.company.name() + ` Property ${i + 1}`,
      fullAddress: `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} ${faker.location.zipCode()}`,
      propertyType: faker.helpers.arrayElement(['apartment', 'house', 'condominium', 'townhouse']),
      status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance']),
      occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied']),
      maxAllowedUnits: faker.number.int({ min: 1, max: 50 }),
      yearBuilt: faker.number.int({ min: 1950, max: 2024 }),
      managedBy: faker.person.fullName(),
      description_text: faker.lorem.paragraph(),
      specifications_totalArea: faker.number.int({ min: 500, max: 3000 }),
      specifications_bedrooms: faker.number.int({ min: 1, max: 5 }),
      specifications_bathrooms: faker.number.float({ min: 1, max: 4, fractionDigits: 1 }),
      specifications_floors: faker.number.int({ min: 1, max: 3 }),
      fees_taxAmount: faker.number.float({ min: 100, max: 1000, fractionDigits: 2 }),
      fees_rentalAmount: faker.number.float({ min: 1000, max: 5000, fractionDigits: 2 }),
      fees_currency: 'USD',
      utilities_water: faker.datatype.boolean(),
      utilities_gas: faker.datatype.boolean(),
      utilities_electricity: faker.datatype.boolean(),
      interiorAmenities_airConditioning: faker.datatype.boolean(),
      interiorAmenities_heating: faker.datatype.boolean(),
      communityAmenities_parking: faker.datatype.boolean(),
      communityAmenities_swimmingPool: faker.datatype.boolean(),
    });
  }

  return properties;
};

// Mock Multer File for Property Photos
export const createMockPropertyPhotos = (count = 3) => {
  const photos = [];
  for (let i = 0; i < count; i++) {
    photos.push(
      createMockMulterFile({
        fieldname: 'document.photos',
        originalname: `property-photo-${i + 1}.jpg`,
        mimetype: 'image/jpeg',
        size: faker.number.int({ min: 100000, max: 2000000 }),
      })
    );
  }
  return photos;
};

// Mock CSV File
export const createMockPropertyCsvFile = (csvData = createMockPropertyCsvData()) => {
  const headers = Object.keys(csvData[0]);
  const csvContent = [
    headers.join(','),
    ...csvData.map((row) => headers.map((header) => (row as any)[header]).join(',')),
  ].join('\n');

  return createMockMulterFile({
    fieldname: 'csv_file',
    originalname: 'properties.csv',
    mimetype: 'text/csv',
    buffer: Buffer.from(csvContent),
    size: csvContent.length,
  });
};

// Current User Factory (for context)
export const createMockCurrentUser = (overrides = {}) => ({
  sub: new Types.ObjectId().toString(),
  email: faker.internet.email(),
  roles: ['STAFF'],
  permissions: ['property:create', 'property:read', 'property:update', 'property:delete'],
  clientId: new Types.ObjectId().toString(),
  client: {
    cuid: new Types.ObjectId().toString(),
    displayname: faker.company.name(),
    role: 'admin',
  },
  clients: [
    {
      cuid: new Types.ObjectId().toString(),
      isConnected: true,
      roles: ['STAFF'],
      displayName: faker.company.name(),
    },
  ],
  ...overrides,
});

// Property Pagination Response Factory
export const createMockPropertyPaginationResponse = (
  properties = [createMockProperty()],
  overrides = {}
) => ({
  success: true,
  message: 'Properties retrieved successfully',
  data: properties,
  pagination: {
    total: properties.length,
    page: 1,
    pages: Math.ceil(properties.length / 10),
    limit: 10,
    hasNext: false,
    hasPrev: false,
  },
  ...overrides,
});

// Property Form Metadata Factory
export const createMockPropertyFormMetadata = () => ({
  propertyForm: {
    propertyTypes: [
      { value: 'apartment', label: 'Apartment' },
      { value: 'house', label: 'House' },
      { value: 'condominium', label: 'Condominium' },
      { value: 'townhouse', label: 'Townhouse' },
      { value: 'commercial', label: 'Commercial' },
      { value: 'industrial', label: 'Industrial' },
    ],
    statuses: [
      { value: 'available', label: 'Available' },
      { value: 'occupied', label: 'Occupied' },
      { value: 'maintenance', label: 'Maintenance' },
      { value: 'construction', label: 'Construction' },
      { value: 'inactive', label: 'Inactive' },
    ],
    occupancyStatuses: [
      { value: 'vacant', label: 'Vacant' },
      { value: 'occupied', label: 'Occupied' },
      { value: 'partially_occupied', label: 'Partially Occupied' },
    ],
    currencies: [
      { value: 'USD', label: 'US Dollar' },
      { value: 'CAD', label: 'Canadian Dollar' },
      { value: 'EUR', label: 'Euro' },
      { value: 'GBP', label: 'British Pound' },
      { value: 'AUD', label: 'Australian Dollar' },
      { value: 'JPY', label: 'Japanese Yen' },
    ],
  },
  unitForm: {
    unitTypes: [
      { value: 'studio', label: 'Studio' },
      { value: '1br', label: '1 Bedroom' },
      { value: '2br', label: '2 Bedrooms' },
      { value: '3br', label: '3 Bedrooms' },
      { value: '4br', label: '4 Bedrooms' },
      { value: 'penthouse', label: 'Penthouse' },
    ],
  },
});
