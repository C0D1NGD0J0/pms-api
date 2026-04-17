import dayjs from 'dayjs';
import Logger from 'bunyan';
import { UserDAO } from '@dao/userDAO';
import { LeaseDAO } from '@dao/leaseDAO';
import { ClientDAO } from '@dao/clientDAO';
import { createLogger } from '@utils/index';
import { MetricsDAO } from '@dao/metricsDAO';
import { PaymentDAO } from '@dao/paymentDAO';
import { PropertyUnitDAO } from '@dao/propertyUnitDAO';
import { SSEService } from '@services/sse/sse.service';
import { EventTypes } from '@interfaces/events.interface';
import { EventEmitterService } from '@services/eventEmitter';
import { MaintenanceRequestDAO } from '@dao/maintenanceRequestDAO';
import { ICronProvider, ICronJob } from '@interfaces/cron.interface';
import { LeaseESignatureCompletedPayload } from '@interfaces/lease.interface';
import {
  IMetricsSnapshot,
  IDashboardStats,
  IMetricsDelta,
  ITrendResult,
  MetricType,
} from '@interfaces/metrics.interface';
import {
  MaintenanceRequestCancelledPayload,
  MaintenanceRequestCompletedPayload,
  MaintenanceRequestCreatedPayload,
  PaymentSucceededPayload,
  PaymentRefundedPayload,
  PaymentOverduePayload,
  UnitChangedPayload,
} from '@interfaces/events.interface';

interface IConstructor {
  maintenanceRequestDAO: MaintenanceRequestDAO;
  emitterService: EventEmitterService;
  propertyUnitDAO: PropertyUnitDAO;
  metricsDAO: MetricsDAO;
  paymentDAO: PaymentDAO;
  sseService: SSEService;
  clientDAO: ClientDAO;
  leaseDAO: LeaseDAO;
  userDAO: UserDAO;
}

export class MetricsService implements ICronProvider {
  private readonly log: Logger;
  private readonly metricsDAO: MetricsDAO;
  private readonly leaseDAO: LeaseDAO;
  private readonly paymentDAO: PaymentDAO;
  private readonly userDAO: UserDAO;
  private readonly clientDAO: ClientDAO;
  private readonly propertyUnitDAO: PropertyUnitDAO;
  private readonly maintenanceRequestDAO: MaintenanceRequestDAO;
  private readonly emitterService: EventEmitterService;
  private readonly sseService: SSEService;

  // Stable bound handlers — prevents listener accumulation on hot reloads
  private readonly onPaymentSucceeded = this.handlePaymentSucceeded.bind(this);
  private readonly onPaymentOverdue = this.handlePaymentOverdue.bind(this);
  private readonly onPaymentRefunded = this.handlePaymentRefunded.bind(this);
  private readonly onMaintenanceCreated = this.handleMaintenanceCreated.bind(this);
  private readonly onMaintenanceCompleted = this.handleMaintenanceCompleted.bind(this);
  private readonly onMaintenanceCancelled = this.handleMaintenanceCancelled.bind(this);
  private readonly onUnitStatusChanged = this.handleUnitStatusChanged.bind(this);
  private readonly onLeaseEsigCompleted = this.handleLeaseEsigCompleted.bind(this);

  constructor(deps: IConstructor) {
    this.log = createLogger('MetricsService');
    this.metricsDAO = deps.metricsDAO;
    this.leaseDAO = deps.leaseDAO;
    this.paymentDAO = deps.paymentDAO;
    this.userDAO = deps.userDAO;
    this.clientDAO = deps.clientDAO;
    this.propertyUnitDAO = deps.propertyUnitDAO;
    this.maintenanceRequestDAO = deps.maintenanceRequestDAO;
    this.emitterService = deps.emitterService;
    this.sseService = deps.sseService;

    this.emitterService.on(EventTypes.PAYMENT_SUCCEEDED, this.onPaymentSucceeded);
    this.emitterService.on(EventTypes.PAYMENT_OVERDUE, this.onPaymentOverdue);
    this.emitterService.on(EventTypes.PAYMENT_REFUNDED, this.onPaymentRefunded);
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_CREATED, this.onMaintenanceCreated);
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_COMPLETED, this.onMaintenanceCompleted);
    this.emitterService.on(EventTypes.MAINTENANCE_REQUEST_CANCELLED, this.onMaintenanceCancelled);
    this.emitterService.on(EventTypes.UNIT_STATUS_CHANGED, this.onUnitStatusChanged);
    this.emitterService.on(EventTypes.LEASE_ESIGNATURE_COMPLETED, this.onLeaseEsigCompleted);
  }

  getCronJobs(): ICronJob[] {
    return [
      {
        name: 'metrics:daily-snapshot',
        schedule: '0 0 * * *',
        handler: this.captureAllSnapshots.bind(this),
        service: 'MetricsService',
        enabled: true,
        description: 'Capture daily metrics snapshots for all active clients',
        timeout: 600_000,
      },
    ];
  }

  async captureAllSnapshots(): Promise<void> {
    this.log.info('Starting daily metrics snapshot capture');
    const cuids = await this.clientDAO.getActiveCuids();
    this.log.info(`Capturing snapshots for ${cuids.length} clients`);

    for (const cuid of cuids) {
      try {
        await Promise.all([
          this.captureLeaseSnapshot(cuid),
          this.capturePropertySnapshot(cuid),
          this.capturePaymentSnapshot(cuid),
          this.captureUserSnapshot(cuid),
          this.captureMaintenanceSnapshot(cuid),
        ]);
      } catch (err) {
        this.log.error({ err, cuid }, 'Failed to capture snapshot for client');
      }
    }

    this.log.info('Daily metrics snapshot capture complete');
  }

  private async pushDelta(cuid: string, delta: Omit<IMetricsDelta, 'cuid'>): Promise<void> {
    try {
      await this.sseService.broadcastToClient(cuid, { cuid, ...delta }, 'metrics:update');
    } catch (err) {
      // SSE broadcast errors are non-fatal — the client will re-fetch on next poll
      this.log.warn({ err, cuid, deltaType: delta.type }, 'metrics SSE broadcast failed');
    }
  }

  private async handlePaymentSucceeded(payload: PaymentSucceededPayload): Promise<void> {
    if (!payload?.cuid) return;
    const isThisMonth = dayjs(payload.paidAt).isSame(dayjs(), 'month');

    await this.pushDelta(payload.cuid, {
      type: 'metrics:delta',
      payments: {
        totalRevenue: payload.amount,
        monthRevenue: isThisMonth ? payload.amount : 0,
        pendingAmount: -payload.amount,
      },
    });
  }

  private async handlePaymentOverdue(payload: PaymentOverduePayload): Promise<void> {
    if (!payload?.cuid) return;
    await this.pushDelta(payload.cuid, {
      type: 'metrics:delta',
      payments: {
        overdueCount: 1,
        pendingAmount: -payload.amount,
      },
    });
  }

  private async handlePaymentRefunded(payload: PaymentRefundedPayload): Promise<void> {
    // Can't reliably determine which month the original payment belonged to — invalidate
    if (!payload?.cuid) return;
    await this.pushDelta(payload.cuid, { type: 'metrics:invalidate' });
  }

  private async handleMaintenanceCreated(payload: MaintenanceRequestCreatedPayload): Promise<void> {
    if (!payload?.cuid) return;
    await this.pushDelta(payload.cuid, {
      type: 'metrics:delta',
      maintenance: {
        open: 1,
        byPriority: { [payload.priority]: 1 },
        byCategory: { [payload.category]: 1 },
      },
    });
  }

  private async handleMaintenanceCompleted(
    payload: MaintenanceRequestCompletedPayload
  ): Promise<void> {
    // Previous status unknown — full invalidation is safest
    if (!payload?.cuid) return;
    await this.pushDelta(payload.cuid, { type: 'metrics:invalidate' });
  }

  private async handleMaintenanceCancelled(
    payload: MaintenanceRequestCancelledPayload
  ): Promise<void> {
    // Previous status unknown — full invalidation is safest
    if (!payload?.cuid) return;
    await this.pushDelta(payload.cuid, { type: 'metrics:invalidate' });
  }

  private async handleUnitStatusChanged(payload: UnitChangedPayload): Promise<void> {
    if (!payload?.cuid || !payload.previousStatus || !payload.newStatus) return;

    const delta: IMetricsDelta['properties'] = {};
    const OCCUPIED = 'occupied';
    const AVAILABLE = 'available';

    if (payload.newStatus === OCCUPIED && payload.previousStatus !== OCCUPIED) {
      delta.occupied = 1;
      if (payload.previousStatus === AVAILABLE) delta.vacant = -1;
    } else if (payload.previousStatus === OCCUPIED && payload.newStatus !== OCCUPIED) {
      delta.occupied = -1;
      if (payload.newStatus === AVAILABLE) delta.vacant = 1;
    } else if (payload.newStatus === AVAILABLE && payload.previousStatus !== AVAILABLE) {
      delta.vacant = 1;
    } else if (payload.previousStatus === AVAILABLE && payload.newStatus !== AVAILABLE) {
      delta.vacant = -1;
    }

    if (Object.keys(delta).length === 0) return;
    await this.pushDelta(payload.cuid, { type: 'metrics:delta', properties: delta });
  }

  private async handleLeaseEsigCompleted(payload: LeaseESignatureCompletedPayload): Promise<void> {
    if (!payload?.cuid) return;
    await this.pushDelta(payload.cuid, {
      type: 'metrics:delta',
      leases: { active: 1 },
    });
  }

  // ─── Query methods ─────────────────────────────────────────────────────────

  async getDashboardStats(cuid: string): Promise<IDashboardStats> {
    const [leases, payments, properties, users, maintenance] = await Promise.all([
      this.leaseDAO.getLeaseStats(cuid),
      this.paymentDAO.getPaymentStats(cuid),
      this.propertyUnitDAO.getPropertyUnitCounts(cuid),
      this.userDAO.getUserStats(cuid),
      this.maintenanceRequestDAO.getStats(cuid),
    ]);

    return {
      leases,
      payments,
      properties,
      users,
      maintenance: {
        open: maintenance.open,
        assigned: maintenance.assigned,
        inProgress: maintenance.inProgress,
        completed: maintenance.completed,
        cancelled: maintenance.cancelled,
        pending: maintenance.pending,
        avgResolutionDays: maintenance.avgResolutionDays,
        byPriority: maintenance.byPriority,
        byCategory: maintenance.byCategory,
      },
      generatedAt: new Date(),
    };
  }

  async getHistory(
    cuid: string,
    metricType: MetricType,
    from: Date,
    to: Date
  ): Promise<IMetricsSnapshot[]> {
    return this.metricsDAO.findByDateRange(cuid, metricType, from, to);
  }

  async getTrend(cuid: string, metricType: MetricType, days: number = 30): Promise<ITrendResult> {
    const data = await this.metricsDAO.findSince(cuid, metricType, days * 2);

    const midpoint = dayjs().subtract(days, 'day');

    const recent = data.filter((d) => !dayjs(d.timestamp).isBefore(midpoint));
    const prior = data.filter((d) => dayjs(d.timestamp).isBefore(midpoint));

    const primaryKey = this.getPrimaryMeasurementKey(metricType);
    const recentAvg = this.avg(recent, primaryKey);
    const priorAvg = this.avg(prior, primaryKey);

    const changePercent = priorAvg === 0 ? 0 : ((recentAvg - priorAvg) / priorAvg) * 100;

    return { data: recent, changePercent: Math.round(changePercent * 10) / 10 };
  }

  // ─── Cron snapshot helpers ─────────────────────────────────────────────────

  private async captureLeaseSnapshot(cuid: string): Promise<void> {
    const stats = await this.leaseDAO.getLeaseStats(cuid);
    await this.metricsDAO.insertSnapshot(cuid, MetricType.LEASE, {
      totalLeases: stats.totalLeases,
      activeLeases: stats.leasesByStatus.active,
      occupancyRate: stats.occupancyRate,
      totalMonthlyRent: stats.totalMonthlyRent,
      expiringIn30Days: stats.expiringIn30Days,
    });
  }

  private async capturePropertySnapshot(cuid: string): Promise<void> {
    const counts = await this.propertyUnitDAO.getPropertyUnitCounts(cuid);
    await this.metricsDAO.insertSnapshot(cuid, MetricType.PROPERTY, {
      total: counts.total,
      occupied: counts.occupied,
      vacant: counts.vacant,
      occupancyRate: counts.occupancyRate,
    });
  }

  private async capturePaymentSnapshot(cuid: string): Promise<void> {
    const stats = await this.paymentDAO.getPaymentStats(cuid);
    await this.metricsDAO.insertSnapshot(cuid, MetricType.PAYMENT, {
      totalRevenue: stats.totalRevenue,
      monthRevenue: stats.monthRevenue,
      pendingAmount: stats.pendingAmount,
      overdueCount: stats.overdueCount,
      onTimeRate: stats.onTimeRate,
    });
  }

  private async captureUserSnapshot(cuid: string): Promise<void> {
    const stats = await this.userDAO.getUserStats(cuid);
    await this.metricsDAO.insertSnapshot(cuid, MetricType.USER, {
      total: stats.total,
      tenants: stats.tenants,
      staff: stats.staff,
    });
  }

  private async captureMaintenanceSnapshot(cuid: string): Promise<void> {
    const stats = await this.maintenanceRequestDAO.getStats(cuid);
    await this.metricsDAO.insertSnapshot(cuid, MetricType.MAINTENANCE, {
      open: stats.open,
      assigned: stats.assigned,
      inProgress: stats.inProgress,
      completed: stats.completed,
      cancelled: stats.cancelled,
      avgResolutionDays: stats.avgResolutionDays,
    });
  }

  // ─── Private helpers ───────────────────────────────────────────────────────

  private getPrimaryMeasurementKey(metricType: MetricType): string {
    const map: Record<MetricType, string> = {
      [MetricType.LEASE]: 'totalMonthlyRent',
      [MetricType.PAYMENT]: 'totalRevenue',
      [MetricType.PROPERTY]: 'occupancyRate',
      [MetricType.USER]: 'total',
      [MetricType.MAINTENANCE]: 'open',
    };
    return map[metricType];
  }

  private avg(snapshots: IMetricsSnapshot[], key: string): number {
    if (snapshots.length === 0) return 0;
    const sum = snapshots.reduce((acc, s) => acc + (s.measurements[key] ?? 0), 0);
    return sum / snapshots.length;
  }

  async destroy(): Promise<void> {
    this.emitterService.off(EventTypes.PAYMENT_SUCCEEDED, this.onPaymentSucceeded);
    this.emitterService.off(EventTypes.PAYMENT_OVERDUE, this.onPaymentOverdue);
    this.emitterService.off(EventTypes.PAYMENT_REFUNDED, this.onPaymentRefunded);
    this.emitterService.off(EventTypes.MAINTENANCE_REQUEST_CREATED, this.onMaintenanceCreated);
    this.emitterService.off(EventTypes.MAINTENANCE_REQUEST_COMPLETED, this.onMaintenanceCompleted);
    this.emitterService.off(EventTypes.MAINTENANCE_REQUEST_CANCELLED, this.onMaintenanceCancelled);
    this.emitterService.off(EventTypes.UNIT_STATUS_CHANGED, this.onUnitStatusChanged);
    this.emitterService.off(EventTypes.LEASE_ESIGNATURE_COMPLETED, this.onLeaseEsigCompleted);
  }
}
