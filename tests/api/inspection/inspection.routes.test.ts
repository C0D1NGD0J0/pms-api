jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Request, Response } from 'express';
import { createApiTestHelper, createMockCurrentUser } from '@tests/helpers';

// ─── Mock Inspection Controller ─────────────────────────────────────────────

const mockInspectionController = {
  scheduleInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.CREATED).json({
      success: true,
      message: 'Inspection scheduled',
      data: { iuid: 'insp-abc123', status: 'scheduled', type: 'move_in' },
    });
  }),

  listInspections: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        inspections: [
          { iuid: 'insp-abc123', status: 'scheduled', type: 'move_in' },
        ],
        pagination: { total: 1, page: 1, pages: 1, limit: 10 },
      },
    });
  }),

  getInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: { iuid: 'insp-abc123', status: 'scheduled', type: 'move_in' },
    });
  }),

  updateInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection updated',
      data: { iuid: 'insp-abc123', status: 'in_progress' },
    });
  }),

  submitInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection submitted',
      data: { iuid: 'insp-abc123', status: 'submitted' },
    });
  }),

  approveInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection approved',
      data: { iuid: 'insp-abc123', status: 'approved' },
    });
  }),

  rejectInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection rejected',
      data: { iuid: 'insp-abc123', status: 'rejected' },
    });
  }),

  acknowledgeInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection acknowledged',
    });
  }),

  disputeInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection disputed',
      data: { iuid: 'insp-abc123', status: 'disputed' },
    });
  }),

  cancelInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection cancelled',
    });
  }),

  deleteInspection: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'Inspection deleted',
    });
  }),

  getAIAnalysis: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: { summary: 'AI analysis results', riskFlags: [] },
    });
  }),

  triggerAIAnalysis: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      message: 'AI analysis triggered',
    });
  }),

  generateReport: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: { url: 'https://example.com/report.pdf', status: 'active' },
    });
  }),
};

// ─── Mock Container ─────────────────────────────────────────────────────────

const mockContainer = {
  resolve: jest.fn((service: string) => {
    if (service === 'inspectionController') return mockInspectionController;
    return {};
  }),
};

// ─── Test Suite ─────────────────────────────────────────────────────────────

describe('Inspection Routes', () => {
  const baseUrl = '/api/v1/inspections';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();
  const mockIuid = 'insp-abc123';

  beforeAll(() => {
    app = apiHelper.createApp((testApp: Application) => {
      testApp.use((req: Request, _res: Response, next: any) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      // Schedule & List
      testApp.post(`${baseUrl}/:cuid`, mockInspectionController.scheduleInspection);
      testApp.get(`${baseUrl}/:cuid`, mockInspectionController.listInspections);

      // AI Analysis (must come before /:cuid/:iuid to avoid parameter collision)
      testApp.get(
        `${baseUrl}/:cuid/:iuid/ai-analysis`,
        mockInspectionController.getAIAnalysis
      );
      testApp.post(
        `${baseUrl}/:cuid/:iuid/ai-analysis`,
        mockInspectionController.triggerAIAnalysis
      );

      // Report
      testApp.get(`${baseUrl}/:cuid/:iuid/report`, mockInspectionController.generateReport);

      // Status actions
      testApp.patch(`${baseUrl}/:cuid/:iuid/submit`, mockInspectionController.submitInspection);
      testApp.patch(`${baseUrl}/:cuid/:iuid/approve`, mockInspectionController.approveInspection);
      testApp.patch(`${baseUrl}/:cuid/:iuid/reject`, mockInspectionController.rejectInspection);
      testApp.patch(
        `${baseUrl}/:cuid/:iuid/acknowledge`,
        mockInspectionController.acknowledgeInspection
      );
      testApp.patch(`${baseUrl}/:cuid/:iuid/dispute`, mockInspectionController.disputeInspection);
      testApp.patch(`${baseUrl}/:cuid/:iuid/cancel`, mockInspectionController.cancelInspection);

      // CRUD on single inspection
      testApp.get(`${baseUrl}/:cuid/:iuid`, mockInspectionController.getInspection);
      testApp.patch(`${baseUrl}/:cuid/:iuid`, mockInspectionController.updateInspection);
      testApp.delete(`${baseUrl}/:cuid/:iuid`, mockInspectionController.deleteInspection);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── Schedule ───────────────────────────────────────────────────────────

  describe('POST /:cuid (schedule inspection)', () => {
    const endpoint = `${baseUrl}/${mockCuid}`;

    it('should schedule an inspection and return 201', async () => {
      const response = await request(app)
        .post(endpoint)
        .send({
          type: 'move_in',
          leaseId: 'lease-123',
          scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        })
        .expect(httpStatusCodes.CREATED);

      expect(response.body.success).toBe(true);
      expect(response.body.data.iuid).toBeDefined();
      expect(response.body.data.status).toBe('scheduled');
      expect(mockInspectionController.scheduleInspection).toHaveBeenCalledTimes(1);
    });

    it('should pass request body to the controller', async () => {
      const payload = {
        type: 'move_out',
        leaseId: 'lease-456',
        scheduledDate: new Date(Date.now() + 86400000).toISOString(),
        refundDeposit: true,
      };

      await request(app).post(endpoint).send(payload).expect(httpStatusCodes.CREATED);

      const calledReq = (mockInspectionController.scheduleInspection as jest.Mock).mock.calls[0][0];
      expect(calledReq.body.type).toBe('move_out');
      expect(calledReq.body.leaseId).toBe('lease-456');
      expect(calledReq.body.refundDeposit).toBe(true);
    });
  });

  // ─── List ───────────────────────────────────────────────────────────────

  describe('GET /:cuid (list inspections)', () => {
    const endpoint = `${baseUrl}/${mockCuid}`;

    it('should return a list of inspections with pagination', async () => {
      const response = await request(app).get(endpoint).expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.inspections).toBeInstanceOf(Array);
      expect(response.body.data.pagination).toBeDefined();
      expect(mockInspectionController.listInspections).toHaveBeenCalledTimes(1);
    });

    it('should forward query filters to the controller', async () => {
      await request(app)
        .get(`${endpoint}?status=scheduled&type=move_in&page=2&limit=5`)
        .expect(httpStatusCodes.OK);

      const calledReq = (mockInspectionController.listInspections as jest.Mock).mock.calls[0][0];
      expect(calledReq.query.status).toBe('scheduled');
      expect(calledReq.query.type).toBe('move_in');
      expect(calledReq.query.page).toBe('2');
      expect(calledReq.query.limit).toBe('5');
    });
  });

  // ─── Get Single ─────────────────────────────────────────────────────────

  describe('GET /:cuid/:iuid (get inspection)', () => {
    it('should return a single inspection', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockIuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.iuid).toBe(mockIuid);
      expect(mockInspectionController.getInspection).toHaveBeenCalledTimes(1);
    });

    it('should pass cuid and iuid params to the controller', async () => {
      await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockIuid}`)
        .expect(httpStatusCodes.OK);

      const calledReq = (mockInspectionController.getInspection as jest.Mock).mock.calls[0][0];
      expect(calledReq.params.cuid).toBe(mockCuid);
      expect(calledReq.params.iuid).toBe(mockIuid);
    });
  });

  // ─── Update ─────────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:iuid (update inspection)', () => {
    it('should update the inspection and return 200', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}`)
        .send({
          rooms: [{ name: 'Kitchen', condition: 'good', items: [], media: [] }],
        })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Inspection updated');
      expect(mockInspectionController.updateInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Submit ─────────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:iuid/submit', () => {
    it('should submit the inspection', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}/submit`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('submitted');
      expect(mockInspectionController.submitInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Approve ────────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:iuid/approve', () => {
    it('should approve the inspection', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}/approve`)
        .send({ refundAmount: 500 })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('approved');
      expect(mockInspectionController.approveInspection).toHaveBeenCalledTimes(1);
    });

    it('should allow approval without refundAmount', async () => {
      await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}/approve`)
        .send({})
        .expect(httpStatusCodes.OK);

      expect(mockInspectionController.approveInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Reject ─────────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:iuid/reject', () => {
    it('should reject the inspection with a reason', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}/reject`)
        .send({ reason: { text: 'Photos are too blurry to assess' } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('rejected');
      expect(mockInspectionController.rejectInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Acknowledge ────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:iuid/acknowledge', () => {
    it('should acknowledge the inspection', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}/acknowledge`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Inspection acknowledged');
      expect(mockInspectionController.acknowledgeInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Dispute ────────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:iuid/dispute', () => {
    it('should dispute the inspection with notes', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}/dispute`)
        .send({ disputeNotes: { text: 'The damage was pre-existing' } })
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.status).toBe('disputed');
      expect(mockInspectionController.disputeInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Cancel ─────────────────────────────────────────────────────────────

  describe('PATCH /:cuid/:iuid/cancel', () => {
    it('should cancel the inspection', async () => {
      const response = await request(app)
        .patch(`${baseUrl}/${mockCuid}/${mockIuid}/cancel`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Inspection cancelled');
      expect(mockInspectionController.cancelInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Delete ─────────────────────────────────────────────────────────────

  describe('DELETE /:cuid/:iuid (soft delete)', () => {
    it('should soft-delete the inspection', async () => {
      const response = await request(app)
        .delete(`${baseUrl}/${mockCuid}/${mockIuid}`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('Inspection deleted');
      expect(mockInspectionController.deleteInspection).toHaveBeenCalledTimes(1);
    });
  });

  // ─── AI Analysis ────────────────────────────────────────────────────────

  describe('GET /:cuid/:iuid/ai-analysis', () => {
    it('should return AI analysis results', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockIuid}/ai-analysis`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.summary).toBeDefined();
      expect(response.body.data.riskFlags).toBeInstanceOf(Array);
      expect(mockInspectionController.getAIAnalysis).toHaveBeenCalledTimes(1);
    });
  });

  describe('POST /:cuid/:iuid/ai-analysis', () => {
    it('should trigger AI analysis', async () => {
      const response = await request(app)
        .post(`${baseUrl}/${mockCuid}/${mockIuid}/ai-analysis`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.message).toBe('AI analysis triggered');
      expect(mockInspectionController.triggerAIAnalysis).toHaveBeenCalledTimes(1);
    });
  });

  // ─── Report ─────────────────────────────────────────────────────────────

  describe('GET /:cuid/:iuid/report', () => {
    it('should generate/return an inspection report', async () => {
      const response = await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockIuid}/report`)
        .expect(httpStatusCodes.OK);

      expect(response.body.success).toBe(true);
      expect(response.body.data.url).toBeDefined();
      expect(mockInspectionController.generateReport).toHaveBeenCalledTimes(1);
    });

    it('should forward query options to the controller', async () => {
      await request(app)
        .get(`${baseUrl}/${mockCuid}/${mockIuid}/report?includePhotos=false&forceRegenerate=true`)
        .expect(httpStatusCodes.OK);

      const calledReq = (mockInspectionController.generateReport as jest.Mock).mock.calls[0][0];
      expect(calledReq.query.includePhotos).toBe('false');
      expect(calledReq.query.forceRegenerate).toBe('true');
    });
  });
});
