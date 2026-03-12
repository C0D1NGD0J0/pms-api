import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { PaymentModel, Profile, Lease, User } from '@models/index';
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
        isActive: true,
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

  describe('getClientTenantDetails', () => {
    let testCuid: string;
    let testTenantUid: string;
    let testTenantId: Types.ObjectId;
    let testProfileId: Types.ObjectId;

    beforeEach(async () => {
      testCuid = 'TEST_CLIENT_123';
      testTenantUid = 'TENANT_UID_123';
      testTenantId = new Types.ObjectId();
      testProfileId = new Types.ObjectId();

      // Create test tenant user
      await User.create({
        _id: testTenantId,
        uid: testTenantUid,
        email: 'tenant@example.com',
        firstName: 'Test',
        lastName: 'Tenant',
        password: 'hashed',
        isActive: true,
        activecuid: testCuid,
        cuids: [testCuid],
        status: 'active',
        joinedDate: new Date('2024-01-01'),
      });

      // Create test profile
      await Profile.create({
        _id: testProfileId,
        user: testTenantId,
        cuid: testCuid,
        firstName: 'Test',
        lastName: 'Tenant',
        email: 'tenant@example.com',
        phoneNumber: '+1234567890',
        tenantInfo: {
          activeLeases: [],
          leaseHistory: [],
          leaseStatus: 'active',
        },
        tenantMetrics: {
          totalRentPaid: 0,
          onTimePaymentRate: 100,
          averagePaymentDelay: 0,
          totalMaintenanceRequests: 0,
          currentRentStatus: 'current',
        },
      });
    });

    it('should fetch tenant details with payment metrics', async () => {
      // Create test payments
      const payments = [
        {
          cuid: testCuid,
          tenant: testTenantId,
          pytuid: 'PAY_001',
          invoiceNumber: 'INV-001',
          baseAmount: 200000, // $2000 in cents
          processingFee: 1000, // $10 in cents
          status: 'paid',
          paymentMethod: 'card',
          paymentType: 'rent',
          dueDate: new Date('2024-01-01'),
          paidAt: new Date('2024-01-01'), // Paid on time
          description: 'Rent payment',
          period: { month: 1, year: 2024 },
        },
        {
          cuid: testCuid,
          tenant: testTenantId,
          pytuid: 'PAY_002',
          invoiceNumber: 'INV-002',
          baseAmount: 200000,
          processingFee: 1000,
          status: 'paid',
          paymentMethod: 'card',
          paymentType: 'rent',
          dueDate: new Date('2024-02-01'),
          paidAt: new Date('2024-02-05'), // Paid 4 days late
          description: 'Rent payment',
          period: { month: 2, year: 2024 },
        },
        {
          cuid: testCuid,
          tenant: testTenantId,
          pytuid: 'PAY_003',
          invoiceNumber: 'INV-003',
          baseAmount: 200000,
          processingFee: 1000,
          status: 'pending',
          paymentMethod: 'card',
          paymentType: 'rent',
          dueDate: new Date('2024-03-01'),
          description: 'Rent payment',
          period: { month: 3, year: 2024 },
        },
      ];

      await PaymentModel.insertMany(payments);

      const tenant = await userDAO.getClientTenantDetails(
        testCuid,
        testTenantUid,
        []
      );

      expect(tenant).not.toBeNull();
      expect(tenant?.tenantMetrics).toBeDefined();

      // Total paid should be 2 payments x (200000 + 1000) = 402000 cents = $4020
      expect(tenant?.tenantMetrics?.totalRentPaid).toBe(402000);

      // On-time rate should be 50% (1 out of 2 paid payments)
      expect(tenant?.tenantMetrics?.onTimePaymentRate).toBe(50);

      // Average delay should be 2 days ((0 + 4) / 2)
      expect(tenant?.tenantMetrics?.averagePaymentDelay).toBe(2);

      // Payment history should include all 3 payments (limited to 50)
      expect(tenant?.tenantInfo?.paymentHistory).toHaveLength(3);
      expect(tenant?.tenantInfo?.paymentHistory?.[0]?.amount).toBe(201000);
    });

    it('should populate payment history regardless of include parameter', async () => {
      // Create one payment
      await PaymentModel.create({
        cuid: testCuid,
        tenant: testTenantId,
        pytuid: 'PAY_001',
        invoiceNumber: 'INV-001',
        baseAmount: 200000,
        processingFee: 1000,
        status: 'paid',
        paymentMethod: 'card',
        paymentType: 'rent',
        dueDate: new Date('2024-01-01'),
        paidAt: new Date('2024-01-01'),
        description: 'Rent payment',
        period: { month: 1, year: 2024 },
      });

      const tenant = await userDAO.getClientTenantDetails(
        testCuid,
        testTenantUid,
        [] // Not requesting payment history explicitly
      );

      expect(tenant).not.toBeNull();
      expect(tenant?.tenantInfo?.paymentHistory).toBeDefined();
      expect(tenant?.tenantInfo?.paymentHistory).toHaveLength(1);
    });

    it('should handle tenants with no payments', async () => {
      const tenant = await userDAO.getClientTenantDetails(
        testCuid,
        testTenantUid,
        []
      );

      expect(tenant).not.toBeNull();
      expect(tenant?.tenantInfo?.paymentHistory).toEqual([]);
      // Metrics should remain at default values
      expect(tenant?.tenantMetrics?.totalRentPaid).toBe(0);
    });

    it('should fetch lease history when requested', async () => {
      // Create test lease
      const leaseId = new Types.ObjectId();
      await Lease.create({
        _id: leaseId,
        cuid: testCuid,
        luid: 'LEASE_001',
        leaseNumber: 'L2024-001',
        tenantId: testTenantId,
        status: 'active',
        property: {
          id: new Types.ObjectId(),
          address: '123 Test St',
        },
        unit: {
          unitNumber: '101',
        },
        fees: {
          monthlyRent: 200000,
        },
        duration: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2025-01-01'),
        },
      });

      const tenant = await userDAO.getClientTenantDetails(
        testCuid,
        testTenantUid,
        ['lease']
      );

      expect(tenant).not.toBeNull();
      expect(tenant?.tenantInfo?.leaseHistory).toBeDefined();
      expect(tenant?.tenantInfo?.leaseHistory).toHaveLength(1);
      expect(tenant?.tenantInfo?.leaseHistory?.[0]?.luid).toBe('LEASE_001');
      expect(tenant?.tenantInfo?.leaseHistory?.[0]?.leaseNumber).toBe('L2024-001');
      expect(tenant?.tenantInfo?.leaseHistory?.[0]?.monthlyRent).toBe(200000);
    });
  });
});
