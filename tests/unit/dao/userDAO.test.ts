/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks
import { UserDAO } from '@dao/userDAO';
import { User } from '@models/index';
import { 
  TestDataFactory,
  TestSuiteHelpers 
} from '@tests/utils/testHelpers';
import { 
  BadRequestError,
  NotFoundError 
} from '@shared/customErrors';
import { Types } from 'mongoose';
import dayjs from 'dayjs';
import { setupDAOTestMocks } from '@tests/mocks/dao/commonMocks';

// Setup all common DAO test mocks
setupDAOTestMocks();

describe('UserDAO - Unit Tests', () => {
  let userDAO: UserDAO;
  let mockUserModel: any;
  let mockLogger: any;

  beforeAll(() => {
    mockUserModel = {
      create: jest.fn(),
      findOne: jest.fn(),
      findById: jest.fn(),
      findByIdAndUpdate: jest.fn(),
      find: jest.fn(),
      countDocuments: jest.fn(),
      aggregate: jest.fn(),
    };

    mockLogger = {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
    };

    userDAO = new UserDAO({ 
      userModel: mockUserModel 
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserById', () => {
    describe('Successful user retrieval', () => {
      it('should get user by ID successfully', async () => {
        // Arrange
        const userId = 'user-123';
        const user = TestDataFactory.createUser({ _id: userId });

        userDAO.findFirst = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.getUserById(userId);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.findFirst).toHaveBeenCalledWith(
          { _id: expect.any(Types.ObjectId) },
          undefined
        );
      });

      it('should get user by ID with options', async () => {
        // Arrange
        const userId = 'user-456';
        const user = TestDataFactory.createUser({ _id: userId });
        const opts = { populate: 'profile' };

        userDAO.findFirst = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.getUserById(userId, opts);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.findFirst).toHaveBeenCalledWith(
          { _id: expect.any(Types.ObjectId) },
          opts
        );
      });

      it('should return null for non-existent user', async () => {
        // Arrange
        const userId = 'non-existent-user';

        userDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.getUserById(userId);

        // Assert
        expect(result).toBeNull();
      });
    });

    describe('User retrieval validation errors', () => {
      it('should throw error for missing user ID', async () => {
        // Arrange
        const userId = '';

        // Act & Assert
        await expect(userDAO.getUserById(userId))
          .rejects.toThrow('UserID missing.');
      });

      it('should handle database query errors', async () => {
        // Arrange
        const userId = 'user-error';
        const dbError = new Error('Database connection failed');

        userDAO.findFirst = jest.fn().mockRejectedValue(dbError);
        userDAO.throwErrorHandler = jest.fn().mockReturnValue(dbError);

        // Act & Assert
        await expect(userDAO.getUserById(userId))
          .rejects.toThrow('Database connection failed');

        expect(userDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
      });
    });
  });

  describe('getUserByUId', () => {
    describe('Successful user retrieval by UID', () => {
      it('should get user by UID successfully', async () => {
        // Arrange
        const uid = 'user-uid-123';
        const user = TestDataFactory.createUser({ uid });

        userDAO.findFirst = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.getUserByUId(uid);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.findFirst).toHaveBeenCalledWith(
          { uid },
          undefined
        );
      });

      it('should return null for non-existent UID', async () => {
        // Arrange
        const uid = 'non-existent-uid';

        userDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.getUserByUId(uid);

        // Assert
        expect(result).toBeNull();
      });
    });
  });

  describe('getActiveUserByEmail', () => {
    describe('Successful active user retrieval', () => {
      it('should get active user by email successfully', async () => {
        // Arrange
        const email = 'test@example.com';
        const user = TestDataFactory.createUser({ 
          email,
          isActive: true,
          deletedAt: null 
        });

        userDAO.findFirst = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.getActiveUserByEmail(email);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.findFirst).toHaveBeenCalledWith(
          { email, deletedAt: null, isActive: true },
          undefined
        );
      });

      it('should return null for inactive user', async () => {
        // Arrange
        const email = 'inactive@example.com';

        userDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.getActiveUserByEmail(email);

        // Assert
        expect(result).toBeNull();
      });
    });
  });

  describe('verifyCredentials', () => {
    describe('Successful credential verification', () => {
      it('should verify valid credentials', async () => {
        // Arrange
        const email = 'test@example.com';
        const password = 'correctpassword';
        const user = TestDataFactory.createUser({ email });
        
        // Mock the validatePassword method
        user.validatePassword = jest.fn().mockResolvedValue(true);
        
        userDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.verifyCredentials(email, password);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.getActiveUserByEmail).toHaveBeenCalledWith(email);
        expect(user.validatePassword).toHaveBeenCalledWith(password);
      });

      it('should return null for invalid credentials', async () => {
        // Arrange
        const email = 'test@example.com';
        const password = 'wrongpassword';
        const user = TestDataFactory.createUser({ email });
        
        user.validatePassword = jest.fn().mockResolvedValue(false);
        userDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.verifyCredentials(email, password);

        // Assert
        expect(result).toBeNull();
        expect(user.validatePassword).toHaveBeenCalledWith(password);
      });

      it('should return null for non-existent user', async () => {
        // Arrange
        const email = 'nonexistent@example.com';
        const password = 'anypassword';
        
        userDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.verifyCredentials(email, password);

        // Assert
        expect(result).toBeNull();
        expect(userDAO.getActiveUserByEmail).toHaveBeenCalledWith(email);
      });
    });
  });

  describe('createActivationToken', () => {
    describe('Successful activation token creation', () => {
      it('should create activation token with user ID', async () => {
        // Arrange
        const userId = 'user-123';
        const user = TestDataFactory.createUser({
          _id: userId,
          activationToken: 'generated-hash-token',
          activationTokenExpiresAt: new Date('2024-01-01T14:00:00Z'),
        });

        userDAO.update = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.createActivationToken(userId);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.update).toHaveBeenCalledWith(
          {
            deletedAt: null,
            isActive: false,
            $or: [{ _id: userId }],
          },
          {
            activationToken: 'generated-hash-token',
            activationTokenExpiresAt: new Date('2024-01-01T14:00:00Z'),
          }
        );
      });

      it('should create activation token with email', async () => {
        // Arrange
        const email = 'test@example.com';
        const user = TestDataFactory.createUser({
          email,
          activationToken: 'generated-hash-token',
          activationTokenExpiresAt: new Date('2024-01-01T14:00:00Z'),
        });

        userDAO.update = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.createActivationToken(undefined, email);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.update).toHaveBeenCalledWith(
          {
            deletedAt: null,
            isActive: false,
            email,
          },
          {
            activationToken: 'generated-hash-token',
            activationTokenExpiresAt: new Date('2024-01-01T14:00:00Z'),
          }
        );
      });

      it('should create activation token with both user ID and email', async () => {
        // Arrange
        const userId = 'user-123';
        const email = 'test@example.com';
        const user = TestDataFactory.createUser({
          _id: userId,
          email,
          activationToken: 'generated-hash-token',
        });

        userDAO.update = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.createActivationToken(userId, email);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.update).toHaveBeenCalledWith(
          {
            deletedAt: null,
            isActive: false,
            $or: [{ _id: userId }, { email }],
          },
          expect.any(Object)
        );
      });
    });

    describe('Activation token creation validation errors', () => {
      it('should throw error for missing user ID and email', async () => {
        // Act & Assert
        await expect(userDAO.createActivationToken())
          .rejects.toThrow('User ID or email is required to create activation token.');
      });
    });
  });

  describe('activateAccount', () => {
    describe('Successful account activation', () => {
      it('should activate account with valid token', async () => {
        // Arrange
        const token = 'valid-activation-token';
        const user = TestDataFactory.createUser({
          activationToken: token,
          activationTokenExpiresAt: new Date('2024-12-31'),
          isActive: false,
        });
        
        user.save = jest.fn().mockResolvedValue(user);
        userDAO.findFirst = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.activateAccount(token);

        // Assert
        expect(result).toBe(true);
        expect(user.isActive).toBe(true);
        expect(user.activationToken).toBe('');
        expect(user.activationTokenExpiresAt).toBeNull();
        expect(user.save).toHaveBeenCalled();
      });

      it('should not activate account with expired token', async () => {
        // Arrange
        const token = 'expired-token';
        
        userDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.activateAccount(token);

        // Assert
        expect(result).toBe(false);
        expect(userDAO.findFirst).toHaveBeenCalledWith({
          activationToken: token,
          activationTokenExpiresAt: { $gt: expect.any(Date) },
          isActive: false,
        });
      });

      it('should not activate account with invalid token', async () => {
        // Arrange
        const token = 'invalid-token';
        
        userDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.activateAccount(token);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('associateUserWithClient', () => {
    describe('Successful user-client association', () => {
      it('should create new association', async () => {
        // Arrange
        const userId = 'user-123';
        const clientId = 'client-456';
        const role = 'admin';
        
        const user = TestDataFactory.createUser({
          _id: userId,
          cids: [], // No existing associations
        });

        userDAO.getUserById = jest.fn().mockResolvedValue(user);
        userDAO.updateById = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.associateUserWithClient(userId, clientId, role);

        // Assert
        expect(result).toBe(true);
        expect(userDAO.updateById).toHaveBeenCalledWith(
          userId,
          {
            $push: {
              cids: {
                cid: clientId,
                isConnected: true,
              },
            },
            $addToSet: {
              roles: role,
            },
          }
        );
      });

      it('should update existing association with new role', async () => {
        // Arrange
        const userId = 'user-123';
        const clientId = 'client-456';
        const role = 'manager';
        
        const user = TestDataFactory.createUser({
          _id: userId,
          cids: [
            {
              cid: clientId,
              isConnected: false,
              roles: ['viewer'],
            },
          ],
        });

        userDAO.getUserById = jest.fn().mockResolvedValue(user);
        userDAO.update = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.associateUserWithClient(userId, clientId, role);

        // Assert
        expect(result).toBe(true);
        expect(userDAO.update).toHaveBeenCalledWith(
          { _id: userId, 'cids.cid': clientId },
          {
            $set: {
              'cids.$.isConnected': true,
            },
            $addToSet: {
              'cids.$.roles': role,
            },
          }
        );
      });

      it('should handle existing association with same role', async () => {
        // Arrange
        const userId = 'user-123';
        const clientId = 'client-456';
        const role = 'admin';
        
        const user = TestDataFactory.createUser({
          _id: userId,
          cids: [
            {
              cid: clientId,
              isConnected: true,
              roles: ['admin'],
            },
          ],
        });

        userDAO.getUserById = jest.fn().mockResolvedValue(user);
        userDAO.update = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.associateUserWithClient(userId, clientId, role);

        // Assert
        expect(result).toBe(true);
        expect(userDAO.update).toHaveBeenCalledWith(
          { _id: userId, 'cids.cid': clientId },
          {
            $set: {
              'cids.$.isConnected': true,
            },
            $addToSet: {
              'cids.$.roles': role,
            },
          }
        );
      });

      it('should return false for non-existent user', async () => {
        // Arrange
        const userId = 'non-existent-user';
        const clientId = 'client-456';
        const role = 'admin';

        userDAO.getUserById = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.associateUserWithClient(userId, clientId, role);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('getUsersByClientId', () => {
    describe('Successful users by client retrieval', () => {
      it('should get users associated with client', async () => {
        // Arrange
        const clientId = 'client-123';
        const users = [
          TestDataFactory.createUser({ 
            cids: [{ cid: clientId, isConnected: true }] 
          }),
          TestDataFactory.createUser({ 
            cids: [{ cid: clientId, isConnected: true }] 
          }),
        ];

        const paginatedResult = {
          data: users,
          pagination: {
            page: 1,
            limit: 10,
            total: 2,
            pages: 1,
          },
        };

        userDAO.list = jest.fn().mockResolvedValue(paginatedResult);

        // Act
        const result = await userDAO.getUsersByClientId(clientId);

        // Assert
        expect(result).toEqual(paginatedResult);
        expect(userDAO.list).toHaveBeenCalledWith(
          {
            'cids.cid': clientId,
            'cids.isConnected': true,
            deletedAt: null,
          },
          undefined
        );
      });

      it('should get users with additional filter', async () => {
        // Arrange
        const clientId = 'client-456';
        const filter = { isActive: true };
        const opts = { limit: 5 };

        const paginatedResult = {
          data: [],
          pagination: { page: 1, limit: 5, total: 0, pages: 0 },
        };

        userDAO.list = jest.fn().mockResolvedValue(paginatedResult);

        // Act
        const result = await userDAO.getUsersByClientId(clientId, filter, opts);

        // Assert
        expect(result).toEqual(paginatedResult);
        expect(userDAO.list).toHaveBeenCalledWith(
          {
            isActive: true,
            'cids.cid': clientId,
            'cids.isConnected': true,
            deletedAt: null,
          },
          opts
        );
      });
    });
  });

  describe('searchUsers', () => {
    describe('Successful user search', () => {
      it('should search users by query within client', async () => {
        // Arrange
        const query = 'john';
        const clientId = 'client-123';
        const users = [
          TestDataFactory.createUser({ firstName: 'John' }),
          TestDataFactory.createUser({ lastName: 'Johnson' }),
        ];

        userDAO.aggregate = jest.fn().mockResolvedValue(users);

        // Act
        const result = await userDAO.searchUsers(query, clientId);

        // Assert
        expect(result).toEqual(users);
        expect(userDAO.aggregate).toHaveBeenCalledWith([
          {
            $match: {
              $and: [
                { 'cids.cid': clientId },
                { 'cids.isConnected': true },
                { deletedAt: null },
                {
                  $or: [
                    { firstName: { $regex: query, $options: 'i' } },
                    { lastName: { $regex: query, $options: 'i' } },
                    { email: { $regex: query, $options: 'i' } },
                    { phoneNumber: { $regex: query, $options: 'i' } },
                  ],
                },
              ],
            },
          },
          {
            $project: {
              password: 0,
              activationToken: 0,
              passwordResetToken: 0,
              activationTokenExpiresAt: 0,
              passwordResetTokenExpiresAt: 0,
            },
          },
        ]);
      });

      it('should handle empty search results', async () => {
        // Arrange
        const query = 'nonexistent';
        const clientId = 'client-123';

        userDAO.aggregate = jest.fn().mockResolvedValue([]);

        // Act
        const result = await userDAO.searchUsers(query, clientId);

        // Assert
        expect(result).toEqual([]);
      });
    });
  });

  describe('isEmailUnique', () => {
    describe('Email uniqueness check', () => {
      it('should return true for unique email', async () => {
        // Arrange
        const email = 'unique@example.com';

        userDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.isEmailUnique(email);

        // Assert
        expect(result).toBe(true);
        expect(userDAO.getActiveUserByEmail).toHaveBeenCalledWith(email);
      });

      it('should return false for existing email', async () => {
        // Arrange
        const email = 'existing@example.com';
        const user = TestDataFactory.createUser({ email });

        userDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.isEmailUnique(email);

        // Assert
        expect(result).toBe(false);
        expect(userDAO.getActiveUserByEmail).toHaveBeenCalledWith(email);
      });
    });
  });

  describe('removeClientAssociation', () => {
    describe('Successful client association removal', () => {
      it('should remove client association successfully', async () => {
        // Arrange
        const userId = 'user-123';
        const clientId = 'client-456';
        const user = TestDataFactory.createUser();

        userDAO.update = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.removeClientAssociation(userId, clientId);

        // Assert
        expect(result).toBe(true);
        expect(userDAO.update).toHaveBeenCalledWith(
          { _id: expect.any(Types.ObjectId) },
          { $pull: { cids: { cid: clientId } } }
        );
      });

      it('should return false for failed removal', async () => {
        // Arrange
        const userId = 'user-123';
        const clientId = 'client-456';

        userDAO.update = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.removeClientAssociation(userId, clientId);

        // Assert
        expect(result).toBe(false);
      });
    });
  });

  describe('getUserClientAssociations', () => {
    describe('Successful client associations retrieval', () => {
      it('should get user client associations', async () => {
        // Arrange
        const userId = 'user-123';
        const associations = [
          { cid: 'client-1', isConnected: true, roles: ['admin'] },
          { cid: 'client-2', isConnected: true, roles: ['viewer'] },
        ];
        const user = TestDataFactory.createUser({
          _id: userId,
          cids: associations,
        });

        userDAO.getUserById = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.getUserClientAssociations(userId);

        // Assert
        expect(result).toEqual(associations);
        expect(userDAO.getUserById).toHaveBeenCalledWith(
          userId,
          { projection: { cids: 1 } }
        );
      });

      it('should return empty array for user with no associations', async () => {
        // Arrange
        const userId = 'user-no-associations';
        const user = TestDataFactory.createUser({
          _id: userId,
          cids: undefined,
        });

        userDAO.getUserById = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.getUserClientAssociations(userId);

        // Assert
        expect(result).toEqual([]);
      });

      it('should return empty array for non-existent user', async () => {
        // Arrange
        const userId = 'non-existent-user';

        userDAO.getUserById = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.getUserClientAssociations(userId);

        // Assert
        expect(result).toEqual([]);
      });
    });
  });

  describe('createPasswordResetToken', () => {
    describe('Successful password reset token creation', () => {
      it('should create password reset token for existing user', async () => {
        // Arrange
        const email = 'test@example.com';
        const user = TestDataFactory.createUser({
          email,
          passwordResetToken: 'generated-hash-token',
          passwordResetTokenExpiresAt: new Date('2024-01-01T14:00:00Z'),
        });

        userDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(user);
        userDAO.updateById = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.createPasswordResetToken(email);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.updateById).toHaveBeenCalledWith(
          user._id.toString(),
          {
            $set: {
              passwordResetToken: 'generated-hash-token',
              passwordResetTokenExpiresAt: new Date('2024-01-01T14:00:00Z'),
            },
          }
        );
      });

      it('should return null for non-existent user', async () => {
        // Arrange
        const email = 'nonexistent@example.com';

        userDAO.getActiveUserByEmail = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.createPasswordResetToken(email);

        // Assert
        expect(result).toBeNull();
        expect(userDAO.getActiveUserByEmail).toHaveBeenCalledWith(email);
      });
    });
  });

  describe('resetPassword', () => {
    describe('Successful password reset', () => {
      it('should reset password with valid token', async () => {
        // Arrange
        const token = 'valid-reset-token';
        const newPassword = 'newpassword123';
        const user = TestDataFactory.createUser({
          passwordResetToken: token,
          passwordResetTokenExpiresAt: new Date('2024-12-31'),
        });
        
        user.save = jest.fn().mockResolvedValue(user);
        userDAO.findFirst = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.resetPassword(token, newPassword);

        // Assert
        expect(result).toEqual(user);
        expect(user.password).toBe(newPassword);
        expect(user.passwordResetToken).toBe('');
        expect(user.passwordResetTokenExpiresAt).toBeNull();
        expect(user.save).toHaveBeenCalled();
      });

      it('should return null for invalid or expired token', async () => {
        // Arrange
        const token = 'invalid-token';
        const newPassword = 'newpassword123';

        userDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.resetPassword(token, newPassword);

        // Assert
        expect(result).toBeNull();
        expect(userDAO.findFirst).toHaveBeenCalledWith({
          passwordResetToken: token,
          passwordResetTokenExpiresAt: { $gt: expect.any(Date) },
        });
      });
    });
  });

  describe('getUserWithProfileByEmailOrId', () => {
    describe('Successful user with profile retrieval', () => {
      it('should get user with profile by email', async () => {
        // Arrange
        const email = 'test@example.com';
        const user = TestDataFactory.createUser({ 
          email,
          profile: TestDataFactory.createProfile(),
        });

        userDAO.findFirst = jest.fn().mockResolvedValue(user);

        // Act
        const result = await userDAO.getUserWithProfileByEmailOrId(email);

        // Assert
        expect(result).toEqual(user);
        expect(userDAO.findFirst).toHaveBeenCalledWith(
          { email, deletedAt: null },
          { populate: 'profile' }
        );
      });

      it('should return null for non-existent user', async () => {
        // Arrange
        const email = 'nonexistent@example.com';

        userDAO.findFirst = jest.fn().mockResolvedValue(null);

        // Act
        const result = await userDAO.getUserWithProfileByEmailOrId(email);

        // Assert
        expect(result).toBeNull();
      });
    });
  });

  describe('listUsers', () => {
    describe('Successful users listing', () => {
      it('should list users with query and options', async () => {
        // Arrange
        const query = { isActive: true };
        const opts = { limit: 10, page: 1 };
        const users = [
          TestDataFactory.createUser({ isActive: true }),
          TestDataFactory.createUser({ isActive: true }),
        ];

        const paginatedResult = {
          data: users,
          pagination: { page: 1, limit: 10, total: 2, pages: 1 },
        };

        userDAO.list = jest.fn().mockResolvedValue(paginatedResult);

        // Act
        const result = await userDAO.listUsers(query, opts);

        // Assert
        expect(result).toEqual(paginatedResult);
        expect(userDAO.list).toHaveBeenCalledWith(query, opts);
      });
    });
  });
});