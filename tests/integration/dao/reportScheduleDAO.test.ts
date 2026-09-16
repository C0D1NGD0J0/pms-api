import { Types } from 'mongoose';
import { clearTestDatabase } from '@tests/helpers';
import { ReportScheduleDAO } from '@dao/reportScheduleDAO';
import { ReportSchedule as ReportScheduleModel } from '@models/index';
import { ScheduleFrequency, REPORT_SECTIONS } from '@interfaces/report.interface';

const BASE_CUID = 'TEST_CLIENT_001';
const USER_ID = new Types.ObjectId();

function makeSchedule(overrides: Record<string, any> = {}) {
  return {
    cuid: BASE_CUID,
    createdBy: USER_ID,
    frequency: ScheduleFrequency.MONTHLY,
    sections: [...REPORT_SECTIONS],
    emailRecipients: ['pm@example.com'],
    nextRunAt: new Date('2026-09-01T06:00:00Z'),
    isActive: true,
    ...overrides,
  };
}

describe('ReportScheduleDAO Integration Tests', () => {
  let dao: ReportScheduleDAO;

  beforeAll(async () => {
    dao = new ReportScheduleDAO({ reportScheduleModel: ReportScheduleModel });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('upsertSchedule', () => {
    it('should create a new schedule when none exists', async () => {
      const schedule = await dao.upsertSchedule(BASE_CUID, makeSchedule());

      expect(schedule._id).toBeDefined();
      expect(schedule.cuid).toBe(BASE_CUID);
      expect(schedule.frequency).toBe(ScheduleFrequency.MONTHLY);
      expect(schedule.sections).toHaveLength(REPORT_SECTIONS.length);
      expect(schedule.emailRecipients).toEqual(['pm@example.com']);
      expect(schedule.isActive).toBe(true);
      expect(schedule.nextRunAt).toEqual(new Date('2026-09-01T06:00:00Z'));
    });

    it('should update existing schedule for the same client', async () => {
      await dao.upsertSchedule(BASE_CUID, makeSchedule());

      const updated = await dao.upsertSchedule(
        BASE_CUID,
        makeSchedule({
          frequency: ScheduleFrequency.QUARTERLY,
          emailRecipients: ['pm@example.com', 'investor@example.com'],
        })
      );

      expect(updated.frequency).toBe(ScheduleFrequency.QUARTERLY);
      expect(updated.emailRecipients).toEqual(['pm@example.com', 'investor@example.com']);

      // Verify only one schedule exists for this client
      const found = await dao.getSchedule(BASE_CUID);
      expect(found!._id.toString()).toBe(updated._id.toString());
    });

    it('should reject invalid frequency enum', async () => {
      await expect(
        dao.upsertSchedule(BASE_CUID, makeSchedule({ frequency: 'weekly' }))
      ).rejects.toThrow();
    });

    it('should enforce email recipients max limit', async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => `user${i}@test.com`);
      await expect(
        dao.upsertSchedule(BASE_CUID, makeSchedule({ emailRecipients: tooMany }))
      ).rejects.toThrow();
    });

    it('should default sections to all when not provided', async () => {
      const { sections: _, ...data } = makeSchedule();
      const schedule = await dao.upsertSchedule(BASE_CUID, data);

      expect(schedule.sections).toHaveLength(REPORT_SECTIONS.length);
    });
  });

  describe('getSchedule', () => {
    it('should return schedule for client', async () => {
      await dao.upsertSchedule(BASE_CUID, makeSchedule());

      const found = await dao.getSchedule(BASE_CUID);

      expect(found).not.toBeNull();
      expect(found!.cuid).toBe(BASE_CUID);
    });

    it('should return null when no schedule exists', async () => {
      const found = await dao.getSchedule('NON_EXISTENT');

      expect(found).toBeNull();
    });
  });

  describe('deactivateSchedule', () => {
    it('should set isActive to false', async () => {
      await dao.upsertSchedule(BASE_CUID, makeSchedule());

      const deactivated = await dao.deactivateSchedule(BASE_CUID);

      expect(deactivated!.isActive).toBe(false);
    });
  });

  describe('getDueSchedules', () => {
    it('should return schedules where nextRunAt is in the past', async () => {
      await ReportScheduleModel.create([
        makeSchedule({ cuid: 'CLIENT_A', nextRunAt: new Date('2026-08-01T06:00:00Z') }),
        makeSchedule({ cuid: 'CLIENT_B', nextRunAt: new Date('2026-10-01T06:00:00Z') }),
      ]);

      const now = new Date('2026-09-01T06:00:00Z');
      const due = await dao.getDueSchedules(now);

      expect(due).toHaveLength(1);
      expect(due[0].cuid).toBe('CLIENT_A');
    });

    it('should exclude inactive schedules', async () => {
      await ReportScheduleModel.create([
        makeSchedule({ cuid: 'CLIENT_A', nextRunAt: new Date('2026-08-01'), isActive: false }),
        makeSchedule({ cuid: 'CLIENT_B', nextRunAt: new Date('2026-08-01'), isActive: true }),
      ]);

      const due = await dao.getDueSchedules(new Date('2026-09-01'));

      expect(due).toHaveLength(1);
      expect(due[0].cuid).toBe('CLIENT_B');
    });

    it('should return empty array when no schedules are due', async () => {
      await ReportScheduleModel.create(makeSchedule({ nextRunAt: new Date('2026-12-01') }));

      const due = await dao.getDueSchedules(new Date('2026-09-01'));

      expect(due).toHaveLength(0);
    });
  });

  describe('advanceNextRunAt', () => {
    it('should update nextRunAt for the given schedule', async () => {
      const schedule = await dao.upsertSchedule(BASE_CUID, makeSchedule());
      const newDate = new Date('2026-10-01T06:00:00Z');

      await dao.advanceNextRunAt(schedule._id.toString(), newDate);

      const updated = await dao.getSchedule(BASE_CUID);
      expect(updated!.nextRunAt).toEqual(newDate);
    });
  });
});
