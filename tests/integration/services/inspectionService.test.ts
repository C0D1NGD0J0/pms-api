import { Types } from 'mongoose';
import { faker } from '@faker-js/faker';
import { ROLES } from '@shared/constants/roles.constants';
import { InspectionDAO } from '@dao/inspectionDAO';
import { PropertyDAO } from '@dao/propertyDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { UserDAO } from '@dao/userDAO';
import { InspectionService } from '@services/inspection/inspection.service';
import { mockEventEmitter } from '@tests/setup/externalMocks';
import {
  ConditionRating,
  InspectionStatus,
  InspectionType,
} from '@interfaces/inspection.interface';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { PropertyUnit, Inspection, Property, Lease, User } from '@models/index';
import {
  createTestPropertyUnit,
  createTestProperty,
  createTestClient,
  createTestUser,
  clearTestDatabase,
} from '@tests/helpers';

// Mock only external services
const mockEmailQueue = {
  addToEmailQueue: jest.fn().mockResolvedValue({ success: true }),
  addJobToQueue: jest.fn().mockResolvedValue({ id: 'job-id' }),
  add: jest.fn(),
} as any;

describe('InspectionService Integration Tests', () => {
  let inspectionService: InspectionService;
  let inspectionDAO: InspectionDAO;
  let propertyDAO: PropertyDAO;
  let propertyUnitDAO: PropertyUnitDAO;
  let leaseDAO: LeaseDAO;
  let userDAO: UserDAO;

  beforeAll(() => {
    const inspectionModel = Inspection as any;
    inspectionDAO = new InspectionDAO({ inspectionModel });
    propertyUnitDAO = new PropertyUnitDAO({ propertyUnitModel: PropertyUnit });
    propertyDAO = new PropertyDAO({ propertyModel: Property, propertyUnitDAO });
    leaseDAO = new LeaseDAO({ leaseModel: Lease });
    userDAO = new UserDAO({ userModel: User });

    inspectionService = new InspectionService({
      inspectionDAO,
      leaseDAO,
      propertyDAO,
      userDAO,
      emitterService: mockEventEmitter as any,
      emailQueue: mockEmailQueue,
    });
  });

  beforeEach(async () => {
    await clearTestDatabase();
    jest.clearAllMocks();
  });

  // ─── Helpers ────────────────────────────────────────────────────────────

  const setupScenario = async () => {
    const client = await createTestClient({ isVerified: true });
    const cuid = client.cuid;

    const admin = await createTestUser(cuid, { roles: [ROLES.ADMIN] });
    const tenant = await createTestUser(cuid, { roles: [ROLES.TENANT] });
    const property = await createTestProperty(cuid, client._id);
    const unit = await createTestPropertyUnit(cuid, property._id);

    const lease = await Lease.create({
      luid: `lease-${faker.string.alphanumeric(12)}`,
      cuid,
      tenantId: tenant._id,
      property: {
        id: property._id,
        address: property.address?.fullAddress || 'Test Address',
      },
      status: LeaseStatus.ACTIVE,
      approvalStatus: 'approved',
      type: LeaseType.FIXED_TERM,
      duration: {
        startDate: new Date(),
        endDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
      fees: {
        rentAmount: 2000,
        currency: 'USD',
        securityDeposit: 1500,
        acceptedPaymentMethod: 'e-transfer',
      },
      signingMethod: 'manual',
      templateType: 'generic',
      createdBy: admin._id,
      signedDate: new Date(),
      leaseDocuments: [
        {
          url: 'https://example.com/lease.pdf',
          key: 'leases/test.pdf',
          name: 'test-lease.pdf',
          filename: 'test-lease.pdf',
          status: 'active',
          uploadedAt: new Date(),
          uploadedBy: admin._id,
        },
      ],
      signatures: [
        {
          userId: tenant._id,
          role: 'tenant',
          signedAt: new Date(),
          name: 'Test Tenant',
          signatureMethod: 'manual',
        },
      ],
    } as any);

    return { client, cuid, admin, tenant, property, unit, lease: lease as any };
  };

  const makeRooms = (conditions: ConditionRating[]) =>
    conditions.map((c, i) => ({
      name: `Room ${i + 1}`,
      condition: ConditionRating.NA,
      items: [{ name: 'Walls', condition: c }, { name: 'Floor', condition: c }],
      media: [],
    }));

  // ─── Workflow Tests ─────────────────────────────────────────────────────

  describe('Move-in happy path', () => {
    it('should complete: schedule → update rooms → submit → approve', async () => {
      const { cuid, admin, tenant, lease } = await setupScenario();
      const adminId = admin._id.toString();

      // 1. Schedule
      const scheduleResult = await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_IN,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });

      expect(scheduleResult.success).toBe(true);
      const iuid = (scheduleResult.data as any).iuid;
      expect(iuid).toBeDefined();

      // Verify DB: status = scheduled, default rooms created
      let dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.SCHEDULED);
      expect(dbDoc!.rooms.length).toBe(4); // default rooms

      // 2. Update rooms (transitions to in_progress)
      const rooms = makeRooms([ConditionRating.EXCELLENT, ConditionRating.GOOD]);
      const updateResult = await inspectionService.updateInspection(
        cuid, adminId, 'admin', iuid, { rooms }
      );
      expect(updateResult.success).toBe(true);

      dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.IN_PROGRESS);
      expect(dbDoc!.rooms.length).toBe(2);

      // 3. Submit (computes conditionScore + overallCondition)
      const submitResult = await inspectionService.submitInspection(cuid, adminId, 'admin', iuid);
      expect(submitResult.success).toBe(true);

      dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.SUBMITTED);
      expect(dbDoc!.conditionScore).toBeDefined();
      expect(dbDoc!.conditionScore).toBeGreaterThan(0);
      expect(dbDoc!.overallCondition).toBeDefined();
      expect(dbDoc!.submittedAt).toBeDefined();

      // 4. Approve
      const approveResult = await inspectionService.approveInspection(cuid, iuid);
      expect(approveResult.success).toBe(true);

      dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.APPROVED);
      expect(dbDoc!.approvedAt).toBeDefined();
    });
  });

  describe('Move-out with refund', () => {
    it('should handle full workflow: schedule with refundDeposit → submit → approve with refundAmount', async () => {
      const { cuid, admin, lease } = await setupScenario();
      const adminId = admin._id.toString();

      // Schedule with refundDeposit
      const scheduleResult = await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_OUT,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        refundDeposit: true,
      });

      expect(scheduleResult.success).toBe(true);
      const iuid = (scheduleResult.data as any).iuid;

      // Verify refundInfo populated from lease security deposit
      let dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.refundInfo).toBeDefined();
      expect(dbDoc!.refundInfo!.amount).toBe(1500); // matches securityDeposit in setupScenario
      expect(dbDoc!.refundInfo!.isRefunded).toBe(false);

      // Update to in_progress
      await inspectionService.updateInspection(cuid, adminId, 'admin', iuid, {
        rooms: makeRooms([ConditionRating.FAIR]),
      });

      // Submit
      await inspectionService.submitInspection(cuid, adminId, 'admin', iuid);

      // Approve with partial refund
      const refundAmount = 800;
      const approveResult = await inspectionService.approveInspection(cuid, iuid, refundAmount);
      expect(approveResult.success).toBe(true);

      dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.APPROVED);
      expect(dbDoc!.refundInfo!.amount).toBe(refundAmount);
      expect(dbDoc!.refundInfo!.isRefunded).toBe(true);
    });
  });

  describe('Rejection + revision (move-in)', () => {
    it('should allow: submit → reject → update (clears rejection, back to in_progress) → resubmit', async () => {
      const { cuid, admin, tenant, lease } = await setupScenario();
      const adminId = admin._id.toString();

      // Schedule + update to in_progress + submit
      const scheduleResult = await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_IN,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });
      const iuid = (scheduleResult.data as any).iuid;

      await inspectionService.updateInspection(cuid, adminId, 'admin', iuid, {
        rooms: makeRooms([ConditionRating.POOR]),
      });
      await inspectionService.submitInspection(cuid, adminId, 'admin', iuid);

      // Reject
      const rejectResult = await inspectionService.rejectInspection(cuid, iuid, {
        text: 'Photos are blurry, please retake',
      });
      expect(rejectResult.success).toBe(true);
      expect(rejectResult.message).toContain('revise and resubmit');

      let dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.REJECTED);
      expect(dbDoc!.rejectionReason?.text).toBe('Photos are blurry, please retake');

      // Update (revision) — should go back to in_progress, clear rejection
      await inspectionService.updateInspection(cuid, adminId, 'admin', iuid, {
        rooms: makeRooms([ConditionRating.GOOD, ConditionRating.GOOD]),
      });

      dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.IN_PROGRESS);
      expect(dbDoc!.rejectionReason?.text).toBeFalsy();

      // Resubmit
      const resubmitResult = await inspectionService.submitInspection(cuid, adminId, 'admin', iuid);
      expect(resubmitResult.success).toBe(true);

      dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.SUBMITTED);
    });
  });

  describe('Dispute flow', () => {
    it('should complete: submit → dispute → approve with disputeNotes persisted', async () => {
      const { cuid, admin, tenant, lease } = await setupScenario();
      const adminId = admin._id.toString();
      const tenantId = tenant._id.toString();

      // Schedule + update + submit
      const scheduleResult = await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_IN,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });
      const iuid = (scheduleResult.data as any).iuid;

      await inspectionService.updateInspection(cuid, adminId, 'admin', iuid, {
        rooms: makeRooms([ConditionRating.POOR]),
      });
      await inspectionService.submitInspection(cuid, adminId, 'admin', iuid);

      // Tenant disputes
      const disputeResult = await inspectionService.disputeInspection(cuid, tenantId, iuid, {
        disputeNotes: { text: 'The kitchen damage was pre-existing' },
      });
      expect(disputeResult.success).toBe(true);

      let dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.DISPUTED);
      expect(dbDoc!.disputeNotes?.text).toBe('The kitchen damage was pre-existing');

      // Admin approves the disputed inspection
      const approveResult = await inspectionService.approveInspection(cuid, iuid);
      expect(approveResult.success).toBe(true);

      dbDoc = await Inspection.findOne({ iuid });
      expect(dbDoc!.status).toBe(InspectionStatus.APPROVED);
      // disputeNotes should still be persisted
      expect(dbDoc!.disputeNotes?.text).toBe('The kitchen damage was pre-existing');
    });
  });

  describe('Tenant scoping with real DB', () => {
    it('should return not-found when wrong tenant queries (query-level filter)', async () => {
      const { cuid, admin, tenant, lease } = await setupScenario();
      const adminId = admin._id.toString();
      const tenantId = tenant._id.toString();

      // Create a second tenant in the same client
      const otherTenant = await createTestUser(cuid, { roles: [ROLES.TENANT] });
      const otherTenantId = otherTenant._id.toString();

      // Schedule inspection for the first tenant
      const scheduleResult = await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_IN,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });
      const iuid = (scheduleResult.data as any).iuid;

      // Wrong tenant tries to GET → not found (query-level filter prevents data from loading)
      await expect(
        inspectionService.getInspection(cuid, otherTenantId, 'tenant', iuid)
      ).rejects.toThrow(/not found/i);

      // Correct tenant can GET
      const result = await inspectionService.getInspection(cuid, tenantId, 'tenant', iuid);
      expect(result.success).toBe(true);
      expect((result.data as any).iuid).toBe(iuid);

      // Admin can access any inspection without tenant filter
      const adminResult = await inspectionService.getInspection(cuid, adminId, 'admin', iuid);
      expect(adminResult.success).toBe(true);
      expect((adminResult.data as any).iuid).toBe(iuid);
    });
  });

  describe('Duplicate inspection guard', () => {
    it('should reject scheduling a second move-in inspection for the same lease', async () => {
      const { cuid, admin, lease } = await setupScenario();
      const adminId = admin._id.toString();

      // First schedule succeeds
      await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_IN,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });

      // Second schedule of same type for same lease should fail
      await expect(
        inspectionService.scheduleInspection(cuid, adminId, {
          type: InspectionType.MOVE_IN,
          leaseId: lease.luid,
          scheduledDate: new Date(Date.now() + 172800000).toISOString(),
        })
      ).rejects.toThrow(/move-in inspection already exists for this lease/);
    });

    it('should allow scheduling a move-out after a move-in exists', async () => {
      const { cuid, admin, lease } = await setupScenario();
      const adminId = admin._id.toString();

      // Schedule move-in
      await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_IN,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
      });

      // Schedule move-out — different type, should succeed
      const result = await inspectionService.scheduleInspection(cuid, adminId, {
        type: InspectionType.MOVE_OUT,
        leaseId: lease.luid,
        scheduledDate: new Date(Date.now() + 172800000).toISOString(),
      });

      expect(result.success).toBe(true);
    });
  });
});
