import { asValue } from 'awilix';
import { jest } from '@jest/globals';
import { EmailWorker } from '@workers/index';
import { AuthController } from '@controllers/index';
import { Profile, Client, User } from '@models/index';
import { DatabaseService, RedisService } from '@database/index';
import { createServiceMock, createDeepMock } from '@tests/utils/mockHelpers';

// Mock Controllers
jest.mock('@controllers/index', () => ({
  ...(jest.requireActual('@controllers/index') as object),
  AuthController: jest.fn(),
}));

export const mockAuthService = createServiceMock();

export const mockPropertyService = createDeepMock({
  addProperty: jest.fn(),
  getAllProperties: jest.fn(),
  getPropertyById: jest.fn(),
  updateProperty: jest.fn(),
  deleteProperty: jest.fn(),
  validateCsv: jest.fn(),
  addPropertiesFromCsv: jest.fn(),
});

export const mockAuthTokenService = createDeepMock({
  createJwtTokens: jest.fn(),
  verifyJwtToken: jest.fn(),
  decodeJwt: jest.fn(),
});

export const mockAuthCache = createDeepMock({
  saveRefreshToken: jest.fn(),
  saveCurrentUser: jest.fn(),
  getRefreshToken: jest.fn(),
  getCurrentUser: jest.fn(),
  deleteRefreshToken: jest.fn(),
});

// Mock DAOs
export const mockUserDAO = createDeepMock({
  startSession: jest.fn(),
  withTransaction: jest.fn(),
  insert: jest.fn(),
  getActiveUserByEmail: jest.fn(),
  getUserById: jest.fn(),
  activateAccount: jest.fn(),
  createActivationToken: jest.fn(),
  createPasswordResetToken: jest.fn(),
  resetPassword: jest.fn(),
  verifyCredentials: jest.fn(),
  updateById: jest.fn(),
});

export const mockClientDAO = createDeepMock({
  insert: jest.fn(),
  findById: jest.fn(),
  findByCid: jest.fn(),
});

export const mockProfileDAO = createDeepMock({
  createUserProfile: jest.fn(),
  generateCurrentUserInfo: jest.fn(),
  findByUserId: jest.fn(),
});

export const mockEmailQueue = createDeepMock({
  addToEmailQueue: jest.fn(),
});

export const mockPropertyDAO = createDeepMock({
  create: jest.fn(),
  findById: jest.fn(),
  findByOwner: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  findAll: jest.fn(),
});

export const mockPropertyUnitDAO = createDeepMock({
  create: jest.fn(),
  findById: jest.fn(),
  findByProperty: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
});

// Additional service mocks
export const mockPropertyValidationService = createDeepMock({
  validateProperty: jest.fn(),
  validateCurrency: jest.fn(),
  validateDate: jest.fn(),
  validateNumericField: jest.fn(),
});

export const mockGeoCoderService = createDeepMock({
  parseLocation: jest.fn(),
  reverseGeocode: jest.fn(),
  formatAddress: jest.fn(),
});

export const mockPropertyCsvProcessor = createDeepMock({
  validateCsv: jest.fn(),
  validatePropertyRow: jest.fn(),
  transformPropertyRow: jest.fn(),
  postProcessProperties: jest.fn(),
});

export const mockEventEmitterService = createDeepMock({
  emit: jest.fn(),
  on: jest.fn(),
  once: jest.fn(),
  off: jest.fn(),
  removeAllListeners: jest.fn(),
});

export const mockPropertyQueue = createDeepMock({
  addCsvValidationJob: jest.fn(),
  addCsvImportJob: jest.fn(),
});

export const mockUploadQueue = createDeepMock({
  addToUploadQueue: jest.fn(),
});

export const mockPropertyCache = createDeepMock({
  cacheProperty: jest.fn(),
  getClientProperties: jest.fn(),
  invalidateProperty: jest.fn(),
  invalidatePropertyLists: jest.fn(),
});

export const mockAuthController = jest.mocked(AuthController);
export const mockDatabaseService = jest.mocked(DatabaseService);
export const mockEmailWorker = jest.mocked(EmailWorker);
export const mockRedisConfig = jest.mocked(RedisService);

// Controller Resources
const MockControllerResources = {
  authController: asValue(mockAuthController),
};

// Model Resources
const MockModelResources = {
  userModel: asValue(User),
  clientModel: asValue(Client),
  profileModel: asValue(Profile),
};

// Service Resources
const MockServiceResources = {
  authService: asValue(mockAuthService),
  authTokenService: asValue(mockAuthTokenService),
  authCache: asValue(mockAuthCache),
};

// DAO Resources
const MockDAOResources = {
  userDAO: asValue(mockUserDAO),
  clientDAO: asValue(mockClientDAO),
  profileDAO: asValue(mockProfileDAO),
};

// Queue Resources
const MockQueuesResources = {
  emailQueue: asValue(mockEmailQueue),
};

// Utils and Config Resources
const MockUtilsResources = {
  redisConfig: asValue(mockRedisConfig),
  databaseService: asValue(mockDatabaseService),
};

// Export all mocks and resources
export const mockResources = {
  ...MockControllerResources,
  ...MockModelResources,
  ...MockServiceResources,
  ...MockDAOResources,
  ...MockQueuesResources,
  ...MockUtilsResources,
};
