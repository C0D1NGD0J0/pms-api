import { Types } from 'mongoose';
import { UserDAO } from '@dao/userDAO';
import { ROLES } from '@shared/constants/roles.constants';
import { LeaseStatus } from '@interfaces/lease.interface';
import { Payment, Profile, Lease, User } from '@models/index';
import { clearTestDatabase, createTestClient } from '@tests/helpers';
import { PaymentRecordStatus, PaymentRecordType, PaymentMethod } from '@interfaces/payments.interface';

describe('UserDAO Integration Tests', () => {
  let userDAO: UserDAO;

  beforeAll(async () => {
    userDAO = new UserDAO({ userModel: User });
  });
  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('getUserByUId', () => {
    it('should find user by uid', async () => {
      await User.create({
        uid: 'unique-uid-123',
        email: 'test@example.com',
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
        password: 'hashed',
        isActive: true,
        activecuid: testCuid,
        cuids: [{ cuid: testCuid, roles: ['tenant'], isConnected: true }],
      });

      // Create test profile
      await Profile.create({
        _id: testProfileId,
        puid: `puid-user-test-${Date.now()}`,
        user: testTenantId,
        personalInfo: {
          firstName: 'Test',
          lastName: 'Tenant',
          displayName: 'Test Tenant',
          location: 'Toronto',
          phoneNumber: '+1234567890',
        },
        tenantInfo: {
          activeLeases: [],
          leaseHistory: [],
          leaseStatus: 'active',
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
          status: PaymentRecordStatus.PAID,
          paymentMethod: PaymentMethod.ONLINE,
          paymentType: PaymentRecordType.RENT,
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
          status: PaymentRecordStatus.PAID,
          paymentMethod: PaymentMethod.ONLINE,
          paymentType: PaymentRecordType.RENT,
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
          status: PaymentRecordStatus.PENDING,
          paymentMethod: PaymentMethod.ONLINE,
          paymentType: PaymentRecordType.RENT,
          dueDate: new Date('2024-03-01'),
          description: 'Rent payment',
          period: { month: 3, year: 2024 },
        },
      ];

      await Payment.insertMany(payments);

      const tenant = await userDAO.getClientTenantDetails(testCuid, testTenantUid, []);

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
      await Payment.create({
        cuid: testCuid,
        tenant: testTenantId,
        pytuid: 'PAY_001',
        invoiceNumber: 'INV-001',
        baseAmount: 200000,
        processingFee: 1000,
        status: PaymentRecordStatus.PAID,
        paymentMethod: PaymentMethod.ONLINE,
        paymentType: PaymentRecordType.RENT,
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
      const tenant = await userDAO.getClientTenantDetails(testCuid, testTenantUid, []);

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
        createdBy: testTenantId,
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved' as const,
        type: 'fixed_term' as any,
        signingMethod: 'manual' as const,
        templateType: 'residential-apartment' as const,
        signedDate: new Date(),
        signatures: [{ userId: testTenantId, signedAt: new Date(), role: 'tenant' as const, signatureMethod: 'manual' as const }],
        leaseDocuments: [{ documentType: 'lease_agreement' as const, url: 'https://example.com/doc.pdf', uploadedAt: new Date(), uploadedBy: testTenantId, filename: 'lease.pdf', key: 'leases/lease.pdf' }],
        property: {
          id: new Types.ObjectId(),
          address: '123 Test St',
          unitId: new Types.ObjectId().toString(),
        },
        fees: {
          rentAmount: 200000,
          acceptedPaymentMethod: 'e-transfer' as const,
        },
        duration: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2025-01-01'),
        },
      });

      const tenant = await userDAO.getClientTenantDetails(testCuid, testTenantUid, ['lease']);

      expect(tenant).not.toBeNull();
      expect(tenant?.tenantInfo?.leaseHistory).toBeDefined();
      expect(tenant?.tenantInfo?.leaseHistory).toHaveLength(1);
      expect(tenant?.tenantInfo?.leaseHistory?.[0]?.luid).toBe('LEASE_001');
      expect(tenant?.tenantInfo?.leaseHistory?.[0]?.leaseNumber).toBe('L2024-001');
      expect(tenant?.tenantInfo?.leaseHistory?.[0]?.rentAmount).toBe(200000);
    });
  });

  describe('getUsersByFilteredType', () => {
    const cuid = 'CLIENT_SEARCH_001';
    const otherCuid = 'OTHER_CLIENT_999';

    beforeEach(async () => {
      await User.create([
        {
          uid: 'uid-alice-001',
          email: 'alice.smith@example.com',
          password: 'hashed',
          isActive: true,
          activecuid: cuid,
          cuids: [{ cuid, roles: [ROLES.STAFF], isConnected: true, clientDisplayName: 'Test Client' }],
        },
        {
          uid: 'uid-bob-001',
          email: 'bob.jones@example.com',
          password: 'hashed',
          isActive: true,
          activecuid: cuid,
          cuids: [{ cuid, roles: [ROLES.STAFF], isConnected: true, clientDisplayName: 'Test Client' }],
        },
        {
          uid: 'uid-carol-001',
          email: 'carol.adams@example.com',
          password: 'hashed',
          isActive: true,
          activecuid: cuid,
          cuids: [{ cuid, roles: [ROLES.MANAGER], isConnected: true, clientDisplayName: 'Test Client' }],
        },
        {
          uid: 'uid-alice-other',
          email: 'alice.other@example.com',
          password: 'hashed',
          isActive: true,
          activecuid: otherCuid,
          cuids: [{ cuid: otherCuid, roles: [ROLES.STAFF], isConnected: true, clientDisplayName: 'Other Client' }],
        },
      ]);
    });

    it('should filter by partial email match', async () => {
      const result = await userDAO.getUsersByFilteredType(
        cuid,
        { search: 'alice.smith' },
        { limit: 10 }
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].email).toBe('alice.smith@example.com');
    });

    it('should return users matching search by email', async () => {
      const result = await userDAO.getUsersByFilteredType(
        cuid,
        { search: 'bob.jones' },
        { limit: 10 }
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].email).toBe('bob.jones@example.com');
    });

    it('should scope search results to the given cuid', async () => {
      // 'alice' matches both alice.smith@... (cuid) and alice.other@... (otherCuid) via email
      // only the one in `cuid` should be returned
      const result = await userDAO.getUsersByFilteredType(cuid, { search: 'alice' }, { limit: 10 });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].uid).toBe('uid-alice-001');
    });

    it('should return all users when search is omitted', async () => {
      const result = await userDAO.getUsersByFilteredType(cuid, {}, { limit: 10 });

      expect(result.items).toHaveLength(3);
    });

    it('should return no results for a non-matching search term', async () => {
      const result = await userDAO.getUsersByFilteredType(
        cuid,
        { search: 'zzznomatch' },
        { limit: 10 }
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe('createBulkUserWithDefaults', () => {
    it('should set requiresOnboarding to true on the cuid entry', async () => {
      const client = await createTestClient();
      const userData = {
        email: `bulk-${Date.now()}@example.com`,
        firstName: 'Bulk',
        lastName: 'User',
        role: ROLES.STAFF,
        defaultPassword: 'TempPass123!',
      };

      const user = await userDAO.createBulkUserWithDefaults(
        { cuid: client.cuid, clientDisplayName: client.displayName, id: client._id.toString() },
        userData
      );

      expect(user).not.toBeNull();
      const cuidEntry = user.cuids.find((c) => c.cuid === client.cuid);
      expect(cuidEntry).toBeDefined();
      expect(cuidEntry!.requiresOnboarding).toBe(true);
    });

    it('should create an active user with the given role', async () => {
      const client = await createTestClient();
      const email = `bulk-role-${Date.now()}@example.com`;

      const user = await userDAO.createBulkUserWithDefaults(
        { cuid: client.cuid, clientDisplayName: client.displayName, id: client._id.toString() },
        { email, firstName: 'Bulk', lastName: 'User', role: ROLES.TENANT, defaultPassword: 'TempPass123!' }
      );

      expect(user.isActive).toBe(true);
      expect(user.email).toBe(email);
      const cuidEntry = user.cuids.find((c) => c.cuid === client.cuid);
      expect(cuidEntry!.roles).toContain(ROLES.TENANT);
    });
  });

  describe('clearOnboardingFlag', () => {
    it('should set requiresOnboarding to false for the given cuid', async () => {
      const client = await createTestClient();
      const user = await User.create({
        uid: `uid-onboarding-${Date.now()}`,
        email: `onboarding-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client.cuid,
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            requiresOnboarding: true,
            clientDisplayName: client.displayName,
          },
        ],
      });

      await userDAO.clearOnboardingFlag(user._id.toString(), client.cuid);

      const updated = await User.findById(user._id);
      const cuidEntry = updated!.cuids.find((c) => c.cuid === client.cuid);
      expect(cuidEntry!.requiresOnboarding).toBe(false);
    });

    it('should not affect other cuid entries', async () => {
      const client1 = await createTestClient();
      const client2 = await createTestClient();
      const user = await User.create({
        uid: `uid-multi-onboard-${Date.now()}`,
        email: `multi-onboard-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client1.cuid,
        cuids: [
          {
            cuid: client1.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            requiresOnboarding: true,
            clientDisplayName: client1.displayName,
          },
          {
            cuid: client2.cuid,
            roles: [ROLES.STAFF],
            isConnected: true,
            requiresOnboarding: true,
            clientDisplayName: client2.displayName,
          },
        ],
      });

      await userDAO.clearOnboardingFlag(user._id.toString(), client1.cuid);

      const updated = await User.findById(user._id);
      const entry1 = updated!.cuids.find((c) => c.cuid === client1.cuid);
      const entry2 = updated!.cuids.find((c) => c.cuid === client2.cuid);
      expect(entry1!.requiresOnboarding).toBe(false);
      expect(entry2!.requiresOnboarding).toBe(true); // untouched
    });
  });

  describe('addUserToClient — dual-role / primaryRole', () => {
    it('sets primaryRole to the role when adding a brand-new cuid connection', async () => {
      const client = await createTestClient();
      const user = await User.create({
        uid: `uid-addclient-new-${Date.now()}`,
        email: `addclient-new-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client.cuid,
        cuids: [],
      });

      await userDAO.addUserToClient(user._id.toString(), ROLES.TENANT, {
        cuid: client.cuid,
        clientDisplayName: client.displayName,
        id: client._id.toString(),
      });

      const updated = await User.findById(user._id);
      const entry = updated!.cuids.find((c) => c.cuid === client.cuid);
      expect(entry).toBeDefined();
      expect(entry!.roles).toContain(ROLES.TENANT);
      expect(entry!.primaryRole).toBe(ROLES.TENANT);
    });

    it('keeps primaryRole as the higher-privilege role when a lower role is added second', async () => {
      const client = await createTestClient();
      const user = await User.create({
        uid: `uid-dual-low-${Date.now()}`,
        email: `dual-low-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client.cuid,
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.STAFF],
            primaryRole: ROLES.STAFF,
            isConnected: true,
            clientDisplayName: client.displayName,
          },
        ],
      });

      await userDAO.addUserToClient(user._id.toString(), ROLES.TENANT, {
        cuid: client.cuid,
        clientDisplayName: client.displayName,
        id: client._id.toString(),
      });

      const updated = await User.findById(user._id);
      const entry = updated!.cuids.find((c) => c.cuid === client.cuid);
      expect(entry!.roles).toContain(ROLES.STAFF);
      expect(entry!.roles).toContain(ROLES.TENANT);
      // staff (index 3) > tenant (index 4) → staff wins
      expect(entry!.primaryRole).toBe(ROLES.STAFF);
    });

    it('upgrades primaryRole when a higher-privilege role is added second', async () => {
      const client = await createTestClient();
      // User was added as tenant first
      const user = await User.create({
        uid: `uid-dual-high-${Date.now()}`,
        email: `dual-high-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client.cuid,
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.TENANT],
            primaryRole: ROLES.TENANT,
            isConnected: true,
            clientDisplayName: client.displayName,
          },
        ],
      });

      await userDAO.addUserToClient(user._id.toString(), ROLES.STAFF, {
        cuid: client.cuid,
        clientDisplayName: client.displayName,
        id: client._id.toString(),
      });

      const updated = await User.findById(user._id);
      const entry = updated!.cuids.find((c) => c.cuid === client.cuid);
      expect(entry!.roles).toContain(ROLES.TENANT);
      expect(entry!.roles).toContain(ROLES.STAFF);
      // staff has higher privilege than tenant → staff wins
      expect(entry!.primaryRole).toBe(ROLES.STAFF);
    });

    it('does not duplicate roles when the same role is added twice', async () => {
      const client = await createTestClient();
      const user = await User.create({
        uid: `uid-dedup-${Date.now()}`,
        email: `dedup-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client.cuid,
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.STAFF],
            primaryRole: ROLES.STAFF,
            isConnected: true,
            clientDisplayName: client.displayName,
          },
        ],
      });

      await userDAO.addUserToClient(user._id.toString(), ROLES.STAFF, {
        cuid: client.cuid,
        clientDisplayName: client.displayName,
        id: client._id.toString(),
      });

      const updated = await User.findById(user._id);
      const entry = updated!.cuids.find((c) => c.cuid === client.cuid);
      const staffCount = entry!.roles.filter((r) => r === ROLES.STAFF).length;
      expect(staffCount).toBe(1);
      expect(entry!.primaryRole).toBe(ROLES.STAFF);
    });
  });

  describe('getTenantsByClient', () => {
    const cuid = 'CLIENT_TENANT_SEARCH_001';

    beforeEach(async () => {
      await User.create([
        {
          uid: 'uid-tenant-alice',
          email: 'alice.tenant@example.com',
          password: 'hashed',
          isActive: true,
          activecuid: cuid,
          cuids: [{ cuid, roles: [ROLES.TENANT], isConnected: true, clientDisplayName: 'Test Client' }],
        },
        {
          uid: 'uid-tenant-bob',
          email: 'bob.tenant@example.com',
          password: 'hashed',
          isActive: true,
          activecuid: cuid,
          cuids: [{ cuid, roles: [ROLES.TENANT], isConnected: true, clientDisplayName: 'Test Client' }],
        },
        {
          uid: 'uid-staff-dave',
          email: 'dave.staff@example.com',
          password: 'hashed',
          isActive: true,
          activecuid: cuid,
          cuids: [{ cuid, roles: [ROLES.STAFF], isConnected: true, clientDisplayName: 'Test Client' }],
        },
      ]);
    });

    it('should filter tenants by partial email match', async () => {
      const result = await userDAO.getTenantsByClient(
        cuid,
        { search: 'alice.tenant' },
        { limit: 10 }
      );

      expect(result.items).toHaveLength(1);
      expect(result.items[0].email).toBe('alice.tenant@example.com');
    });

    it('should return multiple tenants matching the same search term', async () => {
      // 'tenant' appears in both alice.tenant@ and bob.tenant@ emails
      const result = await userDAO.getTenantsByClient(cuid, { search: 'tenant' }, { limit: 10 });

      expect(result.items).toHaveLength(2);
    });

    it('should not return non-tenant users when searching', async () => {
      // Dave is staff, not a tenant — should never appear in tenant search
      const result = await userDAO.getTenantsByClient(cuid, { search: 'Dave' }, { limit: 10 });

      expect(result.items).toHaveLength(0);
    });

    it('should return all tenants when search is omitted', async () => {
      const result = await userDAO.getTenantsByClient(cuid, {}, { limit: 10 });

      expect(result.items).toHaveLength(2);
    });

    it('should return no results for a non-matching search term', async () => {
      const result = await userDAO.getTenantsByClient(
        cuid,
        { search: 'zzznomatch' },
        { limit: 10 }
      );

      expect(result.items).toHaveLength(0);
    });
  });

  describe('createUserFromInvitation', () => {
    it('should set requiresOnboarding to true on the cuid entry for a tenant invite', async () => {
      const client = await createTestClient();
      const invitation = {
        role: ROLES.TENANT,
        inviteeEmail: `invite-tenant-${Date.now()}@example.com`,
      } as any;
      const userData = { password: '$2b$10$hashedPasswordForTesting' };

      const user = await userDAO.createUserFromInvitation(
        { cuid: client.cuid, displayName: client.displayName },
        invitation,
        userData
      );

      const cuidEntry = user.cuids.find((c) => c.cuid === client.cuid);
      expect(cuidEntry).toBeDefined();
      expect(cuidEntry!.requiresOnboarding).toBe(true);
    });

    it('should set requiresOnboarding to true for all invited roles', async () => {
      const client = await createTestClient();

      for (const role of [ROLES.STAFF, ROLES.MANAGER, ROLES.VENDOR]) {
        const invitation = {
          role,
          inviteeEmail: `invite-${role}-${Date.now()}@example.com`,
        } as any;
        const user = await userDAO.createUserFromInvitation(
          { cuid: client.cuid, displayName: client.displayName },
          invitation,
          { password: '$2b$10$hashedPasswordForTesting' }
        );
        const entry = user.cuids.find((c) => c.cuid === client.cuid);
        expect(entry!.requiresOnboarding).toBe(true);
      }
    });
  });

  describe('addUserToClient — requiresOnboarding on new connection', () => {
    it('sets requiresOnboarding to true when adding a brand-new cuid connection', async () => {
      const client = await createTestClient();
      const user = await User.create({
        uid: `uid-onboard-new-${Date.now()}`,
        email: `onboard-new-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client.cuid,
        cuids: [],
      });

      await userDAO.addUserToClient(user._id.toString(), ROLES.TENANT, {
        cuid: client.cuid,
        clientDisplayName: client.displayName,
        id: client._id.toString(),
      });

      const updated = await User.findById(user._id);
      const entry = updated!.cuids.find((c) => c.cuid === client.cuid);
      expect(entry).toBeDefined();
      expect(entry!.requiresOnboarding).toBe(true);
    });

    it('does not overwrite requiresOnboarding when updating an existing connection', async () => {
      // Existing connection — user has already been onboarded (requiresOnboarding: false)
      const client = await createTestClient();
      const user = await User.create({
        uid: `uid-onboard-exist-${Date.now()}`,
        email: `onboard-exist-${Date.now()}@example.com`,
        password: '$2b$10$hashedPasswordForTesting',
        isActive: true,
        activecuid: client.cuid,
        cuids: [
          {
            cuid: client.cuid,
            roles: [ROLES.TENANT],
            primaryRole: ROLES.TENANT,
            isConnected: true,
            clientDisplayName: client.displayName,
            requiresOnboarding: false,
          },
        ],
      });

      // Adding the same role again — hits the "existing connection" branch
      await userDAO.addUserToClient(user._id.toString(), ROLES.TENANT, {
        cuid: client.cuid,
        clientDisplayName: client.displayName,
        id: client._id.toString(),
      });

      const updated = await User.findById(user._id);
      const entry = updated!.cuids.find((c) => c.cuid === client.cuid);
      // requiresOnboarding must NOT be reset to true for an existing connection
      expect(entry!.requiresOnboarding).toBe(false);
    });
  });
});
