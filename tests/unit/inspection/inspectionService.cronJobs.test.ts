import { Types } from 'mongoose';
import { jest } from '@jest/globals';
import { getSystemBotUserId } from '@utils/systemBot';
import { InspectionService } from '@services/inspection/inspection.service';
import { InspectionStatus, InspectionType } from '@interfaces/inspection.interface';

// The auto-close note is authored by the system bot (notes.authorId must be a user ObjectId)
jest.mock('@utils/systemBot', () => ({ getSystemBotUserId: jest.fn() }));
const SYSTEM_BOT_ID = new Types.ObjectId();

// ─── Mock DAOs & External Services ──────────────────────────────────────────

const mockInspectionDAO = {
  getByIuid: jest.fn() as any,
  listByClient: jest.fn() as any,
  listForTenant: jest.fn() as any,
  insert: jest.fn() as any,
  updateById: jest.fn() as any,
  update: jest.fn() as any,
  archiveDocument: jest.fn() as any,
  list: jest.fn() as any,
  findFirst: jest.fn() as any,
};

const mockLeaseDAO = {
  findFirst: jest.fn() as any,
  list: jest.fn() as any,
};

const mockPropertyDAO = {
  findFirst: jest.fn() as any,
  updateById: jest.fn() as any,
};

const mockPropertyUnitDAO = {
  findFirst: jest.fn() as any,
  findById: jest.fn() as any,
  updateById: jest.fn() as any,
};

const mockUserDAO = {
  findFirst: jest.fn() as any,
};

const mockEmitterService = {
  emit: jest.fn() as any,
  on: jest.fn() as any,
};

const mockPaymentDAO = {
  findFirst: jest.fn() as any,
};

const mockNotificationService = {
  createNotification: jest.fn() as any,
};

const mockEmailQueue = {
  addToEmailQueue: jest.fn() as any,
} as any;

// ─── Helpers ────────────────────────────────────────────────────────────────

const CUID = 'test-client-cuid';
const INSPECTOR_UID = 'insp-uid-abc123';

const makeStaleInspection = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  iuid: `insp-${Math.random().toString(36).slice(2, 8)}`,
  cuid: CUID,
  type: InspectionType.MOVE_OUT,
  status: InspectionStatus.PENDING_REVIEW,
  tenantId: new Types.ObjectId(),
  inspectorUid: INSPECTOR_UID,
  inspectorId: new Types.ObjectId(),
  propertyId: new Types.ObjectId(),
  propertyUnitId: undefined,
  leaseId: new Types.ObjectId(),
  createdBy: new Types.ObjectId(),
  scheduledDate: new Date('2026-07-01'),
  updatedAt: new Date('2026-07-20'), // >7 days ago
  rooms: [],
  media: [],
  refundInfo: undefined,
  previousOperationalStatus: undefined,
  ...overrides,
});

const makeExpiredScheduledInspection = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  iuid: `insp-${Math.random().toString(36).slice(2, 8)}`,
  cuid: CUID,
  type: InspectionType.MOVE_IN,
  status: InspectionStatus.SCHEDULED,
  tenantId: new Types.ObjectId(),
  inspectorUid: INSPECTOR_UID,
  inspectorId: new Types.ObjectId(),
  propertyId: new Types.ObjectId(),
  propertyUnitId: undefined,
  leaseId: new Types.ObjectId(),
  createdBy: new Types.ObjectId(),
  scheduledDate: new Date('2026-07-01'), // >7 days ago
  rooms: [],
  media: [],
  previousOperationalStatus: undefined,
  ...overrides,
});

// ─── Service + Cron Handler Setup ───────────────────────────────────────────

let service: InspectionService;
let autoCloseHandler: () => Promise<void>;
let autoCancelHandler: () => Promise<void>;

beforeEach(() => {
  jest.clearAllMocks();

  service = new InspectionService({
    inspectionDAO: mockInspectionDAO as any,
    propertyUnitDAO: mockPropertyUnitDAO as any,
    leaseDAO: mockLeaseDAO as any,
    propertyDAO: mockPropertyDAO as any,
    userDAO: mockUserDAO as any,
    emitterService: mockEmitterService as any,
    notificationService: mockNotificationService as any,
    paymentDAO: mockPaymentDAO as any,
    emailQueue: mockEmailQueue,
    s3Service: { getSignedUrl: jest.fn(), uploadFiles: jest.fn() } as any,
  });

  // Extract handlers from getCronJobs — avoids calling private methods directly
  const cronJobs = service.getCronJobs();
  const autoCloseJob = cronJobs.find((j) => j.name === 'inspection:auto-close-unresponsive');
  const autoCancelJob = cronJobs.find((j) => j.name === 'inspection:auto-cancel-expired-scheduled');

  autoCloseHandler = autoCloseJob!.handler as () => Promise<void>;
  autoCancelHandler = autoCancelJob!.handler as () => Promise<void>;
});

// ═══════════════════════════════════════════════════════════════════════════════
// autoCloseUnresponsiveInspections
// ═══════════════════════════════════════════════════════════════════════════════

describe('InspectionService Cron Jobs', () => {
  describe('autoCloseUnresponsiveInspections', () => {
    beforeEach(() => {
      (getSystemBotUserId as unknown as jest.Mock<any>).mockReturnValue(
        Promise.resolve(SYSTEM_BOT_ID)
      );
    });

    it('should do nothing when no stale inspections are found', async () => {
      mockInspectionDAO.list.mockResolvedValue({ items: [], total: 0 });

      await autoCloseHandler();

      expect(mockInspectionDAO.list).toHaveBeenCalledTimes(1);
      expect(mockInspectionDAO.updateById).not.toHaveBeenCalled();
      expect(mockEmitterService.emit).not.toHaveBeenCalled();
    });

    it('should query for PENDING_REVIEW move-out inspections older than 7 days', async () => {
      mockInspectionDAO.list.mockResolvedValue({ items: [], total: 0 });

      await autoCloseHandler();

      expect(mockInspectionDAO.list).toHaveBeenCalledWith(
        expect.objectContaining({
          type: InspectionType.MOVE_OUT,
          status: InspectionStatus.PENDING_REVIEW,
          updatedAt: expect.objectContaining({ $lte: expect.any(Date) }),
          deletedAt: null,
        }),
        { limit: 200 }
      );
    });

    it('should set status to APPROVED and add a system note', async () => {
      const inspection = makeStaleInspection();
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCloseHandler();

      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(inspection._id.toString(), {
        $set: expect.objectContaining({
          status: InspectionStatus.APPROVED,
          approvedAt: expect.any(Date),
        }),
        $push: {
          notes: expect.objectContaining({
            note: expect.stringContaining('Auto-closed'),
            author: 'System',
            authorId: SYSTEM_BOT_ID,
            timestamp: expect.any(Date),
          }),
        },
      });
    });

    it('should still close the inspection, without a note, when the system bot is not seeded', async () => {
      (getSystemBotUserId as unknown as jest.Mock<any>).mockReturnValue(Promise.resolve(null));
      const inspection = makeStaleInspection();
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCloseHandler();

      const update = (mockInspectionDAO.updateById as any).mock.calls[0][1];
      expect(update.$set).toEqual(expect.objectContaining({ status: InspectionStatus.APPROVED }));
      expect(update).not.toHaveProperty('$push');
    });

    it('should approve with the PM-proposed refund — never forfeit by default', async () => {
      const inspection = makeStaleInspection({
        refundInfo: { amount: 1500, proposedRefund: 1200, currency: 'USD', isRefunded: false },
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCloseHandler();

      const update = mockInspectionDAO.updateById.mock.calls[0][1];
      expect(update.$set.status).toBe(InspectionStatus.APPROVED);
      expect(update.$set).not.toHaveProperty('refundInfo.isRefunded');
      expect(update.$push.notes.note).not.toMatch(/forfeit/i);
      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        'inspection:approved',
        expect.objectContaining({ refundAmount: 1200, depositAmount: 1500, currency: 'USD' })
      );
    });

    it('should honour an explicit 0 proposed refund', async () => {
      const inspection = makeStaleInspection({
        refundInfo: { amount: 1500, proposedRefund: 0, currency: 'USD', isRefunded: false },
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCloseHandler();

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        'inspection:approved',
        expect.objectContaining({ refundAmount: 0 })
      );
    });

    describe('deposit without a proposed refund', () => {
      const managerId = new Types.ObjectId();
      const makeUndecided = () =>
        makeStaleInspection({
          refundInfo: { amount: 1500, currency: 'USD', isRefunded: false },
        });

      beforeEach(() => {
        mockPropertyDAO.findFirst.mockResolvedValue({ managedBy: managerId });
      });

      it('does not approve the inspection or emit INSPECTION_APPROVED', async () => {
        const inspection = makeUndecided();
        mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

        await autoCloseHandler();

        const update = mockInspectionDAO.updateById.mock.calls[0][1];
        expect(update.$set).not.toHaveProperty('status');
        expect(update.$set).not.toHaveProperty('refundInfo.isRefunded');
        expect(update.$push.notes.note).toMatch(/no deposit refund amount has been proposed/);
        expect(mockEmitterService.emit).not.toHaveBeenCalled();
      });

      it('notifies the property manager to decide the refund', async () => {
        const inspection = makeUndecided();
        mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

        await autoCloseHandler();

        expect(mockNotificationService.createNotification).toHaveBeenCalledWith(
          CUID,
          'inspection',
          expect.objectContaining({
            recipient: managerId.toString(),
            title: 'Deposit Refund Decision Needed',
            actionUrl: `/inspections/${CUID}/${inspection.iuid}`,
          })
        );
      });
    });

    it('should not set refundInfo.isRefunded when refundInfo is absent', async () => {
      const inspection = makeStaleInspection({ refundInfo: undefined });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCloseHandler();

      const updateCall = mockInspectionDAO.updateById.mock.calls[0][1];
      expect(updateCall.$set).not.toHaveProperty('refundInfo.isRefunded');
    });

    it('should revert unit status from MAINTENANCE when previousOperationalStatus exists', async () => {
      const unitId = new Types.ObjectId();
      const inspection = makeStaleInspection({
        propertyUnitId: unitId,
        previousOperationalStatus: 'occupied',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });
      mockPropertyUnitDAO.findFirst.mockResolvedValue({ _id: unitId, status: 'maintenance' });

      await autoCloseHandler();

      expect(mockPropertyUnitDAO.findFirst).toHaveBeenCalledWith({ _id: unitId });
      expect(mockPropertyUnitDAO.updateById).toHaveBeenCalledWith(unitId.toString(), {
        status: 'occupied',
      });
    });

    it('should revert property status from maintenance when no unit and previousOperationalStatus exists', async () => {
      const propertyId = new Types.ObjectId();
      const inspection = makeStaleInspection({
        propertyId,
        propertyUnitId: undefined,
        previousOperationalStatus: 'occupied',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });
      mockPropertyDAO.findFirst.mockResolvedValue({
        _id: propertyId,
        operationalStatus: 'maintenance',
      });

      await autoCloseHandler();

      expect(mockPropertyDAO.findFirst).toHaveBeenCalledWith({ _id: propertyId });
      expect(mockPropertyDAO.updateById).toHaveBeenCalledWith(propertyId.toString(), {
        operationalStatus: 'occupied',
      });
    });

    it('should not revert unit status if it is no longer MAINTENANCE', async () => {
      const unitId = new Types.ObjectId();
      const inspection = makeStaleInspection({
        propertyUnitId: unitId,
        previousOperationalStatus: 'occupied',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });
      mockPropertyUnitDAO.findFirst.mockResolvedValue({ _id: unitId, status: 'occupied' });

      await autoCloseHandler();

      expect(mockPropertyUnitDAO.updateById).not.toHaveBeenCalled();
    });

    it('should not revert property status if it is no longer maintenance', async () => {
      const propertyId = new Types.ObjectId();
      const inspection = makeStaleInspection({
        propertyId,
        propertyUnitId: undefined,
        previousOperationalStatus: 'occupied',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });
      mockPropertyDAO.findFirst.mockResolvedValue({
        _id: propertyId,
        operationalStatus: 'available',
      });

      await autoCloseHandler();

      expect(mockPropertyDAO.updateById).not.toHaveBeenCalled();
    });

    it('should emit INSPECTION_APPROVED event with refund data when refundInfo exists', async () => {
      const inspection = makeStaleInspection({
        refundInfo: { amount: 2000, proposedRefund: 1500, isRefunded: false },
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCloseHandler();

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        'inspection:approved',
        expect.objectContaining({
          iuid: inspection.iuid,
          cuid: inspection.cuid,
          refundAmount: 1500,
          depositAmount: 2000,
        })
      );
    });

    it('should emit INSPECTION_APPROVED event without refund data when no refundInfo', async () => {
      const inspection = makeStaleInspection({ refundInfo: undefined });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCloseHandler();

      const emitCall = mockEmitterService.emit.mock.calls[0][1];
      expect(emitCall).not.toHaveProperty('refundAmount');
      expect(emitCall).not.toHaveProperty('depositAmount');
    });

    it('should process multiple inspections in a single run', async () => {
      const inspections = [makeStaleInspection(), makeStaleInspection(), makeStaleInspection()];
      mockInspectionDAO.list.mockResolvedValue({ items: inspections, total: 3 });

      await autoCloseHandler();

      expect(mockInspectionDAO.updateById).toHaveBeenCalledTimes(3);
      expect(mockEmitterService.emit).toHaveBeenCalledTimes(3);
    });

    it('should continue processing remaining inspections when one fails', async () => {
      const inspections = [makeStaleInspection(), makeStaleInspection(), makeStaleInspection()];
      mockInspectionDAO.list.mockResolvedValue({ items: inspections, total: 3 });

      // Second inspection update fails
      mockInspectionDAO.updateById
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB write error'))
        .mockResolvedValueOnce({});

      await autoCloseHandler();

      // All three attempted, 1st and 3rd succeed
      expect(mockInspectionDAO.updateById).toHaveBeenCalledTimes(3);
      // Only 2 events emitted (the failed one is skipped)
      expect(mockEmitterService.emit).toHaveBeenCalledTimes(2);
    });

    it('should not throw when the outer try/catch catches a DAO list error', async () => {
      mockInspectionDAO.list.mockRejectedValue(new Error('Connection timeout'));

      // Should not throw — error is caught internally
      await expect(autoCloseHandler()).resolves.toBeUndefined();
    });

    it('should request a batch limit of 200', async () => {
      mockInspectionDAO.list.mockResolvedValue({ items: [], total: 0 });

      await autoCloseHandler();

      expect(mockInspectionDAO.list).toHaveBeenCalledWith(expect.any(Object), { limit: 200 });
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════════
  // autoCancelExpiredScheduledInspections
  // ═══════════════════════════════════════════════════════════════════════════════

  describe('autoCancelExpiredScheduledInspections', () => {
    it('should do nothing when no expired inspections are found', async () => {
      mockInspectionDAO.list.mockResolvedValue({ items: [], total: 0 });

      await autoCancelHandler();

      expect(mockInspectionDAO.list).toHaveBeenCalledTimes(1);
      expect(mockInspectionDAO.updateById).not.toHaveBeenCalled();
      expect(mockEmitterService.emit).not.toHaveBeenCalled();
    });

    it('should query for SCHEDULED inspections with scheduledDate older than 7 days', async () => {
      mockInspectionDAO.list.mockResolvedValue({ items: [], total: 0 });

      await autoCancelHandler();

      expect(mockInspectionDAO.list).toHaveBeenCalledWith(
        expect.objectContaining({
          status: InspectionStatus.SCHEDULED,
          scheduledDate: expect.objectContaining({ $lte: expect.any(Date) }),
          deletedAt: null,
        }),
        { limit: 200 }
      );
    });

    it('should set status to CANCELLED and add a system note', async () => {
      const inspection = makeExpiredScheduledInspection();
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCancelHandler();

      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(inspection._id.toString(), {
        $set: expect.objectContaining({
          status: InspectionStatus.CANCELLED,
        }),
        $push: {
          notes: expect.objectContaining({
            note: expect.stringContaining('Auto-cancelled'),
            author: 'System',
            authorId: inspection.createdBy,
            timestamp: expect.any(Date),
          }),
        },
      });
    });

    it('should clear previousOperationalStatus in the update when it exists', async () => {
      const inspection = makeExpiredScheduledInspection({
        previousOperationalStatus: 'occupied',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });
      mockPropertyUnitDAO.findById.mockResolvedValue(null);

      await autoCancelHandler();

      expect(mockInspectionDAO.updateById).toHaveBeenCalledWith(
        inspection._id.toString(),
        expect.objectContaining({
          $unset: { previousOperationalStatus: 1 },
        })
      );
    });

    it('should revert unit status from MAINTENANCE when previousOperationalStatus exists', async () => {
      const unitId = new Types.ObjectId();
      const inspection = makeExpiredScheduledInspection({
        propertyUnitId: unitId,
        previousOperationalStatus: 'available',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });
      mockPropertyUnitDAO.findById.mockResolvedValue({ _id: unitId, status: 'maintenance' });

      await autoCancelHandler();

      expect(mockPropertyUnitDAO.findById).toHaveBeenCalled();
      expect(mockPropertyUnitDAO.updateById).toHaveBeenCalledWith(expect.any(String), {
        status: 'available',
      });
    });

    it('should not revert unit status if it is no longer MAINTENANCE', async () => {
      const unitId = new Types.ObjectId();
      const inspection = makeExpiredScheduledInspection({
        propertyUnitId: unitId,
        previousOperationalStatus: 'available',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });
      mockPropertyUnitDAO.findById.mockResolvedValue({ _id: unitId, status: 'occupied' });

      await autoCancelHandler();

      expect(mockPropertyUnitDAO.updateById).not.toHaveBeenCalled();
    });

    it('should revert property status when no unit and previousOperationalStatus exists', async () => {
      const propertyId = new Types.ObjectId();
      const inspection = makeExpiredScheduledInspection({
        propertyId,
        propertyUnitId: undefined,
        previousOperationalStatus: 'available',
      });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCancelHandler();

      expect(mockPropertyDAO.updateById).toHaveBeenCalledWith(expect.any(String), {
        operationalStatus: 'available',
      });
    });

    it('should not revert any status when previousOperationalStatus is absent', async () => {
      const inspection = makeExpiredScheduledInspection({ previousOperationalStatus: undefined });
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCancelHandler();

      expect(mockPropertyUnitDAO.findById).not.toHaveBeenCalled();
      expect(mockPropertyUnitDAO.updateById).not.toHaveBeenCalled();
      expect(mockPropertyDAO.updateById).not.toHaveBeenCalled();
    });

    it('should emit INSPECTION_CANCELLED event for each cancelled inspection', async () => {
      const inspection = makeExpiredScheduledInspection();
      mockInspectionDAO.list.mockResolvedValue({ items: [inspection], total: 1 });

      await autoCancelHandler();

      expect(mockEmitterService.emit).toHaveBeenCalledWith(
        'inspection:cancelled',
        expect.objectContaining({
          iuid: inspection.iuid,
          cuid: inspection.cuid,
          type: inspection.type,
        })
      );
    });

    it('should process multiple expired inspections in a single run', async () => {
      const inspections = [makeExpiredScheduledInspection(), makeExpiredScheduledInspection()];
      mockInspectionDAO.list.mockResolvedValue({ items: inspections, total: 2 });

      await autoCancelHandler();

      expect(mockInspectionDAO.updateById).toHaveBeenCalledTimes(2);
      expect(mockEmitterService.emit).toHaveBeenCalledTimes(2);
    });

    it('should continue processing remaining inspections when one fails', async () => {
      const inspections = [
        makeExpiredScheduledInspection(),
        makeExpiredScheduledInspection(),
        makeExpiredScheduledInspection(),
      ];
      mockInspectionDAO.list.mockResolvedValue({ items: inspections, total: 3 });

      mockInspectionDAO.updateById
        .mockResolvedValueOnce({})
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({});

      await autoCancelHandler();

      expect(mockInspectionDAO.updateById).toHaveBeenCalledTimes(3);
      // Only 2 events emitted — the failed one is skipped
      expect(mockEmitterService.emit).toHaveBeenCalledTimes(2);
    });

    it('should not throw when the outer try/catch catches a DAO list error', async () => {
      mockInspectionDAO.list.mockRejectedValue(new Error('Connection timeout'));

      await expect(autoCancelHandler()).resolves.toBeUndefined();
    });

    it('should request a batch limit of 200', async () => {
      mockInspectionDAO.list.mockResolvedValue({ items: [], total: 0 });

      await autoCancelHandler();

      expect(mockInspectionDAO.list).toHaveBeenCalledWith(expect.any(Object), { limit: 200 });
    });
  });
});
