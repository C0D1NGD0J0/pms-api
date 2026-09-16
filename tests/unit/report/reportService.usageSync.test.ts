import { Types } from 'mongoose';
import { ReportStatus } from '@interfaces/report.interface';
import { ReportService } from '@services/report/report.service';

import {
  mockSubscriptionDAO,
  createReportService,
  mockRedisService,
  mockReportDAO,
  mockS3Service,
} from './__mocks__';

const CUID = 'TEST_CLIENT_001';

describe('ReportService — Usage Sync & Delete', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createReportService();
  });

  // ─── _syncUsageCounter ──────────────────────────────────────────

  describe('_syncUsageCounter', () => {
    it('should correct the counter when tracked count differs from actual', async () => {
      const periodStart = new Date('2026-09-01T00:00:00Z');
      mockSubscriptionDAO.findFirst.mockResolvedValue({
        planName: 'portfolio',
        reportGenerationUsage: { countThisPeriod: 0, periodStart },
      });
      mockReportDAO.countDocuments.mockResolvedValue(5);

      const result = await service._syncUsageCounter(CUID);

      expect(result).toBe(5);
      expect(mockSubscriptionDAO.setUsageFields).toHaveBeenCalledWith(
        { cuid: CUID },
        { 'reportGenerationUsage.countThisPeriod': 5 }
      );
    });

    it('should not update when counter matches actual count', async () => {
      const periodStart = new Date('2026-09-01T00:00:00Z');
      mockSubscriptionDAO.findFirst.mockResolvedValue({
        planName: 'portfolio',
        reportGenerationUsage: { countThisPeriod: 3, periodStart },
      });
      mockReportDAO.countDocuments.mockResolvedValue(3);

      const result = await service._syncUsageCounter(CUID);

      expect(result).toBe(3);
      expect(mockSubscriptionDAO.setUsageFields).not.toHaveBeenCalled();
    });

    it('should use subscription startDate when periodStart is missing', async () => {
      const subStartDate = new Date('2026-08-15T00:00:00Z');
      mockSubscriptionDAO.findFirst.mockResolvedValue({
        planName: 'portfolio',
        startDate: subStartDate,
        // no reportGenerationUsage at all
      });
      mockReportDAO.countDocuments.mockResolvedValue(2);

      const result = await service._syncUsageCounter(CUID);

      expect(result).toBe(2);
      expect(mockReportDAO.countDocuments).toHaveBeenCalledWith({
        cuid: CUID,
        createdAt: { $gte: subStartDate },
      });
      // Should also set periodStart since it was missing
      expect(mockSubscriptionDAO.setUsageFields).toHaveBeenCalledWith(
        { cuid: CUID },
        {
          'reportGenerationUsage.countThisPeriod': 2,
          'reportGenerationUsage.periodStart': subStartDate,
        }
      );
    });

    it('should return 0 when subscription not found', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue(null);

      const result = await service._syncUsageCounter(CUID);

      expect(result).toBe(0);
      expect(mockReportDAO.countDocuments).not.toHaveBeenCalled();
    });

    it('should return 0 and not throw on errors', async () => {
      mockSubscriptionDAO.findFirst.mockRejectedValue(new Error('DB error'));

      const result = await service._syncUsageCounter(CUID);

      expect(result).toBe(0);
    });
  });

  // ─── listReports (meta.usedThisMonth uses synced counter) ──────

  describe('listReports meta.usedThisMonth', () => {
    it('should reflect synced count in meta', async () => {
      mockSubscriptionDAO.findFirst.mockResolvedValue({
        planName: 'portfolio',
        reportGenerationUsage: { countThisPeriod: 0, periodStart: new Date() },
      });
      mockReportDAO.countDocuments.mockResolvedValue(4);
      mockReportDAO.listByClient.mockResolvedValue({
        items: [],
        pagination: { total: 4, perPage: 10, totalPages: 1, currentPage: 1 },
      });
      mockRedisService.client.ttl.mockResolvedValue(-2);

      const result = await service.listReports(CUID);

      expect(result.data.meta.usedThisMonth).toBe(4);
    });
  });

  // ─── deleteReport ──────────────────────────────────────────────

  describe('deleteReport', () => {
    const REPORT_ID = new Types.ObjectId().toString();

    it('should delete report from DB and S3', async () => {
      const s3Key = 'reports/test-report.pdf';
      mockReportDAO.findById.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
        cuid: CUID,
        status: ReportStatus.COMPLETED,
        file: { key: s3Key, filename: 'test-report.pdf' },
      });

      const result = await service.deleteReport(CUID, REPORT_ID);

      expect(result.success).toBe(true);
      expect(mockS3Service.deleteFile).toHaveBeenCalledWith(s3Key);
      expect(mockReportDAO.deleteItem).toHaveBeenCalledWith({
        _id: expect.any(Types.ObjectId),
      });
    });

    it('should delete from DB even when no S3 file exists', async () => {
      mockReportDAO.findById.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
        cuid: CUID,
        status: ReportStatus.FAILED,
        // no file property
      });

      const result = await service.deleteReport(CUID, REPORT_ID);

      expect(result.success).toBe(true);
      expect(mockS3Service.deleteFile).not.toHaveBeenCalled();
      expect(mockReportDAO.deleteItem).toHaveBeenCalled();
    });

    it('should still delete from DB if S3 deletion fails', async () => {
      mockReportDAO.findById.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
        cuid: CUID,
        status: ReportStatus.COMPLETED,
        file: { key: 'reports/test.pdf' },
      });
      mockS3Service.deleteFile.mockRejectedValue(new Error('S3 error'));

      const result = await service.deleteReport(CUID, REPORT_ID);

      expect(result.success).toBe(true);
      expect(mockReportDAO.deleteItem).toHaveBeenCalled();
    });

    it('should throw NotFoundError for wrong cuid', async () => {
      mockReportDAO.findById.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
        cuid: 'DIFFERENT_CLIENT',
        status: ReportStatus.COMPLETED,
      });

      await expect(service.deleteReport(CUID, REPORT_ID)).rejects.toThrow('Report not found');
    });

    it('should throw NotFoundError when report does not exist', async () => {
      mockReportDAO.findById.mockResolvedValue(null);

      await expect(service.deleteReport(CUID, REPORT_ID)).rejects.toThrow('Report not found');
    });
  });
});
