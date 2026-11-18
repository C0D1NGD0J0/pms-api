import { Types } from 'mongoose';
import { ReportService } from '@services/report/report.service';
import { ReportPeriod, ReportStatus } from '@interfaces/report.interface';

// Template rendering is covered by reportTemplates.test.ts — stub it here so this
// test focuses purely on the _processReport orchestration.
jest.mock('ejs', () => ({
  __esModule: true,
  default: { renderFile: jest.fn().mockResolvedValue('<html>report</html>') },
  renderFile: jest.fn().mockResolvedValue('<html>report</html>'),
}));

// Avoid S3 in loadBrandConfig — return a minimal brand so no white-label is applied.
jest.mock('@branding/index', () => ({
  loadBrandConfig: jest
    .fn()
    .mockResolvedValue({ identity: {}, colors: {}, radius: {}, typography: {} }),
  toEmailBrandContext: jest.fn().mockReturnValue({
    appName: 'Test Co',
    primaryColor: '#111111',
    accentColor: '#222222',
  }),
}));

import {
  createReportService,
  mockReportDAO,
  mockClientDAO,
  mockPdfGeneratorService,
  mockS3Service,
  mockSseService,
  mockEmailQueue,
  mockReportAnalysisAIService,
} from './__mocks__';

const CUID = 'TEST_CLIENT_001';
const USER_ID = new Types.ObjectId().toString();
const REPORT_ID = new Types.ObjectId().toString();

function makeJob(overrides: Record<string, any> = {}) {
  const now = new Date();
  const prev = new Date(now.getTime() - 30 * 24 * 3600 * 1000);
  return {
    data: {
      reportId: REPORT_ID,
      cuid: CUID,
      userId: USER_ID,
      period: ReportPeriod.LAST_30_DAYS,
      startDate: prev,
      endDate: now,
      prevStartDate: new Date(prev.getTime() - 30 * 24 * 3600 * 1000),
      prevEndDate: prev,
      propertyId: undefined,
      sections: ['executive_summary'],
      emailRecipients: ['owner@example.com'],
      ...overrides,
    },
    progress: jest.fn().mockResolvedValue(undefined),
  } as any;
}

describe('ReportService._processReport (end-to-end orchestration)', () => {
  let service: ReportService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = createReportService();

    mockClientDAO.findFirst.mockResolvedValue({
      _id: new Types.ObjectId(),
      cuid: CUID,
      displayName: 'Test Co',
      companyProfile: { tradingName: 'Test Co' },
    });
    mockReportAnalysisAIService.analyzeReport.mockResolvedValue({
      ok: false,
      reason: 'feature_disabled',
    });
    mockReportDAO.findById.mockResolvedValue({ _id: REPORT_ID, scheduledBy: null });
    mockS3Service.uploadBuffer.mockResolvedValue({
      url: 'https://s3/report.pdf',
      key: 'reports/report|||x|||_1.pdf',
    });
    mockS3Service.getSignedUrl.mockResolvedValue('https://signed/report.pdf');
  });

  it('runs the full chain: PROCESSING → PDF → S3 → COMPLETED → email + SSE', async () => {
    mockPdfGeneratorService.generatePdf.mockResolvedValue({
      success: true,
      buffer: Buffer.from('%PDF-1.4 fake'),
    });

    await service._processReport(makeJob());

    // status transitions
    expect(mockReportDAO.updateStatus).toHaveBeenCalledWith(REPORT_ID, ReportStatus.PROCESSING);
    const completed = mockReportDAO.updateStatus.mock.calls.find(
      (c: any[]) => c[1] === ReportStatus.COMPLETED
    );
    expect(completed).toBeDefined();
    expect(completed[2].file.url).toBe('https://s3/report.pdf');
    expect(completed[2].file.filename).toMatch(/\.pdf$/);

    // pdf + upload + delivery
    expect(mockPdfGeneratorService.generatePdf).toHaveBeenCalledTimes(1);
    expect(mockS3Service.uploadBuffer).toHaveBeenCalledTimes(1);
    expect(mockEmailQueue.addToEmailQueue).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ to: 'owner@example.com' })
    );
    expect(mockSseService.sendToUser).toHaveBeenCalledWith(
      USER_ID,
      CUID,
      expect.objectContaining({ resource: 'report', action: 'ready', reportId: REPORT_ID }),
      'resource-event'
    );
  });

  it('marks the report FAILED and rethrows when PDF generation fails', async () => {
    mockPdfGeneratorService.generatePdf.mockResolvedValue({
      success: false,
      error: 'puppeteer crashed',
    });

    await expect(service._processReport(makeJob())).rejects.toThrow('puppeteer crashed');

    const failed = mockReportDAO.updateStatus.mock.calls.find(
      (c: any[]) => c[1] === ReportStatus.FAILED
    );
    expect(failed).toBeDefined();
    expect(failed[2].failedReason).toContain('puppeteer crashed');
    // nothing delivered on failure
    expect(mockS3Service.uploadBuffer).not.toHaveBeenCalled();
    expect(mockSseService.sendToUser).not.toHaveBeenCalled();
  });
});
