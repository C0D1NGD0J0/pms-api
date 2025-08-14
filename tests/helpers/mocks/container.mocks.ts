// Auth mocks
import {
  createMockAuthService,
  createMockAuthTokenService,
  createMockAuthCache,
  createMockUserDAO,
  createMockProfileDAO,
  createMockPermissionService,
} from './auth.mocks';

// Property mocks
import {
  createMockPropertyDAO,
  createMockPropertyUnitDAO,
  createMockPropertyService,
  createMockPropertyUnitService,
} from './property.mocks';

// Client mocks
import {
  createMockClientDAO,
  createMockInvitationDAO,
  createMockClientService,
  createMockInvitationService,
} from './client.mocks';

// Infrastructure mocks
import {
  createMockRedisService,
  createMockS3Service,
  createMockEmailQueue,
  createMockDatabaseService,
  createMockLogger,
  createMockInvitationQueue,
  createMockPropertyQueue,
  createMockPropertyUnitQueue,
  createMockUploadQueue,
  createMockDocumentProcessingQueue,
  createMockEventBusQueue,
  createMockEmitterService,
} from './infrastructure.mocks';

// Awilix Container Mock
export const createMockAwilixContainer = () => ({
  cradle: {
    // Auth Services
    authService: createMockAuthService(),
    authTokenService: createMockAuthTokenService(),
    authCache: createMockAuthCache(),
    permissionService: createMockPermissionService(),

    // Property Services
    propertyService: createMockPropertyService(),
    propertyUnitService: createMockPropertyUnitService(),

    // Client Services
    clientService: createMockClientService(),
    invitationService: createMockInvitationService(),

    // Infrastructure Services
    s3Service: createMockS3Service(),
    redisService: createMockRedisService(),
    dbService: createMockDatabaseService(),
    emitterService: createMockEmitterService(),

    // DAOs
    userDAO: createMockUserDAO(),
    clientDAO: createMockClientDAO(),
    profileDAO: createMockProfileDAO(),
    propertyDAO: createMockPropertyDAO(),
    propertyUnitDAO: createMockPropertyUnitDAO(),
    invitationDAO: createMockInvitationDAO(),

    // Queues
    emailQueue: createMockEmailQueue(),
    invitationQueue: createMockInvitationQueue(),
    propertyQueue: createMockPropertyQueue(),
    propertyUnitQueue: createMockPropertyUnitQueue(),
    uploadQueue: createMockUploadQueue(),
    documentProcessingQueue: createMockDocumentProcessingQueue(),
    eventBusQueue: createMockEventBusQueue(),

    // Utilities
    logger: createMockLogger(),
  },

  resolve: jest.fn().mockImplementation((name: string) => {
    const cradle = createMockAwilixContainer().cradle;
    return cradle[name as keyof typeof cradle];
  }),

  register: jest.fn(),
  createScope: jest.fn().mockReturnThis(),
  hasRegistration: jest.fn().mockReturnValue(true),
  dispose: jest.fn(),
});

// Test Container Setup Utility
export const setupTestContainer = () => {
  const container = createMockAwilixContainer();

  // Reset all mocks before each test
  beforeEach(() => {
    Object.values(container.cradle).forEach((service) => {
      if (service && typeof service === 'object') {
        Object.values(service).forEach((method) => {
          if (jest.isMockFunction(method)) {
            method.mockClear();
          }
        });
      }
    });
  });

  return container;
};

// Helper to create scoped containers for specific tests
export const createScopedTestContainer = (overrides: Record<string, any> = {}) => {
  const container = createMockAwilixContainer();
  
  // Apply overrides to specific services
  Object.keys(overrides).forEach(serviceName => {
    if (container.cradle[serviceName as keyof typeof container.cradle]) {
      container.cradle[serviceName as keyof typeof container.cradle] = overrides[serviceName];
    }
  });

  return container;
};