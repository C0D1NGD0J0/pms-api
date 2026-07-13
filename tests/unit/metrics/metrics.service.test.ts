import { EventTypes } from '@interfaces/events.interface';
import { MetricType } from '@interfaces/metrics.interface';
import { MetricsService } from '@services/metrics/metrics.service';

// ---------------------------------------------------------------------------
// Mock dependencies — DAOs and external services are mocked; only business
// logic in MetricsService is under test.
// ---------------------------------------------------------------------------

const mockLeaseStats = {
  totalLeases: 10,
  leasesByStatus: { active: 8, expired: 2 },
  occupancyRate: 80,
  monthlyRentByCurrency: [{ currency: 'USD', total: 24000 }],
  expiringIn30Days: 1,
};

const mockPaymentStats = {
  byCurrency: [{ currency: 'USD', totalRevenue: 100000, monthRevenue: 8000, pendingAmount: 3000 }],
  overdueCount: 2,
  totalCount: 40,
  onTimeRate: 92,
  avgPaymentDelayDays: 2.5,
};

const mockPropertyCounts = {
  total: 10,
  occupied: 8,
  vacant: 2,
  occupancyRate: 80,
};

const mockPropertyCount = 7;

const mockUserStats = {
  total: 15,
  tenants: 10,
  staff: 5,
};

const mockMaintenanceStats = {
  open: 3,
  assigned: 2,
  inProgress: 1,
  awaitingInvoice: 0,
  completed: 20,
  cancelled: 1,
  pending: 0,
  total: 27,
  avgResolutionDays: 5,
  byPriority: { urgent: 1, high: 2, medium: 0, low: 0 },
  byCategory: { plumbing: 2, electrical: 1 },
  pendingInvoices: 0,
};

const mockLeaseDAO = {
  getLeaseStats: jest.fn().mockReturnValue(Promise.resolve(mockLeaseStats)),
} as any;
const mockPaymentDAO = {
  getPaymentStats: jest.fn().mockReturnValue(Promise.resolve(mockPaymentStats)),
} as any;
const mockPropertyUnitDAO = {
  getPropertyUnitCounts: jest.fn().mockReturnValue(Promise.resolve(mockPropertyCounts)),
} as any;
const mockPropertyDAO = {
  getPropertyCount: jest.fn().mockReturnValue(Promise.resolve(mockPropertyCount)),
} as any;
const mockUserDAO = {
  getUserStats: jest.fn().mockReturnValue(Promise.resolve(mockUserStats)),
} as any;
const mockMaintenanceRequestDAO = {
  getStats: jest.fn().mockReturnValue(Promise.resolve(mockMaintenanceStats)),
} as any;
const mockClientDAO = {
  getActiveCuids: jest.fn().mockReturnValue(Promise.resolve(['cuid1', 'cuid2'])),
} as any;

const mockMetricsDAO = {
  insertSnapshot: jest.fn().mockReturnValue(Promise.resolve(undefined)),
  findByDateRange: jest.fn().mockReturnValue(Promise.resolve([])),
  findSince: jest.fn().mockReturnValue(Promise.resolve([])),
} as any;

const mockSSEService = {
  broadcastToClient: jest.fn().mockReturnValue(Promise.resolve(undefined)),
} as any;

// Simple synchronous event emitter for testing
const listeners: Record<string, ((payload: unknown) => void)[]> = {};
const mockEmitterService = {
  on: jest.fn((event: string, handler: (payload: unknown) => void) => {
    if (!listeners[event]) listeners[event] = [];
    listeners[event].push(handler);
  }),
  off: jest.fn(),
  emit: (event: string, payload: unknown) => {
    (listeners[event] || []).forEach((fn) => fn(payload));
  },
} as any;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

function makeService(): MetricsService {
  return new MetricsService({
    maintenanceRequestDAO: mockMaintenanceRequestDAO,
    propertyUnitDAO: mockPropertyUnitDAO,
    propertyDAO: mockPropertyDAO,
    emitterService: mockEmitterService,
    metricsDAO: mockMetricsDAO,
    paymentDAO: mockPaymentDAO,
    clientDAO: mockClientDAO,
    leaseDAO: mockLeaseDAO,
    userDAO: mockUserDAO,
    sseService: mockSSEService,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(() => {
    jest.clearAllMocks();
    // Reset listeners between tests
    Object.keys(listeners).forEach((k) => delete listeners[k]);
    service = makeService();
  });

  afterEach(async () => {
    await service.destroy();
  });

  // ─── getDashboardStats ────────────────────────────────────────────────────

  describe('getDashboardStats', () => {
    it('should run all 5 DAO aggregations in parallel and return IDashboardStats', async () => {
      const stats = await service.getDashboardStats('cuid123');

      expect(mockLeaseDAO.getLeaseStats).toHaveBeenCalledWith('cuid123');
      expect(mockPaymentDAO.getPaymentStats).toHaveBeenCalledWith('cuid123');
      expect(mockPropertyUnitDAO.getPropertyUnitCounts).toHaveBeenCalledWith('cuid123');
      expect(mockPropertyDAO.getPropertyCount).toHaveBeenCalledWith('cuid123');
      expect(mockUserDAO.getUserStats).toHaveBeenCalledWith('cuid123');
      expect(mockMaintenanceRequestDAO.getStats).toHaveBeenCalledWith('cuid123');

      // Leases — base stats plus computed totalMonthlyRent (sum of monthlyRentByCurrency)
      expect(stats.leases).toMatchObject(mockLeaseStats);
      expect(stats.leases.totalMonthlyRent).toBe(24000);

      // Payments — byCurrency array preserved; flat sums added
      expect(stats.payments.byCurrency).toEqual(mockPaymentStats.byCurrency);
      expect(stats.payments.monthRevenue).toBe(8000);
      expect(stats.payments.totalRevenue).toBe(100000);
      expect(stats.payments.pendingAmount).toBe(3000);
      expect(stats.payments.overdueCount).toBe(mockPaymentStats.overdueCount);
      expect(stats.payments.onTimeRate).toBe(mockPaymentStats.onTimeRate);

      expect(stats.properties).toEqual({ ...mockPropertyCounts, propertyCount: mockPropertyCount });
      expect(stats.users).toEqual(mockUserStats);

      // Maintenance — activeCount = open(3) + assigned(2) + inProgress(1) + pending(0) = 6
      expect(stats.maintenance.activeCount).toBe(6);
      expect(stats.maintenance.open).toBe(mockMaintenanceStats.open);
      expect(stats.maintenance.byPriority).toEqual(mockMaintenanceStats.byPriority);
      expect(stats.maintenance.byCategory).toEqual(mockMaintenanceStats.byCategory);

      expect(stats.generatedAt).toBeInstanceOf(Date);
    });
  });

  // ─── getTrend ─────────────────────────────────────────────────────────────

  describe('getTrend', () => {
    it('should return changePercent=0 when no snapshot data', async () => {
      mockMetricsDAO.findSince.mockReturnValue(Promise.resolve([]));
      const result = await service.getTrend('cuid123', MetricType.PAYMENT, 30);
      expect(result.changePercent).toBe(0);
      expect(result.data).toEqual([]);
    });

    it('should compute positive changePercent when recent avg exceeds prior avg', async () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000); // 10 days ago
      const priorDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000); // 40 days ago

      mockMetricsDAO.findSince.mockReturnValue(
        Promise.resolve([
          {
            metadata: { cuid: 'c', metricType: 'payment' },
            measurements: { overdueCount: 1000 },
            timestamp: priorDate,
          },
          {
            metadata: { cuid: 'c', metricType: 'payment' },
            measurements: { overdueCount: 2000 },
            timestamp: recentDate,
          },
        ])
      );

      const result = await service.getTrend('cuid123', MetricType.PAYMENT, 30);
      expect(result.changePercent).toBe(100); // (2000 - 1000) / 1000 * 100
      expect(result.data.length).toBe(1); // only the recent snapshot
    });

    it('should compute negative changePercent when recent avg is lower', async () => {
      const now = new Date();
      const recentDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000);
      const priorDate = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

      mockMetricsDAO.findSince.mockReturnValue(
        Promise.resolve([
          {
            metadata: { cuid: 'c', metricType: 'payment' },
            measurements: { overdueCount: 4000 },
            timestamp: priorDate,
          },
          {
            metadata: { cuid: 'c', metricType: 'payment' },
            measurements: { overdueCount: 2000 },
            timestamp: recentDate,
          },
        ])
      );

      const result = await service.getTrend('cuid123', MetricType.PAYMENT, 30);
      expect(result.changePercent).toBe(-50); // (2000 - 4000) / 4000 * 100
    });
  });

  // ─── getHistory ───────────────────────────────────────────────────────────

  describe('getHistory', () => {
    it('should delegate to metricsDAO.findByDateRange', async () => {
      const from = new Date('2025-01-01');
      const to = new Date('2025-01-31');

      await service.getHistory('cuid123', MetricType.LEASE, from, to);

      expect(mockMetricsDAO.findByDateRange).toHaveBeenCalledWith(
        'cuid123',
        MetricType.LEASE,
        from,
        to
      );
    });
  });

  // ─── SSE delta push handlers ──────────────────────────────────────────────

  describe('SSE delta push', () => {
    it('should push metrics:invalidate for PAYMENT_SUCCEEDED (revenue is per-currency, requires re-fetch)', async () => {
      const payload = {
        cuid: 'cuid123',
        amount: 1200,
        paidAt: new Date().toISOString(),
        pytuid: 'pay_001',
        invoiceId: 'inv_001',
      };

      mockEmitterService.emit(EventTypes.PAYMENT_SUCCEEDED, payload);
      await Promise.resolve();

      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        'cuid123',
        expect.objectContaining({ type: 'metrics:invalidate' }),
        'metrics:update'
      );
    });

    it('should push invalidate for PAYMENT_REFUNDED', async () => {
      mockEmitterService.emit(EventTypes.PAYMENT_REFUNDED, { cuid: 'cuid123', amount: 500 });
      await Promise.resolve();

      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        'cuid123',
        expect.objectContaining({ type: 'metrics:invalidate' }),
        'metrics:update'
      );
    });

    it('should push delta for MAINTENANCE_REQUEST_CREATED', async () => {
      mockEmitterService.emit(EventTypes.MAINTENANCE_REQUEST_CREATED, {
        cuid: 'cuid123',
        priority: 'high',
        category: 'plumbing',
        mruid: 'MR-001',
      });
      await Promise.resolve();

      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        'cuid123',
        expect.objectContaining({
          type: 'metrics:delta',
          maintenance: expect.objectContaining({ open: 1 }),
        }),
        'metrics:update'
      );
    });

    it('should push invalidate for MAINTENANCE_REQUEST_COMPLETED', async () => {
      mockEmitterService.emit(EventTypes.MAINTENANCE_REQUEST_COMPLETED, {
        cuid: 'cuid123',
        mruid: 'MR-001',
      });
      await Promise.resolve();

      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        'cuid123',
        expect.objectContaining({ type: 'metrics:invalidate' }),
        'metrics:update'
      );
    });

    it('should push occupied+1 delta when unit becomes occupied from available', async () => {
      mockEmitterService.emit(EventTypes.UNIT_STATUS_CHANGED, {
        cuid: 'cuid123',
        puid: 'unit-001',
        previousStatus: 'available',
        newStatus: 'occupied',
      });
      await Promise.resolve();

      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        'cuid123',
        expect.objectContaining({
          type: 'metrics:delta',
          properties: expect.objectContaining({ occupied: 1, vacant: -1 }),
        }),
        'metrics:update'
      );
    });

    it('should push occupied-1 delta when unit becomes available from occupied', async () => {
      mockEmitterService.emit(EventTypes.UNIT_STATUS_CHANGED, {
        cuid: 'cuid123',
        puid: 'unit-002',
        previousStatus: 'occupied',
        newStatus: 'available',
      });
      await Promise.resolve();

      expect(mockSSEService.broadcastToClient).toHaveBeenCalledWith(
        'cuid123',
        expect.objectContaining({
          type: 'metrics:delta',
          properties: expect.objectContaining({ occupied: -1, vacant: 1 }),
        }),
        'metrics:update'
      );
    });

    it('should not push if cuid is missing in payload', async () => {
      mockEmitterService.emit(EventTypes.PAYMENT_SUCCEEDED, {
        amount: 500,
        paidAt: new Date().toISOString(),
      });
      await Promise.resolve();

      expect(mockSSEService.broadcastToClient).not.toHaveBeenCalled();
    });
  });

  // ─── destroy ──────────────────────────────────────────────────────────────

  describe('destroy', () => {
    it('should remove all event listeners', async () => {
      await service.destroy();
      expect(mockEmitterService.off).toHaveBeenCalledTimes(8);
    });
  });

  // ─── captureAllSnapshots (cron handler) ───────────────────────────────────

  describe('captureAllSnapshots', () => {
    it('should iterate active cuids and call 5 snapshot methods per client', async () => {
      await service.captureAllSnapshots();

      // 2 clients × 5 snapshot methods each
      expect(mockLeaseDAO.getLeaseStats).toHaveBeenCalledTimes(2);
      expect(mockPaymentDAO.getPaymentStats).toHaveBeenCalledTimes(2);
      expect(mockPropertyUnitDAO.getPropertyUnitCounts).toHaveBeenCalledTimes(2);
      expect(mockUserDAO.getUserStats).toHaveBeenCalledTimes(2);
      expect(mockMaintenanceRequestDAO.getStats).toHaveBeenCalledTimes(2);
      expect(mockMetricsDAO.insertSnapshot).toHaveBeenCalledTimes(10);
    });

    it('should continue processing remaining clients if one fails', async () => {
      mockLeaseDAO.getLeaseStats
        .mockRejectedValueOnce(new Error('DB error'))
        .mockReturnValue(Promise.resolve(mockLeaseStats));

      await expect(service.captureAllSnapshots()).resolves.not.toThrow();
    });
  });
});
