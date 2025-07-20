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
  name: faker.location.streetAddress(),
  address: {
    street: faker.location.streetAddress(),
    city: faker.location.city(),
    state: faker.location.state(),
    zipCode: faker.location.zipCode(),
    country: faker.location.country()
  },
  cuid: faker.string.uuid(),
  isActive: true,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides
});

export const createMockPropertyUnit = (overrides: any = {}) => ({
  _id: new Types.ObjectId(),
  propertyId: new Types.ObjectId(),
  unitNumber: faker.number.int({ min: 1, max: 999 }).toString(),
  type: 'apartment',
  bedrooms: faker.number.int({ min: 1, max: 4 }),
  bathrooms: faker.number.int({ min: 1, max: 3 }),
  squareFeet: faker.number.int({ min: 500, max: 2000 }),
  rent: faker.number.int({ min: 800, max: 3000 }),
  isActive: true,
  cuid: faker.string.uuid(),
  createdAt: new Date(),
  updatedAt: new Date(),
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