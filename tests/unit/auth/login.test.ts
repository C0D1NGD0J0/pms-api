/* eslint-disable */
import * as uuid from 'uuid';
import { Types } from 'mongoose';
import { AuthService } from '@root/app/services/index';
import '@tests/di';
import {
  BadRequestError,
  ForbiddenError,
  InvalidRequestError,
  NotFoundError,
  UnauthorizedError,
} from '@shared/customErrors';

// Mock dependencies
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid'),
}));

jest.mock('@utils/index', () => ({
  hashGenerator: jest.fn((_hashOpts = {}) => 'test-activation-token'),
  createLogger: jest.fn(() => ({
    error: jest.fn(),
    info: jest.fn(),
    debug: jest.fn(),
  })),
  JWT_KEY_NAMES: {
    ACCESS_TOKEN: 'access_token',
    REFRESH_TOKEN: 'refresh_token',
  },
}));

describe('AuthService - Login and Session Management', () => {
  let authService: AuthService;
  let mockUserDAO: any;
  let mockClientDAO: any;
  let mockProfileDAO: any;
  let mockTokenService: any;
  let mockAuthCache: any;
  let mockEmailQueue: any;

  const mockUserId = new Types.ObjectId();
  const mockClientId = 'mock-cid';
  const mockClientId2 = 'mock-cid-2';

  beforeEach(() => {
    jest.clearAllMocks();
    (uuid.v4 as jest.Mock).mockReturnValue(mockClientId);

    mockUserDAO = {
      getUserByEmail: jest.fn(),
      getUserById: jest.fn(),
      verifyCredentials: jest.fn(),
      updateById: jest.fn(),
    };

    mockClientDAO = {
      findByCid: jest.fn(),
    };

    mockProfileDAO = {
      generateCurrentUserInfo: jest.fn(),
      findByUserId: jest.fn(),
    };

    mockTokenService = {
      createJwtTokens: jest.fn(),
      verifyJwtToken: jest.fn(),
    };

    mockAuthCache = {
      saveRefreshToken: jest.fn(),
      saveCurrentUser: jest.fn(),
      invalidateUserSession: jest.fn(),
    };

    mockEmailQueue = {
      addToEmailQueue: jest.fn(),
    };

    authService = new AuthService({
      userDAO: mockUserDAO,
      clientDAO: mockClientDAO,
      profileDAO: mockProfileDAO,
      emailQueue: mockEmailQueue,
      tokenService: mockTokenService,
      authCache: mockAuthCache,
    });
  });

  describe('login', () => {
    const loginData = {
      email: 'test@example.com',
      password: 'Password123!',
      rememberMe: false,
    };

    it('should throw BadRequestError if email or password is missing', async () => {
      await expect(
        authService.login({ email: '', password: '', rememberMe: false })
      ).rejects.toThrow(BadRequestError);
      expect(mockUserDAO.getUserByEmail).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if user is not found by email', async () => {
      mockUserDAO.getUserByEmail.mockResolvedValue(null);

      await expect(authService.login(loginData)).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.getUserByEmail).toHaveBeenCalledWith(loginData.email);
      expect(mockUserDAO.verifyCredentials).not.toHaveBeenCalled();
    });

    it('should throw InvalidRequestError if account is not activated', async () => {
      mockUserDAO.getUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: false,
      });

      await expect(authService.login(loginData)).rejects.toThrow(InvalidRequestError);
      expect(mockUserDAO.getUserByEmail).toHaveBeenCalledWith(loginData.email);
      expect(mockUserDAO.verifyCredentials).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if credentials verification fails', async () => {
      mockUserDAO.getUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
      });
      mockUserDAO.verifyCredentials.mockResolvedValue(null);

      await expect(authService.login(loginData)).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.getUserByEmail).toHaveBeenCalledWith(loginData.email);
      expect(mockUserDAO.verifyCredentials).toHaveBeenCalledWith(
        loginData.email,
        loginData.password
      );
    });

    it('should successfully login with single account', async () => {
      const mockTokens = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      };

      // Setup user with one account
      mockUserDAO.getUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
        ],
      });

      mockUserDAO.verifyCredentials.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
        ],
      });

      mockTokenService.createJwtTokens.mockReturnValue(mockTokens);
      mockAuthCache.saveRefreshToken.mockResolvedValue(true);
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        displayName: 'Test User',
      });
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      const result = await authService.login(loginData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Login successful.');
      expect(result.data).toEqual({
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
        rememberMe: loginData.rememberMe,
        activeAccount: {
          cid: mockClientId,
          displayName: 'Test User',
        },
        accounts: [],
      });

      expect(mockTokenService.createJwtTokens).toHaveBeenCalledWith({
        sub: mockUserId.toString(),
        rememberMe: loginData.rememberMe,
      });
      expect(mockAuthCache.saveRefreshToken).toHaveBeenCalledWith(
        mockUserId.toString(),
        mockTokens.refreshToken,
        loginData.rememberMe
      );
    });

    it('should successfully login with multiple accounts', async () => {
      const mockTokens = {
        accessToken: 'mock-access-token',
        refreshToken: 'mock-refresh-token',
      };

      // Setup user with multiple accounts
      mockUserDAO.getUserByEmail.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
          {
            cid: mockClientId2,
            isConnected: true,
            roles: ['USER'],
            displayName: 'Test User 2',
          },
        ],
      });

      mockUserDAO.verifyCredentials.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        isActive: true,
        activeCid: mockClientId,
        cids: [
          {
            cid: mockClientId,
            isConnected: true,
            roles: ['ADMIN'],
            displayName: 'Test User',
          },
          {
            cid: mockClientId2,
            isConnected: true,
            roles: ['USER'],
            displayName: 'Test User 2',
          },
        ],
      });

      mockTokenService.createJwtTokens.mockReturnValue(mockTokens);
      mockAuthCache.saveRefreshToken.mockResolvedValue(true);
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue({
        _id: mockUserId,
        email: loginData.email,
        displayName: 'Test User',
      });
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      const result = await authService.login(loginData);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Login successful.');
      expect(result.data).toEqual({
        accessToken: mockTokens.accessToken,
        refreshToken: mockTokens.refreshToken,
        rememberMe: loginData.rememberMe,
        activeAccount: {
          cid: mockClientId,
          displayName: 'Test User',
        },
        accounts: [
          {
            cid: mockClientId2,
            displayName: 'Test User 2',
          },
        ],
      });
    });
  });

  describe('getCurrentUser', () => {
    it('should throw BadRequestError if userId is missing', async () => {
      await expect(authService.getCurrentUser('')).rejects.toThrow(BadRequestError);
      expect(mockProfileDAO.generateCurrentUserInfo).not.toHaveBeenCalled();
    });

    it('should throw UnauthorizedError if user not found', async () => {
      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(null);

      await expect(authService.getCurrentUser(mockUserId.toString())).rejects.toThrow(
        UnauthorizedError
      );
      expect(mockProfileDAO.generateCurrentUserInfo).toHaveBeenCalledWith(mockUserId.toString());
    });

    it('should return user data successfully', async () => {
      const userData = {
        _id: mockUserId,
        email: 'test@example.com',
        displayName: 'Test User',
      };

      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(userData);
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: true });

      const result = await authService.getCurrentUser(mockUserId.toString());

      expect(result.success).toBe(true);
      expect(result.data).toEqual(userData);
      expect(mockAuthCache.saveCurrentUser).toHaveBeenCalledWith(userData);
    });

    it('should handle cache failure gracefully', async () => {
      const userData = {
        _id: mockUserId,
        email: 'test@example.com',
        displayName: 'Test User',
      };

      mockProfileDAO.generateCurrentUserInfo.mockResolvedValue(userData);
      mockAuthCache.saveCurrentUser.mockResolvedValue({ success: false });

      const result = await authService.getCurrentUser(mockUserId.toString());

      expect(result.success).toBe(false);
      expect(result.data).toBeNull();
    });
  });

  describe('switchActiveAccount', () => {
    it('should throw BadRequestError if userId or newCid is missing', async () => {
      await expect(authService.switchActiveAccount('', mockClientId)).rejects.toThrow(
        BadRequestError
      );
      await expect(authService.switchActiveAccount(mockUserId.toString(), '')).rejects.toThrow(
        BadRequestError
      );
      expect(mockUserDAO.getUserById).not.toHaveBeenCalled();
    });

    it('should throw NotFoundError if user not found', async () => {
      mockUserDAO.getUserById.mockResolvedValue(null);

      await expect(
        authService.switchActiveAccount(mockUserId.toString(), mockClientId)
      ).rejects.toThrow(NotFoundError);
      expect(mockUserDAO.getUserById).toHaveBeenCalledWith(mockUserId.toString());
    });

    it('should throw ForbiddenError if account does not exist for user', async () => {
      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        cids: [{ cid: 'different-cid', displayName: 'Different Account' }],
      });

      await expect(
        authService.switchActiveAccount(mockUserId.toString(), mockClientId)
      ).rejects.toThrow(ForbiddenError);
      expect(mockUserDAO.updateById).not.toHaveBeenCalled();
    });

    it('should successfully switch to a valid account', async () => {
      mockUserDAO.getUserById.mockResolvedValue({
        _id: mockUserId,
        cids: [
          { cid: 'different-cid', displayName: 'Different Account' },
          { cid: mockClientId, displayName: 'Test Account' },
        ],
      });

      mockUserDAO.updateById.mockResolvedValue(true);

      const result = await authService.switchActiveAccount(mockUserId.toString(), mockClientId);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Account switched successfully.');
      expect(result.data).toEqual({
        activeAccount: {
          cid: mockClientId,
          displayName: 'Test Account',
        },
      });
      expect(mockUserDAO.updateById).toHaveBeenCalledWith(mockUserId.toString(), {
        $set: { activeCid: mockClientId },
      });
    });
  });

  describe('logout', () => {
    it('should log error if accessToken is missing', async () => {
      await authService.logout('');
      // We expect the service to log the error but not throw
      expect(mockTokenService.verifyJwtToken).not.toHaveBeenCalled();
    });

    it('should not invalidate session if token verification fails', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: false,
        data: null,
      });

      await expect(authService.logout('invalid-token')).rejects.toThrow();
      expect(mockAuthCache.invalidateUserSession).not.toHaveBeenCalled();
    });

    it('should successfully logout and invalidate session', async () => {
      mockTokenService.verifyJwtToken.mockResolvedValue({
        success: true,
        data: { sub: mockUserId.toString() },
      });

      mockAuthCache.invalidateUserSession.mockResolvedValue(true);

      const result = await authService.logout('valid-token');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Logout successful.');
      expect(mockTokenService.verifyJwtToken).toHaveBeenCalledWith('access_token', 'valid-token');
      expect(mockAuthCache.invalidateUserSession).toHaveBeenCalledWith(mockUserId.toString());
    });
  });
});
