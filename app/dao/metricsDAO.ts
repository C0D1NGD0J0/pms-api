import Logger from 'bunyan';
import mongoose from 'mongoose';
import { createLogger } from '@utils/index';
import { MetricsSnapshot } from '@models/metrics/metrics.model';
import { IMetricsSnapshot, MetricType } from '@interfaces/metrics.interface';

interface IConstructor {
  metricsSnapshotModel: typeof MetricsSnapshot;
}

export class MetricsDAO {
  private readonly model: typeof MetricsSnapshot;
  private readonly log: Logger;

  constructor({ metricsSnapshotModel }: IConstructor) {
    this.model = metricsSnapshotModel;
    this.log = createLogger('MetricsDAO');
  }

  /**
   * Creates the time-series collection if it doesn't already exist.
   * MongoDB error code 48 = NamespaceExists — safe to ignore.
   * Call once at startup from initQueues() in registerResources.ts.
   */
  async ensureCollection(): Promise<void> {
    try {
      const db = mongoose.connection.db;
      if (!db) throw new Error('DB not connected');
      await db.createCollection('metrics_snapshots', {
        timeseries: {
          timeField: 'timestamp',
          metaField: 'metadata',
          granularity: 'hours',
        },
      });
      this.log.info('metrics_snapshots time-series collection created');
    } catch (err: any) {
      if (err?.code === 48) {
        this.log.debug('metrics_snapshots already exists, skipping creation');
        return;
      }
      throw err;
    }
  }

  async insertSnapshot(
    cuid: string,
    metricType: MetricType,
    measurements: Record<string, number>
  ): Promise<void> {
    await this.model.create({
      metadata: { cuid, metricType },
      timestamp: new Date(),
      measurements,
    });
  }

  async findByDateRange(
    cuid: string,
    metricType: MetricType,
    from: Date,
    to: Date
  ): Promise<IMetricsSnapshot[]> {
    return this.model
      .find({
        'metadata.cuid': cuid,
        'metadata.metricType': metricType,
        timestamp: { $gte: from, $lte: to },
      })
      .sort({ timestamp: 1 })
      .lean();
  }

  async findLatest(cuid: string, metricType: MetricType): Promise<IMetricsSnapshot | null> {
    return this.model
      .findOne({ 'metadata.cuid': cuid, 'metadata.metricType': metricType })
      .sort({ timestamp: -1 })
      .lean();
  }

  async aggregateByDay(
    cuid: string,
    metricType: MetricType,
    days: number
  ): Promise<IMetricsSnapshot[]> {
    const from = new Date();
    from.setDate(from.getDate() - days);

    return this.model
      .find({
        'metadata.cuid': cuid,
        'metadata.metricType': metricType,
        timestamp: { $gte: from },
      })
      .sort({ timestamp: 1 })
      .lean();
  }
}
