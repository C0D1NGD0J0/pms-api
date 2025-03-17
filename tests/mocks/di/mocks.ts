import { asValue } from 'awilix';
import { jest } from '@jest/globals';
import { EmailWorker } from '@workers/index';
import { AuthController } from '@controllers/index';
import { User, Profile, Client } from '@models/index';
import { RedisService, DatabaseService } from '@database/index';

// Mock Controllers
jest.mock('@controllers/index', () => ({
  ...(jest.requireActual('@controllers/index') as object),
  AuthController: jest.fn(),
}));

export const mockAuthService = {
  signup: jest.fn(),
  login: jest.fn(),
  accountActivation: jest.fn(),
  sendActivationLink: jest.fn(),
  forgotPassword: jest.fn(),
  resetPassword: jest.fn(),
  switchActiveAccount: jest.fn(),
};

export const mockAuthTokenService = {
  createJwtTokens: jest.fn(),
  verifyJwtToken: jest.fn(),
  decodeJwt: jest.fn(),
};

export const mockAuthCache = {
  saveRefreshToken: jest.fn(),
  saveCurrentUser: jest.fn(),
  getRefreshToken: jest.fn(),
  getCurrentUser: jest.fn(),
  deleteRefreshToken: jest.fn(),
};

// Mock DAOs
export const mockUserDAO = {
  startSession: jest.fn(),
  withTransaction: jest.fn(),
  insert: jest.fn(),
  getUserByEmail: jest.fn(),
  getUserById: jest.fn(),
  activateAccount: jest.fn(),
  createActivationToken: jest.fn(),
  createPasswordResetToken: jest.fn(),
  resetPassword: jest.fn(),
  verifyCredentials: jest.fn(),
  updateById: jest.fn(),
};

export const mockClientDAO = {
  insert: jest.fn(),
  findById: jest.fn(),
  findByCid: jest.fn(),
};

export const mockProfileDAO = {
  createUserProfile: jest.fn(),
  generateCurrentUserInfo: jest.fn(),
  findByUserId: jest.fn(),
};

export const mockEmailQueue = {
  addToEmailQueue: jest.fn(),
};

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
