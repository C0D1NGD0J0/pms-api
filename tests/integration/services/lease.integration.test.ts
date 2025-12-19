import { Types } from 'mongoose';
import { UserService } from '@services/user/user.service';
import { ROLES } from '@shared/constants/roles.constants';
import { LeaseService } from '@services/lease/lease.service';
import { mockQueueFactory } from '@tests/setup/externalMocks';
import { VendorService } from '@services/vendor/vendor.service';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { PermissionService } from '@services/permission/permission.service';
import { InvitationService } from '@services/invitation/invitation.service';
import { EventEmitterService } from '@services/eventEmitter/eventsEmitter.service';
import { beforeEach, beforeAll, describe, afterAll, expect, it } from '@jest/globals';
import { PropertyUnit, Property, Profile, Client, Vendor, Lease, User } from '@models/index';
import {
  PropertyUnitDAO,
  InvitationDAO,
  PropertyDAO,
  ProfileDAO,
  ClientDAO,
  VendorDAO,
  LeaseDAO,
  UserDAO,
} from '@dao/index';

import {
  disconnectTestDatabase,
  createTestPropertyUnit,
  setupAllExternalMocks,
  createTestManagerUser,
  createTestTenantUser,
  createTestAdminUser,
  createTestProperty,
  setupTestDatabase,
  clearTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
  SeededTestData,
  seedTestData,
} from '../../helpers';

const setupServices = () => {
  const userDAO = new UserDAO({ userModel: User });
  const clientDAO = new ClientDAO({ clientModel: Client, userModel: User });
  const profileDAO = new ProfileDAO({ profileModel: Profile });
  const propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
  const propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
  const vendorDAO = new VendorDAO({ vendorModel: Vendor });
  const leaseDAO = new LeaseDAO({ leaseModel: Lease });
  const invitationDAO = new InvitationDAO();

  const userCache = {
    getUserDetail: jest.fn().mockResolvedValue({ success: false, data: null }),
    cacheUserDetail: jest.fn().mockResolvedValue(undefined),
    getFilteredUsers: jest.fn().mockResolvedValue({ success: false, data: null }),
    saveFilteredUsers: jest.fn().mockResolvedValue(undefined),
    invalidateUserDetail: jest.fn().mockResolvedValue(undefined),
    invalidateUserLists: jest.fn().mockResolvedValue(undefined),
  } as any;

  const leaseCache = {
    getLease: jest.fn().mockResolvedValue({ success: false, data: null }),
    cacheLease: jest.fn().mockResolvedValue(undefined),
    invalidateLease: jest.fn().mockResolvedValue(undefined),
    getClientLeases: jest.fn().mockResolvedValue({ success: false, data: null }),
    saveClientLeases: jest.fn().mockResolvedValue(undefined),
    invalidateLeaseLists: jest.fn().mockResolvedValue(undefined),
  } as any;

  const permissionService = new PermissionService();

  const vendorService = new VendorService({
    vendorDAO,
    clientDAO,
    userDAO,
    profileDAO,
    permissionService,
    queueFactory: mockQueueFactory as any,
    emitterService: {} as any,
  } as any);

  const userService = new UserService({
    clientDAO,
    userDAO,
    propertyDAO,
    profileDAO,
    userCache,
    permissionService,
    vendorService,
  });

  const eventsRegistry = {
    trackEvent: jest.fn().mockResolvedValue(undefined),
    getEventLog: jest.fn().mockResolvedValue([]),
    registerEvent: jest.fn().mockResolvedValue(undefined),
  } as any;

  const emitterService = new EventEmitterService({ eventsRegistry });

  const mailerService = {
    sendEmail: jest.fn().mockResolvedValue({ success: true }),
  } as any;

  const notificationService = {
    handlePropertyUpdateNotifications: jest.fn().mockResolvedValue(undefined),
    notifyApprovalDecision: jest.fn().mockResolvedValue(undefined),
    createNotification: jest.fn().mockResolvedValue(undefined),
  } as any;

  const pdfGeneratorService = {
    generatePdf: jest.fn().mockResolvedValue({ success: true, pdfBuffer: Buffer.from('pdf') }),
  } as any;

  const mediaUploadService = {
    uploadFile: jest
      .fn()
      .mockResolvedValue({ success: true, data: { url: 'https://test.com/file.pdf' } }),
  } as any;

  const boldSignService = {
    sendDocumentForSignature: jest.fn().mockResolvedValue({ success: true, documentId: 'doc123' }),
    getSignatureStatus: jest.fn().mockResolvedValue({ success: true, status: 'completed' }),
  } as any;

  const invitationService = new InvitationService({
    invitationDAO,
    userDAO,
    clientDAO,
    profileDAO,
    mailerService,
    queueFactory: mockQueueFactory as any,
    emitterService,
  } as any);

  const leaseService = new LeaseService({
    leaseDAO,
    userDAO,
    clientDAO,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    invitationDAO,
    userService,
    invitationService,
    notificationService,
    pdfGeneratorService,
    mediaUploadService,
    boldSignService,
    mailerService,
    queueFactory: mockQueueFactory as any,
    emitterService,
    leaseCache,
  } as any);

  return {
    leaseService,
    leaseDAO,
    userDAO,
    clientDAO,
    profileDAO,
    propertyDAO,
    propertyUnitDAO,
    invitationDAO,
  };
};

describe('LeaseService Integration Tests - Write Operations', () => {
  let leaseService: LeaseService;
  let _leaseDAO: LeaseDAO;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();

    // Ensure Lease model indexes are built before running tests
    // This prevents WriteConflict errors during transactions
    await Lease.init();

    const services = setupServices();
    leaseService = services.leaseService;
    _leaseDAO = services.leaseDAO;
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('createLease', () => {
    it('should create a lease successfully for single-family property', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id, {
        propertyType: 'single_family',
      });

      // Update property to be approved and authorized
      await Property.findByIdAndUpdate(property._id, {
        approvalStatus: 'approved',
        owner: { type: 'company_owned' },
        authorization: { isActive: true },
      });

      const leaseData = {
        tenantInfo: {
          id: tenant._id.toString(),
        },
        property: {
          id: property._id.toString(),
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000, // in cents
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-TEST-${Date.now()}`,
      };

      const mockContext = {
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      const result = await leaseService.createLease(client.cuid, leaseData as any, mockContext);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.luid).toBeDefined();
      expect(result.data.status).toBe(LeaseStatus.DRAFT);
      expect(result.data.approvalStatus).toBe('approved'); // Manager auto-approves

      // Verify lease was saved to database
      const savedLease = await Lease.findOne({ luid: result.data.luid });
      expect(savedLease).toBeDefined();
      expect(savedLease!.tenantId.toString()).toBe(tenant._id.toString());
    });

    it('should require unitId for apartment properties', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id, {
        propertyType: 'apartment',
        maxAllowedUnits: 10,
      });

      await Property.findByIdAndUpdate(property._id, {
        approvalStatus: 'approved',
        owner: { type: 'company_owned' },
        authorization: { isActive: true },
      });

      const leaseData = {
        tenantInfo: {
          id: tenant._id.toString(),
        },
        property: {
          id: property._id.toString(),
          address: property.address.fullAddress,
          // Missing unitId
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-TEST-${Date.now()}`,
      };

      const mockContext = {
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      await expect(
        leaseService.createLease(client.cuid, leaseData as any, mockContext)
      ).rejects.toThrow();
    });

    it('should create lease with unit for apartment property', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id, {
        propertyType: 'apartment',
        maxAllowedUnits: 10,
      });

      await Property.findByIdAndUpdate(property._id, {
        approvalStatus: 'approved',
        owner: { type: 'company_owned' },
        authorization: { isActive: true },
      });

      const unit = await createTestPropertyUnit(client.cuid, property._id, {
        status: 'available',
        unitNumber: '101',
      });

      const leaseData = {
        tenantInfo: {
          id: tenant._id.toString(),
        },
        property: {
          id: property._id.toString(),
          unitId: unit._id.toString(),
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-TEST-${Date.now()}`,
      };

      const mockContext = {
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      const result = await leaseService.createLease(client.cuid, leaseData as any, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.property.unitId).toBeDefined();
    });

    it('should set status to pending for staff user', async () => {
      const client = await createTestClient();
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      await createTestProfile(staff._id, client._id, { type: 'employee' });
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id, {
        propertyType: 'single_family',
      });

      await Property.findByIdAndUpdate(property._id, {
        approvalStatus: 'approved',
        owner: { type: 'company_owned' },
        authorization: { isActive: true },
      });

      const leaseData = {
        tenantInfo: {
          id: tenant._id.toString(),
        },
        property: {
          id: property._id.toString(),
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-TEST-${Date.now()}`,
      };

      const mockContext = {
        currentuser: {
          uid: staff.uid,
          sub: staff._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.STAFF,
          },
        },
      } as any;

      const result = await leaseService.createLease(client.cuid, leaseData as any, mockContext);

      expect(result.success).toBe(true);
      expect(result.data.approvalStatus).toBe('pending');
    });

    it('should reject lease creation with invalid property', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const leaseData = {
        tenantInfo: {
          id: tenant._id.toString(),
        },
        property: {
          id: new Types.ObjectId().toString(), // Non-existent property
          address: '123 Fake St',
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-TEST-${Date.now()}`,
      };

      const mockContext = {
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      await expect(
        leaseService.createLease(client.cuid, leaseData as any, mockContext)
      ).rejects.toThrow();
    });
  });

  describe('updateLease', () => {
    it('should allow manager to update draft lease', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id, {
        propertyType: 'single_family',
      });

      await Property.findByIdAndUpdate(property._id, {
        approvalStatus: 'approved',
        owner: { type: 'company_owned' },
        authorization: { isActive: true },
      });

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.DRAFT,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: manager._id,
      });

      const updateData = {
        fees: {
          monthlyRent: 1750, // Increase rent (MoneyUtils will convert to cents)
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
      };

      const mockContext = {
        request: {
          params: {
            cuid: client.cuid,
          },
        },
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      const result = await leaseService.updateLease(mockContext, lease.luid, updateData as any);

      expect(result.success).toBe(true);
      expect(result.data.lease.fees.monthlyRent).toBe(175000);

      // Verify in database
      const updatedLease = await Lease.findOne({ luid: lease.luid });
      expect(updatedLease?.fees.monthlyRent).toBe(175000);
    });

    it('should block updates to immutable fields on active lease', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id, {
        propertyType: 'single_family',
      });

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: manager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: {
          status: 'signed',
          provider: 'boldsign',
        },
        signatures: [
          {
            userId: tenant._id,
            signedAt: new Date(),
            role: 'tenant',
            signatureMethod: 'electronic',
          },
        ],
        leaseDocuments: [
          {
            url: 'https://test.com/lease.pdf',
            key: 's3-key-test',
            filename: 'lease.pdf',
            documentType: 'lease_agreement',
            uploadedAt: new Date(),
            uploadedBy: manager._id,
          },
        ],
      });

      const updateData = {
        tenantInfo: {
          id: new Types.ObjectId().toString(), // Try to change immutable tenantInfo
        },
      };

      const mockContext = {
        request: {
          params: {
            cuid: client.cuid,
          },
        },
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      await expect(
        leaseService.updateLease(mockContext, lease.luid, updateData as any)
      ).rejects.toThrow();
    });

    it('should allow updates to mutable fields on active lease', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id, {
        propertyType: 'single_family',
      });

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: manager._id,
        petPolicy: {
          allowed: false,
        },
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: {
          status: 'signed',
          provider: 'boldsign',
        },
        signatures: [
          {
            userId: tenant._id,
            signedAt: new Date(),
            role: 'tenant',
            signatureMethod: 'electronic',
          },
        ],
        leaseDocuments: [
          {
            url: 'https://test.com/lease.pdf',
            key: 's3-key-test',
            filename: 'lease.pdf',
            documentType: 'lease_agreement',
            uploadedAt: new Date(),
            uploadedBy: manager._id,
          },
        ],
      });

      const updateData = {
        petPolicy: {
          allowed: true,
          maxPets: 2,
        },
      };

      const mockContext = {
        request: {
          params: {
            cuid: client.cuid,
          },
        },
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      const result = await leaseService.updateLease(mockContext, lease.luid, updateData as any);

      expect(result.success).toBe(true);
      expect(result.data.lease.petPolicy.allowed).toBe(true);
      expect(result.data.lease.petPolicy.maxPets).toBe(2);
    });
  });

  describe('deleteLease', () => {
    it('should allow deletion of draft lease', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id);

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.DRAFT,
        approvalStatus: 'draft',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: manager._id,
      });

      const result = await leaseService.deleteLease(
        client.cuid,
        lease.luid,
        manager._id.toString()
      );

      expect(result.success).toBe(true);

      // Verify soft delete
      const deletedLease = await Lease.findOne({ luid: lease.luid });
      expect(deletedLease?.deletedAt).toBeDefined();
    });

    it('should block deletion of active lease', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id);

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: manager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: {
          status: 'signed',
          provider: 'boldsign',
        },
        signatures: [
          {
            userId: tenant._id,
            signedAt: new Date(),
            role: 'tenant',
            signatureMethod: 'electronic',
          },
        ],
        leaseDocuments: [
          {
            url: 'https://test.com/lease.pdf',
            key: 's3-key-test',
            filename: 'lease.pdf',
            documentType: 'lease_agreement',
            uploadedAt: new Date(),
            uploadedBy: manager._id,
          },
        ],
      });

      await expect(
        leaseService.deleteLease(client.cuid, lease.luid, manager._id.toString())
      ).rejects.toThrow();
    });
  });

  describe('approveLease', () => {
    it('should approve pending lease', async () => {
      const client = await createTestClient();
      const admin = await createTestAdminUser(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      await createTestProfile(staff._id, client._id, { type: 'employee' });
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id);

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.DRAFT,
        approvalStatus: 'pending',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: staff._id,
      });

      const mockContext = {
        currentuser: {
          uid: admin.uid,
          sub: admin._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      const result = await leaseService.approveLease(
        client.cuid,
        lease.luid,
        mockContext.currentuser
      );

      expect(result.success).toBe(true);
      expect(result.data.approvalStatus).toBe('approved');

      // Verify in database
      const approvedLease = await Lease.findOne({ luid: lease.luid });
      expect(approvedLease?.approvalStatus).toBe('approved');
    });

    it('should reject approval by non-admin', async () => {
      const client = await createTestClient();
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      await createTestProfile(staff._id, client._id, { type: 'employee' });
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id);

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.DRAFT,
        approvalStatus: 'pending',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: staff._id,
      });

      const mockContext = {
        currentuser: {
          uid: staff.uid,
          sub: staff._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.STAFF,
          },
        },
      } as any;

      await expect(
        leaseService.approveLease(client.cuid, lease.luid, mockContext.currentuser)
      ).rejects.toThrow();
    });
  });

  describe('rejectLease', () => {
    it('should reject pending lease with reason', async () => {
      const client = await createTestClient();
      const admin = await createTestAdminUser(client.cuid, client._id);
      const staff = await createTestUser(client.cuid, { roles: [ROLES.STAFF] });
      await createTestProfile(staff._id, client._id, { type: 'employee' });
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id);

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.DRAFT,
        approvalStatus: 'pending',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: staff._id,
      });

      const mockContext = {
        currentuser: {
          uid: admin.uid,
          sub: admin._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      const rejectionReason = 'Invalid rental terms';
      const result = await leaseService.rejectLease(
        client.cuid,
        lease.luid,
        mockContext.currentuser,
        rejectionReason
      );

      expect(result.success).toBe(true);
      expect(result.data.approvalStatus).toBe('rejected');

      // Verify in database
      const rejectedLease = await Lease.findOne({ luid: lease.luid });
      expect(rejectedLease?.approvalStatus).toBe('rejected');
    });
  });

  describe('terminateLease', () => {
    it('should terminate active lease', async () => {
      const client = await createTestClient();
      const manager = await createTestManagerUser(client.cuid, client._id);
      const tenant = await createTestTenantUser(client.cuid, client._id);

      const property = await createTestProperty(client.cuid, client._id);

      const lease = await Lease.create({
        luid: `lease-${Date.now()}`,
        cuid: client.cuid,
        clientId: client._id,
        tenantId: tenant._id,
        property: {
          id: property._id,
          address: property.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-12-31'),
        },
        fees: {
          monthlyRent: 150000,
          securityDeposit: 300000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.ACTIVE,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-${Date.now()}`,
        createdBy: manager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: {
          status: 'signed',
          provider: 'boldsign',
        },
        signatures: [
          {
            userId: tenant._id,
            signedAt: new Date(),
            role: 'tenant',
            signatureMethod: 'electronic',
          },
        ],
        leaseDocuments: [
          {
            url: 'https://test.com/lease.pdf',
            key: 's3-key-test',
            filename: 'lease.pdf',
            documentType: 'lease_agreement',
            uploadedAt: new Date(),
            uploadedBy: manager._id,
          },
        ],
      });

      const mockContext = {
        currentuser: {
          uid: manager.uid,
          sub: manager._id.toString(),
          client: {
            cuid: client.cuid,
            role: ROLES.MANAGER,
          },
        },
      } as any;

      const terminationData = {
        terminationDate: new Date('2026-06-01'), // Mid-lease termination
        terminationReason: 'Tenant request',
      };

      const result = await leaseService.terminateLease(
        client.cuid,
        lease.luid,
        terminationData as any,
        mockContext
      );

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(LeaseStatus.TERMINATED);

      // Verify in database
      const terminatedLease = await Lease.findOne({ luid: lease.luid });
      expect(terminatedLease?.status).toBe(LeaseStatus.TERMINATED);
    });
  });
});

describe('LeaseService Integration Tests - Read Operations', () => {
  let leaseService: LeaseService;
  let seededData: SeededTestData;
  let testLease: any;
  let testClient: any;
  let testManager: any;
  let testTenant: any;
  let testProperty: any;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();
    const services = setupServices();
    leaseService = services.leaseService;
    seededData = await seedTestData();

    // Create test data for read operations
    testClient = seededData.clients.client1;
    testManager = seededData.users.admin1;
    testTenant = await createTestTenantUser(testClient.cuid, testClient._id);

    testProperty = await createTestProperty(testClient.cuid, testClient._id, {
      propertyType: 'single_family',
    });

    await Property.findByIdAndUpdate(testProperty._id, {
      approvalStatus: 'approved',
      owner: { type: 'company_owned' },
      authorization: { isActive: true },
    });

    testLease = await Lease.create({
      luid: `lease-read-${Date.now()}`,
      cuid: testClient.cuid,
      clientId: testClient._id,
      tenantId: testTenant._id,
      property: {
        id: testProperty._id,
        address: testProperty.address.fullAddress,
      },
      duration: {
        startDate: new Date('2025-01-01'),
        endDate: new Date('2026-01-01'),
      },
      fees: {
        monthlyRent: 150000,
        securityDeposit: 300000,
        rentDueDay: 1,
        currency: 'USD',
        acceptedPaymentMethod: 'e-transfer',
      },
      status: LeaseStatus.ACTIVE,
      approvalStatus: 'approved',
      type: LeaseType.FIXED_TERM,
      leaseNumber: `LEASE-READ-${Date.now()}`,
      createdBy: testManager._id,
      signedDate: new Date(),
      signingMethod: 'electronic',
      eSignature: {
        status: 'signed',
        provider: 'boldsign',
      },
      signatures: [
        {
          userId: testTenant._id,
          signedAt: new Date(),
          role: 'tenant',
          signatureMethod: 'electronic',
        },
      ],
      leaseDocuments: [
        {
          url: 'https://test.com/lease.pdf',
          key: 's3-key-test',
          filename: 'lease.pdf',
          documentType: 'lease_agreement',
          uploadedAt: new Date(),
          uploadedBy: testManager._id,
        },
      ],
    });
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('getLeaseById', () => {
    it('should retrieve lease by luid', async () => {
      const mockContext = {
        request: {
          params: {
            cuid: testClient.cuid,
          },
        },
        currentuser: {
          uid: testManager.uid,
          sub: testManager._id.toString(),
          client: {
            cuid: testClient.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      const result = await leaseService.getLeaseById(mockContext, testLease.luid);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(result.data.lease).toBeDefined();
      expect(result.data.lease.luid).toBe(testLease.luid);
      expect(result.data.lease.status).toBe(LeaseStatus.ACTIVE);
    });

    it('should throw error for non-existent lease', async () => {
      const mockContext = {
        request: {
          params: {
            cuid: testClient.cuid,
          },
        },
        currentuser: {
          uid: testManager.uid,
          sub: testManager._id.toString(),
          client: {
            cuid: testClient.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      await expect(leaseService.getLeaseById(mockContext, 'non-existent-luid')).rejects.toThrow();
    });
  });

  describe('getFilteredLeases', () => {
    it('should return leases with pagination', async () => {
      const _mockContext = {
        currentuser: {
          uid: testManager.uid,
          sub: testManager._id.toString(),
          client: {
            cuid: testClient.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      const result = await leaseService.getFilteredLeases(
        testClient.cuid,
        {},
        { limit: 10, skip: 0 }
      );

      expect(result.items).toBeInstanceOf(Array);
      expect(result.pagination).toBeDefined();
      expect(result?.pagination?.total).toBeGreaterThan(0);
    });

    it('should filter leases by status', async () => {
      const _mockContext = {
        currentuser: {
          uid: testManager.uid,
          sub: testManager._id.toString(),
          client: {
            cuid: testClient.cuid,
            role: ROLES.ADMIN,
          },
        },
      } as any;

      const result = await leaseService.getFilteredLeases(
        testClient.cuid,
        { status: LeaseStatus.ACTIVE },
        { limit: 10, skip: 0 }
      );

      expect(result.items).toBeInstanceOf(Array);
      // All returned leases should be active
      result.items.forEach((lease: any) => {
        expect(lease.status).toBe(LeaseStatus.ACTIVE);
      });
    });
  });

  describe('getLeaseStats', () => {
    it('should return lease statistics', async () => {
      const result = await leaseService.getLeaseStats(testClient.cuid);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      // Stats should include various metrics
      expect(typeof result.data).toBe('object');
    });
  });
});
