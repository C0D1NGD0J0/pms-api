/**
 * Nigeria (Lagos) - ENTERPRISE TIER
 * Test all features including enterprise-only (API access, advanced analytics, white-label)
 */

export const nigeriaClient = {
  displayName: 'Ikoyi Estate Management Ltd.',
  legalEntityName: 'Ikoyi Estate Management Limited',
  tradingName: 'Ikoyi Estates',
  companyEmail: 'info@ikoyiestates.ng',
  companyPhone: '+234-1-271-5550',
  industry: 'Real Estate & Property Management',
  website: 'https://ikoyiestates.ng',
  registrationNumber: 'NG-RC-456789',
  timeZone: 'Africa/Lagos',
  currency: 'NGN',
  lang: 'en',
  // Account type - ENTERPRISE
  planId: 'enterprise',
  planName: 'Enterprise Plan',
  isEnterpriseAccount: true,
};

export const nigeriaAdmins = [
  {
    firstName: 'Chukwuemeka',
    lastName: 'Okonkwo',
    email: 'chukwuemeka.okonkwo@ikoyiestates.ng',
    phoneNumber: '+234-802-555-0101',
  },
  {
    firstName: 'Ngozi',
    lastName: 'Adeyemi',
    email: 'ngozi.adeyemi@ikoyiestates.ng',
    phoneNumber: '+234-802-555-0102',
  },
];

export const nigeriaStaff = [
  // 3 in operations/management
  {
    firstName: 'Tunde',
    lastName: 'Bakare',
    email: 'tunde.bakare@ikoyiestates.ng',
    phoneNumber: '+234-802-555-0201',
    department: 'operations',
    jobTitle: 'Head of Property Operations',
  },
  {
    firstName: 'Amaka',
    lastName: 'Nwosu',
    email: 'amaka.nwosu@ikoyiestates.ng',
    phoneNumber: '+234-802-555-0202',
    department: 'management',
    jobTitle: 'Estate Manager',
  },
  {
    firstName: 'Ibrahim',
    lastName: 'Yusuf',
    email: 'ibrahim.yusuf@ikoyiestates.ng',
    phoneNumber: '+234-802-555-0203',
    department: 'operations',
    jobTitle: 'Facilities Manager',
  },
  // 2 general staff
  {
    firstName: 'Funmi',
    lastName: 'Adeleke',
    email: 'funmi.adeleke@ikoyiestates.ng',
    phoneNumber: '+234-802-555-0204',
    department: 'general',
    jobTitle: 'Leasing Officer',
  },
  {
    firstName: 'Oluwaseun',
    lastName: 'Musa',
    email: 'oluwaseun.musa@ikoyiestates.ng',
    phoneNumber: '+234-802-555-0205',
    department: 'general',
    jobTitle: 'Client Relations Executive',
  },
];

export const nigeriaVendors = [
  {
    companyName: 'PowerGen Nigeria',
    businessType: 'Generator Services',
    email: 'service@powergen.ng',
    phone: '+234-802-555-0301',
    servicesOffered: {
      electrical: true,
      maintenance: true,
    },
    primaryContact: {
      firstName: 'Chinedu',
      lastName: 'Eze',
      jobTitle: 'Chief Engineer',
    },
    yearsInBusiness: 16,
    taxId: 'NG-PWR-123456',
    registrationNumber: 'PWR-LAG-001',
    employees: [
      { firstName: 'Adebayo', lastName: 'Tijani', email: 'adebayo.tijani@powergen.ng' },
      { firstName: 'Chinwe', lastName: 'Okorie', email: 'chinwe.okorie@powergen.ng' },
      { firstName: 'Emeka', lastName: 'Nwankwo', email: 'emeka.nwankwo@powergen.ng' },
      { firstName: 'Blessing', lastName: 'Ugwu', email: 'blessing.ugwu@powergen.ng' },
      { firstName: 'Kunle', lastName: 'Ajayi', email: 'kunle.ajayi@powergen.ng' },
    ],
  },
  {
    companyName: 'SafeGuard Security Services',
    businessType: 'Security Services',
    email: 'contact@safeguard.ng',
    phone: '+234-802-555-0302',
    servicesOffered: {
      security: true,
    },
    primaryContact: {
      firstName: 'Abdullahi',
      lastName: 'Mohammed',
      jobTitle: 'Security Director',
    },
    yearsInBusiness: 12,
    taxId: 'NG-SEC-234567',
    registrationNumber: 'SEC-LAG-002',
    employees: [
      { firstName: 'Chioma', lastName: 'Obi', email: 'chioma.obi@safeguard.ng' },
      { firstName: 'Usman', lastName: 'Bello', email: 'usman.bello@safeguard.ng' },
      { firstName: 'Adeola', lastName: 'Williams', email: 'adeola.williams@safeguard.ng' },
      { firstName: 'Musa', lastName: 'Garba', email: 'musa.garba@safeguard.ng' },
      { firstName: 'Folake', lastName: 'Oni', email: 'folake.oni@safeguard.ng' },
    ],
  },
  {
    companyName: 'Lagos Plumbing & Maintenance',
    businessType: 'Plumbing & Maintenance',
    email: 'info@lagosplumbing.ng',
    phone: '+234-802-555-0303',
    servicesOffered: {
      plumbing: true,
      maintenance: true,
      electrical: true,
    },
    primaryContact: {
      firstName: 'Festus',
      lastName: 'Onyeka',
      jobTitle: 'Master Plumber',
    },
    yearsInBusiness: 14,
    taxId: 'NG-PLUMB-345678',
    registrationNumber: 'PLUMB-LAG-003',
    employees: [
      { firstName: 'Bukola', lastName: 'Daramola', email: 'bukola.daramola@lagosplumbing.ng' },
      { firstName: 'Segun', lastName: 'Okafor', email: 'segun.okafor@lagosplumbing.ng' },
      { firstName: 'Aisha', lastName: 'Ibrahim', email: 'aisha.ibrahim@lagosplumbing.ng' },
      { firstName: 'Olumide', lastName: 'Falana', email: 'olumide.falana@lagosplumbing.ng' },
      { firstName: 'Kemi', lastName: 'Olabode', email: 'kemi.olabode@lagosplumbing.ng' },
    ],
  },
];

export const nigeriaProperties = [
  {
    name: 'Victoria Island Towers',
    propertyType: 'apartment',
    status: 'available',
    occupancyStatus: 'occupied',
    address: {
      street: '1004 Housing Estate',
      streetNumber: '1004',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postCode: '101004',
    },
    coordinates: [3.421, 6.428],
    isMultiUnit: true,
    maxAllowedUnits: 15,
    specifications: {
      totalArea: 9200,
      floors: 14,
    },
    fees: {
      rentalAmount: 600000000, // ₦6,000,000/month in kobo (cents)
      managementFees: 60000000, // ₦600,000
      taxAmount: 12000000, // ₦120,000
    },
    yearBuilt: 2018,
    description: {
      text: 'Luxury high-rise apartments in Victoria Island with 24/7 power, security, and breathtaking lagoon views.',
      html: '<p>Luxury high-rise apartments in Victoria Island with 24/7 power, security, and breathtaking lagoon views.</p>',
    },
    utilities: {
      water: true,
      electricity: true,
      gas: true,
      internet: true,
      cableTV: true,
    },
    communityAmenities: {
      swimmingPool: true,
      fitnessCenter: true,
      elevator: true,
      parking: true,
      securitySystem: true,
      laundryFacility: true,
      petFriendly: true,
      doorman: true,
    },
  },
  {
    name: 'Lekki Phase 1 Apartments',
    propertyType: 'condominium',
    status: 'available',
    occupancyStatus: 'partially_occupied',
    address: {
      street: 'Admiralty Way',
      streetNumber: '15',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postCode: '105102',
    },
    coordinates: [3.479, 6.442],
    isMultiUnit: true,
    maxAllowedUnits: 15,
    specifications: {
      totalArea: 8500,
      floors: 10,
    },
    fees: {
      rentalAmount: 450000000, // ₦4,500,000/month
      managementFees: 45000000,
      taxAmount: 9000000,
    },
    yearBuilt: 2020,
    description: {
      text: 'Modern condominiums in Lekki Phase 1 with smart home features and premium amenities.',
      html: '<p>Modern condominiums in Lekki Phase 1 with smart home features and premium amenities.</p>',
    },
    utilities: {
      water: true,
      electricity: true,
      gas: true,
      internet: true,
      cableTV: true,
    },
    communityAmenities: {
      swimmingPool: true,
      fitnessCenter: true,
      elevator: true,
      parking: true,
      securitySystem: true,
      laundryFacility: false,
      petFriendly: true,
      doorman: true,
    },
  },
  {
    name: 'Ikeja Estates',
    propertyType: 'townhouse',
    status: 'available',
    occupancyStatus: 'vacant',
    address: {
      street: 'Allen Avenue',
      streetNumber: '82',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postCode: '100271',
    },
    coordinates: [3.355, 6.601],
    isMultiUnit: true,
    maxAllowedUnits: 15,
    specifications: {
      totalArea: 7200,
      floors: 3,
    },
    fees: {
      rentalAmount: 350000000, // ₦3,500,000/month
      managementFees: 35000000,
      taxAmount: 7000000,
    },
    yearBuilt: 2017,
    description: {
      text: 'Contemporary townhouses in Ikeja with private courtyards and gated community security.',
      html: '<p>Contemporary townhouses in Ikeja with private courtyards and gated community security.</p>',
    },
    utilities: {
      water: true,
      electricity: true,
      gas: true,
      internet: true,
      cableTV: false,
    },
    communityAmenities: {
      swimmingPool: false,
      fitnessCenter: true,
      elevator: false,
      parking: true,
      securitySystem: true,
      laundryFacility: false,
      petFriendly: true,
      doorman: false,
    },
  },
  {
    name: 'Apapa Retail Plaza',
    propertyType: 'commercial',
    status: 'available',
    occupancyStatus: 'occupied',
    address: {
      street: 'Warehouse Road',
      streetNumber: '45',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postCode: '102273',
    },
    coordinates: [3.360, 6.449],
    isMultiUnit: false,
    maxAllowedUnits: 0,
    specifications: {
      totalArea: 18000,
      floors: 5,
    },
    fees: {
      rentalAmount: 1000000000, // ₦10,000,000/month
      managementFees: 100000000,
      taxAmount: 20000000,
    },
    yearBuilt: 2015,
    description: {
      text: 'Prime retail and office space in Apapa with high foot traffic and ample parking.',
      html: '<p>Prime retail and office space in Apapa with high foot traffic and ample parking.</p>',
    },
    utilities: {
      water: true,
      electricity: true,
      gas: false,
      internet: true,
      cableTV: false,
    },
    communityAmenities: {
      swimmingPool: false,
      fitnessCenter: false,
      elevator: true,
      parking: true,
      securitySystem: true,
      laundryFacility: false,
      petFriendly: false,
      doorman: true,
    },
  },
  {
    name: 'Banana Island Villa',
    propertyType: 'house',
    status: 'available',
    occupancyStatus: 'vacant',
    address: {
      street: 'Ocean Parade',
      streetNumber: '7',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postCode: '101004',
    },
    coordinates: [3.431, 6.430],
    isMultiUnit: false,
    maxAllowedUnits: 0,
    specifications: {
      totalArea: 5500,
      bedrooms: 6,
      bathrooms: 5,
      floors: 2,
      garageSpaces: 3,
      lotSize: 10000,
    },
    fees: {
      rentalAmount: 1500000000, // ₦15,000,000/month
      managementFees: 150000000,
      taxAmount: 30000000,
      securityDeposit: 1500000000,
    },
    yearBuilt: 2019,
    description: {
      text: 'Ultra-luxury waterfront villa on Banana Island with private dock, infinity pool, and panoramic views.',
      html: '<p>Ultra-luxury waterfront villa on Banana Island with private dock, infinity pool, and panoramic views.</p>',
    },
    utilities: {
      water: true,
      electricity: true,
      gas: true,
      internet: true,
      cableTV: true,
    },
    interiorAmenities: {
      airConditioning: true,
      heating: false,
      washerDryer: true,
      dishwasher: true,
      fridge: true,
      furnished: true,
      storageSpace: true,
    },
  },
  {
    name: 'Ajah Family Home',
    propertyType: 'house',
    status: 'available',
    occupancyStatus: 'occupied',
    address: {
      street: 'Lekki-Epe Expressway',
      streetNumber: '128',
      city: 'Lagos',
      state: 'Lagos',
      country: 'Nigeria',
      postCode: '105102',
    },
    coordinates: [3.566, 6.468],
    isMultiUnit: false,
    maxAllowedUnits: 0,
    specifications: {
      totalArea: 3200,
      bedrooms: 4,
      bathrooms: 3,
      floors: 2,
      garageSpaces: 2,
      lotSize: 5500,
    },
    fees: {
      rentalAmount: 500000000, // ₦5,000,000/month
      managementFees: 50000000,
      taxAmount: 10000000,
      securityDeposit: 500000000,
    },
    yearBuilt: 2016,
    description: {
      text: 'Spacious detached house in Ajah with modern design, generator backup, and secure compound.',
      html: '<p>Spacious detached house in Ajah with modern design, generator backup, and secure compound.</p>',
    },
    utilities: {
      water: true,
      electricity: true,
      gas: true,
      internet: true,
      cableTV: false,
    },
    interiorAmenities: {
      airConditioning: true,
      heating: false,
      washerDryer: true,
      dishwasher: true,
      fridge: true,
      furnished: false,
      storageSpace: true,
    },
  },
];
