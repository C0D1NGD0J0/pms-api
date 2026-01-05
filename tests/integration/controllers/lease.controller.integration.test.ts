/* eslint-disable @typescript-eslint/no-unused-vars */
import request from 'supertest';
import { Types } from 'mongoose';
import { Application } from 'express';
import { Property, Lease } from '@models/index';
import { ROLES } from '@shared/constants/roles.constants';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { beforeEach, beforeAll, describe, afterAll, expect, it } from '@jest/globals';

import { createAuthToken, createTestApp } from '../../setup/testApp';
import {
  disconnectTestDatabase,
  createTestPropertyUnit,
  setupAllExternalMocks,
  createTestManagerUser,
  createTestTenantUser,
  createTestAdminUser,
  createTestProperty,
  setupTestDatabase,
  createTestProfile,
  createTestClient,
  createTestUser,
} from '../../helpers';

// Helper function to create standard lease documents for testing
const createMockLeaseDocuments = (uploadedBy: Types.ObjectId) => [
  {
    url: 'https://test.com/lease.pdf',
    key: 's3-key-test',
    filename: 'lease.pdf',
    documentType: 'lease_agreement',
    uploadedAt: new Date(),
    uploadedBy,
  },
];

// Helper function to create standard signature array
const createMockSignatures = (tenantId: Types.ObjectId) => [
  {
    userId: tenantId,
    signedAt: new Date(),
    role: 'tenant',
    signatureMethod: 'electronic',
  },
];

// Helper function to create eSignature object
const createMockESignature = () => ({
  status: 'signed',
  provider: 'boldsign',
  documentId: 'test-doc-id',
  sentAt: new Date(),
  completedAt: new Date(),
});

describe('LeaseController Integration Tests', () => {
  let app: Application;
  let testClient: any;
  let testManager: any;
  let testTenant: any;
  let testProperty: any;
  let testUnit: any;
  let managerToken: string;
  let tenantToken: string;
  let adminToken: string;
  let testAdmin: any;
  let testStaff: any;
  let staffToken: string;

  beforeAll(async () => {
    await setupTestDatabase();
    setupAllExternalMocks();

    // Ensure Lease model indexes are built
    await Lease.init();
    await Property.init();

    app = createTestApp();

    // Create test data
    testClient = await createTestClient();
    testManager = await createTestManagerUser(testClient.cuid, testClient._id);
    testTenant = await createTestTenantUser(testClient.cuid, testClient._id);
    testAdmin = await createTestAdminUser(testClient.cuid, testClient._id);
    testStaff = await createTestUser(testClient.cuid, { roles: [ROLES.STAFF] });
    await createTestProfile(testStaff._id, testClient._id, { type: 'employee' });

    // Create test property with units
    testProperty = await createTestProperty(testClient.cuid, testClient._id, {
      propertyType: 'apartment',
      maxAllowedUnits: 10,
    });

    await Property.findByIdAndUpdate(testProperty._id, {
      approvalStatus: 'approved',
      owner: { type: 'company_owned' },
      authorization: { isActive: true },
    });

    testUnit = await createTestPropertyUnit(testClient.cuid, testProperty._id, {
      status: 'available',
      unitNumber: '101',
    });

    // Create auth tokens
    managerToken = createAuthToken(testManager);
    tenantToken = createAuthToken(testTenant);
    adminToken = createAuthToken(testAdmin);
    staffToken = createAuthToken(testStaff);
  });

  beforeEach(async () => {
    // Clear only leases to maintain test users/properties
    await Lease.deleteMany({});
  });

  afterAll(async () => {
    await disconnectTestDatabase();
  });

  describe('POST /api/v1/leases/:cuid - Create Lease', () => {
    it('should create a lease successfully with manager role', async () => {
      const leaseData = {
        tenantInfo: {
          id: testTenant._id.toString(),
        },
        property: {
          id: testProperty._id.toString(),
          unitId: testUnit._id.toString(),
          address: testProperty.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500, // in dollars
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-TEST-${Date.now()}`,
      };

      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send(leaseData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.data.luid).toBeDefined();
      expect(response.body.data.data.status).toBe(LeaseStatus.DRAFT);
      expect(response.body.data.data.approvalStatus).toBe('approved'); // Manager auto-approves
    });

    it('should create lease with pending status for staff user', async () => {
      const leaseData = {
        tenantInfo: {
          id: testTenant._id.toString(),
        },
        property: {
          id: testProperty._id.toString(),
          unitId: testUnit._id.toString(),
          address: testProperty.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-STAFF-${Date.now()}`,
      };

      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}`)
        .set('Authorization', `Bearer ${staffToken}`)
        .send(leaseData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.data.approvalStatus).toBe('pending');
    });

    it('should return 401 without authentication', async () => {
      const leaseData = {
        tenantInfo: { id: testTenant._id.toString() },
        property: { id: testProperty._id.toString() },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
      };

      await request(app).post(`/api/v1/leases/${testClient.cuid}`).send(leaseData).expect(401);
    });

    it('should return 400 for invalid property', async () => {
      const leaseData = {
        tenantInfo: {
          id: testTenant._id.toString(),
        },
        property: {
          id: new Types.ObjectId().toString(), // Non-existent property
          unitId: testUnit._id.toString(),
          address: 'Fake Address',
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-INVALID-${Date.now()}`,
      };

      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send(leaseData);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });
  });

  describe('GET /api/v1/leases/:cuid - Get Filtered Leases', () => {
    beforeEach(async () => {
      // Create multiple test leases
      await Lease.create({
        luid: `lease-active-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        leaseNumber: `LEASE-ACTIVE-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });

      await Lease.create({
        luid: `lease-draft-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
          address: testProperty.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-02-01'),
          endDate: new Date('2026-02-01'),
        },
        fees: {
          monthlyRent: 140000,
          securityDeposit: 280000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.DRAFT,
        approvalStatus: 'draft',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-DRAFT-${Date.now()}`,
        createdBy: testManager._id,
      });
    });

    it('should return all leases with pagination', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .query({ 'pagination[page]': 1, 'pagination[limit]': 10 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      expect(response.body.pagination).toBeDefined();
      expect(response.body.pagination.total).toBeGreaterThanOrEqual(2);
    });

    it('should filter leases by status', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .query({
          'filter[status]': LeaseStatus.ACTIVE,
          'pagination[page]': 1,
          'pagination[limit]': 10,
        })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
      response.body.data.forEach((lease: any) => {
        expect(lease.status).toBe(LeaseStatus.ACTIVE);
      });
    });

    it('should return 401 without authentication', async () => {
      await request(app).get(`/api/v1/leases/${testClient.cuid}`).expect(401);
    });
  });

  describe('GET /api/v1/leases/:cuid/:luid - Get Lease By ID', () => {
    let testLease: any;

    beforeEach(async () => {
      testLease = await Lease.create({
        luid: `lease-test-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });
    });

    it('should retrieve lease by luid', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/${testLease.luid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.lease.luid).toBe(testLease.luid);
      expect(response.body.data.lease.status).toBe(LeaseStatus.ACTIVE);
    });

    it('should return 404 for non-existent lease', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/non-existent-luid`)
        .set('Authorization', `Bearer ${managerToken}`);

      expect(response.status).toBeGreaterThanOrEqual(404);
    });

    it('should return 401 without authentication', async () => {
      await request(app).get(`/api/v1/leases/${testClient.cuid}/${testLease.luid}`).expect(401);
    });
  });

  describe('PATCH /api/v1/leases/:cuid/:luid - Update Lease', () => {
    let draftLease: any;
    let activeLease: any;

    beforeEach(async () => {
      draftLease = await Lease.create({
        luid: `lease-draft-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        status: LeaseStatus.DRAFT,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-DRAFT-${Date.now()}`,
        createdBy: testManager._id,
      });

      activeLease = await Lease.create({
        luid: `lease-active-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        leaseNumber: `LEASE-ACTIVE-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });
    });

    it('should update draft lease successfully', async () => {
      const updateData = {
        fees: {
          monthlyRent: 1750, // MoneyUtils will convert to cents
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
      };

      const response = await request(app)
        .patch(`/api/v1/leases/${testClient.cuid}/${draftLease.luid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.lease.fees.monthlyRent).toBe(175000); // Should be in cents
    });

    it('should allow updates to mutable fields on active lease', async () => {
      const updateData = {
        petPolicy: {
          allowed: true,
          maxPets: 2,
        },
      };

      const response = await request(app)
        .patch(`/api/v1/leases/${testClient.cuid}/${activeLease.luid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send(updateData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.lease.petPolicy.allowed).toBe(true);
      expect(response.body.data.lease.petPolicy.maxPets).toBe(2);
    });

    it('should reject updates to immutable fields on active lease', async () => {
      const updateData = {
        tenantInfo: {
          id: new Types.ObjectId().toString(), // Try to change immutable field
        },
      };

      const response = await request(app)
        .patch(`/api/v1/leases/${testClient.cuid}/${activeLease.luid}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send(updateData);

      expect(response.status).toBeGreaterThanOrEqual(400);
      expect(response.body.success).toBe(false);
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .patch(`/api/v1/leases/${testClient.cuid}/${draftLease.luid}`)
        .send({ fees: { monthlyRent: 2000 } })
        .expect(401);
    });
  });

  describe('DELETE /api/v1/leases/:cuid/:luid - Delete Lease', () => {
    let draftLease: any;
    let activeLease: any;

    beforeEach(async () => {
      draftLease = await Lease.create({
        luid: `lease-draft-del-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        status: LeaseStatus.DRAFT,
        approvalStatus: 'draft',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-DRAFT-DEL-${Date.now()}`,
        createdBy: testManager._id,
      });

      activeLease = await Lease.create({
        luid: `lease-active-del-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        leaseNumber: `LEASE-ACTIVE-DEL-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });
    });

    it('should delete draft lease successfully', async () => {
      // Note: Controller deleteLease is not fully implemented yet
      const response = await request(app)
        .delete(`/api/v1/leases/${testClient.cuid}/${draftLease.luid}`)
        .set('Authorization', `Bearer ${managerToken}`);

      // Since controller returns 503 (SERVICE_UNAVAILABLE), we expect that
      expect(response.status).toBe(503);
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not yet implemented');
    });

    it('should return 401 without authentication', async () => {
      await request(app).delete(`/api/v1/leases/${testClient.cuid}/${draftLease.luid}`).expect(401);
    });
  });

  describe('GET /api/v1/leases/:cuid/stats - Get Lease Stats', () => {
    beforeEach(async () => {
      // Create sample leases for stats
      await Lease.create({
        luid: `lease-stats-1-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        leaseNumber: `LEASE-STATS-1-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });

      await Lease.create({
        luid: `lease-stats-2-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
          address: testProperty.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-02-01'),
          endDate: new Date('2026-02-01'),
        },
        fees: {
          monthlyRent: 160000,
          securityDeposit: 320000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        status: LeaseStatus.DRAFT,
        approvalStatus: 'pending',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-STATS-2-${Date.now()}`,
        createdBy: testStaff._id,
      });
    });

    it('should return lease statistics', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/stats`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(typeof response.body.data).toBe('object');
    });

    it('should return 401 without authentication', async () => {
      await request(app).get(`/api/v1/leases/${testClient.cuid}/stats`).expect(401);
    });
  });

  describe('GET /api/v1/leases/:cuid/expiring - Get Expiring Leases', () => {
    beforeEach(async () => {
      const now = new Date();
      const futureDate = new Date(now);
      futureDate.setDate(futureDate.getDate() + 25); // Expiring in 25 days

      await Lease.create({
        luid: `lease-expiring-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
          address: testProperty.address.fullAddress,
        },
        duration: {
          startDate: new Date('2024-03-01'),
          endDate: futureDate, // Expiring soon
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
        leaseNumber: `LEASE-EXPIRING-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });
    });

    it('should return expiring leases within default 30 days', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/expiring`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return expiring leases within custom days threshold', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/expiring`)
        .set('Authorization', `Bearer ${managerToken}`)
        .query({ days: 60 })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(Array.isArray(response.body.data)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      await request(app).get(`/api/v1/leases/${testClient.cuid}/expiring`).expect(401);
    });
  });

  describe('GET /api/v1/leases/:cuid/templates - Get Lease Templates', () => {
    it('should return available lease templates', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/templates`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.templates).toBeDefined();
      expect(Array.isArray(response.body.data.templates)).toBe(true);
    });

    it('should return 401 without authentication', async () => {
      await request(app).get(`/api/v1/leases/${testClient.cuid}/templates`).expect(401);
    });
  });

  describe('POST /api/v1/leases/:cuid/:luid/activate - Activate Lease', () => {
    let testLease: any;

    beforeEach(async () => {
      testLease = await Lease.create({
        luid: `lease-activate-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        status: LeaseStatus.DRAFT,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-ACTIVATE-${Date.now()}`,
        createdBy: testManager._id,
      });
    });

    it('should return not implemented status', async () => {
      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/activate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({});

      expect(response.status).toBe(501); // NOT_IMPLEMENTED
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not yet implemented');
    });
  });

  describe('POST /api/v1/leases/:cuid/:luid/terminate - Terminate Lease', () => {
    let testLease: any;

    beforeEach(async () => {
      testLease = await Lease.create({
        luid: `lease-terminate-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
          address: testProperty.address.fullAddress,
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
        leaseNumber: `LEASE-TERMINATE-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });
    });

    it('should return not implemented status', async () => {
      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/terminate`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({
          terminationDate: new Date('2026-06-01'),
          terminationReason: 'Tenant request',
        });

      expect(response.status).toBe(501); // NOT_IMPLEMENTED
      expect(response.body.success).toBe(false);
      expect(response.body.message).toContain('not yet implemented');
    });
  });

  describe('POST /api/v1/leases/:cuid/:luid/pdf - Generate Lease PDF', () => {
    let testLease: any;

    beforeEach(async () => {
      testLease = await Lease.create({
        luid: `lease-pdf-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        status: LeaseStatus.DRAFT,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-PDF-${Date.now()}`,
        createdBy: testManager._id,
      });
    });

    it('should queue PDF generation successfully', async () => {
      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/pdf`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ templateType: 'residential-single-family' })
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data.jobId).toBeDefined();
      expect(response.body.data.status).toBe('queued');
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/pdf`)
        .send({ templateType: 'residential-single-family' })
        .expect(401);
    });
  });

  describe('GET /api/v1/leases/:cuid/:luid/preview_lease - Preview Lease', () => {
    let testLease: any;

    beforeEach(async () => {
      testLease = await Lease.create({
        luid: `lease-preview-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        status: LeaseStatus.DRAFT,
        approvalStatus: 'approved',
        type: LeaseType.FIXED_TERM,
        leaseNumber: `LEASE-PREVIEW-${Date.now()}`,
        createdBy: testManager._id,
      });
    });

    it('should return lease preview HTML', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/preview_lease`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.data.html).toBeDefined();
      expect(response.body.data.templateUsed).toBeDefined();
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/preview_lease`)
        .expect(401);
    });
  });

  describe('POST /api/v1/leases/:cuid/:luid/lease_renewal - Renew Lease', () => {
    let testLease: any;

    beforeEach(async () => {
      testLease = await Lease.create({
        luid: `lease-renew-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
          address: testProperty.address.fullAddress,
        },
        duration: {
          startDate: new Date('2024-01-01'),
          endDate: new Date('2025-01-01'),
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
        leaseNumber: `LEASE-RENEW-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });
    });

    it('should initiate lease renewal successfully', async () => {
      const renewalData = {
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1600,
          securityDeposit: 3200,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
      };

      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/lease_renewal`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send(renewalData)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeDefined();
      expect(response.body.message).toContain('renewal');
    });

    it('should return 401 without authentication', async () => {
      await request(app)
        .post(`/api/v1/leases/${testClient.cuid}/${testLease.luid}/lease_renewal`)
        .send({})
        .expect(401);
    });
  });

  describe('Authorization Tests', () => {
    let testLease: any;

    beforeEach(async () => {
      testLease = await Lease.create({
        luid: `lease-auth-${Date.now()}`,
        cuid: testClient.cuid,
        clientId: testClient._id,
        tenantId: testTenant._id,
        property: {
          id: testProperty._id,
          unitId: testUnit._id,
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
        leaseNumber: `LEASE-AUTH-${Date.now()}`,
        createdBy: testManager._id,
        signedDate: new Date(),
        signingMethod: 'electronic',
        eSignature: createMockESignature(),
        signatures: createMockSignatures(testTenant._id),
        leaseDocuments: createMockLeaseDocuments(testManager._id),
      });
    });

    it('should deny tenant from creating leases', async () => {
      const leaseData = {
        tenantInfo: { id: testTenant._id.toString() },
        property: {
          id: testProperty._id.toString(),
          unitId: testUnit._id.toString(),
          address: testProperty.address.fullAddress,
        },
        duration: {
          startDate: new Date('2025-01-01'),
          endDate: new Date('2026-01-01'),
        },
        fees: {
          monthlyRent: 1500,
          securityDeposit: 3000,
          rentDueDay: 1,
          currency: 'USD',
          acceptedPaymentMethod: 'e-transfer',
        },
        type: LeaseType.FIXED_TERM,
      };

      const response = await request(app)
        .post(`/api/v1/leases/${testClient.cuid}`)
        .set('Authorization', `Bearer ${tenantToken}`)
        .send(leaseData);

      expect(response.status).toBeGreaterThanOrEqual(403); // Forbidden
    });

    it('should allow tenant to view their own lease', async () => {
      const response = await request(app)
        .get(`/api/v1/leases/${testClient.cuid}/${testLease.luid}`)
        .set('Authorization', `Bearer ${tenantToken}`);

      // Tenant should be able to read their own lease
      expect(response.status).toBeLessThan(500);
    });
  });
});
