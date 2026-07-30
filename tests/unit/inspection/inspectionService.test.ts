import { Types } from 'mongoose';
import { jest } from '@jest/globals';
import { InspectionService } from '@services/inspection/inspection.service';
import {
  InspectionStatus,
  ConditionRating,
  InspectionType,
} from '@interfaces/inspection.interface';

// ─── Mock DAOs & External Services ──────────────────────────────────────────

const mockInspectionDAO = {
  getByIuid: jest.fn() as any,
  listByClient: jest.fn() as any,
  listForTenant: jest.fn() as any,
  insert: jest.fn() as any,
  updateById: jest.fn() as any,
  archiveDocument: jest.fn() as any,
  list: jest.fn() as any,
  findFirst: jest.fn() as any,
};

const mockLeaseDAO = {
  findFirst: jest.fn() as any,
};

const mockPropertyDAO = {
  findFirst: jest.fn() as any,
};

const mockUserDAO = {
  findFirst: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
  on: jest.fn() as any,
};

const mockEmailQueue = {
  addToEmailQueue: jest.fn() as any,
} as any;

const CUID = 'test-client-cuid';
const USER_ID = new Types.ObjectId().toString();
const TENANT_ID = new Types.ObjectId().toString();
const IUID = 'insp-abc123';

const makeInspection = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  iuid: IUID,
  cuid: CUID,
  type: InspectionType.MOVE_IN,
  status: InspectionStatus.SCHEDULED,
  tenantId: new Types.ObjectId(TENANT_ID),
  inspectorId: new Types.ObjectId(USER_ID),
  propertyId: new Types.ObjectId(),
  leaseId: new Types.ObjectId(),
  scheduledDate: new Date(),
  rooms: [],
  media: [],
  ...overrides,
});

const makeRooms = (conditions: ConditionRating[]) =>
  conditions.map((c, i) => ({
    name: `Room ${i}`,
    condition: ConditionRating.NA,
    items: [{ name: 'Item', condition: c, notes: '' }],
    media: [],
  }));

let service: InspectionService;

beforeEach(() => {
  jest.clearAllMocks();

  service = new InspectionService({
    inspectionDAO: mockInspectionDAO as any,
    leaseDAO: mockLeaseDAO as any,
    propertyDAO: mockPropertyDAO as any,
    userDAO: mockUserDAO as any,
    emitterService: mockEmitterService as any,
    emailQueue: mockEmailQueue,
  });
});

describe('InspectionService', () => {
  describe('State Machine Transitions', () => {
    it('should allow scheduled → in_progress (via updateInspection)', async () => {
      const inspection = makeInspection({ status: InspectionStatus.SCHEDULED });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.IN_PROGRESS,
      });

      const result = await service.updateInspection(CUID, USER_ID, 'admin', IUID, {
        overallNotes: { text: 'Starting inspection' },
      });

      expect(result.success).toBe(true);
      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
        inspection._id.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: InspectionStatus.IN_PROGRESS }),
        })
      );
    });

    it('should allow in_progress → submitted', async () => {
      const inspection = makeInspection({ status: InspectionStatus.IN_PROGRESS });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.SUBMITTED,
      });

      const result = await service.submitInspection(CUID, USER_ID, 'admin', IUID);

      expect(result.success).toBe(true);
      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
        inspection._id.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: InspectionStatus.SUBMITTED }),
        })
      );
    });

    it('should allow submitted → approved', async () => {
      const inspection = makeInspection({ status: InspectionStatus.SUBMITTED });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.APPROVED,
      });

      const result = await service.approveInspection(CUID, IUID);

      expect(result.success).toBe(true);
      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
        inspection._id.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({ status: InspectionStatus.APPROVED }),
        })
      );
    });

    it('should reject transition from approved → any status', async () => {
      const inspection = makeInspection({ status: InspectionStatus.APPROVED });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      // Try to cancel an approved inspection
      await expect(service.cancelInspection(CUID, IUID)).rejects.toThrow(
        /Cannot transition from approved to cancelled/
      );
    });

    it('should reject transition from cancelled → any status', async () => {
      const inspection = makeInspection({ status: InspectionStatus.CANCELLED });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      // Cannot submit a cancelled inspection
      await expect(service.submitInspection(CUID, USER_ID, 'admin', IUID)).rejects.toThrow(
        /Cannot transition from cancelled to submitted/
      );
    });

    it('should allow rejected move-in → in_progress (revision)', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.REJECTED,
        type: InspectionType.MOVE_IN,
        rejectionReason: { text: 'Missing photos' },
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.IN_PROGRESS,
        rejectionReason: null,
      });

      const result = await service.updateInspection(CUID, TENANT_ID, 'tenant', IUID, {
        rooms: makeRooms([ConditionRating.GOOD]),
      });

      expect(result.success).toBe(true);
      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
        inspection._id.toString(),
        expect.objectContaining({
          $set: expect.objectContaining({
            status: InspectionStatus.IN_PROGRESS,
            rejectionReason: null,
          }),
        })
      );
    });

    it('should block updating a rejected move-out inspection (final)', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.REJECTED,
        type: InspectionType.MOVE_OUT,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      await expect(
        service.updateInspection(CUID, USER_ID, 'admin', IUID, {
          overallNotes: { text: 'Trying to update' },
        })
      ).rejects.toThrow(/Cannot update inspection in status: rejected/);
    });

    it('should allow disputed → approved', async () => {
      const inspection = makeInspection({ status: InspectionStatus.DISPUTED });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.APPROVED,
      });

      const result = await service.approveInspection(CUID, IUID);

      expect(result.success).toBe(true);
    });
  });

  // ─── Tenant Scoping Tests ──────────────────────────────────────────────────

  describe('Tenant Scoping', () => {
    it('should allow a tenant to GET their own inspection', async () => {
      const inspection = makeInspection({ tenantId: new Types.ObjectId(TENANT_ID) });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      const result = await service.getInspection(CUID, TENANT_ID, 'tenant', IUID);

      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      // Verify tenantId passed to DAO for query-level filtering
      expect(mockInspectionDAO.getByIuid).toHaveBeenCalledWith(IUID, CUID, TENANT_ID);
    });

    it("should return not-found when tenant queries another tenant's inspection (query-level filter)", async () => {
      // DAO returns null because tenantId filter doesn't match
      mockInspectionDAO.getByIuid.mockResolvedValue(null);

      await expect(service.getInspection(CUID, TENANT_ID, 'tenant', IUID)).rejects.toThrow(
        /not found/i
      );

      expect(mockInspectionDAO.getByIuid).toHaveBeenCalledWith(IUID, CUID, TENANT_ID);
    });

    it('should not pass tenantId filter for admin users', async () => {
      const inspection = makeInspection();
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      await service.getInspection(CUID, USER_ID, 'admin', IUID);

      expect(mockInspectionDAO.getByIuid).toHaveBeenCalledWith(IUID, CUID, undefined);
    });

    it('should deny a tenant from updating a move-out inspection', async () => {
      const inspection = makeInspection({
        tenantId: new Types.ObjectId(TENANT_ID),
        type: InspectionType.MOVE_OUT,
        status: InspectionStatus.IN_PROGRESS,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      await expect(
        service.updateInspection(CUID, TENANT_ID, 'tenant', IUID, {
          overallNotes: { text: 'Trying' },
        })
      ).rejects.toThrow(/Tenants can only update move-in inspections/);

      expect(mockInspectionDAO.getByIuid).toHaveBeenCalledWith(IUID, CUID, TENANT_ID);
    });

    it('should allow tenant to update their own move-in inspection', async () => {
      const inspection = makeInspection({
        tenantId: new Types.ObjectId(TENANT_ID),
        type: InspectionType.MOVE_IN,
        status: InspectionStatus.IN_PROGRESS,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue(inspection);

      const result = await service.updateInspection(CUID, TENANT_ID, 'tenant', IUID, {
        rooms: makeRooms([ConditionRating.GOOD]),
      });

      expect(result.success).toBe(true);
      expect(mockInspectionDAO.getByIuid).toHaveBeenCalledWith(IUID, CUID, TENANT_ID);
    });
  });

  // ─── Condition Scoring Tests ──────────────────────────────────────────────

  describe('Condition Scoring', () => {
    it('should compute score 100 and overallCondition excellent for all excellent items', async () => {
      const rooms = makeRooms([
        ConditionRating.EXCELLENT,
        ConditionRating.EXCELLENT,
        ConditionRating.EXCELLENT,
      ]);
      const inspection = makeInspection({
        status: InspectionStatus.IN_PROGRESS,
        rooms,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockImplementation((_id: string, update: any) => {
        return Promise.resolve({ ...inspection, ...update.$set });
      });

      await service.submitInspection(CUID, USER_ID, 'admin', IUID);

      const updateCall = mockInspectionDAO.updateById.mock.calls[0];
      const setFields = updateCall[1].$set;
      expect(setFields.conditionScore).toBe(100);
      expect(setFields.overallCondition).toBe(ConditionRating.EXCELLENT);
    });

    it('should compute correct proportional score for mixed ratings', async () => {
      // excellent=4, good=3, poor=1 → avg = 8/3 ≈ 2.67 → score = (2.67/4)*100 ≈ 67
      // avg 2.67 → >= 2.5 → GOOD
      const rooms = makeRooms([
        ConditionRating.EXCELLENT,
        ConditionRating.GOOD,
        ConditionRating.POOR,
      ]);
      const inspection = makeInspection({
        status: InspectionStatus.IN_PROGRESS,
        rooms,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockImplementation((_id: string, update: any) => {
        return Promise.resolve({ ...inspection, ...update.$set });
      });

      await service.submitInspection(CUID, USER_ID, 'admin', IUID);

      const setFields = mockInspectionDAO.updateById.mock.calls[0][1].$set;
      expect(setFields.conditionScore).toBe(67); // Math.round((8/3/4)*100)
      expect(setFields.overallCondition).toBe(ConditionRating.GOOD);
    });

    it('should compute score 0 and overallCondition NA for all NA items', async () => {
      const rooms = makeRooms([ConditionRating.NA, ConditionRating.NA, ConditionRating.NA]);
      const inspection = makeInspection({
        status: InspectionStatus.IN_PROGRESS,
        rooms,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockImplementation((_id: string, update: any) => {
        return Promise.resolve({ ...inspection, ...update.$set });
      });

      await service.submitInspection(CUID, USER_ID, 'admin', IUID);

      const setFields = mockInspectionDAO.updateById.mock.calls[0][1].$set;
      expect(setFields.conditionScore).toBe(0);
      expect(setFields.overallCondition).toBe(ConditionRating.NA);
    });
  });

  // ─── Refund Validation Tests ──────────────────────────────────────────────

  describe('Refund Validation', () => {
    it('should throw 400 when refundAmount provided but no refundInfo on inspection', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.SUBMITTED,
        type: InspectionType.MOVE_OUT,
        refundInfo: undefined,
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      await expect(service.approveInspection(CUID, IUID, 500)).rejects.toThrow(
        /does not have a security deposit to refund/
      );
    });

    it('should throw 400 when refundAmount exceeds deposit', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.SUBMITTED,
        type: InspectionType.MOVE_OUT,
        refundInfo: { amount: 1000, isRefunded: false },
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);

      await expect(service.approveInspection(CUID, IUID, 1500)).rejects.toThrow(
        /Refund amount cannot exceed deposit amount/
      );
    });

    it('should set isRefunded = false when refundAmount is 0', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.SUBMITTED,
        type: InspectionType.MOVE_OUT,
        refundInfo: { amount: 1000, isRefunded: false },
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.APPROVED,
      });

      await service.approveInspection(CUID, IUID, 0);

      const setFields = mockInspectionDAO.updateById.mock.calls[0][1].$set;
      expect(setFields['refundInfo.isRefunded']).toBe(false);
      expect(setFields['refundInfo.amount']).toBe(0);
    });

    it('should set isRefunded = true when refundAmount > 0', async () => {
      const inspection = makeInspection({
        status: InspectionStatus.SUBMITTED,
        type: InspectionType.MOVE_OUT,
        refundInfo: { amount: 1000, isRefunded: false },
      });
      mockInspectionDAO.getByIuid.mockResolvedValue(inspection);
      mockInspectionDAO.updateById.mockResolvedValue({
        ...inspection,
        status: InspectionStatus.APPROVED,
      });

      await service.approveInspection(CUID, IUID, 750);

      const setFields = mockInspectionDAO.updateById.mock.calls[0][1].$set;
      expect(setFields['refundInfo.isRefunded']).toBe(true);
      expect(setFields['refundInfo.amount']).toBe(750);
    });
  });

  // ─── Scheduling Tests ─────────────────────────────────────────────────────

  describe('Scheduling', () => {
    const makeActiveLease = () => ({
      _id: new Types.ObjectId(),
      luid: 'lease-123',
      cuid: CUID,
      status: 'active',
      tenantId: new Types.ObjectId(TENANT_ID),
      property: { id: new Types.ObjectId() },
      fees: { securityDeposit: 1500 },
    });

    it('should reject scheduling a duplicate inspection of the same type for the same lease', async () => {
      const lease = makeActiveLease();
      mockLeaseDAO.findFirst.mockResolvedValue(lease);
      mockInspectionDAO.findFirst.mockResolvedValue({
        iuid: 'existing-insp',
        status: InspectionStatus.SCHEDULED,
      });

      await expect(
        service.scheduleInspection(CUID, USER_ID, {
          type: InspectionType.MOVE_IN,
          leaseId: 'lease-123',
          scheduledDate: new Date().toISOString(),
        })
      ).rejects.toThrow(/move-in inspection already exists for this lease/);
    });

    it('should allow scheduling when the only existing inspection of the same type is cancelled', async () => {
      const lease = makeActiveLease();
      const property = { _id: lease.property.id, cuid: CUID };
      mockLeaseDAO.findFirst.mockResolvedValue(lease);
      mockInspectionDAO.findFirst.mockResolvedValue(null); // no non-cancelled match
      mockPropertyDAO.findFirst.mockResolvedValue(property);
      mockInspectionDAO.insert.mockImplementation((data: any) =>
        Promise.resolve({ ...data, iuid: IUID })
      );

      const result = await service.scheduleInspection(CUID, USER_ID, {
        type: InspectionType.MOVE_IN,
        leaseId: 'lease-123',
        scheduledDate: new Date().toISOString(),
      });

      expect(result.success).toBe(true);
    });

    it('should use DEFAULT_INSPECTION_ROOMS when no rooms provided', async () => {
      const lease = makeActiveLease();
      const property = { _id: lease.property.id, cuid: CUID };
      mockLeaseDAO.findFirst.mockResolvedValue(lease);
      mockPropertyDAO.findFirst.mockResolvedValue(property);
      mockInspectionDAO.findFirst.mockResolvedValue(null); // no duplicate
      mockInspectionDAO.insert.mockImplementation((data: any) =>
        Promise.resolve({ ...data, iuid: IUID })
      );

      await service.scheduleInspection(CUID, USER_ID, {
        type: InspectionType.MOVE_IN,
        leaseId: 'lease-123',
        scheduledDate: new Date().toISOString(),
      });

      const insertData = mockInspectionDAO.insert.mock.calls[0][0];
      // Default rooms have 4 entries: Living Room, Kitchen, Bathroom, Bedroom
      expect(insertData.rooms).toHaveLength(4);
      expect(insertData.rooms[0].name).toBe('Living Room');
    });

    it('should throw 404 when inspectorId provided but user not found', async () => {
      const lease = makeActiveLease();
      const property = { _id: lease.property.id, cuid: CUID };
      mockLeaseDAO.findFirst.mockResolvedValue(lease);
      mockInspectionDAO.findFirst.mockResolvedValue(null); // no duplicate
      mockPropertyDAO.findFirst.mockResolvedValue(property);
      mockUserDAO.findFirst.mockResolvedValue(null);

      await expect(
        service.scheduleInspection(CUID, USER_ID, {
          type: InspectionType.MOVE_IN,
          leaseId: 'lease-123',
          scheduledDate: new Date().toISOString(),
          inspectorId: new Types.ObjectId().toString(),
        })
      ).rejects.toThrow(/Inspector not found/);
    });
  });

  // ─── Lease Termination Handler Tests ──────────────────────────────────────

  describe('handleLeaseTerminated', () => {
    const leaseId = new Types.ObjectId().toString();

    it('should cancel all open inspections when a lease is terminated', async () => {
      const openInspections = [
        makeInspection({ status: InspectionStatus.SCHEDULED, iuid: 'insp-1' }),
        makeInspection({ status: InspectionStatus.IN_PROGRESS, iuid: 'insp-2' }),
      ];

      mockInspectionDAO.list.mockResolvedValue({
        items: openInspections,
        pagination: { total: 2, page: 1, pages: 1, limit: 50 },
      });
      mockInspectionDAO.updateById.mockResolvedValue({});

      // Trigger the event handler directly
      const handler = mockEmitterService.on.mock.calls.find(
        (call: any[]) => call[0] === 'lease:terminated'
      )?.[1];
      expect(handler).toBeDefined();

      await handler({
        leaseId,
        cuid: CUID,
        luid: 'lease-123',
        tenantId: TENANT_ID,
        propertyId: new Types.ObjectId().toString(),
        terminationDate: new Date(),
        terminationReason: 'Ended',
        terminatedBy: USER_ID,
      });

      expect(mockInspectionDAO.updateById).toHaveBeenCalledTimes(2);
      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
        openInspections[0]._id.toString(),
        expect.objectContaining({ $set: { status: InspectionStatus.CANCELLED } })
      );
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        'inspection:cancelled',
        expect.objectContaining({ iuid: 'insp-1' })
      );
    });

    it('should not cancel already approved or cancelled inspections', async () => {
      mockInspectionDAO.list.mockResolvedValue({
        items: [],
        pagination: { total: 0, page: 1, pages: 1, limit: 50 },
      });

      const handler = mockEmitterService.on.mock.calls.find(
        (call: any[]) => call[0] === 'lease:terminated'
      )?.[1];

      await handler({
        leaseId,
        cuid: CUID,
        luid: 'lease-123',
        tenantId: TENANT_ID,
        propertyId: new Types.ObjectId().toString(),
        terminationDate: new Date(),
        terminationReason: 'Ended',
        terminatedBy: USER_ID,
      });

      expect(mockInspectionDAO.updateById).not.toHaveBeenCalled();
    });
  });
});
