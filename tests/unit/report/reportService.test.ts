import { Types } from 'mongoose';
import { ReportService } from '@services/report/report.service';
import { REPORT_SECTIONS, ReportPeriod, ReportStatus } from '@interfaces/report.interface';

import {
  createReportService,
  mockQueueFactory,
  mockReportDAO,
  mockClientDAO,
  mockS3Service,
} from './__mocks__';

const CUID = 'TEST_CLIENT_001';
const USER_ID = new Types.ObjectId().toString();
const REPORT_ID = new Types.ObjectId().toString();
const CLIENT_ID = new Types.ObjectId().toString();

describe('ReportService', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    mockClientDAO.findFirst.mockResolvedValue({
      _id: new Types.ObjectId(CLIENT_ID),
      cuid: CUID,
      companyProfile: { tradingName: 'Test Company' },
    });
    mockReportDAO.createReport.mockResolvedValue({
      _id: new Types.ObjectId(REPORT_ID),
      cuid: CUID,
      status: ReportStatus.PENDING,
    });
    mockQueueFactory.getQueue.mockReturnValue({
      addReportJob: jest.fn().mockResolvedValue({ id: 'job-1' }),
    });
    service = createReportService();
  });

  // ─── requestReport ────────────────────────────────────────────────

  describe('requestReport', () => {
    it('should create a report record and enqueue a job', async () => {
      const result = await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
      });

      expect(result.success).toBe(true);
      expect(result.data.reportId).toBe(REPORT_ID);
      expect(result.data.status).toBe(ReportStatus.PENDING);
      expect(mockReportDAO.createReport).toHaveBeenCalledTimes(1);
      expect(mockQueueFactory.getQueue).toHaveBeenCalledWith('reportQueue');
    });

    it('should default sections to all when not provided', async () => {
      await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
      });

      expect(mockReportDAO.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: [...REPORT_SECTIONS],
        })
      );
    });

    it('should accept a subset of sections', async () => {
      await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
        sections: ['financial_overview', 'payment_analysis'],
      });

      expect(mockReportDAO.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          sections: ['financial_overview', 'payment_analysis'],
        })
      );
    });

    it('should pass email recipients through', async () => {
      await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
        emailRecipients: ['pm@test.com', 'investor@test.com'],
      });

      expect(mockReportDAO.createReport).toHaveBeenCalledWith(
        expect.objectContaining({
          emailRecipients: ['pm@test.com', 'investor@test.com'],
        })
      );
    });

    it('should use Types.ObjectId for requestedBy', async () => {
      await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
      });

      const createCall = mockReportDAO.createReport.mock.calls[0][0];
      expect(createCall.requestedBy).toBeInstanceOf(Types.ObjectId);
    });

    it('should throw NotFoundError if client does not exist', async () => {
      mockClientDAO.findFirst.mockResolvedValue(null);

      await expect(
        service.requestReport(CUID, USER_ID, { period: ReportPeriod.LAST_30_DAYS })
      ).rejects.toThrow(/Client not found/);
    });

    it('should resolve custom date range', async () => {
      await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.CUSTOM,
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-03-31T23:59:59Z',
      });

      const createCall = mockReportDAO.createReport.mock.calls[0][0];
      expect(createCall.startDate).toEqual(new Date('2026-01-01T00:00:00Z'));
      expect(createCall.endDate).toEqual(new Date('2026-03-31T23:59:59Z'));
    });

    it('should throw if custom period is missing dates', async () => {
      await expect(
        service.requestReport(CUID, USER_ID, { period: ReportPeriod.CUSTOM })
      ).rejects.toThrow(/startDate and endDate are required/);
    });

    it('should throw if custom period has invalid dates', async () => {
      await expect(
        service.requestReport(CUID, USER_ID, {
          period: ReportPeriod.CUSTOM,
          startDate: 'garbage',
          endDate: 'also-garbage',
        })
      ).rejects.toThrow(/Invalid startDate or endDate/);
    });

    it('should throw if startDate is after endDate', async () => {
      await expect(
        service.requestReport(CUID, USER_ID, {
          period: ReportPeriod.CUSTOM,
          startDate: '2026-06-01T00:00:00Z',
          endDate: '2026-01-01T00:00:00Z',
        })
      ).rejects.toThrow(/startDate must be before endDate/);
    });

    it('should include previous period dates in job data for trends', async () => {
      await service.requestReport(CUID, USER_ID, {
        period: ReportPeriod.LAST_30_DAYS,
      });

      const resolvedQueue = mockQueueFactory.getQueue.mock.results[0].value;
      const jobData = resolvedQueue.addReportJob.mock.calls[0][0];
      expect(jobData.prevStartDate).toBeDefined();
      expect(jobData.prevEndDate).toBeDefined();
      expect(jobData.prevEndDate.getTime()).toBeLessThan(jobData.startDate.getTime());
    });
  });

  // ─── getReportStatus ──────────────────────────────────────────────

  describe('getReportStatus', () => {
    it('should return status for a pending report', async () => {
      mockReportDAO.findById.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
        cuid: CUID,
        status: ReportStatus.PENDING,
        period: ReportPeriod.LAST_30_DAYS,
        startDate: new Date(),
        endDate: new Date(),
        sections: [...REPORT_SECTIONS],
        createdAt: new Date(),
      });

      const result = await service.getReportStatus(CUID, REPORT_ID);

      expect(result.success).toBe(true);
      expect(result.data.status).toBe(ReportStatus.PENDING);
      expect(result.data.presignedUrl).toBeUndefined();
      expect(mockS3Service.getSignedUrl).not.toHaveBeenCalled();
    });

    it('should generate presigned URL for completed report', async () => {
      mockReportDAO.findById.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
        cuid: CUID,
        status: ReportStatus.COMPLETED,
        period: ReportPeriod.LAST_30_DAYS,
        startDate: new Date(),
        endDate: new Date(),
        sections: [...REPORT_SECTIONS],
        createdAt: new Date(),
        completedAt: new Date(),
        file: { key: 'reports/test/report.pdf', filename: 'report.pdf' },
      });
      mockS3Service.getSignedUrl.mockResolvedValue('https://s3.example.com/signed-url');

      const result = await service.getReportStatus(CUID, REPORT_ID);

      expect(result.data.presignedUrl).toBe('https://s3.example.com/signed-url');
      expect(result.data.expiresAt).toBeDefined();
      expect(result.data.filename).toBe('report.pdf');
      expect(mockS3Service.getSignedUrl).toHaveBeenCalledWith('reports/test/report.pdf');
    });

    it('should throw NotFoundError if report does not exist', async () => {
      mockReportDAO.findById.mockResolvedValue(null);

      await expect(service.getReportStatus(CUID, REPORT_ID)).rejects.toThrow(/Report not found/);
    });

    it('should throw NotFoundError if report belongs to different client', async () => {
      mockReportDAO.findById.mockResolvedValue({
        _id: new Types.ObjectId(REPORT_ID),
        cuid: 'OTHER_CLIENT',
        status: ReportStatus.COMPLETED,
      });

      await expect(service.getReportStatus(CUID, REPORT_ID)).rejects.toThrow(/Report not found/);
    });
  });

  // ─── listReports ──────────────────────────────────────────────────

  describe('listReports', () => {
    it('should return paginated reports for client', async () => {
      mockReportDAO.listByClient.mockResolvedValue({
        items: [{ _id: REPORT_ID, status: ReportStatus.COMPLETED }],
        pagination: { hasMoreResource: false, currentPage: 1, totalPages: 1 },
      });

      const result = await service.listReports(CUID);

      expect(result.success).toBe(true);
      expect(result.data.reports).toHaveLength(1);
      expect(mockReportDAO.listByClient).toHaveBeenCalledWith(CUID, undefined);
    });
  });
});
