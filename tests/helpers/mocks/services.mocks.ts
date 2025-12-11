/**
 * Centralized Service Mock Factory
 * Eliminates repetitive service test setup across all test files
 */

import {
  createMockPropertyCsvProcessor,
  createMockEventEmitterService,
  createMockAuthTokenService,
  createMockPropertyUnitDAO,
  createMockGeoCoderService,
  createMockNotificationDAO,
  createMockVendorService,
  createMockInvitationDAO,
  createMockPropertyCache,
  createMockPropertyQueue,
  createMockPropertyDAO,
  createMockUploadQueue,
  createMockProfileDAO,
  createMockEmailQueue,
  createMockAuthCache,
  createMockClientDAO,
  createMockUserDAO,
} from '../index';

/**
 * Common service dependencies that appear in multiple services
 */
export interface CommonServiceDependencies {
  emitterService?: any;
  profileDAO?: any;
  emailQueue?: any;
  clientDAO?: any;
  userDAO?: any;
}

/**
 * Create standard service dependency mocks
 */
export const createServiceDependencies = (overrides: Partial<CommonServiceDependencies> = {}): CommonServiceDependencies => ({
  userDAO: createMockUserDAO(),
  clientDAO: createMockClientDAO(),
  profileDAO: createMockProfileDAO(),
  emailQueue: createMockEmailQueue(),
  emitterService: createMockEventEmitterService(),
  ...overrides,
});

/**
 * AuthService complete dependency factory
 */
export const createAuthServiceDependencies = (overrides: any = {}) => ({
  tokenService: createMockAuthTokenService(),
  authCache: createMockAuthCache(),
  userDAO: createMockUserDAO(),
  clientDAO: createMockClientDAO(),
  profileDAO: createMockProfileDAO(),
  emailQueue: createMockEmailQueue(),
  vendorService: createMockVendorService(),
  ...overrides,
});

/**
 * PropertyService complete dependency factory
 */
export const createPropertyServiceDependencies = (overrides: any = {}) => {
  const mockPropertyDAO = createMockPropertyDAO();
  const mockUserDAO = createMockUserDAO();
  const mockProfileDAO = createMockProfileDAO();

  return {
    propertyDAO: mockPropertyDAO,
    clientDAO: createMockClientDAO(),
    profileDAO: mockProfileDAO,
    propertyUnitDAO: createMockPropertyUnitDAO(),
    geoCoderService: createMockGeoCoderService(),
    emitterService: createMockEventEmitterService(),
    propertyCache: createMockPropertyCache(),
    propertyQueue: createMockPropertyQueue(),
    uploadQueue: createMockUploadQueue(),
    propertyCsvProcessor: createMockPropertyCsvProcessor(),
    userDAO: mockUserDAO,
    mediaUploadService: {
      handleMediaDeletion: jest.fn().mockResolvedValue(undefined),
    },
    notificationService: {
      handlePropertyUpdateNotifications: jest.fn().mockResolvedValue(undefined),
      notifyPropertyUpdate: jest.fn().mockResolvedValue(undefined),
      notifyApprovalNeeded: jest.fn().mockResolvedValue(undefined),
      notifyApprovalDecision: jest.fn().mockResolvedValue(undefined),
    },
    ...overrides,
  };
};

/**
 * PropertyUnitService complete dependency factory
 */
export const createPropertyUnitServiceDependencies = (overrides: any = {}) => ({
  propertyUnitDAO: createMockPropertyUnitDAO(),
  propertyDAO: createMockPropertyDAO(),
  clientDAO: createMockClientDAO(),
  profileDAO: createMockProfileDAO(),
  emitterService: createMockEventEmitterService(),
  propertyUnitCsvProcessor: {
    processUnitsFromCsv: jest.fn(),
    generateSampleCsv: jest.fn(),
  },
  unitNumberingService: {
    generateUnitNumbers: jest.fn(),
    validateUnitNumberPattern: jest.fn(),
  },
  ...overrides,
});

/**
 * InvitationService complete dependency factory
 */
export const createInvitationServiceDependencies = (overrides: any = {}) => ({
  invitationDAO: createMockInvitationDAO(),
  userDAO: createMockUserDAO(),
  clientDAO: createMockClientDAO(),
  profileDAO: createMockProfileDAO(),
  emailQueue: createMockEmailQueue(),
  emitterService: createMockEventEmitterService(),
  ...overrides,
});

/**
 * NotificationService complete dependency factory
 */
export const createNotificationServiceDependencies = (overrides: any = {}) => ({
  notificationDAO: createMockNotificationDAO(),
  emailQueue: createMockEmailQueue(),
  socketHandler: {
    sendToUser: jest.fn(),
    broadcastToClient: jest.fn(),
    sendNotification: jest.fn(),
  },
  notificationCache: {
    getUnreadCount: jest.fn(),
    setUnreadCount: jest.fn(),
    invalidateUnreadCount: jest.fn(),
  },
  ...overrides,
});

/**
 * UserService complete dependency factory
 */
export const createUserServiceDependencies = (overrides: any = {}) => ({
  userDAO: createMockUserDAO(),
  clientDAO: createMockClientDAO(),
  vendorDAO: {
    create: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    list: jest.fn(),
  },
  profileDAO: createMockProfileDAO(),
  emailQueue: createMockEmailQueue(),
  emitterService: createMockEventEmitterService(),
  ...overrides,
});

/**
 * ClientService complete dependency factory
 */
export const createClientServiceDependencies = (overrides: any = {}) => ({
  clientDAO: createMockClientDAO(),
  userDAO: createMockUserDAO(),
  propertyDAO: createMockPropertyDAO(),
  emailQueue: createMockEmailQueue(),
  emitterService: createMockEventEmitterService(),
  ...overrides,
});

/**
 * ProfileService complete dependency factory
 */
export const createProfileServiceDependencies = (overrides: any = {}) => ({
  profileDAO: createMockProfileDAO(),
  clientDAO: createMockClientDAO(),
  userDAO: createMockUserDAO(),
  emitterService: createMockEventEmitterService(),
  ...overrides,
});

/**
 * Generic service factory for simple services
 * Use this when you just need a few basic dependencies
 */
export const createBasicServiceDependencies = (dependencies: string[], overrides: any = {}) => {
  const mocks: any = {};

  const mockFactories: Record<string, () => any> = {
    userDAO: createMockUserDAO,
    clientDAO: createMockClientDAO,
    profileDAO: createMockProfileDAO,
    propertyDAO: createMockPropertyDAO,
    propertyUnitDAO: createMockPropertyUnitDAO,
    invitationDAO: createMockInvitationDAO,
    notificationDAO: createMockNotificationDAO,
    emailQueue: createMockEmailQueue,
    emitterService: createMockEventEmitterService,
  };

  dependencies.forEach(dep => {
    if (mockFactories[dep]) {
      mocks[dep] = mockFactories[dep]();
    }
  });

  return { ...mocks, ...overrides };
};

/**
 * Helper to create service instance with mocked dependencies
 * Reduces boilerplate in test setup
 */
export const createServiceWithMocks = <T>(
  ServiceClass: new (deps: any) => T,
  dependencyFactory: (overrides?: any) => any,
  overrides: any = {}
): { service: T; mocks: any } => {
  const mocks = dependencyFactory(overrides);
  const service = new ServiceClass(mocks);

  return { service, mocks };
};