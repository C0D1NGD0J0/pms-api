import { Types, ClientSession } from 'mongoose';
import { ISuccessReturnData, ICurrentUser } from '@interfaces/index';
import { IUserDocument } from '@interfaces/user.interface';
import { createMockUser, createMockCurrentUser } from '../mockFactories';

// Auth Service Mocks with proper interfaces
export const createMockAuthService = () => ({
  refreshToken: jest.fn().mockResolvedValue({
    success: true,
    data: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      rememberMe: false,
    },
    message: 'Token refreshed successfully',
  } as ISuccessReturnData<{
    accessToken: string;
    refreshToken: string;
    rememberMe: boolean;
  }>),

  getTokenUser: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Token validated successfully',
  } as ISuccessReturnData),

  verifyClientAccess: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'User has access to client',
  } as ISuccessReturnData),

  signup: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Activation email sent',
  } as ISuccessReturnData),

  login: jest.fn().mockResolvedValue({
    success: true,
    data: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      rememberMe: false,
      activeAccount: { csub: 'mock-cuid', displayName: 'Test Account' },
      accounts: [],
    },
    message: 'Login successful',
  } as ISuccessReturnData<{
    accessToken: string;
    rememberMe: boolean;
    refreshToken: string;
    activeAccount: { csub: string; displayName: string };
    accounts: { csub: string; displayName: string }[] | null;
  }>),

  getCurrentUser: jest.fn().mockResolvedValue({
    success: true,
    data: createMockCurrentUser(),
  } as ISuccessReturnData<ICurrentUser>),

  switchActiveAccount: jest.fn().mockResolvedValue({
    success: true,
    data: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      activeAccount: { csub: 'new-cuid', displayName: 'New Account' },
    },
    message: 'Account switched successfully',
  } as ISuccessReturnData<{
    accessToken: string;
    refreshToken: string;
    activeAccount: { csub: string; displayName: string };
  }>),

  accountActivation: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Account activated successfully',
  } as ISuccessReturnData),

  sendActivationLink: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Activation link sent',
  } as ISuccessReturnData),

  forgotPassword: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Password reset email sent',
  } as ISuccessReturnData),

  resetPassword: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Password reset email sent',
  } as ISuccessReturnData),

  logout: jest.fn().mockResolvedValue({
    success: true,
    data: null,
    message: 'Logout successful',
  } as ISuccessReturnData),

  inviteUserSignup: jest.fn().mockRejectedValue(
    new Error('This method should be called through InvitationService.acceptInvitation')
  ),

  loginAfterInvitationSignup: jest.fn().mockResolvedValue({
    success: true,
    data: {
      accessToken: 'mock-access-token',
      refreshToken: 'mock-refresh-token',
      activeAccount: { csub: 'mock-cuid', displayName: 'Test Account' },
      accounts: null,
    },
    message: 'Login successful',
  } as ISuccessReturnData<{
    accessToken: string;
    refreshToken: string;
    activeAccount: { csub: string; displayName: string };
    accounts: { csub: string; displayName: string }[] | null;
  }>),
});

// Auth Token Service Mocks
export const createMockAuthTokenService = () => ({
  createJwtTokens: jest.fn().mockReturnValue({
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    rememberMe: false,
  }),

  verifyJwtToken: jest.fn().mockResolvedValue({
    success: true,
    data: {
      rememberMe: false,
      sub: new Types.ObjectId().toString(),
      csub: 'mock-cuid',
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    },
  }),

  decodeJwt: jest.fn().mockReturnValue({
    success: true,
    data: {
      data: {
        sub: new Types.ObjectId().toString(),
        csub: 'mock-cuid',
        rememberMe: false,
      },
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 900,
    },
  }),

  extractTokenFromRequest: jest.fn().mockReturnValue('mock-token'),
});

// Auth Cache Mocks
export const createMockAuthCache = () => ({
  saveRefreshToken: jest.fn().mockResolvedValue({
    success: true,
    data: null,
  } as ISuccessReturnData),

  getRefreshToken: jest.fn().mockResolvedValue({
    success: true,
    data: 'mock-refresh-token',
  } as ISuccessReturnData<string>),

  deleteRefreshToken: jest.fn().mockResolvedValue({
    success: true,
    data: null,
  } as ISuccessReturnData),

  saveCurrentUser: jest.fn().mockResolvedValue({
    success: true,
    data: null,
  } as ISuccessReturnData),

  getCurrentUser: jest.fn().mockResolvedValue({
    success: true,
    data: createMockCurrentUser(),
  } as ISuccessReturnData<ICurrentUser>),

  updateCurrentUserProperty: jest.fn().mockResolvedValue({
    success: true,
    data: null,
  } as ISuccessReturnData),

  invalidateUserSession: jest.fn().mockResolvedValue({
    success: true,
    data: null,
  } as ISuccessReturnData),
});

// User DAO Mock
export const createMockUserDAO = () => ({
  // BaseDAO methods
  findFirst: jest.fn().mockResolvedValue(createMockUser()),
  list: jest.fn().mockResolvedValue({ items: [createMockUser()], pagination: undefined }),
  insert: jest.fn().mockResolvedValue(createMockUser()),
  updateById: jest.fn().mockResolvedValue({ acknowledged: true, modifiedCount: 1 }),
  deleteById: jest.fn().mockResolvedValue({ acknowledged: true, deletedCount: 1 }),
  startSession: jest.fn().mockImplementation(() => ({
    startTransaction: jest.fn(),
    commitTransaction: jest.fn(),
    abortTransaction: jest.fn(),
    endSession: jest.fn(),
  })),
  withTransaction: jest.fn().mockImplementation(
    async (session: ClientSession, callback: (session: ClientSession) => Promise<any>) => {
      return await callback(session);
    }
  ),

  // UserDAO specific methods
  getUserById: jest.fn().mockResolvedValue(createMockUser()),
  getUserByUId: jest.fn().mockResolvedValue(createMockUser()),
  listUsers: jest.fn().mockResolvedValue({ items: [createMockUser()], pagination: undefined }),
  getActiveUserByEmail: jest.fn().mockResolvedValue(createMockUser()),
  verifyCredentials: jest.fn().mockResolvedValue(createMockUser()),
  createActivationToken: jest.fn().mockResolvedValue(true),
  activateAccount: jest.fn().mockResolvedValue(createMockUser()),
  createPasswordResetToken: jest.fn().mockResolvedValue(true),
  resetPassword: jest.fn().mockResolvedValue(true),
  getLinkedVendorUsers: jest.fn().mockResolvedValue({ items: [], pagination: undefined }),
});

// Profile DAO Mock
export const createMockProfileDAO = () => ({
  // BaseDAO methods
  findFirst: jest.fn(),
  list: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  deleteById: jest.fn(),
  startSession: jest.fn(),
  withTransaction: jest.fn(),

  // ProfileDAO specific methods
  generateCurrentUserInfo: jest.fn().mockResolvedValue(createMockCurrentUser()),
  getUserProfile: jest.fn(),
  updateProfile: jest.fn(),
  createUserProfile: jest.fn(),
});

// Permission Service Mock
export const createMockPermissionService = () => ({
  checkUserPermission: jest.fn().mockResolvedValue({
    granted: true,
    reason: 'User has required permission',
  }),
  populateUserPermissions: jest.fn().mockResolvedValue(createMockCurrentUser()),
});