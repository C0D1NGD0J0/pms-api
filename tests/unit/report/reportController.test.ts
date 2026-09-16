import { Types } from 'mongoose';
import { ReportStatus } from '@interfaces/report.interface';
import { ReportController } from '@controllers/ReportController';

const CUID = 'TEST_CLIENT_001';
const USER_ID = new Types.ObjectId().toString();
const REPORT_ID = new Types.ObjectId().toString();
const SCHEDULE_ID = new Types.ObjectId().toString();

const mockReportService = {
  requestReport: jest.fn() as any,
  getReportStatus: jest.fn() as any,
  listReports: jest.fn() as any,
  upsertSchedule: jest.fn() as any,
  getSchedule: jest.fn() as any,
  deactivateSchedule: jest.fn() as any,
};

function makeReq(overrides: Record<string, any> = {}) {
  return {
    params: { cuid: CUID },
    query: {},
    body: {},
    context: { currentuser: { sub: USER_ID } },
    ...overrides,
  } as any;
}

function makeRes() {
  const res: any = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('ReportController', () => {
  let controller: ReportController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new ReportController({ reportService: mockReportService as any });
  });

  describe('generate', () => {
    it('should call requestReport and return 202', async () => {
      const serviceResult = {
        success: true,
        data: { reportId: REPORT_ID, status: ReportStatus.PENDING },
      };
      mockReportService.requestReport.mockResolvedValue(serviceResult);
      const req = makeReq({ body: { period: 'last_30_days' } });
      const res = makeRes();

      await controller.generate(req, res);

      expect(mockReportService.requestReport).toHaveBeenCalledWith(CUID, USER_ID, req.body);
      expect(res.status).toHaveBeenCalledWith(202);
      expect(res.json).toHaveBeenCalledWith(serviceResult);
    });
  });

  describe('getStatus', () => {
    it('should call getReportStatus and return 200', async () => {
      const serviceResult = { success: true, data: { reportId: REPORT_ID, status: 'completed' } };
      mockReportService.getReportStatus.mockResolvedValue(serviceResult);
      const req = makeReq({ params: { cuid: CUID, reportId: REPORT_ID } });
      const res = makeRes();

      await controller.getStatus(req, res);

      expect(mockReportService.getReportStatus).toHaveBeenCalledWith(CUID, REPORT_ID);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('list', () => {
    it('should parse query params and call listReports', async () => {
      const serviceResult = { success: true, data: { reports: [], pagination: {} } };
      mockReportService.listReports.mockResolvedValue(serviceResult);
      const req = makeReq({ query: { page: '2', limit: '10', status: 'completed' } });
      const res = makeRes();

      await controller.list(req, res);

      expect(mockReportService.listReports).toHaveBeenCalledWith(CUID, {
        page: 2,
        limit: 10,
        status: 'completed',
      });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it('should pass undefined for missing query params', async () => {
      mockReportService.listReports.mockResolvedValue({ success: true, data: {} });
      const req = makeReq({ query: {} });
      const res = makeRes();

      await controller.list(req, res);

      expect(mockReportService.listReports).toHaveBeenCalledWith(CUID, {
        page: undefined,
        limit: undefined,
        status: undefined,
      });
    });
  });

  describe('upsertSchedule', () => {
    it('should call upsertSchedule with userId and return 200', async () => {
      const serviceResult = { success: true, data: { scheduleId: SCHEDULE_ID } };
      mockReportService.upsertSchedule.mockResolvedValue(serviceResult);
      const req = makeReq({ body: { frequency: 'monthly' } });
      const res = makeRes();

      await controller.upsertSchedule(req, res);

      expect(mockReportService.upsertSchedule).toHaveBeenCalledWith(CUID, USER_ID, req.body);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('getSchedule', () => {
    it('should call getSchedule and return 200', async () => {
      mockReportService.getSchedule.mockResolvedValue({ success: true, data: null });
      const req = makeReq();
      const res = makeRes();

      await controller.getSchedule(req, res);

      expect(mockReportService.getSchedule).toHaveBeenCalledWith(CUID);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });

  describe('deactivateSchedule', () => {
    it('should call deactivateSchedule and return 200', async () => {
      mockReportService.deactivateSchedule.mockResolvedValue({
        success: true,
        data: { deactivated: true },
      });
      const req = makeReq();
      const res = makeRes();

      await controller.deactivateSchedule(req, res);

      expect(mockReportService.deactivateSchedule).toHaveBeenCalledWith(CUID);
      expect(res.status).toHaveBeenCalledWith(200);
    });
  });
});
