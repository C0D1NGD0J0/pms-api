import { jest } from '@jest/globals';
import { asValue, asClass } from 'awilix';
import { AuthService } from '@services/index';
import { DatabaseService } from '@database/index';
import { AuthController } from '@controllers/index';
import { User, Profile, Client } from '@models/index';
import { UserDAO, ProfileDAO, ClientDAO } from '@dao/index';

// Mock Controllers
jest.mock('@controllers/index', () => ({
  ...(jest.requireActual('@controllers/index') as object),
  AuthController: jest.fn(),
}));

// Mock Services
jest.mock('@services/index', () => ({
  ...(jest.requireActual('@services/index') as object),
  AuthService: jest.fn(),
}));

// Mock DAOs
jest.mock('@dao/index', () => ({
  ...(jest.requireActual('@dao/index') as object),
  UserDAO: jest.fn(),
  ClientDAO: jest.fn(),
  ProfileDAO: jest.fn(),
}));

jest.mock('@database/index', () => ({
  ...(jest.requireActual('@database/index') as object),
  DatabaseService: jest.fn(),
}));

const mockAuthController = jest.mocked(AuthController);

const mockAuthService = jest.mocked(AuthService);
const mockDatabaseService = jest.mocked(DatabaseService);

const mockProfileDAO = jest.mocked(ProfileDAO);
const mockClientDAO = jest.mocked(ClientDAO);
const mockUserDAO = jest.mocked(UserDAO);

// Controller Resources
const MockControllerResources = {
  mockAuthController: asClass(jest.fn().mockImplementation(() => mockAuthController)).scoped(),
};

// Model Resources
const MockModelResources = {
  mockUserModel: asValue(User),
  mockClientModel: asValue(Client),
  mockProfileModel: asValue(Profile),
};

// Service Resources
const MockServiceResources = {
  mockAuthService: asClass(jest.fn().mockImplementation(() => mockAuthService)).scoped(),
};

// DAO Resources
const MockDAOResources = {
  mockUserDAO: asClass(jest.fn().mockImplementation(() => mockUserDAO)).singleton(),
  mockClientDAO: asClass(jest.fn().mockImplementation(() => mockClientDAO)).singleton(),
  mockProfileDAO: asClass(jest.fn().mockImplementation(() => mockProfileDAO)).singleton(),
};

// Cache Resources
const MockCacheResources = {};

// Worker Resources
const MockWorkerResources = {};

// Queue Resources
const MockQueuesResources = {};

// Utils and Config Resources
const MockUtilsResources = {
  mockDatabaseService: asClass(jest.fn().mockImplementation(() => mockDatabaseService)).singleton(),
};

// Export all mocks and resources
export const mockResources = {
  ...MockControllerResources,
  ...MockModelResources,
  ...MockServiceResources,
  ...MockDAOResources,
  ...MockCacheResources,
  ...MockWorkerResources,
  ...MockQueuesResources,
  ...MockUtilsResources,
};
