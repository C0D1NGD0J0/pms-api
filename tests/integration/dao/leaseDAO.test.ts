import { Types } from 'mongoose';
import { LeaseDAO } from '@dao/leaseDAO';
import { clearTestDatabase } from '@tests/helpers';
import { SigningMethod, LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { PropertyUnit, Property, Profile, Client, Lease, User } from '@models/index';

describe('LeaseDAO Integration Tests', () => {
  let leaseDAO: LeaseDAO;
  let testClientId: Types.ObjectId;
  let testTenantId: Types.ObjectId;
  let testCreatorId: Types.ObjectId;
  let testPropertyId: Types.ObjectId;
  let testUnitId: Types.ObjectId;
  const testCuid = 'TEST_CLIENT';

  beforeAll(async () => {
    leaseDAO = new LeaseDAO({ leaseModel: Lease });
  });
  beforeEach(async () => {
    await clearTestDatabase();

    // Create test client
    testClientId = new Types.ObjectId();
    await Client.create({
      _id: testClientId,
      cuid: testCuid,
      displayName: 'Test Company',
      status: 'active',
      accountAdmin: new Types.ObjectId(),
      accountType: { category: 'individual' },
    });

    // Create test users
    testTenantId = new Types.ObjectId();
    testCreatorId = new Types.ObjectId();

    await User.create({
      _id: testTenantId,
      uid: 'tenant-uid',
      email: 'tenant@example.com',
      firstName: 'John',
      lastName: 'Doe',
      password: 'hashed',
      activecuid: testCuid,
      cuids: [{ cuid: testCuid, clientDisplayName: 'Test Client', roles: ['tenant'], isConnected: true }],
    });

    await User.create({
      _id: testCreatorId,
      uid: 'creator-uid',
      email: 'creator@example.com',
      firstName: 'Jane',
      lastName: 'Smith',
      password: 'hashed',
      activecuid: testCuid,
      cuids: [{ cuid: testCuid, clientDisplayName: 'Test Client', roles: ['property_manager'], isConnected: true }],
    });

    // Create test property
    testPropertyId = new Types.ObjectId();
    await Property.create({
      _id: testPropertyId,
      cuid: testCuid,
      name: 'Test Property',
      address: {
        street: '123 Main St',
        city: 'Toronto',
        province: 'ON',
        postalCode: 'M1A 1A1',
        country: 'Canada',
        fullAddress: '123 Main St, Toronto, ON M1A 1A1',
      },
      propertyType: 'apartment',
      owner: testClientId,
      createdBy: testCreatorId,
      managedBy: testCreatorId,
      description: {
        text: 'Test property description',
      },
      computedLocation: {
        type: 'Point',
        coordinates: [-79.3832, 43.6532], // Toronto coordinates
      },
    });

    // Create test unit
    testUnitId = new Types.ObjectId();
    await PropertyUnit.create({
      _id: testUnitId,
      cuid: testCuid,
      propertyId: testPropertyId,
      unitNumber: '101',
      floor: 1,
      unitType: 'residential',
      status: 'available',
      fees: {
        rentAmount: 2000,
        currency: 'CAD',
        securityDeposit: 2000,
      },
      specifications: {
        totalArea: 850,
        bedrooms: 2,
        bathrooms: 1,
      },
      utilities: {
        water: true,
        heating: true,
        gas: false,
        trash: false,
        centralAC: false,
      },
      amenities: {
        parking: false,
        cableTV: false,
        storage: false,
        internet: false,
        dishwasher: false,
        washerDryer: false,
      },
      isActive: true,
      createdBy: testCreatorId,
      managedBy: testCreatorId,
    });
  });

  describe('createLease', () => {
    it('should create a lease with required fields', async () => {
      const leaseData = {
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment' as const,
        leaseNumber: 'L2024-001',
        tenantInfo: { id: testTenantId.toString() },
        property: {
          id: testPropertyId,
          unitId: testUnitId.toString(),
          address: '123 Main St, Toronto, ON M1A 1A1',
        },
        duration: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
        fees: {
          monthlyRent: 2000,
          securityDeposit: 2000,
          rentDueDay: 1,
          currency: 'CAD',
          acceptedPaymentMethod: 'e-transfer' as const,
        },
        signingMethod: SigningMethod.PENDING,
      };

      const lease = await leaseDAO.createLease(testCuid, leaseData);

      expect(lease).toBeDefined();
      expect(lease.cuid).toBe(testCuid);
      expect(lease.luid).toBeDefined();
      expect(lease.leaseNumber).toBeDefined();
      expect(lease.status).toBe(LeaseStatus.DRAFT);
      expect(lease.fees.monthlyRent).toBe(2000);
    });

    it('should create lease with auto-generated lease number', async () => {
      const leaseData = {
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment' as const,
        leaseNumber: 'L2024-002',
        tenantInfo: { id: testTenantId.toString() },
        property: {
          id: testPropertyId,
          unitId: testUnitId.toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 1500,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'credit_card' as const,
        },
        signingMethod: SigningMethod.PENDING,
      };

      const lease = await leaseDAO.createLease(testCuid, leaseData);

      expect(lease.leaseNumber).toMatch(/^L\d{4}-/);
    });
  });

  describe('getLeaseById', () => {
    it('should retrieve lease by ID', async () => {
      const created = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: {
          id: testPropertyId,
          unitId: testUnitId.toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
        fees: {
          monthlyRent: 2000,
          securityDeposit: 2000,
          rentDueDay: 1,
          currency: 'CAD',
          acceptedPaymentMethod: 'e-transfer',
        },
        signingMethod: 'pending',
        createdBy: testCreatorId,
      });

      const lease = await leaseDAO.getLeaseById(testCuid, created._id.toString());

      expect(lease).not.toBeNull();
      expect(lease?._id.toString()).toBe(created._id.toString());
    });

    it('should return null for non-existent lease', async () => {
      const lease = await leaseDAO.getLeaseById(testCuid, new Types.ObjectId().toString());

      expect(lease).toBeNull();
    });

    it('should not return deleted lease', async () => {
      const created = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: {
          id: testPropertyId,
          unitId: testUnitId.toString(),
          address: '123 Main St',
        },
        duration: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2024-12-31'),
        },
        fees: {
          monthlyRent: 2000,
          securityDeposit: 2000,
          rentDueDay: 1,
          currency: 'CAD',
          acceptedPaymentMethod: 'e-transfer',
        },
        signingMethod: 'pending',
        createdBy: testCreatorId,
        deletedAt: new Date(),
      });

      const lease = await leaseDAO.getLeaseById(testCuid, created._id.toString());

      expect(lease).toBeNull();
    });
  });

  describe('getFilteredLeases', () => {
    beforeEach(async () => {
      await Profile.create({
        user: testTenantId,
        cuid: testCuid,
        puid: 'test-puid-tenant',
        personalInfo: {
          displayName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          location: 'Toronto',
        },
      });

      await Lease.insertMany([
        {
          cuid: testCuid,
          leaseNumber: 'L2024-001-TEST',
          type: LeaseType.FIXED_TERM,
          templateType: 'residential-apartment',
          tenantId: testTenantId,
          property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
          duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
          fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
          signingMethod: 'manual',
          signedDate: new Date(),
          createdBy: testCreatorId,
          leaseDocuments: [{
            url: 'https://example.com/lease.pdf',
            key: 'lease-key',
            filename: 'lease.pdf',
            uploadedBy: testCreatorId,
            status: 'active',
          }],
          signatures: [{
            userId: testTenantId,
            role: 'tenant',
            signedAt: new Date(),
            signatureMethod: 'manual',
          }],
        },
        {
          cuid: testCuid,
          leaseNumber: 'L2024-002-TEST',
          type: LeaseType.FIXED_TERM,
          templateType: 'residential-apartment',
          tenantId: testTenantId,
          property: { id: testPropertyId, address: '456 Oak Ave' },
          duration: { startDate: new Date('2024-02-01'), endDate: new Date('2025-01-31') },
          fees: { monthlyRent: 1500, securityDeposit: 1500, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
          status: LeaseStatus.DRAFT,
          signingMethod: 'pending',
          createdBy: testCreatorId,
        },
      ]);
    });

    it('should return paginated leases', async () => {
      const result = await leaseDAO.getFilteredLeases(testCuid, {}, { page: 1, limit: 10 });

      expect(result.items.length).toBe(2);
      expect(result.pagination!.total).toBe(2);
    });

    it('should filter by status', async () => {
      const result = await leaseDAO.getFilteredLeases(
        testCuid,
        { status: LeaseStatus.ACTIVE },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].status).toBe(LeaseStatus.ACTIVE);
    });

    it('should filter by property ID', async () => {
      const result = await leaseDAO.getFilteredLeases(
        testCuid,
        { propertyId: testPropertyId.toString() },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(2);
    });

    it('should filter by date range', async () => {
      const result = await leaseDAO.getFilteredLeases(
        testCuid,
        {
          startDateFrom: new Date('2024-01-15'),
          startDateTo: new Date('2024-02-15'),
        },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
    });

    it('should filter by rent range', async () => {
      const result = await leaseDAO.getFilteredLeases(
        testCuid,
        { minRent: 1800, maxRent: 2500 },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBe(1);
      expect(result.items[0].monthlyRent).toBe(2000);
    });

    it('should search by lease number', async () => {
      const lease = await Lease.findOne({ cuid: testCuid });
      const result = await leaseDAO.getFilteredLeases(
        testCuid,
        { search: lease!.leaseNumber },
        { page: 1, limit: 10 }
      );

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });

    it('should sort results', async () => {
      const result = await leaseDAO.getFilteredLeases(
        testCuid,
        {},
        { page: 1, limit: 10, sortBy: 'fees.monthlyRent', sort: 'asc' }
      );

      expect(result.items[0].monthlyRent).toBe(1500);
    });
  });

  describe('updateLease', () => {
    it('should update lease fields', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        signingMethod: 'pending',
        createdBy: testCreatorId,
      });

      const updated = await leaseDAO.updateLease(testCuid, lease._id.toString(), {
        fees: {
          monthlyRent: 2200,
          securityDeposit: lease.fees.securityDeposit,
          rentDueDay: lease.fees.rentDueDay,
          currency: lease.fees.currency,
          acceptedPaymentMethod: lease.fees.acceptedPaymentMethod,
        },
      });

      expect(updated).not.toBeNull();
      expect(updated?.fees.monthlyRent).toBe(2200);
    });

    it('should return null for non-existent lease', async () => {
      const updated = await leaseDAO.updateLease(testCuid, new Types.ObjectId().toString(), {
        fees: {
          monthlyRent: 2000,
          securityDeposit: 2000,
          rentDueDay: 1,
          currency: 'CAD',
          acceptedPaymentMethod: 'e-transfer' as const,
        },
      });

      expect(updated).toBeNull();
    });
  });

  describe('deleteLease', () => {
    it('should soft delete a lease', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        signingMethod: 'pending',
        createdBy: testCreatorId,
      });

      const result = await leaseDAO.deleteLease(testCuid, lease._id.toString());

      expect(result).toBe(true);

      const deleted = await Lease.findById(lease._id);
      expect(deleted?.deletedAt).toBeDefined();
    });

    it('should return false for non-existent lease', async () => {
      const result = await leaseDAO.deleteLease(testCuid, new Types.ObjectId().toString());

      expect(result).toBe(false);
    });
  });

  describe('checkOverlappingLeases', () => {
    it('should detect overlapping unit-level leases', async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const overlaps = await leaseDAO.checkOverlappingLeases(
        testCuid,
        testPropertyId.toString(),
        testUnitId.toString(),
        new Date('2024-06-01'),
        new Date('2025-05-31')
      );

      expect(overlaps.length).toBe(1);
    });

    it('should detect property-level lease blocking unit lease', async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 5000, securityDeposit: 5000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const overlaps = await leaseDAO.checkOverlappingLeases(
        testCuid,
        testPropertyId.toString(),
        testUnitId.toString(),
        new Date('2024-06-01'),
        new Date('2025-05-31')
      );

      expect(overlaps.length).toBe(1);
    });

    it('should not detect non-overlapping leases', async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-06-30') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const overlaps = await leaseDAO.checkOverlappingLeases(
        testCuid,
        testPropertyId.toString(),
        testUnitId.toString(),
        new Date('2024-07-01'),
        new Date('2025-06-30')
      );

      expect(overlaps.length).toBe(0);
    });

    it('should exclude specified lease from overlap check', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const overlaps = await leaseDAO.checkOverlappingLeases(
        testCuid,
        testPropertyId.toString(),
        testUnitId.toString(),
        new Date('2024-06-01'),
        new Date('2025-05-31'),
        lease._id.toString()
      );

      expect(overlaps.length).toBe(0);
    });
  });

  describe('findPropertyLevelLease', () => {
    it('should find property-level lease', async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 5000, securityDeposit: 5000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const lease = await leaseDAO.findPropertyLevelLease(
        testCuid,
        testPropertyId.toString(),
        new Date('2024-06-01'),
        new Date('2025-05-31')
      );

      expect(lease).not.toBeNull();
    });

    it('should return null when no property-level lease exists', async () => {
      const lease = await leaseDAO.findPropertyLevelLease(
        testCuid,
        testPropertyId.toString(),
        new Date('2024-06-01'),
        new Date('2025-05-31')
      );

      expect(lease).toBeNull();
    });
  });

  describe('findActiveUnitLeases', () => {
    it('should find active unit-level leases', async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const leases = await leaseDAO.findActiveUnitLeases(
        testCuid,
        testPropertyId.toString(),
        new Date('2024-06-01'),
        new Date('2025-05-31')
      );

      expect(leases.length).toBe(1);
    });

    it('should return empty array when no unit leases exist', async () => {
      const leases = await leaseDAO.findActiveUnitLeases(
        testCuid,
        testPropertyId.toString(),
        new Date('2024-06-01'),
        new Date('2025-05-31')
      );

      expect(leases.length).toBe(0);
    });
  });

  describe('getActiveLeaseByTenant', () => {
    it('should find active lease for tenant', async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const lease = await leaseDAO.getActiveLeaseByTenant(testCuid, testTenantId.toString());

      expect(lease).not.toBeNull();
      expect(lease?.status).toBe(LeaseStatus.ACTIVE);
    });

    it('should return null when no active lease exists for tenant', async () => {
      const lease = await leaseDAO.getActiveLeaseByTenant(testCuid, testTenantId.toString());

      expect(lease).toBeNull();
    });
  });

  describe('getActiveLeaseByUnit', () => {
    it('should find active lease for unit', async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const lease = await leaseDAO.getActiveLeaseByUnit(testCuid, testUnitId.toString());

      expect(lease).not.toBeNull();
      expect(lease?.property.unitId?.toString()).toBe(testUnitId.toString());
    });

    it('should return null when no active lease exists for unit', async () => {
      const lease = await leaseDAO.getActiveLeaseByUnit(testCuid, testUnitId.toString());

      expect(lease).toBeNull();
    });
  });

  describe('getExpiringLeases', () => {
    it('should find leases expiring within specified days', async () => {
      const today = new Date();
      const futureDate = new Date();
      futureDate.setDate(today.getDate() + 30);

      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: futureDate },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const leases = await leaseDAO.getExpiringLeases(testCuid, 60);

      expect(leases.length).toBe(1);
    });

    it('should not return leases expiring beyond specified days', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 100);

      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: futureDate },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const leases = await leaseDAO.getExpiringLeases(testCuid, 60);

      expect(leases.length).toBe(0);
    });

    it('should return leases sorted by end date', async () => {
      const date1 = new Date();
      date1.setDate(date1.getDate() + 10);
      const date2 = new Date();
      date2.setDate(date2.getDate() + 20);

      const tenant2 = new Types.ObjectId();
      await User.create({
        _id: tenant2,
        uid: 'tenant2-uid',
        email: 'tenant2@example.com',
        firstName: 'Jane',
        lastName: 'Doe',
        password: 'hashed',
        activecuid: testCuid,
        cuids: [{ cuid: testCuid, clientDisplayName: 'Test Client', roles: ['tenant'], isConnected: true }],
      });

      await Lease.insertMany([
        {
          cuid: testCuid,
          leaseNumber: 'L2024-003-TEST',
          type: LeaseType.FIXED_TERM,
          templateType: 'residential-apartment',
          tenantId: tenant2,
          property: { id: testPropertyId, address: '456 Oak Ave' },
          duration: { startDate: new Date('2024-01-01'), endDate: date2 },
          fees: { monthlyRent: 1500, securityDeposit: 1500, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
          signingMethod: 'manual',
          signedDate: new Date(),
          createdBy: testCreatorId,
          leaseDocuments: [{
            url: 'https://example.com/lease.pdf',
            key: 'lease-key',
            filename: 'lease.pdf',
            uploadedBy: testCreatorId,
            status: 'active',
          }],
          signatures: [{
            userId: tenant2,
            role: 'tenant',
            signedAt: new Date(),
            signatureMethod: 'manual',
          }],
        },
        {
          cuid: testCuid,
          leaseNumber: 'L2024-004-TEST',
          type: LeaseType.FIXED_TERM,
          templateType: 'residential-apartment',
          tenantId: testTenantId,
          property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
          duration: { startDate: new Date('2024-01-01'), endDate: date1 },
          fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
          signingMethod: 'manual',
          signedDate: new Date(),
          createdBy: testCreatorId,
          leaseDocuments: [{
            url: 'https://example.com/lease.pdf',
            key: 'lease-key',
            filename: 'lease.pdf',
            uploadedBy: testCreatorId,
            status: 'active',
          }],
          signatures: [{
            userId: testTenantId,
            role: 'tenant',
            signedAt: new Date(),
            signatureMethod: 'manual',
          }],
        },
      ]);

      const leases = await leaseDAO.getExpiringLeases(testCuid, 60);

      expect(leases.length).toBe(2);
      expect(leases[0].duration.endDate.getTime()).toBeLessThan(
        leases[1].duration.endDate.getTime()
      );
    });
  });

  describe('updateLeaseStatus', () => {
    it('should update lease status', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.DRAFT,
        signingMethod: 'pending',
        createdBy: testCreatorId,
      });

      const result = await leaseDAO.updateLeaseStatus(
        testCuid,
        lease._id.toString(),
        LeaseStatus.EXPIRED
      );

      expect(result).toBe(true);

      const updated = await Lease.findById(lease._id);
      expect(updated?.status).toBe(LeaseStatus.EXPIRED);
    });

    it('should return false for non-existent lease', async () => {
      const result = await leaseDAO.updateLeaseStatus(
        testCuid,
        new Types.ObjectId().toString(),
        LeaseStatus.ACTIVE
      );

      expect(result).toBe(false);
    });
  });

  describe('terminateLease', () => {
    it('should terminate lease with all details', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });

      const terminationData = {
        terminationDate: new Date('2024-06-30'),
        terminationReason: 'Tenant requested early termination',
        moveOutDate: new Date('2024-06-30'),
      };

      const terminated = await leaseDAO.terminateLease(
        testCuid,
        lease._id.toString(),
        terminationData,
        { userId: testCreatorId.toString(), name: 'Jane Smith' }
      );

      expect(terminated).not.toBeNull();
      expect(terminated?.status).toBe(LeaseStatus.TERMINATED);
      expect(terminated?.duration.terminationDate).toBeDefined();
      expect(terminated?.terminationReason).toBe('Tenant requested early termination');
    });

    it('should return null for non-existent lease', async () => {
      const terminated = await leaseDAO.terminateLease(
        testCuid,
        new Types.ObjectId().toString(),
        {
          terminationDate: new Date(),
          terminationReason: 'Test',
        },
        { userId: testCreatorId.toString(), name: 'Test User' }
      );

      expect(terminated).toBeNull();
    });
  });

  describe('getLeaseStats', () => {
    beforeEach(async () => {
      const today = new Date();
      const date30 = new Date();
      date30.setDate(today.getDate() + 25);
      const date60 = new Date();
      date60.setDate(today.getDate() + 50);

      await Lease.insertMany([
        {
          cuid: testCuid,
          leaseNumber: 'L2024-005-TEST',
          type: LeaseType.FIXED_TERM,
          templateType: 'residential-apartment',
          tenantId: testTenantId,
          property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
          duration: { startDate: new Date('2024-01-01'), endDate: date30 },
          fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
          signingMethod: 'manual',
          signedDate: new Date(),
          createdBy: testCreatorId,
          leaseDocuments: [{
            url: 'https://example.com/lease.pdf',
            key: 'lease-key',
            filename: 'lease.pdf',
            uploadedBy: testCreatorId,
            status: 'active',
          }],
          signatures: [{
            userId: testTenantId,
            role: 'tenant',
            signedAt: new Date(),
            signatureMethod: 'manual',
          }],
        },
        {
          cuid: testCuid,
          leaseNumber: 'L2024-006-TEST',
          type: LeaseType.FIXED_TERM,
          templateType: 'residential-apartment',
          tenantId: testTenantId,
          property: { id: testPropertyId, address: '456 Oak Ave' },
          duration: { startDate: new Date('2024-01-01'), endDate: date60 },
          fees: { monthlyRent: 1500, securityDeposit: 1500, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
          status: LeaseStatus.ACTIVE,
          approvalStatus: 'approved',
          signingMethod: 'manual',
          signedDate: new Date(),
          createdBy: testCreatorId,
          leaseDocuments: [{
            url: 'https://example.com/lease.pdf',
            key: 'lease-key',
            filename: 'lease.pdf',
            uploadedBy: testCreatorId,
            status: 'active',
          }],
          signatures: [{
            userId: testTenantId,
            role: 'tenant',
            signedAt: new Date(),
            signatureMethod: 'manual',
          }],
        },
        {
          cuid: testCuid,
          leaseNumber: 'L2024-007-TEST',
          type: LeaseType.FIXED_TERM,
          templateType: 'residential-apartment',
          tenantId: testTenantId,
          property: { id: testPropertyId, address: '789 Pine Rd' },
          duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
          fees: { monthlyRent: 1800, securityDeposit: 1800, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
          status: LeaseStatus.DRAFT,
          signingMethod: 'pending',
          createdBy: testCreatorId,
        },
      ]);
    });

    it('should return comprehensive lease statistics', async () => {
      const stats = await leaseDAO.getLeaseStats(testCuid);

      expect(stats.totalLeases).toBe(3);
      expect(stats.leasesByStatus.active).toBe(2);
      expect(stats.leasesByStatus.draft).toBe(1);
      expect(stats.totalMonthlyRent).toBe(3500);
    });

    it('should calculate expiring leases correctly', async () => {
      const stats = await leaseDAO.getLeaseStats(testCuid);

      expect(stats.expiringIn30Days).toBe(1);
      expect(stats.expiringIn60Days).toBe(2);
    });

    it('should calculate occupancy rate', async () => {
      const stats = await leaseDAO.getLeaseStats(testCuid);

      expect(stats.occupancyRate).toBeGreaterThanOrEqual(0);
      expect(stats.occupancyRate).toBeLessThanOrEqual(100);
    });
  });

  describe('getRentRollData', () => {
    beforeEach(async () => {
      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        signingMethod: 'manual',
        signedDate: new Date(),
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
        signatures: [{
          userId: testTenantId,
          role: 'tenant',
          signedAt: new Date(),
          signatureMethod: 'manual',
        }],
      });
    });

    it('should return rent roll data for all properties', async () => {
      const rentRoll = await leaseDAO.getRentRollData(testCuid);

      expect(rentRoll.length).toBe(1);
      expect(rentRoll[0].monthlyRent).toBe(2000);
      expect(rentRoll[0].status).toBe(LeaseStatus.ACTIVE);
    });

    it('should filter rent roll by property', async () => {
      const rentRoll = await leaseDAO.getRentRollData(testCuid, testPropertyId.toString());

      expect(rentRoll.length).toBe(1);
    });

    it('should include tenant and property details', async () => {
      const rentRoll = await leaseDAO.getRentRollData(testCuid);

      expect(rentRoll[0].tenantName).toBeDefined();
      expect(rentRoll[0].tenantEmail).toBe('tenant@example.com');
      expect(rentRoll[0].propertyName).toBeDefined();
    });
  });

  describe('updateLeaseDocuments', () => {
    it('should add documents to lease', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        signingMethod: 'pending',
        createdBy: testCreatorId,
      });

      const uploadResults = [
        {
          url: 'https://example.com/lease.pdf',
          key: 'leases/lease-123.pdf',
          filename: 'lease-agreement.pdf',
          size: 1024000,
          fieldName: 'leaseDocuments',
          resourceId: lease._id.toString(),
          publicuid: 'pub-uid-lease-doc',
        },
      ];

      const updated = await leaseDAO.updateLeaseDocuments(
        lease._id.toString(),
        uploadResults,
        testCreatorId.toString()
      );

      expect(updated).not.toBeNull();
      expect(updated?.leaseDocuments).toHaveLength(1);
      expect(updated?.leaseDocuments?.[0].filename).toBe('lease-agreement.pdf');
    });

    it('should mark existing lease_agreement as inactive when uploading new one', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        signingMethod: 'pending',
        createdBy: testCreatorId,
        leaseDocuments: [{
          documentType: 'lease_agreement',
          url: 'https://example.com/old-lease.pdf',
          key: 'leases/old-lease.pdf',
          filename: 'old-lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
      });

      const uploadResults = [
        {
          url: 'https://example.com/new-lease.pdf',
          key: 'leases/new-lease.pdf',
          filename: 'new-lease-agreement.pdf',
          size: 2048000,
          documentType: 'lease_agreement',
        },
      ];

      const updated = await leaseDAO.updateLeaseDocuments(
        lease._id.toString(),
        uploadResults as any,
        testCreatorId.toString()
      );

      expect(updated).not.toBeNull();
      expect(updated?.leaseDocuments).toHaveLength(2);
    });
  });

  describe('updateLeaseDocumentStatus', () => {
    it('should update document status', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        signingMethod: 'pending',
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
      });

      const updated = await leaseDAO.updateLeaseDocumentStatus(
        lease._id.toString(),
        'failed',
        'Upload failed'
      );

      expect(updated).not.toBeNull();
    });

    it('should handle luid instead of ObjectId', async () => {
      const lease = await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: testTenantId,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        signingMethod: 'pending',
        createdBy: testCreatorId,
        leaseDocuments: [{
          url: 'https://example.com/lease.pdf',
          key: 'lease-key',
          filename: 'lease.pdf',
          uploadedBy: testCreatorId,
          status: 'active',
        }],
      });

      const updated = await leaseDAO.updateLeaseDocumentStatus(lease.luid, 'active');

      expect(updated).not.toBeNull();
    });
  });

  describe('getLeasesPendingTenantAcceptance', () => {
    it('should return leases using invitation as tenant', async () => {
      const invitationId = new Types.ObjectId();

      await Lease.create({
        cuid: testCuid,
        type: LeaseType.FIXED_TERM,
        templateType: 'residential-apartment',
        tenantId: invitationId,
        useInvitationIdAsTenantId: true,
        property: { id: testPropertyId, unitId: testUnitId.toString(), address: '123 Main St' },
        duration: { startDate: new Date('2024-01-01'), endDate: new Date('2024-12-31') },
        fees: { monthlyRent: 2000, securityDeposit: 2000, rentDueDay: 1, currency: 'CAD', acceptedPaymentMethod: 'e-transfer' },
        signingMethod: 'pending',
        createdBy: testCreatorId,
      });

      const leases = await leaseDAO.getLeasesPendingTenantAcceptance(testCuid);

      expect(leases.length).toBe(1);
      expect(leases[0].useInvitationIdAsTenantId).toBe(true);
    });

    it('should return empty array when no pending leases', async () => {
      const leases = await leaseDAO.getLeasesPendingTenantAcceptance(testCuid);

      expect(leases.length).toBe(0);
    });
  });
});
