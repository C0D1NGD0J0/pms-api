import { ILeaseStats } from './lease.interface';

export enum MetricType {
  MAINTENANCE = 'maintenance',
  PROPERTY = 'property',
  PAYMENT = 'payment',
  LEASE = 'lease',
  USER = 'user',
}

export interface IDashboardStats {
  payments: {
    byCurrency: Array<{
      currency: string;
      totalRevenue: number;
      monthRevenue: number;
      pendingAmount: number;
    }>;
    overdueCount: number;
    totalCount: number;
    onTimeRate: number;
    avgPaymentDelayDays: number;
  };
  maintenance: {
    open: number;
    assigned: number;
    inProgress: number;
    completed: number;
    cancelled: number;
    pending: number;
    avgResolutionDays: number;
    byPriority: Record<string, number>;
    byCategory: Record<string, number>;
  };
  properties: {
    total: number;
    propertyCount: number;
    occupied: number;
    vacant: number;
    occupancyRate: number;
  };
  users: {
    total: number;
    tenants: number;
    staff: number;
  };
  leases: ILeaseStats;
  generatedAt: Date;
}

/**
 * Pushed via SSE on the 'metrics:update' event type.
 *
 * type='metrics:delta'    — apply signed increments directly to cached IDashboardStats
 * type='metrics:invalidate' — re-fetch /metrics/:cuid/dashboard (complex state change)
 *
 * All numeric fields are signed integers: positive = increment, negative = decrement.
 * Derived fields (occupancyRate, onTimeRate) are excluded — recomputed on next full load.
 */
export interface IMetricsDelta {
  maintenance?: {
    open?: number;
    assigned?: number;
    inProgress?: number;
    completed?: number;
    cancelled?: number;
    byPriority?: Record<string, number>;
    byCategory?: Record<string, number>;
  };
  properties?: {
    occupied?: number;
    vacant?: number;
  };
  type: 'metrics:delta' | 'metrics:invalidate';
  payments?: {
    overdueCount?: number;
  };
  leases?: {
    active?: number;
  };
  cuid: string;
}

export interface IMetricsSnapshot {
  metadata: { cuid: string; metricType: MetricType };
  measurements: Record<string, number>;
  timestamp: Date;
}

export interface ITrendResult {
  data: IMetricsSnapshot[];
  changePercent: number;
}
