import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { ROLES } from '@shared/constants/roles.constants';
import { GDPRSettings } from '@interfaces/profile.interface';
import { IUserDocument, ICurrentUser, IAccountType, ISignupData } from '@interfaces/user.interface';

// User Mocks with proper interfaces
export const createMockUser = (overrides: Partial<IUserDocument> = {}): Partial<IUserDocument> => ({
  _id: new Types.ObjectId(),
  uid: faker.string.uuid(),
  email: faker.internet.email(),
  password: faker.internet.password(),
  isActive: true,
  activecuid: faker.string.uuid(),
  activationToken: faker.string.uuid(),
  activationTokenExpiresAt: faker.date.future(),
  passwordResetToken: undefined,
  passwordResetTokenExpiresAt: null,
  cuids: [
    {
      cuid: faker.string.uuid(),
      isConnected: true,
      roles: [ROLES.ADMIN],
      clientDisplayName: faker.company.name(),
    },
  ],
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  id: new Types.ObjectId().toString(),
  validatePassword: jest.fn().mockResolvedValue(true),
  ...overrides,
});

export const createMockCurrentUser = (overrides: Partial<ICurrentUser> = {}): ICurrentUser => ({
  sub: new Types.ObjectId().toString(),
  uid: faker.string.uuid(),
  email: faker.internet.email(),
  isActive: true,
  displayName: faker.person.fullName(),
  fullname: faker.person.fullName(),
  avatarUrl: faker.image.avatar(),
  preferences: {
    theme: 'light',
    lang: 'en',
    timezone: 'UTC',
  },
  client: {
    cuid: faker.string.uuid(),
    displayname: faker.company.name(),
    role: ROLES.ADMIN,
  },
  clients: [
    {
      cuid: faker.string.uuid(),
      isConnected: true,
      roles: [ROLES.ADMIN],
      clientDisplayName: faker.company.name(),
    },
  ],
  permissions: ['read', 'write', 'admin'],
  gdpr: {
    dataRetentionPolicy: 'standard' as any,
    dataProcessingConsent: true,
    processingConsentDate: new Date(),
    retentionExpiryDate: faker.date.future(),
  } as GDPRSettings,
  ...overrides,
});

export const createMockSignupData = (overrides: Partial<ISignupData> = {}): ISignupData => ({
  email: faker.internet.email(),
  password: faker.internet.password(),
  firstName: faker.person.firstName(),
  lastName: faker.person.lastName(),
  displayName: faker.person.fullName(),
  phoneNumber: faker.phone.number(),
  location: faker.location.city(),
  lang: 'en',
  timeZone: 'UTC',
  termsAccepted: true,
  accountType: {
    isEnterpriseAccount: false,
    planName: 'basic',
    planId: 'basic-plan',
  } as IAccountType,
  ...overrides,
});

export const createMockClient = (overrides: any = {}) => {
  const _id = overrides._id || new Types.ObjectId();
  return {
    _id,
    id: _id, // Add id property for compatibility
    cuid: faker.string.uuid(),
    displayName: faker.company.name(),
    accountAdmin: new Types.ObjectId(),
    accountType: {
      isEnterpriseAccount: false,
      planName: 'basic',
      planId: 'basic-plan',
    },
    isActive: true,
    settings: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
};

export const createMockProperty = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  pid: faker.string.uuid(),
  name: faker.location.streetAddress(),
  address: {
    street: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    postCode: faker.location.zipCode(),
    country: faker.location.country(),
    fullAddress:
      faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state(),
  },
  cuid: faker.string.uuid(),
  propertyType: faker.helpers.arrayElement([
    'apartment',
    'house',
    'condominium',
    'townhouse',
    'commercial',
    'industrial',
  ] as const),
  status: faker.helpers.arrayElement([
    'available',
    'occupied',
    'maintenance',
    'construction',
    'inactive',
  ] as const),
  occupancyStatus: faker.helpers.arrayElement([
    'vacant',
    'occupied',
    'partially_occupied',
  ] as const),
  maxAllowedUnits: faker.number.int({ min: 1, max: 50 }),
  yearBuilt: faker.number.int({ min: 1900, max: 2024 }),
  createdBy: new Types.ObjectId(),
  managedBy: new Types.ObjectId(),
  specifications: {
    totalArea: faker.number.int({ min: 500, max: 5000 }),
    bedrooms: faker.number.int({ min: 1, max: 5 }),
    bathrooms: faker.number.float({ min: 1, max: 4 }),
    floors: faker.number.int({ min: 1, max: 3 }),
    garageSpaces: faker.number.int({ min: 0, max: 3 }),
    maxOccupants: faker.number.int({ min: 1, max: 10 }),
    lotSize: faker.number.int({ min: 1000, max: 10000 }),
  },
  financialDetails: {
    purchasePrice: faker.number.int({ min: 100000, max: 2000000 }),
    marketValue: faker.number.int({ min: 100000, max: 2000000 }),
    propertyTax: faker.number.int({ min: 5000, max: 50000 }),
    purchaseDate: faker.date.past(),
    lastAssessmentDate: faker.date.recent(),
  },
  fees: {
    rentalAmount: faker.number.int({ min: 800, max: 5000 }),
    managementFees: faker.number.int({ min: 50, max: 500 }),
    taxAmount: faker.number.int({ min: 100, max: 1000 }),
    currency: 'USD' as const,
  },
  utilities: {
    electricity: true,
    water: true,
    gas: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
    cableTV: faker.datatype.boolean(),
    trash: true,
  },
  interiorAmenities: {
    airConditioning: faker.datatype.boolean(),
    heating: true,
    washerDryer: faker.datatype.boolean(),
    dishwasher: faker.datatype.boolean(),
    fridge: faker.datatype.boolean(),
    furnished: faker.datatype.boolean(),
    storageSpace: faker.datatype.boolean(),
  },
  communityAmenities: {
    parking: faker.datatype.boolean(),
    elevator: faker.datatype.boolean(),
    fitnessCenter: faker.datatype.boolean(),
    swimmingPool: faker.datatype.boolean(),
    laundryFacility: faker.datatype.boolean(),
    securitySystem: faker.datatype.boolean(),
    petFriendly: faker.datatype.boolean(),
    doorman: faker.datatype.boolean(),
  },
  description: {
    text: faker.lorem.paragraphs(2),
    html: `<p>${faker.lorem.paragraphs(2)}</p>`,
  },
  documents: [],
  computedLocation: {
    coordinates: [faker.location.longitude(), faker.location.latitude()],
  },
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastModifiedBy: new Types.ObjectId(),
  id: new Types.ObjectId().toString(),
  toJSON: function () {
    const { toJSON, ...rest } = this;
    return rest;
  },
  ...overrides,
});

export const createMockPropertyUnit = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  puid: faker.string.uuid(),
  cuid: faker.string.uuid(),
  propertyId: new Types.ObjectId(),
  unitNumber: faker.number.int({ min: 1, max: 999 }).toString(),
  unitType: faker.helpers.arrayElement(['residential', 'commercial', 'storage', 'other'] as const),
  status: faker.helpers.arrayElement([
    'available',
    'occupied',
    'reserved',
    'maintenance',
    'inactive',
  ] as const),
  floor: faker.number.int({ min: 1, max: 20 }),
  description: faker.lorem.sentence(),
  isActive: true,
  createdBy: new Types.ObjectId(),
  lastModifiedBy: new Types.ObjectId(),
  currentLease: null,
  specifications: {
    totalArea: faker.number.int({ min: 300, max: 2000 }),
    bedrooms: faker.number.int({ min: 0, max: 4 }),
    bathrooms: faker.number.float({ min: 1, max: 3 }),
    maxOccupants: faker.number.int({ min: 1, max: 8 }),
  },
  fees: {
    rentAmount: faker.number.int({ min: 800, max: 5000 }),
    securityDeposit: faker.number.int({ min: 500, max: 3000 }),
    currency: 'USD' as const,
  },
  utilities: {
    water: faker.datatype.boolean(),
    gas: faker.datatype.boolean(),
    heating: faker.datatype.boolean(),
    centralAC: faker.datatype.boolean(),
    trash: faker.datatype.boolean(),
  },
  amenities: {
    airConditioning: faker.datatype.boolean(),
    washerDryer: faker.datatype.boolean(),
    dishwasher: faker.datatype.boolean(),
    parking: faker.datatype.boolean(),
    cableTV: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
    storage: faker.datatype.boolean(),
  },
  notes: [],
  documents: [],
  inspections: [],
  media: {
    photos: [],
  },
  lastInspectionDate: faker.date.recent(),
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  id: new Types.ObjectId().toString(),
  // Mock methods
  calculateRentAdjustment: jest.fn(),
  applyRentAdjustment: jest.fn(),
  prepareForMaintenance: jest.fn(),
  markUnitAsOccupied: jest.fn(),
  addInspection: jest.fn(),
  makeUnitAvailable: jest.fn(),
  markUnitAsVacant: jest.fn(),
  softDelete: jest.fn(),
  ...overrides,
});

export const createMockNewProperty = (overrides: any = {}) => ({
  name: faker.location.streetAddress(),
  fullAddress:
    faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state(),
  propertyType: faker.helpers.arrayElement([
    'apartment',
    'house',
    'condominium',
    'townhouse',
    'commercial',
    'industrial',
  ] as const),
  status: faker.helpers.arrayElement([
    'available',
    'occupied',
    'maintenance',
    'construction',
    'inactive',
  ] as const),
  occupancyStatus: faker.helpers.arrayElement([
    'vacant',
    'occupied',
    'partially_occupied',
  ] as const),
  maxAllowedUnits: faker.number.int({ min: 1, max: 50 }),
  yearBuilt: faker.number.int({ min: 1900, max: 2024 }),
  createdBy: new Types.ObjectId(),
  managedBy: new Types.ObjectId(),
  address: {
    street: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    postCode: faker.location.zipCode(),
    country: faker.location.country(),
    fullAddress:
      faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state(),
  },
  specifications: {
    totalArea: faker.number.int({ min: 500, max: 5000 }),
    bedrooms: faker.number.int({ min: 1, max: 5 }),
    bathrooms: faker.number.float({ min: 1, max: 4 }),
    floors: faker.number.int({ min: 1, max: 3 }),
    garageSpaces: faker.number.int({ min: 0, max: 3 }),
    maxOccupants: faker.number.int({ min: 1, max: 10 }),
    lotSize: faker.number.int({ min: 1000, max: 10000 }),
  },
  financialDetails: {
    purchasePrice: faker.number.int({ min: 100000, max: 2000000 }),
    marketValue: faker.number.int({ min: 100000, max: 2000000 }),
    propertyTax: faker.number.int({ min: 5000, max: 50000 }),
    purchaseDate: faker.date.past(),
    lastAssessmentDate: faker.date.recent(),
  },
  fees: {
    rentalAmount: faker.number.int({ min: 800, max: 5000 }),
    managementFees: faker.number.int({ min: 50, max: 500 }),
    taxAmount: faker.number.int({ min: 100, max: 1000 }),
    currency: 'USD' as const,
  },
  utilities: {
    electricity: true,
    water: true,
    gas: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
    cableTV: faker.datatype.boolean(),
    trash: true,
  },
  cuid: faker.string.uuid(),
  ...overrides,
});

export const createMockInvitation = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  iuid: faker.string.uuid(),
  inviteeEmail: faker.internet.email().toLowerCase(),
  invitationToken: faker.string.alphanumeric(32),
  personalInfo: {
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    phoneNumber: faker.phone.number(),
  },
  role: faker.helpers.arrayElement([
    ROLES.ADMIN,
    ROLES.MANAGER,
    ROLES.STAFF,
    ROLES.VENDOR,
    ROLES.TENANT,
  ]),
  status: faker.helpers.arrayElement([
    'draft',
    'pending',
    'accepted',
    'expired',
    'revoked',
    'sent',
  ]),
  invitedBy: new Types.ObjectId(),
  clientId: new Types.ObjectId(),
  expiresAt: faker.date.future(),
  metadata: {
    inviteMessage: faker.lorem.sentences(2),
    expectedStartDate: faker.date.future(),
    remindersSent: faker.number.int({ min: 0, max: 3 }),
    lastReminderSent: faker.date.recent(),
  },
  acceptedBy: undefined,
  revokedBy: undefined,
  acceptedAt: undefined,
  revokedAt: undefined,
  revokeReason: undefined,
  createdAt: faker.date.recent(),
  updatedAt: faker.date.recent(),
  get inviteeFullName(): string {
    return `${this.personalInfo?.firstName} ${this.personalInfo?.lastName}`;
  },
  // Instance methods
  isValid: jest.fn().mockReturnValue(true),
  revoke: jest.fn().mockResolvedValue({}),
  accept: jest.fn().mockResolvedValue({}),
  expire: jest.fn().mockResolvedValue({}),
  ...overrides,
});

// JWT Token Mocks
export const createMockJWTTokens = (overrides: any = {}) => ({
  accessToken:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InN1YiI6IjY3NGQxZjE5ZDU4YjNkMDAxNWY4ZmQzYiIsImNzdWIiOiJ0ZXN0LWN1aWQiLCJyZW1lbWJlck1lIjpmYWxzZX0sImlhdCI6MTczMzE0NTM5MywiZXhwIjoxNzMzMTQ2MjkzfQ.test-signature',
  refreshToken:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InN1YiI6IjY3NGQxZjE5ZDU4YjNkMDAxNWY4ZmQzYiIsImNzdWIiOiJ0ZXN0LWN1aWQiLCJyZW1lbWJlck1lIjpmYWxzZX0sImlhdCI6MTczMzE0NTM5MywiZXhwIjoxNzMzNzUwMTkzfQ.test-refresh-signature',
  rememberMe: false,
  ...overrides,
});

export const createMockTokenPayload = (overrides: any = {}) => ({
  sub: new Types.ObjectId().toString(),
  csub: faker.string.uuid(),
  rememberMe: false,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
  ...overrides,
});

// Profile Mock
export const createMockProfile = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  user: new Types.ObjectId(),
  puid: faker.string.uuid(),
  personalInfo: {
    displayName: faker.person.fullName(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    location: faker.location.city(),
    phoneNumber: faker.phone.number(),
  },
  lang: 'en',
  timeZone: 'UTC',
  fullname: faker.person.fullName(),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

// File Mock
export const createMockFile = (overrides: any = {}) => ({
  fieldname: 'file',
  originalname: faker.system.fileName(),
  encoding: '7bit',
  mimetype: 'image/jpeg',
  size: faker.number.int({ min: 1000, max: 100000 }),
  buffer: Buffer.from('mock file content'),
  destination: '/tmp/uploads',
  filename: faker.system.fileName(),
  path: `/tmp/uploads/${faker.system.fileName()}`,
  ...overrides,
});

// Request Mock
export const createMockRequestContext = (overrides: any = {}) => ({
  userAgent: {
    browser: 'Chrome',
    version: '91.0',
    os: 'Windows',
    raw: 'Mozilla/5.0...',
    isMobile: false,
    isBot: false,
  },
  request: {
    path: '/api/v1/test',
    method: 'GET',
    params: {},
    url: '/api/v1/test',
    query: {},
  },
  langSetting: {
    lang: 'en',
    t: jest.fn().mockImplementation((key: string) => key),
  },
  timing: {
    startTime: Date.now(),
  },
  currentuser: null,
  service: { env: 'test' },
  source: 'web' as const,
  requestId: faker.string.uuid(),
  timestamp: new Date(),
  ip: faker.internet.ip(),
  ...overrides,
});

// Email Mock
export const createMockEmailData = (overrides: any = {}) => ({
  to: faker.internet.email(),
  subject: faker.lorem.sentence(),
  emailType: 'ACCOUNT_ACTIVATION',
  data: {
    fullname: faker.person.fullName(),
    activationUrl: faker.internet.url(),
  },
  ...overrides,
});

// Utility functions for creating test data with valid ObjectIds
export const createObjectId = () => new Types.ObjectId();

export const createValidObjectIdString = () => new Types.ObjectId().toString();

// Database session mock
export const createMockSession = () => ({
  startTransaction: jest.fn().mockResolvedValue(undefined),
  commitTransaction: jest.fn().mockResolvedValue(undefined),
  abortTransaction: jest.fn().mockResolvedValue(undefined),
  endSession: jest.fn().mockResolvedValue(undefined),
  id: createObjectId(),
  transaction: {
    isActive: false,
  },
});

// Vendor Mocks
export const createMockVendor = (
  overrides: Partial<import('@interfaces/vendor.interface').IVendor> = {}
): Partial<import('@interfaces/vendor.interface').IVendor> => ({
  companyName: faker.company.name(),
  businessType: faker.helpers.arrayElement([
    'general_contractor',
    'electrical',
    'plumbing',
    'hvac',
    'landscaping',
    'cleaning',
    'security',
    'maintenance',
  ] as const),
  registrationNumber: faker.string.alphanumeric(10).toUpperCase(),
  taxId: faker.string.numeric(9),
  yearsInBusiness: faker.number.int({ min: 1, max: 50 }),
  address: {
    fullAddress:
      faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state(),
    street: faker.location.streetAddress(),
    streetNumber: faker.location.buildingNumber(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: faker.location.country(),
    postCode: faker.location.zipCode(),
    unitNumber: faker.datatype.boolean()
      ? faker.number.int({ min: 1, max: 999 }).toString()
      : undefined,
    computedLocation: {
      type: 'Point' as const,
      coordinates: [faker.location.longitude(), faker.location.latitude()],
    },
  },
  servicesOffered: {
    applianceRepair: faker.datatype.boolean(),
    landscaping: faker.datatype.boolean(),
    maintenance: faker.datatype.boolean(),
    pestControl: faker.datatype.boolean(),
    electrical: faker.datatype.boolean(),
    carpentry: faker.datatype.boolean(),
    cleaning: faker.datatype.boolean(),
    painting: faker.datatype.boolean(),
    plumbing: faker.datatype.boolean(),
    security: faker.datatype.boolean(),
    roofing: faker.datatype.boolean(),
    hvac: faker.datatype.boolean(),
    other: faker.datatype.boolean(),
  },
  serviceAreas: {
    baseLocation: {
      address: faker.location.streetAddress() + ', ' + faker.location.city(),
      coordinates: [faker.location.longitude(), faker.location.latitude()],
    },
    maxDistance: faker.helpers.arrayElement([10, 15, 25, 50] as const),
  },
  connectedClients: [
    {
      cuid: faker.string.uuid(),
      isConnected: true,
      primaryAccountHolder: new Types.ObjectId(),
    },
  ],
  contactPerson: {
    name: faker.person.fullName(),
    jobTitle: faker.person.jobTitle(),
    email: faker.internet.email(),
    phone: faker.phone.number(),
    department: faker.helpers.arrayElement(['Operations', 'Sales', 'Customer Service']),
  },
  insuranceInfo: {
    provider: faker.company.name() + ' Insurance',
    policyNumber: faker.string.alphanumeric(12).toUpperCase(),
    coverageAmount: faker.number.int({ min: 100000, max: 5000000 }),
    expirationDate: faker.date.future(),
  },
  ...overrides,
});

export const createMockVendorDocument = (
  overrides: Partial<import('@interfaces/vendor.interface').IVendorDocument> = {}
): Partial<import('@interfaces/vendor.interface').IVendorDocument> => ({
  ...createMockVendor(),
  _id: new Types.ObjectId(),
  vuid: faker.string.uuid(),
  deletedAt: undefined,
  createdAt: new Date(),
  updatedAt: new Date(),
  id: new Types.ObjectId().toString(),
  // Mock methods that might be used in tests
  toJSON: function () {
    const { toJSON, ...rest } = this;
    return rest;
  },
  ...overrides,
});

export const createMockNewVendor = (
  overrides: Partial<import('@interfaces/vendor.interface').NewVendor> = {}
): import('@interfaces/vendor.interface').NewVendor => {
  const mockVendor = createMockVendor();
  // Remove vuid as it's not part of NewVendor
  const { ...newVendorData } = mockVendor;
  return {
    ...newVendorData,
    isPrimaryAccountHolder: true,
    ...overrides,
  } as import('@interfaces/vendor.interface').NewVendor;
};

export const createMockCompanyProfile = (overrides: any = {}) => ({
  legalEntityName: faker.company.name(),
  companyName: faker.company.name(),
  businessType: faker.helpers.arrayElement([
    'general_contractor',
    'electrical',
    'plumbing',
    'hvac',
    'landscaping',
    'cleaning',
    'security',
    'maintenance',
  ] as const),
  registrationNumber: faker.string.alphanumeric(10).toUpperCase(),
  taxId: faker.string.numeric(9),
  companyEmail: faker.internet.email(),
  address: {
    fullAddress:
      faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state(),
    street: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    country: faker.location.country(),
    postCode: faker.location.zipCode(),
    coordinates: [faker.location.longitude(), faker.location.latitude()],
  },
  contactPerson: {
    name: faker.person.fullName(),
    jobTitle: faker.person.jobTitle(),
    email: faker.internet.email(),
    phone: faker.phone.number(),
  },
  ...overrides,
});

// Success return data mock
export const createSuccessResponse = <T>(data: T, message?: string) => ({
  success: true,
  data,
  message: message || 'Operation successful',
});

export const createErrorResponse = (error: string, message?: string) => ({
  success: false,
  data: null,
  error,
  message: message || 'Operation failed',
});
