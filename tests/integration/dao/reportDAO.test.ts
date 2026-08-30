import { Types } from 'mongoose';
import { ReportDAO } from '@dao/reportDAO';
import { clearTestDatabase } from '@tests/helpers';
import { Report as ReportModel } from '@models/index';
import { REPORT_SECTIONS, ReportPeriod, ReportStatus } from '@interfaces/report.interface';

const BASE_CUID = 'TEST_CLIENT_001';
const USER_ID = new Types.ObjectId();

function makeReport(overrides: Record<string, any> = {}) {
  return {
    cuid: BASE_CUID,
    requestedBy: USER_ID,
    period: ReportPeriod.LAST_30_DAYS,
    status: ReportStatus.PENDING,
    startDate: new Date('2026-07-01'),
    endDate: new Date('2026-07-31'),
    sections: [...REPORT_SECTIONS],
    emailRecipients: [],
    ...overrides,
  };
}

describe('ReportDAO Integration Tests', () => {
  let dao: ReportDAO;

  beforeAll(async () => {
    dao = new ReportDAO({ reportModel: ReportModel });
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  describe('createReport', () => {
    it('should create a report with default values', async () => {
      const report = await dao.createReport(makeReport());

      expect(report._id).toBeDefined();
      expect(report.cuid).toBe(BASE_CUID);
      expect(report.status).toBe(ReportStatus.PENDING);
      expect(report.period).toBe(ReportPeriod.LAST_30_DAYS);
      expect(report.sections).toHaveLength(REPORT_SECTIONS.length);
      expect(report.emailRecipients).toEqual([]);
      expect(report.file?.key).toBeUndefined();
      expect(report.completedAt).toBeUndefined();
      expect(report.failedReason).toBeUndefined();
    });

    it('should reject missing required fields', async () => {
      await expect(dao.createReport({ cuid: BASE_CUID })).rejects.toThrow();
    });

    it('should reject invalid period enum value', async () => {
      await expect(dao.createReport(makeReport({ period: 'invalid_period' }))).rejects.toThrow();
    });

    it('should reject invalid status enum value', async () => {
      await expect(dao.createReport(makeReport({ status: 'invalid_status' }))).rejects.toThrow();
    });

    it('should enforce email recipients max limit', async () => {
      const tooMany = Array.from({ length: 11 }, (_, i) => `user${i}@test.com`);
      await expect(dao.createReport(makeReport({ emailRecipients: tooMany }))).rejects.toThrow();
    });

    it('should allow up to 10 email recipients', async () => {
      const recipients = Array.from({ length: 10 }, (_, i) => `user${i}@test.com`);
      const report = await dao.createReport(makeReport({ emailRecipients: recipients }));

      expect(report.emailRecipients).toHaveLength(10);
    });

    it('should default sections to all when not provided', async () => {
      const { sections: _, ...data } = makeReport();
      const report = await dao.createReport(data);

      expect(report.sections).toHaveLength(REPORT_SECTIONS.length);
      expect(report.sections).toEqual(expect.arrayContaining([...REPORT_SECTIONS]));
    });

    it('should accept a subset of sections', async () => {
      const report = await dao.createReport(
        makeReport({ sections: ['financial_overview', 'payment_analysis'] })
      );

      expect(report.sections).toEqual(['financial_overview', 'payment_analysis']);
    });
  });

  describe('updateStatus', () => {
    it('should update status to processing', async () => {
      const report = await dao.createReport(makeReport());
      const updated = await dao.updateStatus(report._id.toString(), ReportStatus.PROCESSING);

      expect(updated!.status).toBe(ReportStatus.PROCESSING);
    });

    it('should update status to completed with file info', async () => {
      const report = await dao.createReport(makeReport());
      const fileData = {
        file: {
          url: 'https://s3.example.com/report.pdf',
          key: 'reports/test/report.pdf',
          filename: 'report-2026-07-31.pdf',
          size: 12345,
          mimeType: 'application/pdf',
          uploadedAt: new Date(),
        },
        completedAt: new Date(),
      };

      const updated = await dao.updateStatus(
        report._id.toString(),
        ReportStatus.COMPLETED,
        fileData
      );

      expect(updated!.status).toBe(ReportStatus.COMPLETED);
      expect(updated!.file!.key).toBe('reports/test/report.pdf');
      expect(updated!.file!.size).toBe(12345);
      expect(updated!.completedAt).toBeDefined();
    });

    it('should update status to failed with reason', async () => {
      const report = await dao.createReport(makeReport());
      const updated = await dao.updateStatus(report._id.toString(), ReportStatus.FAILED, {
        failedReason: 'PDF generation timed out',
      });

      expect(updated!.status).toBe(ReportStatus.FAILED);
      expect(updated!.failedReason).toBe('PDF generation timed out');
    });
  });

  describe('listByClient', () => {
    it('should return empty list for client with no reports', async () => {
      const result = await dao.listByClient(BASE_CUID);

      expect(result.items).toHaveLength(0);
    });

    it('should return reports for the given client only', async () => {
      await ReportModel.create([makeReport(), makeReport(), makeReport({ cuid: 'OTHER_CLIENT' })]);

      const result = await dao.listByClient(BASE_CUID);

      expect(result.items).toHaveLength(2);
      result.items.forEach((r: any) => expect(r.cuid).toBe(BASE_CUID));
    });

    it('should order by createdAt descending', async () => {
      await ReportModel.create([
        makeReport({ startDate: new Date('2026-01-01'), endDate: new Date('2026-01-31') }),
        makeReport({ startDate: new Date('2026-03-01'), endDate: new Date('2026-03-31') }),
        makeReport({ startDate: new Date('2026-02-01'), endDate: new Date('2026-02-28') }),
      ]);

      const result = await dao.listByClient(BASE_CUID);

      // Most recently created should be first
      const dates = result.items.map((r: any) => r.createdAt.getTime());
      expect(dates).toEqual([...dates].sort((a, b) => b - a));
    });

    it('should exclude file field from list results', async () => {
      const report = await dao.createReport(makeReport());
      await dao.updateStatus(report._id.toString(), ReportStatus.COMPLETED, {
        file: {
          url: 'https://s3.example.com/report.pdf',
          key: 'reports/test/report.pdf',
          filename: 'report.pdf',
          size: 999,
          mimeType: 'application/pdf',
          uploadedAt: new Date(),
        },
      });

      const result = await dao.listByClient(BASE_CUID);

      expect(result.items[0].file?.key).toBeUndefined();
    });

    it('should filter by status when provided', async () => {
      await ReportModel.create([
        makeReport({ status: ReportStatus.COMPLETED }),
        makeReport({ status: ReportStatus.COMPLETED }),
        makeReport({ status: ReportStatus.PENDING }),
        makeReport({ status: ReportStatus.FAILED }),
      ]);

      const result = await dao.listByClient(BASE_CUID, { status: ReportStatus.COMPLETED });

      expect(result.items).toHaveLength(2);
      result.items.forEach((r: any) => expect(r.status).toBe(ReportStatus.COMPLETED));
    });

    it('should return all statuses when status filter is not provided', async () => {
      await ReportModel.create([
        makeReport({ status: ReportStatus.COMPLETED }),
        makeReport({ status: ReportStatus.PENDING }),
        makeReport({ status: ReportStatus.FAILED }),
      ]);

      const result = await dao.listByClient(BASE_CUID);

      expect(result.items).toHaveLength(3);
    });

    it('should apply pagination with status filter', async () => {
      await ReportModel.create([
        makeReport({ status: ReportStatus.COMPLETED }),
        makeReport({ status: ReportStatus.COMPLETED }),
        makeReport({ status: ReportStatus.COMPLETED }),
      ]);

      const result = await dao.listByClient(BASE_CUID, {
        status: ReportStatus.COMPLETED,
        limit: 2,
      });

      expect(result.items).toHaveLength(2);
    });
  });

  describe('findById', () => {
    it('should return report by id', async () => {
      const report = await dao.createReport(makeReport());
      const found = await dao.findById(report._id.toString());

      expect(found).not.toBeNull();
      expect(found!.cuid).toBe(BASE_CUID);
      expect(found!.period).toBe(ReportPeriod.LAST_30_DAYS);
    });

    it('should return null for non-existent id', async () => {
      const found = await dao.findById(new Types.ObjectId().toString());

      expect(found).toBeNull();
    });
  });
});
