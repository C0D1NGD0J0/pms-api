import { Types } from 'mongoose';
import { clearTestDatabase } from '@tests/helpers';
import { InspectionDAO } from '@dao/inspectionDAO';
import { Inspection as InspectionModel } from '@models/index';
import { InspectionStatus, InspectionType } from '@interfaces/inspection.interface';

const BASE_CUID = 'TEST_CLIENT_001';

function makeInspection(overrides: Record<string, any> = {}) {
  return {
    cuid: BASE_CUID,
    propertyId: new Types.ObjectId(),
    tenantId: new Types.ObjectId(),
    inspectorId: new Types.ObjectId(),
    createdBy: new Types.ObjectId(),
    leaseId: new Types.ObjectId(),
    type: InspectionType.MOVE_IN,
    status: InspectionStatus.SCHEDULED,
    scheduledDate: new Date('2026-06-01'),
    media: [],
    rooms: [],
    ...overrides,
  };
}

describe('InspectionDAO Integration Tests', () => {
  let dao: InspectionDAO;

  beforeAll(async () => {
    dao = new InspectionDAO({ inspectionModel: InspectionModel });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('getStats', () => {
    it('should return zeroes for an empty collection', async () => {
      const stats = await dao.getStats(BASE_CUID);

      expect(stats.total).toBe(0);
      expect(stats.scheduled).toBe(0);
      expect(stats.inProgress).toBe(0);
      expect(stats.submitted).toBe(0);
      expect(stats.approved).toBe(0);
      expect(stats.rejected).toBe(0);
      expect(stats.disputed).toBe(0);
      expect(stats.cancelled).toBe(0);
      expect(stats.avgCompletionDays).toBe(0);
      expect(stats.byType).toEqual({});
    });

    it('should count inspections by status', async () => {
      await InspectionModel.create([
        makeInspection({ status: InspectionStatus.SCHEDULED }),
        makeInspection({ status: InspectionStatus.SCHEDULED }),
        makeInspection({ status: InspectionStatus.IN_PROGRESS }),
        makeInspection({ status: InspectionStatus.SUBMITTED }),
        makeInspection({ status: InspectionStatus.APPROVED, approvedAt: new Date() }),
        makeInspection({ status: InspectionStatus.APPROVED, approvedAt: new Date() }),
        makeInspection({ status: InspectionStatus.APPROVED, approvedAt: new Date() }),
        makeInspection({ status: InspectionStatus.REJECTED }),
        makeInspection({ status: InspectionStatus.CANCELLED }),
      ]);

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.total).toBe(9);
      expect(stats.scheduled).toBe(2);
      expect(stats.inProgress).toBe(1);
      expect(stats.submitted).toBe(1);
      expect(stats.approved).toBe(3);
      expect(stats.rejected).toBe(1);
      expect(stats.cancelled).toBe(1);
      expect(stats.disputed).toBe(0);
    });

    it('should group by inspection type', async () => {
      await InspectionModel.create([
        makeInspection({ type: InspectionType.MOVE_IN }),
        makeInspection({ type: InspectionType.MOVE_IN }),
        makeInspection({ type: InspectionType.MOVE_OUT }),
        makeInspection({ type: InspectionType.ROUTINE }),
      ]);

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.byType).toEqual({
        move_in: 2,
        move_out: 1,
        routine: 1,
      });
    });

    it('should calculate avgCompletionDays from scheduledDate to approvedAt', async () => {
      const scheduled = new Date('2026-06-01');
      const approvedAt = new Date('2026-06-04'); // 3 days later

      await InspectionModel.create([
        makeInspection({
          status: InspectionStatus.APPROVED,
          scheduledDate: scheduled,
          approvedAt,
        }),
        makeInspection({
          status: InspectionStatus.APPROVED,
          scheduledDate: new Date('2026-06-01'),
          approvedAt: new Date('2026-06-08'), // 7 days later
        }),
      ]);

      const stats = await dao.getStats(BASE_CUID);

      // avg of 3 and 7 = 5
      expect(stats.avgCompletionDays).toBe(5);
    });

    it('should isolate stats by cuid', async () => {
      await InspectionModel.create([
        makeInspection({ cuid: BASE_CUID }),
        makeInspection({ cuid: 'OTHER_CLIENT' }),
      ]);

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.total).toBe(1);
    });

    it('should exclude soft-deleted inspections', async () => {
      await InspectionModel.create([makeInspection(), makeInspection({ deletedAt: new Date() })]);

      const stats = await dao.getStats(BASE_CUID);

      expect(stats.total).toBe(1);
    });
  });
});
