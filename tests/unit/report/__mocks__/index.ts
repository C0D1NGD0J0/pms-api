export const mockReportDAO = {
  createReport: jest.fn() as any,
  updateStatus: jest.fn() as any,
  listByClient: jest.fn() as any,
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
export const mockPdfGeneratorService = { generatePdf: jest.fn() as any };
export const mockS3Service = { uploadBuffer: jest.fn() as any, getSignedUrl: jest.fn() as any };
export const mockSseService = { sendToUser: jest.fn() as any };

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
    pdfGeneratorService: mockPdfGeneratorService as any,
    s3Service: mockS3Service as any,
    sseService: mockSseService as any,
  });
}
