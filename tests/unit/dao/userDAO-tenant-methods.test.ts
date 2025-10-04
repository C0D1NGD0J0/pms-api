import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import User from '@models/user/user.model';
import { ITenantFilterOptions } from '@interfaces/user.interface';

// Mock the setup functions for now since they may not exist
const setupTestDatabase = async () => {};
const cleanupTestDatabase = async () => {};

describe('UserDAO Tenant Methods', () => {
  let userDAO: UserDAO;

  beforeAll(async () => {
    await setupTestDatabase();
    userDAO = new UserDAO({ userModel: User });
  });

  afterAll(async () => {
    await cleanupTestDatabase();
  });

  beforeEach(async () => {
    await User.deleteMany({});
  });

  describe('getTenantsByClient', () => {
    it('should return paginated tenants for a client', async () => {
      // Create a test client ID
      const cuid = 'test-client-123';

      // Create test tenant user
      const tenantUser = await User.create({
        uid: 'tenant-123',
        email: 'tenant@test.com',
        password: 'password123',
        isActive: true,
        cuids: [
          {
            cuid,
            roles: ['tenant'],
            isConnected: true,
          },
        ],
      });

      const result = await userDAO.getTenantsByClient(cuid, {}, { limit: 10, skip: 0 });

      expect(result).toBeDefined();
      expect(result.items).toHaveLength(1);
      expect(result.pagination).toBeDefined();
      expect(result.pagination.total).toBe(1);
      expect(result.items[0].uid).toBe('tenant-123');
    });

    it('should filter tenants by status', async () => {
      const cuid = 'test-client-456';

      // Create active tenant
      await User.create({
        uid: 'active-tenant',
        email: 'active@test.com',
        password: 'password123',
        isActive: true,
        cuids: [
          {
            cuid,
            roles: ['tenant'],
            isConnected: true,
          },
        ],
      });

      // Create inactive tenant
      await User.create({
        uid: 'inactive-tenant',
        email: 'inactive@test.com',
        password: 'password123',
        isActive: false,
        cuids: [
          {
            cuid,
            roles: ['tenant'],
            isConnected: true,
          },
        ],
      });

      const filters: ITenantFilterOptions = { status: 'active' };
      const result = await userDAO.getTenantsByClient(cuid, filters, { limit: 10, skip: 0 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].uid).toBe('active-tenant');
    });

    it('should return empty result for non-existent client', async () => {
      const result = await userDAO.getTenantsByClient(
        'non-existent-client',
        {},
        { limit: 10, skip: 0 }
      );

      expect(result.items).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('getTenantStats', () => {
    it('should return tenant statistics for a client', async () => {
      const cuid = 'test-client-789';

      // Create test tenant users
      await User.create({
        uid: 'tenant-stats-1',
        email: 'stats1@test.com',
        password: 'password123',
        isActive: true,
        cuids: [
          {
            cuid,
            roles: ['tenant'],
            isConnected: true,
          },
        ],
      });

      await User.create({
        uid: 'tenant-stats-2',
        email: 'stats2@test.com',
        password: 'password123',
        isActive: true,
        cuids: [
          {
            cuid,
            roles: ['tenant'],
            isConnected: true,
          },
        ],
      });

      const stats = await userDAO.getTenantStats(cuid, {});

      expect(stats).toBeDefined();
      expect(stats.total).toBe(2);
      expect(stats.activeLeases).toBe(0); // No profiles with lease data
      expect(stats.expiredLeases).toBe(2);
      expect(stats.rentStatus.current).toBe(0);
      expect(stats.averageRent).toBe(0);
      expect(stats.occupancyRate).toBe(0);
      expect(stats.distributionByProperty).toEqual([]);
      expect(stats.backgroundCheckDistribution).toBeDefined();
    });

    it('should return empty stats for non-existent client', async () => {
      const stats = await userDAO.getTenantStats('non-existent-client', {});

      expect(stats.total).toBe(0);
      expect(stats.activeLeases).toBe(0);
      expect(stats.expiredLeases).toBe(0);
      expect(stats.averageRent).toBe(0);
      expect(stats.occupancyRate).toBe(0);
    });

    it('should handle property filtering', async () => {
      const cuid = 'test-client-property';
      const propertyId = new Types.ObjectId().toString();

      await User.create({
        uid: 'tenant-property',
        email: 'property@test.com',
        password: 'password123',
        isActive: true,
        cuids: [
          {
            cuid,
            roles: ['tenant'],
            isConnected: true,
          },
        ],
      });

      const filters: ITenantFilterOptions = { propertyId };
      const stats = await userDAO.getTenantStats(cuid, filters);

      expect(stats).toBeDefined();
      expect(stats.total).toBe(0); // No matching property in profiles
    });
  });
});
