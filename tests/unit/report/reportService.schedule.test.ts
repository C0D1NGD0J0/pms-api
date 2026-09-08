import { Types } from 'mongoose';
import { ReportService } from '@services/report/report.service';
import {
  ScheduleFrequency,
  REPORT_SECTIONS,
  ReportPeriod,
  ReportStatus,
} from '@interfaces/report.interface';

import {
  mockSubscriptionPlanConfig,
  mockReportScheduleDAO,
  mockSubscriptionDAO,
  createReportService,
  mockQueueFactory,
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
      mockQueueFactory.getQueue.mockReturnValue({
        addReportJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      });

      const cronJobs = service.getCronJobs();
      expect(cronJobs).toHaveLength(2);
      expect(cronJobs[0].name).toBe('report:scheduled-generation');
      expect(cronJobs[1].name).toBe('report:monthly-usage-reset');

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
      expect(mockQueueFactory.getQueue).toHaveBeenCalledWith('reportQueue');
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
      expect(mockQueueFactory.getQueue).toHaveBeenCalledWith('reportQueue');
    });

    it('should do nothing when no schedules are due', async () => {
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([]);

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportDAO.createReport).not.toHaveBeenCalled();
      expect(mockQueueFactory.getQueue).not.toHaveBeenCalled();
    });

    // ─── Guard: Orphan cleanup ────────────────────────────────────

    it('should deactivate schedule when subscription is missing', async () => {
      const schedule = {
        _id: new Types.ObjectId(),
        cuid: 'ORPHAN_CLIENT',
        createdBy: new Types.ObjectId(),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        consecutiveUnviewedCount: 0,
        nextRunAt: new Date(),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockSubscriptionDAO.findFirst.mockResolvedValueOnce(null);

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportScheduleDAO.deactivateSchedule).toHaveBeenCalledWith(
        'ORPHAN_CLIENT',
        'orphaned'
      );
      expect(mockReportDAO.createReport).not.toHaveBeenCalled();
    });

    it('should deactivate schedule when subscription is inactive', async () => {
      const schedule = {
        _id: new Types.ObjectId(),
        cuid: 'INACTIVE_CLIENT',
        createdBy: new Types.ObjectId(),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        consecutiveUnviewedCount: 0,
        nextRunAt: new Date(),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockSubscriptionDAO.findFirst.mockResolvedValueOnce({
        planName: 'portfolio',
        status: 'inactive',
      });

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportScheduleDAO.deactivateSchedule).toHaveBeenCalledWith(
        'INACTIVE_CLIENT',
        'orphaned'
      );
      expect(mockReportDAO.createReport).not.toHaveBeenCalled();
    });

    // ─── Guard: Feature check ─────────────────────────────────────

    it('should deactivate schedule when plan lacks reportingAnalytics', async () => {
      const schedule = {
        _id: new Types.ObjectId(),
        cuid: 'DOWNGRADED_CLIENT',
        createdBy: new Types.ObjectId(),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        consecutiveUnviewedCount: 0,
        nextRunAt: new Date(),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockSubscriptionDAO.findFirst.mockResolvedValueOnce({
        planName: 'essential',
        status: 'active',
      });
      mockSubscriptionPlanConfig.hasFeature.mockReturnValueOnce(false);

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportScheduleDAO.deactivateSchedule).toHaveBeenCalledWith(
        'DOWNGRADED_CLIENT',
        'plan_downgraded'
      );
      expect(mockReportDAO.createReport).not.toHaveBeenCalled();
    });

    // ─── Guard: Quota ─────────────────────────────────────────────

    it('should skip when monthly quota is reached', async () => {
      const schedule = {
        _id: new Types.ObjectId(),
        cuid: CUID,
        createdBy: new Types.ObjectId(),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        consecutiveUnviewedCount: 0,
        nextRunAt: new Date(),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockSubscriptionDAO.incrementUsageCounterIfUnder.mockResolvedValueOnce(null);

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportDAO.createReport).not.toHaveBeenCalled();
      // Should NOT deactivate — quota resets next billing cycle
      expect(mockReportScheduleDAO.deactivateSchedule).not.toHaveBeenCalled();
    });

    // ─── Guard: Unviewed ──────────────────────────────────────────

    it('should pause schedule after 3 consecutive unviewed reports', async () => {
      const schedule = {
        _id: new Types.ObjectId(),
        cuid: 'STALE_CLIENT',
        createdBy: new Types.ObjectId(),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        consecutiveUnviewedCount: 3,
        nextRunAt: new Date(),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportScheduleDAO.deactivateSchedule).toHaveBeenCalledWith(
        'STALE_CLIENT',
        'unviewed_reports'
      );
      expect(mockReportDAO.createReport).not.toHaveBeenCalled();
    });

    it('should increment unviewed count after enqueuing scheduled report', async () => {
      const schedule = {
        _id: new Types.ObjectId(SCHEDULE_ID),
        cuid: CUID,
        createdBy: new Types.ObjectId(USER_ID),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        consecutiveUnviewedCount: 1,
        nextRunAt: new Date(),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockReportDAO.createReport.mockResolvedValue({ _id: new Types.ObjectId() });
      mockQueueFactory.getQueue.mockReturnValue({
        addReportJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      });

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportScheduleDAO.incrementUnviewedCount).toHaveBeenCalledWith(CUID);
    });

    it('should allow schedule with unviewed count under threshold', async () => {
      const schedule = {
        _id: new Types.ObjectId(SCHEDULE_ID),
        cuid: CUID,
        createdBy: new Types.ObjectId(USER_ID),
        frequency: ScheduleFrequency.MONTHLY,
        sections: [...REPORT_SECTIONS],
        emailRecipients: [],
        isActive: true,
        consecutiveUnviewedCount: 2,
        nextRunAt: new Date(),
      };
      mockReportScheduleDAO.getDueSchedules.mockResolvedValue([schedule]);
      mockReportDAO.createReport.mockResolvedValue({ _id: new Types.ObjectId() });
      mockQueueFactory.getQueue.mockReturnValue({
        addReportJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
      });

      const cronJobs = service.getCronJobs();
      await cronJobs[0].handler();

      expect(mockReportDAO.createReport).toHaveBeenCalledTimes(1);
      expect(mockReportScheduleDAO.deactivateSchedule).not.toHaveBeenCalled();
    });
  });
});
