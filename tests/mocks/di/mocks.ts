import { asValue } from 'awilix';
import { jest } from '@jest/globals';
import { EmailWorker } from '@workers/index';
import { AuthController } from '@controllers/index';
import { Profile, Client, User } from '@models/index';
import { createDeepMock } from '@tests/utils/mockHelpers';
import { DatabaseService, RedisService } from '@database/index';

// Mock Controllers
jest.mock('@controllers/index', () => ({
  ...(jest.requireActual('@controllers/index') as object),
  AuthController: jest.fn(),
}));

export const mockAuthService = createDeepMock({
  signup: jest.fn(),
  login: jest.fn(),
  accountActivation: jest.fn(),
  sendActivationLink: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  switchActiveAccount: jest.fn(),
  getCurrentUser: jest.fn(),
  logout: jest.fn(),
  refreshToken: jest.fn(),
  getTokenUser: jest.fn(),
  verifyClientAccess: jest.fn(),
});

export const mockPropertyService = createDeepMock({
  addProperty: jest.fn(),
  getClientProperties: jest.fn(),
  getClientProperty: jest.fn(),
  updateClientProperty: jest.fn(),
  archiveClientProperty: jest.fn(),
  validateCsv: jest.fn(),
  addPropertiesFromCsv: jest.fn(),
  updatePropertyDocuments: jest.fn(),
  getUnitInfoForProperty: jest.fn(),
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
  invalidateUserSession: jest.fn(),
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
  isEmailUnique: jest.fn(),
  associateUserWithClient: jest.fn(),
});

export const mockClientDAO = createDeepMock({
  insert: jest.fn(),
  findById: jest.fn(),
  findByCid: jest.fn(),
  getClientByCid: jest.fn(),
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
  createProperty: jest.fn(),
  findById: jest.fn(),
  findByOwner: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  findAll: jest.fn(),
  findFirst: jest.fn(),
  findPropertyByAddress: jest.fn(),
  getPropertyUnits: jest.fn(),
  getPropertiesByClientId: jest.fn(),
  canAddUnitToProperty: jest.fn(),
  syncPropertyOccupancyWithUnits: jest.fn(),
  syncPropertyOccupancyWithUnitsEnhanced: jest.fn(),
  archiveProperty: jest.fn(),
  updatePropertyDocument: jest.fn(),
  update: jest.fn(),
  insert: jest.fn(),
  list: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest.fn(),
});

export const mockPropertyUnitDAO = createDeepMock({
  create: jest.fn(),
  findById: jest.fn(),
  findByProperty: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  findFirst: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest.fn(),
  findUnitsByProperty: jest.fn(),
  getPropertyUnitInfo: jest.fn(),
  updatePropertyUnit: jest.fn(),
  createPropertyUnit: jest.fn(),
  getNextAvailableUnitNumber: jest.fn(),
  getExistingUnitNumbers: jest.fn(),
  getSuggestedStartingUnitNumber: jest.fn(),
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

export const mockPropertyUnitQueue = createDeepMock({
  addToQueue: jest.fn(),
  processQueue: jest.fn(),
});

export const mockJobTracker = createDeepMock({
  trackJob: jest.fn(),
  getJobStatus: jest.fn(),
  updateJobStatus: jest.fn(),
});

export const mockUnitNumberingService = createDeepMock({
  generateUnitNumber: jest.fn(),
  validateUnitNumber: jest.fn(),
  validateUnitNumberUpdate: jest.fn(),
  detectNumberingPattern: jest.fn(),
});

export const mockUploadQueue = createDeepMock({
  addToUploadQueue: jest.fn(),
});

export const mockPropertyCache = createDeepMock({
  cacheProperty: jest.fn(),
  getClientProperties: jest.fn(),
  saveClientProperties: jest.fn(),
  invalidateProperty: jest.fn(),
  invalidatePropertyLists: jest.fn(),
  invalidateUserSession: jest.fn(),
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
