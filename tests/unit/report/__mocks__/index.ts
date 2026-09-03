export const mockReportDAO = {
  createReport: jest.fn() as any,
  updateStatus: jest.fn() as any,
  listByClient: jest.fn() as any,
  getMonthlyCount: jest.fn().mockResolvedValue(0) as any,
  countDocuments: jest.fn().mockResolvedValue(0) as any,
  deleteItem: jest.fn().mockResolvedValue(true) as any,
  findById: jest.fn() as any,
};

export const mockReportScheduleDAO = {
  upsertSchedule: jest.fn() as any,
  getSchedule: jest.fn() as any,
  deactivateSchedule: jest.fn() as any,
  getDueSchedules: jest.fn() as any,
  advanceNextRunAt: jest.fn() as any,
};

export const mockReportQueue = {
  addReportJob: jest.fn() as any,
};

export const mockQueueFactory = {
  getQueue: jest.fn().mockReturnValue({
    addReportJob: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
  }) as any,
};

export const mockEmailQueue = {
  addToEmailQueue: jest.fn() as any,
} as any;

export const mockClientDAO = { findFirst: jest.fn() as any };
export const mockLeaseDAO = {
  getLeaseStats: jest.fn() as any,
  getRentRollData: jest.fn() as any,
  getExpiringLeases: jest.fn() as any,
};
export const mockPaymentDAO = { getPaymentStats: jest.fn() as any, findByCuid: jest.fn() as any };
export const mockExpenseDAO = {
  aggregateByCategory: jest.fn() as any,
  aggregateByProperty: jest.fn() as any,
  findByClient: jest.fn() as any,
};
export const mockExpenseService = { getPnLSummary: jest.fn() as any };
export const mockPropertyUnitDAO = { getPropertyUnitCounts: jest.fn() as any };
export const mockUserDAO = { getTenantStats: jest.fn() as any, getUserStats: jest.fn() as any };
export const mockVendorDAO = { getClientVendorStats: jest.fn() as any };
export const mockInspectionDAO = { getStats: jest.fn() as any };
export const mockMaintenanceRequestDAO = {
  getStats: jest.fn() as any,
  listWithDetails: jest.fn() as any,
};
export const mockPropertyDAO = { aggregate: jest.fn().mockResolvedValue([]) as any };
export const mockPdfGeneratorService = { generatePdf: jest.fn() as any };
export const mockS3Service = {
  uploadBuffer: jest.fn() as any,
  getSignedUrl: jest.fn() as any,
  deleteFile: jest.fn().mockResolvedValue({}) as any,
};
export const mockSseService = { sendToUser: jest.fn() as any };
export const mockReportAnalysisAIService = {
  analyzeReport: jest.fn().mockResolvedValue({ ok: false, reason: 'feature_disabled' }) as any,
};
export const mockSubscriptionDAO = {
  findFirst: jest.fn().mockResolvedValue({ planName: 'portfolio' }) as any,
  update: jest.fn().mockResolvedValue({}) as any,
  updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }) as any,
  incrementUsageCounter: jest.fn().mockResolvedValue({ matched: true, modified: true }) as any,
  setUsageFields: jest.fn().mockResolvedValue(1) as any,
  bulkResetUsageCounters: jest.fn().mockResolvedValue(0) as any,
};
export const mockSubscriptionPlanConfig = {
  hasFeature: jest.fn().mockReturnValue(true) as any,
  getReportLimits: jest.fn().mockReturnValue({
    maxReportsPerMonth: 10,
    maxReportSections: 9,
    maxReportEmails: 10,
  }) as any,
};
export const mockRedisService = {
  client: {
    get: jest.fn().mockResolvedValue(null) as any,
    set: jest.fn().mockResolvedValue('OK') as any,
    incr: jest.fn().mockResolvedValue(1) as any,
    ttl: jest.fn().mockResolvedValue(-2) as any,
  },
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ReportService } = require('@services/report/report.service');

export function createReportService() {
  return new ReportService({
    reportDAO: mockReportDAO as any,
    reportScheduleDAO: mockReportScheduleDAO as any,
    queueFactory: mockQueueFactory as any,
    emailQueue: mockEmailQueue,
    expenseService: mockExpenseService as any,
    leaseDAO: mockLeaseDAO as any,
    paymentDAO: mockPaymentDAO as any,
    maintenanceRequestDAO: mockMaintenanceRequestDAO as any,
    expenseDAO: mockExpenseDAO as any,
    propertyUnitDAO: mockPropertyUnitDAO as any,
    userDAO: mockUserDAO as any,
    vendorDAO: mockVendorDAO as any,
    clientDAO: mockClientDAO as any,
    inspectionDAO: mockInspectionDAO as any,
    propertyDAO: mockPropertyDAO as any,
    pdfGeneratorService: mockPdfGeneratorService as any,
    reportAnalysisAIService: mockReportAnalysisAIService as any,
    subscriptionPlanConfig: mockSubscriptionPlanConfig as any,
    subscriptionDAO: mockSubscriptionDAO as any,
    redisService: mockRedisService as any,
    s3Service: mockS3Service as any,
    sseService: mockSseService as any,
  });
}
