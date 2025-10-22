import { faker } from '@faker-js/faker';

import { RegionConfig } from '../config/seed-config';

/**
 * Generate property data
 */
export function generatePropertyData(
  region: RegionConfig,
  isMultiUnit: boolean,
  isCommercial: boolean
) {
  const propertyTypes = {
    residential: ['apartment', 'condominium', 'townhouse'],
    commercial: ['commercial'],
    house: ['house'],
  };

  let propertyType: string;
  let name: string;

  if (isCommercial) {
    propertyType = 'commercial';
    const commercialTypes = [
      'Office Complex',
      'Retail Plaza',
      'Storage Facility',
      'Shopping Center',
    ];
    name = `${faker.location.street()} ${faker.helpers.arrayElement(commercialTypes)}`;
  } else if (isMultiUnit) {
    propertyType = faker.helpers.arrayElement(propertyTypes.residential);
    const suffixes = [
      'Towers',
      'Heights',
      'Residences',
      'Apartments',
      'Court',
      'Terraces',
      'Estates',
      'Lofts',
    ];
    name = `${faker.location.street()} ${faker.helpers.arrayElement(suffixes)}`;
  } else {
    propertyType = 'house';
    const houseTypes = ['Family Home', 'Villa', 'Cottage', 'Manor', 'Residence'];
    name = `${faker.location.street()} ${faker.helpers.arrayElement(houseTypes)}`;
  }

  const street = faker.location.streetAddress();
  const streetNumber = faker.location.buildingNumber();
  const postCode = faker.location.zipCode();

  // Generate coordinates within region bounds
  const lat = faker.number.float({
    min: region.coordinates.lat.min,
    max: region.coordinates.lat.max,
    fractionDigits: 6,
  });
  const lng = faker.number.float({
    min: region.coordinates.lng.min,
    max: region.coordinates.lng.max,
    fractionDigits: 6,
  });

  // Base rent calculation (in cents)
  let baseRent: number;
  if (region.currency === 'NGN') {
    // Nigerian Naira (in kobo)
    baseRent = isCommercial
      ? faker.number.int({ min: 800000000, max: 1500000000 }) // ₦8M-15M/month
      : isMultiUnit
        ? faker.number.int({ min: 300000000, max: 600000000 }) // ₦3M-6M/month
        : faker.number.int({ min: 250000000, max: 1000000000 }); // ₦2.5M-10M/month
  } else if (region.currency === 'GBP') {
    // British Pounds (in pence)
    baseRent = isCommercial
      ? faker.number.int({ min: 800000, max: 1500000 }) // £8K-15K/month
      : isMultiUnit
        ? faker.number.int({ min: 300000, max: 500000 }) // £3K-5K/month
        : faker.number.int({ min: 250000, max: 800000 }); // £2.5K-8K/month
  } else {
    // CAD/USD (in cents)
    baseRent = isCommercial
      ? faker.number.int({ min: 600000, max: 1200000 }) // $6K-12K/month
      : isMultiUnit
        ? faker.number.int({ min: 250000, max: 400000 }) // $2.5K-4K/month
        : faker.number.int({ min: 200000, max: 500000 }); // $2K-5K/month
  }

  const data: any = {
    name,
    propertyType,
    status: 'available',
    occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied']),
    address: {
      street,
      streetNumber,
      city: region.city,
      state: region.state,
      country: region.country,
      postCode,
    },
    coordinates: [lng, lat],
    isMultiUnit,
    maxAllowedUnits: isMultiUnit ? 15 : 0,
    specifications: {
      totalArea: isCommercial
        ? faker.number.int({ min: 10000, max: 20000 })
        : isMultiUnit
          ? faker.number.int({ min: 6000, max: 10000 })
          : faker.number.int({ min: 1500, max: 5000 }),
      floors: isMultiUnit
        ? faker.number.int({ min: 5, max: 15 })
        : faker.number.int({ min: 1, max: 3 }),
    },
    fees: {
      rentalAmount: baseRent,
      managementFees: Math.floor(baseRent * 0.1),
      taxAmount: Math.floor(baseRent * 0.02),
    },
    yearBuilt: faker.number.int({ min: 1990, max: 2023 }),
    description: {
      text: faker.lorem.sentence(15),
      html: `<p>${faker.lorem.sentence(15)}</p>`,
    },
    utilities: {
      water: true,
      electricity: true,
      gas: !isCommercial,
      internet: faker.datatype.boolean(),
      cableTV: faker.datatype.boolean(),
    },
  };

  if (isCommercial) {
    data.communityAmenities = {
      elevator: true,
      parking: true,
      securitySystem: true,
      swimmingPool: false,
      fitnessCenter: faker.datatype.boolean(),
      laundryFacility: false,
      petFriendly: false,
      doorman: faker.datatype.boolean(),
    };
  } else if (isMultiUnit) {
    data.communityAmenities = {
      swimmingPool: faker.datatype.boolean(),
      fitnessCenter: faker.datatype.boolean(),
      elevator: true,
      parking: true,
      securitySystem: true,
      laundryFacility: faker.datatype.boolean(),
      petFriendly: faker.datatype.boolean(),
      doorman: faker.datatype.boolean(),
    };
  } else {
    // House
    data.specifications.bedrooms = faker.number.int({ min: 2, max: 6 });
    data.specifications.bathrooms = faker.number.int({ min: 1, max: 5 });
    data.specifications.garageSpaces = faker.number.int({ min: 0, max: 3 });
    data.specifications.lotSize = faker.number.int({ min: 2000, max: 10000 });
    data.fees.securityDeposit = baseRent; // 1 month deposit

    data.interiorAmenities = {
      airConditioning: true,
      heating: true,
      washerDryer: faker.datatype.boolean(),
      dishwasher: faker.datatype.boolean(),
      fridge: faker.datatype.boolean(),
      furnished: faker.datatype.boolean({ probability: 0.3 }),
      storageSpace: true,
    };
  }

  return data;
}

/**
 * Generate vendor data
 */
export function generateVendorData(region: RegionConfig, _index: number) {
  const vendorTypes = [
    {
      type: 'HVAC Services',
      name: `${faker.company.name()} HVAC`,
      services: { hvac: true, heating: true, cooling: true, maintenance: true },
    },
    {
      type: 'Plumbing Services',
      name: `${faker.company.name()} Plumbing`,
      services: { plumbing: true, maintenance: true },
    },
    {
      type: 'Electrical Services',
      name: `${faker.company.name()} Electric`,
      services: { electrical: true, maintenance: true },
    },
    {
      type: 'Cleaning Services',
      name: `${faker.company.name()} CleanCo`,
      services: { cleaning: true, maintenance: true },
    },
    {
      type: 'Landscaping Services',
      name: `${faker.company.name()} Landscaping`,
      services: { landscaping: true, maintenance: true },
    },
    {
      type: 'Security Services',
      name: `${faker.company.name()} Security`,
      services: { security: true },
    },
    {
      type: 'Painting Services',
      name: `${faker.company.name()} Painters`,
      services: { painting: true, maintenance: true },
    },
    {
      type: 'Roofing Services',
      name: `${faker.company.name()} Roofing`,
      services: { roofing: true, maintenance: true },
    },
    {
      type: 'Carpentry Services',
      name: `${faker.company.name()} Carpentry`,
      services: { carpentry: true, maintenance: true },
    },
    {
      type: 'General Maintenance',
      name: `${faker.company.name()} Maintenance`,
      services: { maintenance: true, applianceRepair: true },
    },
  ];

  const vendor = faker.helpers.arrayElement(vendorTypes);
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();

  // Generate coordinates within region bounds
  const lat = faker.number.float({
    min: region.coordinates.lat.min,
    max: region.coordinates.lat.max,
    fractionDigits: 6,
  });
  const lng = faker.number.float({
    min: region.coordinates.lng.min,
    max: region.coordinates.lng.max,
    fractionDigits: 6,
  });

  const street = faker.location.streetAddress();
  const streetNumber = faker.location.buildingNumber();
  const postCode = faker.location.zipCode();
  const fullAddress = `${street}, ${region.city}, ${region.state}, ${postCode}`;

  return {
    companyName: vendor.name,
    businessType: vendor.type,
    email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    phone: generatePhoneNumber(region),
    servicesOffered: vendor.services,
    primaryContact: {
      firstName,
      lastName,
      jobTitle: faker.person.jobTitle(),
    },
    yearsInBusiness: faker.number.int({ min: 5, max: 25 }),
    taxId: `${region.country.substring(0, 2).toUpperCase()}-${faker.string.alphanumeric(9).toUpperCase()}`,
    registrationNumber: `${vendor.type.split(' ')[0].substring(0, 4).toUpperCase()}-${faker.string.alphanumeric(6).toUpperCase()}`,
    address: {
      street,
      streetNumber,
      city: region.city,
      state: region.state,
      country: region.country,
      postCode,
      fullAddress,
      computedLocation: {
        type: 'Point' as const,
        coordinates: [lng, lat],
      },
    },
    serviceAreas: {
      baseLocation: {
        address: fullAddress,
        coordinates: [lng, lat] as [number, number],
      },
      maxDistance: faker.helpers.arrayElement([10, 15, 25, 50] as const),
    },
    insuranceInfo: {
      provider: `${faker.company.name()} Insurance`,
      policyNumber: `POL-${faker.string.alphanumeric(8).toUpperCase()}`,
      expirationDate: faker.date.future({ years: 2 }),
      coverageAmount: faker.number.int({ min: 500000, max: 2000000 }),
    },
  };
}

/**
 * Generate staff user data
 */
export function generateStaffData(
  region: RegionConfig,
  companyEmail: string,
  isOperations: boolean
) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const domain = companyEmail.split('@')[1];

  const operationsTitles = [
    'Property Manager',
    'Operations Manager',
    'Assistant Property Manager',
    'Facilities Manager',
    'Maintenance Coordinator',
  ];

  const generalTitles = [
    'Administrative Assistant',
    'Customer Service Representative',
    'Leasing Officer',
    'Client Relations Executive',
    'Receptionist',
  ];

  return {
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
    phoneNumber: generatePhoneNumber(region),
    department: isOperations ? faker.helpers.arrayElement(['operations', 'management']) : 'general',
    jobTitle: isOperations
      ? faker.helpers.arrayElement(operationsTitles)
      : faker.helpers.arrayElement(generalTitles),
  };
}

/**
 * Generate client data using Faker
 */
export function generateClientData(region: RegionConfig) {
  const companyName = `${faker.company.name()} ${
    region.planTier === 'enterprise' ? 'Ltd.' : 'Inc.'
  }`;

  return {
    displayName: companyName,
    legalEntityName: `${companyName} ${region.country === 'United Kingdom' ? 'Limited' : 'Incorporated'}`,
    tradingName: faker.company.name(),
    companyEmail: faker.internet.email().toLowerCase(),
    companyPhone: generatePhoneNumber(region),
    industry: 'Real Estate & Property Management',
    website: faker.internet.url(),
    registrationNumber: `${region.country.substring(0, 2).toUpperCase()}-${faker.string.alphanumeric(8).toUpperCase()}`,
    timeZone: region.timezone,
    currency: region.currency,
    lang: region.lang,
    planId: region.planTier,
    planName: `${region.planTier.charAt(0).toUpperCase() + region.planTier.slice(1)} Plan`,
    isEnterpriseAccount: region.planTier === 'enterprise',
  };
}

/**
 * Generate vendor employee data
 */
export function generateVendorEmployeeData(region: RegionConfig, companyEmail: string) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const domain = companyEmail.split('@')[1];

  return {
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
    phoneNumber: generatePhoneNumber(region),
  };
}

/**
 * Generate admin user data
 */
export function generateAdminData(region: RegionConfig, companyEmail: string) {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const domain = companyEmail.split('@')[1];

  return {
    firstName,
    lastName,
    email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@${domain}`,
    phoneNumber: generatePhoneNumber(region),
  };
}

/**
 * Generate a valid E.164 format phone number for the region
 */
function generatePhoneNumber(region: RegionConfig): string {
  // Country codes
  const countryCode =
    region.country === 'Canada'
      ? '+1'
      : region.country === 'United Kingdom'
        ? '+44'
        : region.country === 'Nigeria'
          ? '+234'
          : '+1';

  // Generate valid phone number based on country
  if (region.country === 'Canada') {
    // Canadian format: +1 (XXX) XXX-XXXX
    // Use known valid North American area codes
    const validAreaCodes = [
      416,
      647,
      437, // Toronto
      514,
      438, // Montreal
      604,
      778, // Vancouver
      403,
      587, // Calgary
      613, // Ottawa
      212,
      646,
      917, // New York
      310,
      323,
      213, // Los Angeles
      312,
      773, // Chicago
      415,
      628, // San Francisco
    ];
    const areaCode = faker.helpers.arrayElement(validAreaCodes);
    const exchange = faker.number.int({ min: 200, max: 999 });
    const lineNumber = faker.number.int({ min: 1000, max: 9999 });
    return `${countryCode}${areaCode}${exchange}${lineNumber}`;
  } else if (region.country === 'United Kingdom') {
    // UK mobile format: +44 7XXX XXXXXX (10 digits total after +44)
    // Mobile numbers start with 7
    const secondPart = faker.number.int({ min: 100, max: 999 });
    const thirdPart = faker.number.int({ min: 100000, max: 999999 });
    return `${countryCode}7${secondPart}${thirdPart}`;
  } else if (region.country === 'Nigeria') {
    // Nigerian format: +234 XXX XXX XXXX (10 digits after country code)
    const firstPart = faker.number.int({ min: 700, max: 999 }); // Nigerian mobile prefixes
    const secondPart = faker.number.int({ min: 100, max: 999 });
    const thirdPart = faker.number.int({ min: 1000, max: 9999 });
    return `${countryCode}${firstPart}${secondPart}${thirdPart}`;
  }

  // Default fallback
  return `${countryCode}${faker.number.int({ min: 1000000000, max: 9999999999 })}`;
}
