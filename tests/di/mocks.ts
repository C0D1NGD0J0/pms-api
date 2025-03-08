import { jest } from '@jest/globals';
import { asValue, asClass } from 'awilix';
import { User, Client } from '@models/index';
import { AuthService } from '@services/index';
import { UserDAO, ClientDAO } from '@dao/index';
import { DatabaseService } from '@database/index';
import { AuthController } from '@controllers/index';

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
  ClientDAO: jest.fn(),
  UserDAO: jest.fn(),
}));

// DI Container Mock Resources
const mockAuthController = jest.mocked(AuthController);

const mockAuthService = jest.mocked(AuthService);

const mockClientDAO = jest.mocked(ClientDAO);
const mockUserDAO = jest.mocked(UserDAO);

const mockDatabaseService = jest.mocked(DatabaseService);

// Controller Resources
const MockControllerResources = {
  mockAuthController: asClass(jest.fn().mockImplementation(() => mockAuthController)).scoped(),
};

// Model Resources
const MockModelResources = {
  mockUserModel: asValue(User),
  mockClientModel: asValue(Client),
};

// Service Resources
const MockServiceResources = {
  mockAuthService: asClass(jest.fn().mockImplementation(() => mockAuthService)).scoped(),
};

// DAO Resources
const MockDAOResources = {
  mockUserDAO: asClass(jest.fn().mockImplementation(() => mockUserDAO)).singleton(),
  mockClientDAO: asClass(jest.fn().mockImplementation(() => mockClientDAO)).singleton(),
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
