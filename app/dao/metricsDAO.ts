import dayjs from 'dayjs';
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
        // Collection exists — verify it is actually a time-series collection
        // to avoid silently running with a plain collection that will reject
        // time-series inserts at runtime.
        await this.verifyTimeSeriesCollection();
        return;
      }
      throw err;
    }
  }

  private async verifyTimeSeriesCollection(): Promise<void> {
    try {
      const db = mongoose.connection.db;
      if (!db) return;
      const collections = await db
        .listCollections({ name: 'metrics_snapshots' }, { nameOnly: false })
        .toArray();
      const info = collections[0] as any;
      if (info?.options?.timeseries) {
        this.log.debug('metrics_snapshots already exists as time-series collection');
      } else {
        this.log.error(
          'metrics_snapshots exists but is NOT a time-series collection — ' +
            'drop the collection and restart to recreate it correctly'
        );
      }
    } catch (verifyErr) {
      this.log.warn({ verifyErr }, 'Could not verify metrics_snapshots collection type');
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

  /**
   * Returns all snapshots for the given metric type within the last `days` days,
   * sorted oldest-first. Used by MetricsService.getTrend() to compare two periods.
   */
  async findSince(cuid: string, metricType: MetricType, days: number): Promise<IMetricsSnapshot[]> {
    const from = dayjs().subtract(days, 'day').toDate();

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
