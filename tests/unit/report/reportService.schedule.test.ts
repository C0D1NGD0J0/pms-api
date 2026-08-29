import { Types } from 'mongoose';
import { ReportService } from '@services/report/report.service';
import {
  ScheduleFrequency,
  REPORT_SECTIONS,
  ReportPeriod,
  ReportStatus,
} from '@interfaces/report.interface';

import {
  mockReportScheduleDAO,
  createReportService,
  mockReportQueue,
  mockReportDAO,
} from './__mocks__';

const CUID = 'TEST_CLIENT_001';
const USER_ID = new Types.ObjectId().toString();
const SCHEDULE_ID = new Types.ObjectId().toString();
const REPORT_ID = new Types.ObjectId().toString();

describe('ReportService — Schedule Management', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createReportService();
  });

  // ─── upsertSchedule ──────────────────────────────────────────────

  describe('upsertSchedule', () => {
    it('should create a schedule and return scheduleId', async () => {
      mockReportScheduleDAO.upsertSchedule.mockResolvedValue({
        _id: new Types.ObjectId(SCHEDULE_ID),
      });

      const result = await service.upsertSchedule(CUID, USER_ID, {
        frequency: ScheduleFrequency.MONTHLY,
      });

      expect(result.success).toBe(true);
      expect(result.data.scheduleId).toBe(SCHEDULE_ID);
      expect(mockReportScheduleDAO.upsertSchedule).toHaveBeenCalledTimes(1);
    });

    it('should default sections to all when not provided', async () => {
      mockReportScheduleDAO.upsertSchedule.mockResolvedValue({
        _id: new Types.ObjectId(SCHEDULE_ID),
      });

      await service.upsertSchedule(CUID, USER_ID, {
        frequency: ScheduleFrequency.MONTHLY,
      });

      expect(mockReportScheduleDAO.upsertSchedule).toHaveBeenCalledWith(
        CUID,
        expect.objectContaining({
          sections: [...REPORT_SECTIONS],
        })
      );
    });

    it('should compute nextRunAt for monthly schedule', async () => {
      mockReportScheduleDAO.upsertSchedule.mockResolvedValue({
        _id: new Types.ObjectId(SCHEDULE_ID),
      });

      await service.upsertSchedule(CUID, USER_ID, {
        frequency: ScheduleFrequency.MONTHLY,
      });

      const callData = mockReportScheduleDAO.upsertSchedule.mock.calls[0][1];
      const nextRunAt = callData.nextRunAt as Date;
      expect(nextRunAt.getDate()).toBe(1);
      expect(nextRunAt.getHours()).toBe(6);
    });

    it('should compute nextRunAt for quarterly schedule', async () => {
      mockReportScheduleDAO.upsertSchedule.mockResolvedValue({
        _id: new Types.ObjectId(SCHEDULE_ID),
      });

      await service.upsertSchedule(CUID, USER_ID, {
        frequency: ScheduleFrequency.QUARTERLY,
      });

      const callData = mockReportScheduleDAO.upsertSchedule.mock.calls[0][1];
      const nextRunAt = callData.nextRunAt as Date;
      const quarterStartMonths = [0, 3, 6, 9];
      expect(quarterStartMonths).toContain(nextRunAt.getMonth());
      expect(nextRunAt.getDate()).toBe(1);
    });

    it('should use Types.ObjectId for createdBy', async () => {
      mockReportScheduleDAO.upsertSchedule.mockResolvedValue({
        _id: new Types.ObjectId(SCHEDULE_ID),
      });

      await service.upsertSchedule(CUID, USER_ID, {
        frequency: ScheduleFrequency.MONTHLY,
      });

      const callData = mockReportScheduleDAO.upsertSchedule.mock.calls[0][1];
      expect(callData.createdBy).toBeInstanceOf(Types.ObjectId);
    });
  });

  // ─── getSchedule ─────────────────────────────────────────────────

  describe('getSchedule', () => {
    it('should return schedule for client', async () => {
      const schedule = {
        _id: SCHEDULE_ID,
        cuid: CUID,
        frequency: ScheduleFrequency.MONTHLY,
        isActive: true,
      };
      mockReportScheduleDAO.getSchedule.mockResolvedValue(schedule);

      const result = await service.getSchedule(CUID);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(schedule);
    });

    it('should return null when no schedule exists', async () => {
      mockReportScheduleDAO.getSchedule.mockResolvedValue(null);

      const result = await service.getSchedule(CUID);

      expect(result.success).toBe(true);
      expect(result.data).toBeNull();
    });
  });

  // ─── deactivateSchedule ──────────────────────────────────────────

  describe('deactivateSchedule', () => {
    it('should deactivate schedule', async () => {
      mockReportScheduleDAO.deactivateSchedule.mockResolvedValue({ isActive: false });

      const result = await service.deactivateSchedule(CUID);

      expect(result.success).toBe(true);
      expect(result.data.deactivated).toBe(true);
      expect(mockReportScheduleDAO.deactivateSchedule).toHaveBeenCalledWith(CUID);
    });
  });

  // ─── processScheduledReports (cron) ───────────────────────────────

  describe('processScheduledReports (cron)', () => {
    it('should enqueue reports for due schedules', async () => {
      const schedule = {
        _id: new Types.ObjectId(SCHEDULE_ID),
        cuid: CUID,
        createdBy: new Types.ObjectId(USER_ID),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: ['pm@test.com'],
        isActive: true,
        nextRunAt: new Date('2026-08-01'),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockReportDAO.createReport.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
      });
      mockReportQueue.addReportJob.mockResolvedValue({ id: 'job-1' });

      const cronJobs = service.getCronJobs();
      expect(cronJobs).toHaveLength(1);
      expect(cronJobs[0].name).toBe('report:scheduled-generation');

      await cronJobs[0].handler();

      expect(mockReportDAO.createReport).toHaveBeenCalledTimes(1);
      expect(mockReportDAO.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          cuid: CUID,
          status: ReportStatus.PENDING,
          period: ReportPeriod.LAST_30_DAYS,
          scheduledBy: schedule._id,
        })
      );
      expect(mockReportQueue.addReportJob).toHaveBeenCalledTimes(1);
      expect(mockReportScheduleDAO.advanceNextRunAt).toHaveBeenCalledTimes(1);
    });

    it('should use LAST_90_DAYS for quarterly schedules', async () => {
      const schedule = {
        _id: new Types.ObjectId(SCHEDULE_ID),
        cuid: CUID,
        createdBy: new Types.ObjectId(USER_ID),
        frequency: ScheduleFrequency.QUARTERLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        nextRunAt: new Date('2026-07-01'),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockReportDAO.createReport.mockResolvedValue({ _id: new Types.ObjectId() });

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportDAO.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          period: ReportPeriod.LAST_90_DAYS,
        })
      );
    });

    it('should skip and log errors for individual schedule failures', async () => {
      const schedule1 = {
        _id: new Types.ObjectId(),
        cuid: 'CLIENT_A',
        createdBy: new Types.ObjectId(),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        nextRunAt: new Date(),
      };
      const schedule2 = {
        _id: new Types.ObjectId(),
        cuid: 'CLIENT_B',
        createdBy: new Types.ObjectId(),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        nextRunAt: new Date(),
      };

      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule1, schedule2]);
      mockReportDAO.createReport
        .mockRejectedValueOnce(new Error('DB error'))
        .mockResolvedValueOnce({ _id: new Types.ObjectId() });

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportDAO.createReport).toHaveBeenCalledTimes(2);
      expect(mockReportQueue.addReportJob).toHaveBeenCalledTimes(1);
    });

    it('should do nothing when no schedules are due', async () => {
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([]);

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportDAO.createReport).not.toHaveBeenCalled();
      expect(mockReportQueue.addReportJob).not.toHaveBeenCalled();
    });
  });
});
