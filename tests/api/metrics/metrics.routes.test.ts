jest.setTimeout(10000);

import request from 'supertest';
import { faker } from '@faker-js/faker';
import { httpStatusCodes } from '@utils/index';
import { Application, Response, Request } from 'express';
import { createMockCurrentUser, createApiTestHelper } from '@tests/helpers';

const mockMetricsController = {
  getDashboard: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: {
        leases: { totalLeases: 5, leasesByStatus: { active: 4 }, occupancyRate: 80, monthlyRentByCurrency: [{ currency: 'USD', total: 12000 }], expiringIn30Days: 1 },
        payments: { byCurrency: [{ currency: 'USD', totalRevenue: 50000, monthRevenue: 5000, pendingAmount: 2000 }], overdueCount: 1, totalCount: 20, onTimeRate: 90, avgPaymentDelayDays: 3 },
        properties: { total: 5, occupied: 4, vacant: 1, occupancyRate: 80 },
        users: { total: 10, tenants: 5, staff: 3 },
        maintenance: { open: 2, assigned: 1, inProgress: 1, completed: 5, cancelled: 0, pending: 0, avgResolutionDays: 4, byPriority: { high: 1, medium: 1 }, byCategory: { plumbing: 2 } },
        generatedAt: new Date().toISOString(),
      },
    });
  }),

  getHistory: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: [
        { metadata: { cuid: 'cuid123', metricType: 'payment' }, measurements: { totalRevenue: 45000 }, timestamp: new Date().toISOString() },
      ],
    });
  }),

  getTrend: jest.fn((_req: Request, res: Response) => {
    res.status(httpStatusCodes.OK).json({
      success: true,
      data: { data: [], changePercent: 12.5 },
    });
  }),
};

const mockContainer = {
  resolve: jest.fn((service: string) => {
    if (service === 'metricsController') return mockMetricsController;
    return {};
  }),
};

describe('Metrics Routes', () => {
  const baseUrl = '/api/v1/metrics';
  const apiHelper = createApiTestHelper();
  let app: Application;
  const mockCuid = faker.string.uuid();

  beforeAll(() => {
    app = apiHelper.createApp((testApp: Application) => {
      testApp.use((req: Request, _res: Response, next: any) => {
        req.container = mockContainer as any;
        req.context = { currentuser: createMockCurrentUser() } as any;
        next();
      });

      testApp.get(`${baseUrl}/:cuid/dashboard`, mockMetricsController.getDashboard);
      testApp.get(`${baseUrl}/:cuid/history/:metricType`, mockMetricsController.getHistory);
      testApp.get(`${baseUrl}/:cuid/trend/:metricType`, mockMetricsController.getTrend);
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ─── GET /dashboard ────────────────────────────────────────────────────────

  describe('GET /:cuid/dashboard', () => {
    it('should return 200 with dashboard stats', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}/dashboard`)
        .expect(httpStatusCodes.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('leases');
      expect(res.body.data).toHaveProperty('payments');
      expect(res.body.data).toHaveProperty('properties');
      expect(res.body.data).toHaveProperty('users');
      expect(res.body.data).toHaveProperty('maintenance');
      expect(res.body.data).toHaveProperty('generatedAt');
      expect(mockMetricsController.getDashboard).toHaveBeenCalledTimes(1);
    });

    it('should include payment fields', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}/dashboard`)
        .expect(httpStatusCodes.OK);

      const { payments } = res.body.data;
      expect(payments).toHaveProperty('byCurrency');
      expect(Array.isArray(payments.byCurrency)).toBe(true);
      expect(payments.byCurrency[0]).toHaveProperty('currency');
      expect(payments.byCurrency[0]).toHaveProperty('totalRevenue');
      expect(payments.byCurrency[0]).toHaveProperty('monthRevenue');
      expect(payments.byCurrency[0]).toHaveProperty('pendingAmount');
      expect(payments).toHaveProperty('overdueCount');
    });

    it('should include maintenance breakdown fields', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}/dashboard`)
        .expect(httpStatusCodes.OK);

      const { maintenance } = res.body.data;
      expect(maintenance).toHaveProperty('open');
      expect(maintenance).toHaveProperty('inProgress');
      expect(maintenance).toHaveProperty('byPriority');
      expect(maintenance).toHaveProperty('byCategory');
    });
  });

  // ─── GET /history/:metricType ──────────────────────────────────────────────

  describe('GET /:cuid/history/:metricType', () => {
    it('should return 200 with time-series snapshots', async () => {
      const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();

      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}/history/payment`)
        .query({ from, to })
        .expect(httpStatusCodes.OK);

      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(mockMetricsController.getHistory).toHaveBeenCalledTimes(1);
    });

    it('should return 200 for all valid metric types', async () => {
      const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const to = new Date().toISOString();

      for (const type of ['lease', 'payment', 'property', 'user', 'maintenance']) {
        mockMetricsController.getHistory.mockClear();
        await request(app)
          .get(`${baseUrl}/${mockCuid}/history/${type}`)
          .query({ from, to })
          .expect(httpStatusCodes.OK);
      }
    });
  });

  // ─── GET /trend/:metricType ────────────────────────────────────────────────

  describe('GET /:cuid/trend/:metricType', () => {
    it('should return 200 with trend data and changePercent', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}/trend/payment`)
        .expect(httpStatusCodes.OK);

      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty('changePercent');
      expect(res.body.data).toHaveProperty('data');
      expect(mockMetricsController.getTrend).toHaveBeenCalledTimes(1);
    });

    it('should accept optional days query param', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}/trend/lease`)
        .query({ days: 60 })
        .expect(httpStatusCodes.OK);

      expect(res.body.success).toBe(true);
    });

    it('should return 200 for maintenance metric type', async () => {
      const res = await request(app)
        .get(`${baseUrl}/${mockCuid}/trend/maintenance`)
        .expect(httpStatusCodes.OK);

      expect(res.body.success).toBe(true);
    });
  });
});
