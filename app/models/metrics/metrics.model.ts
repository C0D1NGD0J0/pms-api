import mongoose, { Schema } from 'mongoose';
import { IMetricsSnapshot, MetricType } from '@interfaces/metrics.interface';

const MetricsSnapshotSchema = new Schema(
  {
    metadata: {
      cuid: { type: String, required: true },
      metricType: { type: String, enum: Object.values(MetricType), required: true },
    },
    timestamp: { type: Date, required: true },
    measurements: { type: Schema.Types.Mixed, required: true },
  },
  {
    timeseries: {
      timeField: 'timestamp',
      metaField: 'metadata',
      granularity: 'hours',
    },
    autoCreate: false,
    versionKey: false,
    collection: 'metrics_snapshots',
  }
);

export const MetricsSnapshot = mongoose.model<IMetricsSnapshot>(
  'MetricsSnapshot',
  MetricsSnapshotSchema,
  'metrics_snapshots'
);
