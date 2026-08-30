jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

// ─── Mock Report Controller ────────────────────────────────────────────────

const mockReportController = {
  generate: jest.fn((_req: Request, res: Response) => {
    res.status(202).json({
      success: true,
      data: { reportId: 'rpt-abc123', status: 'pending' },
      message: 'Report generation started',
    });
  }),

  getStatus: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        reportId: 'rpt-abc123',
        status: 'completed',
        presignedUrl: 'https://s3.example.com/report.pdf',
        expiresAt: new Date().toISOString(),
        filename: 'report-2026-08-29.pdf',
      },
    });
  }),

  list: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        reports: [{ reportId: 'rpt-abc123', status: 'completed' }],
        pagination: { hasMoreResource: false, currentPage: 1, totalPages: 1 },
      },
    });
  }),

  upsertSchedule: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: { scheduleId: 'sch-abc123' },
      message: 'Report schedule saved',
    });
  }),

  getSchedule: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        frequency: 'monthly',
        sections: ['executive_summary', 'financial_overview'],
        isActive: true,
        nextRunAt: new Date().toISOString(),
      },
    });
  }),

  deactivateSchedule: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: { deactivated: true },
    });
  }),
};

// ─── Mock Container ────────────────────────────────────────────────────────

const mockContainer = {
  resolve: jest.fn((service: string) => {
    if (service === 'reportController') return mockReportController;
    return {};
  }),
};

// ─── Test Suite ────────────────────────────────────────────────────────────

describe('Report Routes', () => {
  const baseUrl = '/api/v1/reports';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockReportId = '507f1f77bcf86cd799439011';

  beforeAll(() => {
    app = apiHelper.createApp((testApp: Application) => {
      testApp.use((req: Request, _res: Response, next: any) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // On-demand generation
      testApp.post(`${baseUrl}/:cuid/generate`, mockReportController.generate);
      testApp.get(`${baseUrl}/:cuid/:reportId/status`, mockReportController.getStatus);
      testApp.get(`${baseUrl}/:cuid`, mockReportController.list);

      // Schedule management
      testApp.post(`${baseUrl}/:cuid/schedule`, mockReportController.upsertSchedule);
      testApp.get(`${baseUrl}/:cuid/schedule`, mockReportController.getSchedule);
      testApp.delete(`${baseUrl}/:cuid/schedule`, mockReportController.deactivateSchedule);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Generate Report ──────────────────────────────────────────────────

  describe('POST /:cuid/generate', () => {
    const endpoint = `${baseUrl}/${mockCuid}/generate`;

    it('should return 202 Accepted with reportId', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ period: 'last_30_days' })
        .expect(202);

      expect(response.body.success).toBe(true);
      expect(response.body.data.reportId).toBeDefined();
      expect(response.body.data.status).toBe('pending');
      expect(mockReportController.generate).toHaveBeenCalledTimes(1);
    });

    it('should pass request body to the controller', async () => {
      const payload = {
        period: 'custom',
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-03-31T23:59:59Z',
        sections: ['financial_overview', 'payment_analysis'],
        emailRecipients: ['investor@example.com'],
      };

      await request(app).post(endpoint).send(payload).expect(202);

      const calledReq = (mockReportController.generate as jest.Mock).mock.calls[0][0];
      expect(calledReq.body.period).toBe('custom');
      expect(calledReq.body.sections).toEqual(['financial_overview', 'payment_analysis']);
      expect(calledReq.body.emailRecipients).toEqual(['investor@example.com']);
    });
  });

  // ─── Report Status ────────────────────────────────────────────────────

  describe('GET /:cuid/:reportId/status', () => {
    it('should return report status with presigned URL', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockReportId}/status`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.presignedUrl).toBeDefined();
      expect(response.body.data.filename).toBeDefined();
      expect(mockReportController.getStatus).toHaveBeenCalledTimes(1);
    });

    it('should pass reportId param to controller', async () => {
      await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockReportId}/status`)
        .expect(httpStatusCodes.OK);

      const calledReq = (mockReportController.getStatus as jest.Mock).mock.calls[0][0];
      expect(calledReq.params.cuid).toBe(mockCuid);
      expect(calledReq.params.reportId).toBe(mockReportId);
    });
  });

  // ─── List Reports ─────────────────────────────────────────────────────

  describe('GET /:cuid', () => {
    it('should return paginated list of reports', async () => {
      const response = await request(app).get(`${baseUrl}/${mockCuid}`).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.reports).toBeInstanceOf(Array);
      expect(response.body.data.pagination).toBeDefined();
      expect(mockReportController.list).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Upsert Schedule ──────────────────────────────────────────────────

  describe('POST /:cuid/schedule', () => {
    const endpoint = `${baseUrl}/${mockCuid}/schedule`;

    it('should create/update schedule and return scheduleId', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({ frequency: 'monthly' })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.scheduleId).toBeDefined();
      expect(mockReportController.upsertSchedule).toHaveBeenCalledTimes(1);
    });

    it('should pass schedule config to controller', async () => {
      const payload = {
        frequency: 'quarterly',
        sections: ['financial_overview'],
        emailRecipients: ['pm@example.com'],
      };

      await request(app).post(endpoint).send(payload).expect(httpStatusCodes.OK);

      const calledReq = (mockReportController.upsertSchedule as jest.Mock).mock.calls[0][0];
      expect(calledReq.body.frequency).toBe('quarterly');
      expect(calledReq.body.sections).toEqual(['financial_overview']);
    });
  });

  // ─── Get Schedule ─────────────────────────────────────────────────────

  describe('GET /:cuid/schedule', () => {
    it('should return current schedule config', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/schedule`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.frequency).toBe('monthly');
      expect(response.body.data.isActive).toBe(true);
      expect(mockReportController.getSchedule).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Deactivate Schedule ──────────────────────────────────────────────

  describe('DELETE /:cuid/schedule', () => {
    it('should deactivate schedule', async () => {
      const response = await request(app)
        .delete(`${baseUrl}/${mockCuid}/schedule`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.deactivated).toBe(true);
      expect(mockReportController.deactivateSchedule).toHaveBeenCalledTimes(1);
    });
  });
});
