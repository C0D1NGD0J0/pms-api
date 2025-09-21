import { ClientSession } from 'mongoose';
import { IUserDocument } from '@interfaces/user.interface';
import { IClientDocument } from '@interfaces/client.interface';

export const createMockClientDAO = () => ({
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest
    .fn()
    .mockImplementation(async (id: string, data: any, _options?: any, _session?: ClientSession) => {
      return { _id: id, ...data };
    }),
  deleteItem: jest.fn(),
  startSession: jest.fn().mockResolvedValue({} as ClientSession),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),
  update: jest.fn(),
  updateMany: jest.fn(),
  upsert: jest.fn(),
  aggregate: jest.fn(),
  deleteAll: jest.fn(),
  findById: jest.fn(),
  countDocuments: jest.fn(),
  createInstance: jest.fn(),

  getClientById: jest.fn(),
  getClientByCuid: jest.fn().mockResolvedValue({
    _id: 'mock-client-id',
    cuid: 'mock-cuid',
    displayName: 'Mock Client',
    isVerified: false,
    accountAdmin: 'mock-admin-id',
    identification: {
      idType: 'passport',
      idNumber: '123456789',
      authority: 'Mock Authority',
    },
    companyProfile: {
      legalEntityName: 'Mock Company',
      registrationNumber: 'REG123',
      companyEmail: 'company@example.com',
    },
    toObject: jest.fn().mockReturnThis(),
  } as unknown as IClientDocument),
  listClients: jest.fn(),
  updateIdentification: jest.fn(),
  updateClientSettings: jest.fn(),
  updateCompanyInfo: jest.fn(),
  getClientsByAccountAdmin: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  updateAccountType: jest.fn(),
  updateSubscription: jest.fn(),
  searchClients: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  createClient: jest.fn(),
  doesClientExist: jest.fn(),
  getClientUsersStats: jest.fn().mockResolvedValue({
    totalFilteredUsers: 10,
    roleDistribution: [
      { name: 'Staff', value: 5, percentage: 50 },
      { name: 'Manager', value: 3, percentage: 30 },
      { name: 'Admin', value: 2, percentage: 20 },
    ],
    departmentDistribution: [
      { name: 'IT', value: 4, percentage: 40 },
      { name: 'HR', value: 3, percentage: 30 },
      { name: 'Finance', value: 3, percentage: 30 },
    ],
  }),
});

export const createMockUserDAO = () => ({
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest
    .fn()
    .mockImplementation(async (id: string, data: any, _options?: any, _session?: ClientSession) => {
      return { _id: id, ...data };
    }),
  deleteItem: jest.fn(),
  startSession: jest.fn().mockResolvedValue({} as ClientSession),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),
  update: jest.fn(),
  updateMany: jest.fn(),
  upsert: jest.fn(),
  aggregate: jest.fn(),
  deleteAll: jest.fn(),
  findById: jest.fn(),
  countDocuments: jest.fn(),
  createInstance: jest.fn(),

  getUserById: jest.fn().mockResolvedValue({
    _id: 'mock-user-id',
    email: 'user@example.com',
    cuids: [
      {
        cuid: 'mock-client-id',
        roles: ['user'],
        isConnected: true,
        displayName: 'Mock User',
      },
    ],
  } as unknown as IUserDocument),
  addUserToClient: jest.fn(),
  getUsersByClientId: jest.fn().mockResolvedValue({
    items: [
      {
        _id: 'user1',
        email: 'user1@example.com',
        cuids: [
          { cuid: 'client1', roles: ['admin'], isConnected: true, displayName: 'Admin User' },
        ],
        profile: { personalInfo: { firstName: 'Admin', lastName: 'User' } },
      },
      {
        _id: 'user2',
        email: 'user2@example.com',
        cuids: [
          { cuid: 'client1', roles: ['user'], isConnected: true, displayName: 'Regular User' },
        ],
        profile: { personalInfo: { firstName: 'Regular', lastName: 'User' } },
      },
    ],
    pagination: { total: 2, perPage: 100, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  assignUserRole: jest.fn().mockResolvedValue({ success: true }),
  removeUserRole: jest.fn().mockResolvedValue({ success: true }),
  updateUserClientConnection: jest.fn().mockResolvedValue({ success: true }),
  findUserByEmail: jest.fn(),
  associateUserWithClient: jest.fn(),
  createUserFromInvitation: jest.fn(),
  createActivationToken: jest.fn(),
  listUsers: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  removeClientAssociation: jest.fn(),
  getUserWithClientAccess: jest.fn(),
  getActiveUserByEmail: jest.fn(),
  verifyCredentials: jest.fn(),
  resetPassword: jest.fn(),
  getUserWithProfileByEmailOrId: jest.fn(),
  getUserClientAssociations: jest.fn(),
  getUserByUId: jest.fn(),
  searchUsers: jest.fn(),
  createPasswordResetToken: jest.fn(),
  activateAccount: jest.fn(),
  isEmailUnique: jest.fn(),
  getUsersByFilteredType: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
});

export const createMockPropertyDAO = () => ({
  getFilteredProperties: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  getUnitCountsByStatus: jest.fn().mockResolvedValue({
    total: 0,
    available: 0,
    occupied: 0,
    reserved: 0,
    maintenance: 0,
    inactive: 0,
  }),
  getPropertiesByClientId: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  updatePropertyOccupancy: jest.fn(),
  canArchiveProperty: jest.fn().mockResolvedValue({
    canArchive: true,
    activeUnitCount: 0,
    occupiedUnitCount: 0,
  }),
  updatePropertyDocument: jest.fn(),
  findPropertiesNearby: jest.fn(),
  removePropertyDocument: jest.fn(),
  findPropertyByAddress: jest.fn(),
  canAddUnitToProperty: jest.fn().mockResolvedValue({
    canAdd: true,
    currentCount: 0,
    maxCapacity: 100,
  }),
  getPropertyUnits: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  createProperty: jest.fn(),
  syncPropertyOccupancyWithUnits: jest.fn(),
  searchProperties: jest.fn().mockResolvedValue({
    items: [],
    pagination: { total: 0, perPage: 10, totalPages: 1, currentPage: 1, hasMoreResource: false },
  }),
  archiveProperty: jest.fn(),
  countDocuments: jest.fn().mockResolvedValue(0),
});

export const createMockInvitationDAO = () => ({
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  deleteItem: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest
    .fn()
    .mockImplementation(
      async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
        return await callback(session);
      }
    ),
  getInvitationById: jest.fn(),
  getInvitationsByClient: jest.fn(),
});

export const createMockClientService = () => ({
  updateClientDetails: jest.fn().mockResolvedValue({
    success: true,
    data: {
      _id: 'mock-client-id',
      cuid: 'mock-cuid',
      displayName: 'Updated Client',
      isVerified: false,
    },
    message: 'Client updated successfully',
  }),
  getClientDetails: jest.fn().mockResolvedValue({
    success: true,
    data: {
      _id: 'mock-client-id',
      cuid: 'mock-cuid',
      displayName: 'Mock Client',
      clientStats: {
        totalProperties: 5,
        totalUsers: 3,
      },
      accountAdmin: {
        email: 'admin@example.com',
        id: 'admin-id',
        firstName: 'Admin',
        lastName: 'User',
        phoneNumber: '+1234567890',
        avatar: '',
      },
    },
    message: 'Client details retrieved successfully',
  }),
  assignUserRole: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Role assigned successfully',
  }),
  removeUserRole: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Role removed successfully',
  }),
  getUserRoles: jest.fn().mockResolvedValue({
    success: true,
    data: { roles: ['user'] },
    message: 'User roles retrieved successfully',
  }),
  disconnectUser: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'User disconnected successfully',
  }),
  reconnectUser: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'User reconnected successfully',
  }),
  getClientUsers: jest.fn().mockResolvedValue({
    success: true,
    data: {
      users: [
        {
          id: 'user1',
          email: 'user1@example.com',
          displayName: 'User One',
          roles: ['admin'],
          isConnected: true,
          profile: { personalInfo: { firstName: 'User', lastName: 'One' } },
        },
        {
          id: 'user2',
          email: 'user2@example.com',
          displayName: 'User Two',
          roles: ['user'],
          isConnected: true,
          profile: { personalInfo: { firstName: 'User', lastName: 'Two' } },
        },
      ],
    },
    message: 'Client users retrieved successfully',
  }),
});

export const createMockInvitationService = () => ({
  createInvitation: jest.fn(),
  sendInvitation: jest.fn(),
  acceptInvitation: jest.fn(),
  cancelInvitation: jest.fn(),
  getInvitationById: jest.fn(),
  getInvitationsByClient: jest.fn(),
  resendInvitation: jest.fn(),
});

export const createMockLogger = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  trace: jest.fn(),
  fatal: jest.fn(),
});

export const mockCreateLogger = jest.fn().mockReturnValue(createMockLogger());

export const mockGetRequestDuration = jest.fn().mockReturnValue({
  durationInMs: 123.456,
});

export const createMockRequestContext = (overrides: any = {}) => ({
  currentuser: {
    sub: 'mock-user-id',
    client: {
      csub: 'mock-client-id',
    },
    ...overrides.currentuser,
  },
  request: {
    url: '/api/v1/clients/mock-cuid',
    params: {
      cuid: 'mock-cuid',
      ...overrides.params,
    },
    ...overrides.request,
  },
  requestId: 'mock-request-id',
  ...overrides,
});

export const createMockCustomErrors = () => ({
  BadRequestError: jest.fn().mockImplementation((opts) => {
    const error = new Error(opts.message);
    error.name = 'BadRequestError';
    return error;
  }),
  NotFoundError: jest.fn().mockImplementation((opts) => {
    const error = new Error(opts.message);
    error.name = 'NotFoundError';
    return error;
  }),
  ForbiddenError: jest.fn().mockImplementation((opts) => {
    const error = new Error(opts.message);
    error.name = 'ForbiddenError';
    return error;
  }),
});

export const mockTranslation = jest.fn().mockImplementation((key: string, params?: any) => {
  return params ? `${key} ${JSON.stringify(params)}` : key;
});
