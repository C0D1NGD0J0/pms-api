import { User } from '@models/index';
import { UserDAO } from '@dao/userDAO';
import {
  disconnectTestDatabase,
  clearTestDatabase,
  setupTestDatabase,
} from '@tests/helpers';

describe('UserDAO Integration Tests', () => {
  let userDAO: UserDAO;

  beforeAll(async () => {
    await setupTestDatabase();
    userDAO = new UserDAO({ userModel: User });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('getUserByUId', () => {
    it('should find user by uid', async () => {
      await User.create({
        uid: 'unique-uid-123',
        email: 'test@example.com',
        firstName: 'John',
        lastName: 'Doe',
        password: 'hashed',
        activecuid: 'TEST_CLIENT',
        cuids: [],
      });

      const user = await userDAO.getUserByUId('unique-uid-123');

      expect(user).not.toBeNull();
      expect(user?.email).toBe('test@example.com');
    });

    it('should return null for non-existent uid', async () => {
      const user = await userDAO.getUserByUId('non-existent');

      expect(user).toBeNull();
    });
  });

  describe('getActiveUserByEmail', () => {
    it('should find active user by email', async () => {
      await User.create({
        uid: 'uid-active',
        email: 'active@example.com',
        firstName: 'Active',
        lastName: 'User',
        password: 'hashed',
        isActive: true,
        activecuid: 'TEST_CLIENT',
        cuids: [],
      });

      const user = await userDAO.getActiveUserByEmail('active@example.com');

      expect(user).not.toBeNull();
      expect(user?.isActive).toBe(true);
    });

    it('should not return inactive users', async () => {
      await User.create({
        uid: 'uid-inactive',
        email: 'inactive@example.com',
        firstName: 'Inactive',
        lastName: 'User',
        password: 'hashed',
        isActive: false,
        activecuid: 'TEST_CLIENT',
        cuids: [],
      });

      const user = await userDAO.getActiveUserByEmail('inactive@example.com');

      expect(user).toBeNull();
    });
  });

  describe('isEmailUnique', () => {
    it('should return false for existing email', async () => {
      await User.create({
        uid: 'uid-unique-test',
        email: 'unique@example.com',
        firstName: 'Unique',
        lastName: 'Test',
        password: 'hashed',
        activecuid: 'CLIENT_1',
        cuids: [],
      });

      const isUnique = await userDAO.isEmailUnique('unique@example.com');

      expect(isUnique).toBe(false);
    });

    it('should return true for new email', async () => {
      const isUnique = await userDAO.isEmailUnique('newemail@example.com');

      expect(isUnique).toBe(true);
    });
  });
});
