/* eslint-disable */
// @ts-nocheck - Disable TypeScript checking for tests to avoid type errors with mocks

/**
 * REFACTORED UserDAO tests using centralized mocks
 * This demonstrates how to eliminate duplication and use shared test utilities
 */

import { UserDAO } from '@dao/userDAO';
import { TestDataFactory } from '@tests/utils/testHelpers';
import { setupDAOTest, DAOTestHelpers } from '@tests/mocks/dao/daoTestSetup';
import { Types } from 'mongoose';

describe('UserDAO - Refactored Unit Tests', () => {
  const daoSetup = setupDAOTest(UserDAO, 'User');
  let userDAO: UserDAO;
  let mockUserModel: any;

  beforeAll(() => {
    const setup = daoSetup.setup();
    userDAO = setup.dao;
    mockUserModel = setup.mockModel;
  });

  beforeEach(() => {
    daoSetup.beforeEachSetup();
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
        await DAOTestHelpers.expectDatabaseError(
          () => userDAO.getUserById(userId),
          'Database connection failed'
        );

        expect(userDAO.throwErrorHandler).toHaveBeenCalledWith(dbError);
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
});