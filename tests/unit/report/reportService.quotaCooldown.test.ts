import { Types } from 'mongoose';
import { ReportService } from '@services/report/report.service';
import { ReportPeriod, ReportStatus } from '@interfaces/report.interface';

import {
  mockSubscriptionPlanConfig,
  mockSubscriptionDAO,
  createReportService,
  mockRedisService,
  mockReportDAO,
  mockClientDAO,
} from './__mocks__';

const CUID = 'TEST_CLIENT_001';
const USER_ID = new Types.ObjectId().toString();

describe('ReportService — Quota & Cooldown', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createReportService();

    // Default mocks for happy path
    mockClientDAO.findFirst.mockResolvedValue({ cuid: CUID, companyProfile: {} });
    mockReportDAO.createReport.mockResolvedValue({
      _id: new Types.ObjectId(),
      cuid: CUID,
      status: ReportStatus.PENDING,
    });
  });

  // ─── Cooldown ────────────────────────────────────────────────────

  describe('cooldown', () => {
    it('should reject request when cooldown key exists', async () => {
      mockRedisService.client.get.mockResolvedValue('1');

      await expect(
        service.requestReport(CUID, USER_ID, { period: ReportPeriod.LAST_30_DAYS })
      ).rejects.toThrow('Please wait before generating another report');
    });

    it('should allow request when cooldown key does not exist', async () => {
      mockRedisService.client.get.mockResolvedValue(null);
      mockReportDAO.getMonthlyCount.mockResolvedValue(0);

      const result = await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
      });

      expect(result.success).toBe(true);
    });

    it('should set cooldown key after successful request', async () => {
      mockRedisService.client.get.mockResolvedValue(null);
      mockReportDAO.getMonthlyCount.mockResolvedValue(0);

      await service.requestReport(CUID, USER_ID, { period: ReportPeriod.LAST_30_DAYS });

      expect(mockRedisService.client.set).toHaveBeenCalledWith(
        expect.stringContaining('report-cooldown:'),
        '1',
        expect.objectContaining({ EX: 900 })
      );
    });

    it('should fail open when Redis is down (cooldown check)', async () => {
      mockRedisService.client.get.mockRejectedValue(new Error('Redis connection refused'));
      mockReportDAO.getMonthlyCount.mockResolvedValue(0);

      const result = await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
      });

      expect(result.success).toBe(true);
    });
  });

  // ─── Monthly Quota ───────────────────────────────────────────────

  describe('monthly quota (atomic)', () => {
    it('should reject when monthly limit reached', async () => {
      mockRedisService.client.get.mockResolvedValue(null); // cooldown clear
      // incrementUsageCounterIfUnder returns null when at/over limit
      mockSubscriptionDAO.incrementUsageCounterIfUnder.mockResolvedValue(null);

      await expect(
        service.requestReport(CUID, USER_ID, { period: ReportPeriod.LAST_30_DAYS })
      ).rejects.toThrow('Monthly report limit reached');
    });

    it('should allow when under quota', async () => {
      mockRedisService.client.get.mockResolvedValue(null);
      mockSubscriptionDAO.incrementUsageCounterIfUnder.mockResolvedValue({
        planName: 'portfolio',
        reportGenerationUsage: { countThisPeriod: 4 },
      });

      const result = await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
      });

      expect(result.success).toBe(true);
    });

    it('should atomically check and increment usage', async () => {
      mockRedisService.client.get.mockResolvedValue(null);
      mockSubscriptionDAO.incrementUsageCounterIfUnder.mockResolvedValue({
        planName: 'portfolio',
        reportGenerationUsage: { countThisPeriod: 1 },
      });

      await service.requestReport(CUID, USER_ID, { period: ReportPeriod.LAST_30_DAYS });

      expect(mockSubscriptionDAO.incrementUsageCounterIfUnder).toHaveBeenCalledWith(
        CUID,
        'reportGenerationUsage.countThisPeriod',
        10
      );
    });
  });

  // ─── Plan-based section/email limits ─────────────────────────────

  describe('plan limits', () => {
    it('should reject when sections exceed plan limit', async () => {
      mockSubscriptionPlanConfig.getReportLimits.mockReturnValue({
        maxReportsPerMonth: 10,
        maxReportSections: 3,
        maxReportEmails: 10,
      });

      await expect(
        service.requestReport(CUID, USER_ID, {
          period: ReportPeriod.LAST_30_DAYS,
          sections: [
            'executive_summary',
            'financial_overview',
            'payment_analysis',
            'maintenance',
            'expenses',
          ],
        })
      ).rejects.toThrow('Your plan allows up to 3 report sections');
    });

    it('should reject when email recipients exceed plan limit', async () => {
      mockSubscriptionPlanConfig.getReportLimits.mockReturnValue({
        maxReportsPerMonth: 10,
        maxReportSections: 9,
        maxReportEmails: 3,
      });

      await expect(
        service.requestReport(CUID, USER_ID, {
          period: ReportPeriod.LAST_30_DAYS,
          emailRecipients: ['a@t.com', 'b@t.com', 'c@t.com', 'd@t.com'],
        })
      ).rejects.toThrow('Your plan allows up to 3 email recipients');
    });

    it('should allow sections within plan limit', async () => {
      mockSubscriptionPlanConfig.getReportLimits.mockReturnValue({
        maxReportsPerMonth: 10,
        maxReportSections: 3,
        maxReportEmails: 10,
      });
      mockRedisService.client.get.mockResolvedValue(null);
      mockReportDAO.getMonthlyCount.mockResolvedValue(0);

      const result = await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
        sections: ['executive_summary', 'financial_overview', 'payment_analysis'],
      });

      expect(result.success).toBe(true);
    });
  });
});
