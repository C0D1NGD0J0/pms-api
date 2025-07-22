import { faker } from '@faker-js/faker';
import { Types } from 'mongoose';
import { 
  IUserDocument, 
  ICurrentUser, 
  IUserRole, 
  ISignupData,
  IAccountType 
} from '@interfaces/user.interface';
import { GDPRSettings } from '@interfaces/profile.interface';

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
      roles: [IUserRole.ADMIN],
      displayName: faker.company.name(),
    }
  ],
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  id: new Types.ObjectId().toString(),
  validatePassword: jest.fn().mockResolvedValue(true),
  ...overrides
});

export const createMockCurrentUser = (overrides: Partial<ICurrentUser> = {}): ICurrentUser => ({
  sub: new Types.ObjectId().toString(),
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
    csub: faker.string.uuid(),
    displayname: faker.company.name(),
    role: 'admin',
  },
  clients: [
    {
      cuid: faker.string.uuid(),
      isConnected: true,
      roles: [IUserRole.ADMIN],
      displayName: faker.company.name(),
    }
  ],
  permissions: ['read', 'write', 'admin'],
  gdpr: {
    dataRetentionPolicy: 'standard' as any,
    dataProcessingConsent: true,
    processingConsentDate: new Date(),
    retentionExpiryDate: faker.date.future(),
  } as GDPRSettings,
  ...overrides
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
  accountType: {
    isCorporate: false,
    planName: 'basic',
    planId: 'basic-plan',
  } as IAccountType,
  ...overrides
});

export const createMockClient = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  cuid: faker.string.uuid(),
  displayName: faker.company.name(),
  accountAdmin: new Types.ObjectId(),
  accountType: {
    isCorporate: false,
    planName: 'basic',
    planId: 'basic-plan',
  },
  isActive: true,
  settings: {},
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

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
    fullAddress: faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state()
  },
  cuid: faker.string.uuid(),
  propertyType: faker.helpers.arrayElement(['apartment', 'house', 'condominium', 'townhouse', 'commercial', 'industrial'] as const),
  status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance', 'construction', 'inactive'] as const),
  occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied'] as const),
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
    lotSize: faker.number.int({ min: 1000, max: 10000 })
  },
  financialDetails: {
    purchasePrice: faker.number.int({ min: 100000, max: 2000000 }),
    marketValue: faker.number.int({ min: 100000, max: 2000000 }),
    propertyTax: faker.number.int({ min: 5000, max: 50000 }),
    purchaseDate: faker.date.past(),
    lastAssessmentDate: faker.date.recent()
  },
  fees: {
    rentalAmount: faker.number.int({ min: 800, max: 5000 }),
    managementFees: faker.number.int({ min: 50, max: 500 }),
    taxAmount: faker.number.int({ min: 100, max: 1000 }),
    currency: 'USD' as const
  },
  utilities: {
    electricity: true,
    water: true,
    gas: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
    cableTV: faker.datatype.boolean(),
    trash: true
  },
  interiorAmenities: {
    airConditioning: faker.datatype.boolean(),
    heating: true,
    washerDryer: faker.datatype.boolean(),
    dishwasher: faker.datatype.boolean(),
    fridge: faker.datatype.boolean(),
    furnished: faker.datatype.boolean(),
    storageSpace: faker.datatype.boolean()
  },
  communityAmenities: {
    parking: faker.datatype.boolean(),
    elevator: faker.datatype.boolean(),
    fitnessCenter: faker.datatype.boolean(),
    swimmingPool: faker.datatype.boolean(),
    laundryFacility: faker.datatype.boolean(),
    securitySystem: faker.datatype.boolean(),
    petFriendly: faker.datatype.boolean(),
    doorman: faker.datatype.boolean()
  },
  description: {
    text: faker.lorem.paragraphs(2),
    html: `<p>${faker.lorem.paragraphs(2)}</p>`
  },
  documents: [],
  computedLocation: {
    coordinates: [faker.location.longitude(), faker.location.latitude()]
  },
  deletedAt: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastModifiedBy: new Types.ObjectId(),
  id: new Types.ObjectId().toString(),
  ...overrides
});

export const createMockPropertyUnit = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  puid: faker.string.uuid(),
  cuid: faker.string.uuid(),
  propertyId: new Types.ObjectId(),
  unitNumber: faker.number.int({ min: 1, max: 999 }).toString(),
  unitType: faker.helpers.arrayElement(['residential', 'commercial', 'storage', 'other'] as const),
  status: faker.helpers.arrayElement(['available', 'occupied', 'reserved', 'maintenance', 'inactive'] as const),
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
    maxOccupants: faker.number.int({ min: 1, max: 8 })
  },
  fees: {
    rentAmount: faker.number.int({ min: 800, max: 5000 }),
    securityDeposit: faker.number.int({ min: 500, max: 3000 }),
    currency: 'USD' as const
  },
  utilities: {
    water: faker.datatype.boolean(),
    gas: faker.datatype.boolean(),
    heating: faker.datatype.boolean(),
    centralAC: faker.datatype.boolean(),
    trash: faker.datatype.boolean()
  },
  amenities: {
    airConditioning: faker.datatype.boolean(),
    washerDryer: faker.datatype.boolean(),
    dishwasher: faker.datatype.boolean(),
    parking: faker.datatype.boolean(),
    cableTV: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
    storage: faker.datatype.boolean()
  },
  notes: [],
  documents: [],
  inspections: [],
  media: {
    photos: []
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
  ...overrides
});

export const createMockNewProperty = (overrides: any = {}) => ({
  name: faker.location.streetAddress(),
  fullAddress: faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state(),
  propertyType: faker.helpers.arrayElement(['apartment', 'house', 'condominium', 'townhouse', 'commercial', 'industrial'] as const),
  status: faker.helpers.arrayElement(['available', 'occupied', 'maintenance', 'construction', 'inactive'] as const),
  occupancyStatus: faker.helpers.arrayElement(['vacant', 'occupied', 'partially_occupied'] as const),
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
    fullAddress: faker.location.streetAddress() + ', ' + faker.location.city() + ', ' + faker.location.state()
  },
  specifications: {
    totalArea: faker.number.int({ min: 500, max: 5000 }),
    bedrooms: faker.number.int({ min: 1, max: 5 }),
    bathrooms: faker.number.float({ min: 1, max: 4 }),
    floors: faker.number.int({ min: 1, max: 3 }),
    garageSpaces: faker.number.int({ min: 0, max: 3 }),
    maxOccupants: faker.number.int({ min: 1, max: 10 }),
    lotSize: faker.number.int({ min: 1000, max: 10000 })
  },
  financialDetails: {
    purchasePrice: faker.number.int({ min: 100000, max: 2000000 }),
    marketValue: faker.number.int({ min: 100000, max: 2000000 }),
    propertyTax: faker.number.int({ min: 5000, max: 50000 }),
    purchaseDate: faker.date.past(),
    lastAssessmentDate: faker.date.recent()
  },
  fees: {
    rentalAmount: faker.number.int({ min: 800, max: 5000 }),
    managementFees: faker.number.int({ min: 50, max: 500 }),
    taxAmount: faker.number.int({ min: 100, max: 1000 }),
    currency: 'USD' as const
  },
  utilities: {
    electricity: true,
    water: true,
    gas: faker.datatype.boolean(),
    internet: faker.datatype.boolean(),
    cableTV: faker.datatype.boolean(),
    trash: true
  },
  cuid: faker.string.uuid(),
  ...overrides
});

export const createMockInvitation = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  email: faker.internet.email(),
  firstName: faker.person.firstName(),
  lastName: faker.person.lastName(),
  role: 'user',
  status: 'pending',
  invitedBy: new Types.ObjectId(),
  clientId: new Types.ObjectId(),
  cuid: faker.string.uuid(),
  token: faker.string.uuid(),
  expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

// JWT Token Mocks
export const createMockJWTTokens = (overrides: any = {}) => ({
  accessToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InN1YiI6IjY3NGQxZjE5ZDU4YjNkMDAxNWY4ZmQzYiIsImNzdWIiOiJ0ZXN0LWN1aWQiLCJyZW1lbWJlck1lIjpmYWxzZX0sImlhdCI6MTczMzE0NTM5MywiZXhwIjoxNzMzMTQ2MjkzfQ.test-signature',
  refreshToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJkYXRhIjp7InN1YiI6IjY3NGQxZjE5ZDU4YjNkMDAxNWY4ZmQzYiIsImNzdWIiOiJ0ZXN0LWN1aWQiLCJyZW1lbWJlck1lIjpmYWxzZX0sImlhdCI6MTczMzE0NTM5MywiZXhwIjoxNzMzNzUwMTkzfQ.test-refresh-signature',
  rememberMe: false,
  ...overrides
});

export const createMockTokenPayload = (overrides: any = {}) => ({
  sub: new Types.ObjectId().toString(),
  csub: faker.string.uuid(),
  rememberMe: false,
  iat: Math.floor(Date.now() / 1000),
  exp: Math.floor(Date.now() / 1000) + 900,
  ...overrides
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
  ...overrides
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
  ...overrides
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
  ...overrides
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
  ...overrides
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