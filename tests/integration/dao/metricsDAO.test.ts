import dayjs from 'dayjs';
import mongoose from 'mongoose';
import { MetricsDAO } from '@dao/metricsDAO';
import { clearTestDatabase } from '@tests/helpers';
import { MetricType } from '@interfaces/metrics.interface';
import { MetricsSnapshot } from '@models/metrics/metrics.model';

const CUID_A = 'METRICS_CLIENT_A';
const CUID_B = 'METRICS_CLIENT_B';

function makeSnapshot(
  cuid: string,
  metricType: MetricType,
  measurements: Record<string, number>,
  timestamp: Date = new Date()
) {
  return { metadata: { cuid, metricType }, timestamp, measurements };
}

describe('MetricsDAO Integration Tests', () => {
  let dao: MetricsDAO;

  beforeAll(async () => {
    dao = new MetricsDAO({ metricsSnapshotModel: MetricsSnapshot });
    await dao.ensureCollection();
  });

  beforeEach(async () => {
    await clearTestDatabase();
  });

  // ─── ensureCollection ────────────────────────────────────────────────────────

  describe('ensureCollection', () => {
    it('should be idempotent — second call does not throw', async () => {
      await expect(dao.ensureCollection()).resolves.toBeUndefined();
    });

    it('should result in a time-series collection that accepts inserts', async () => {
      await expect(
        MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.PAYMENT, { totalRevenue: 100 }))
      ).resolves.toBeDefined();
    });
  });

  // ─── insertSnapshot ──────────────────────────────────────────────────────────

  describe('insertSnapshot', () => {
    it('should create a document with the correct metadata and measurements', async () => {
      await dao.insertSnapshot(CUID_A, MetricType.PAYMENT, { totalRevenue: 5000, overdueCount: 2 });

      const doc = await MetricsSnapshot.findOne({
        'metadata.cuid': CUID_A,
        'metadata.metricType': MetricType.PAYMENT,
      }).lean();

      expect(doc).not.toBeNull();
      expect(doc!.metadata.cuid).toBe(CUID_A);
      expect(doc!.metadata.metricType).toBe(MetricType.PAYMENT);
      expect(doc!.measurements.totalRevenue).toBe(5000);
      expect(doc!.measurements.overdueCount).toBe(2);
    });

    it('should set a timestamp close to now', async () => {
      const before = new Date();
      await dao.insertSnapshot(CUID_A, MetricType.USER, { total: 10, tenants: 8, staff: 2 });
      const after = new Date();

      const doc = await MetricsSnapshot.findOne({ 'metadata.cuid': CUID_A }).lean();

      expect(doc!.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime());
      expect(doc!.timestamp.getTime()).toBeLessThanOrEqual(after.getTime());
    });

    it('should allow multiple snapshots with different metricTypes for the same cuid', async () => {
      await dao.insertSnapshot(CUID_A, MetricType.PAYMENT, { totalRevenue: 100 });
      await dao.insertSnapshot(CUID_A, MetricType.LEASE, { totalLeases: 5 });
      await dao.insertSnapshot(CUID_A, MetricType.PROPERTY, { total: 10 });

      const count = await MetricsSnapshot.countDocuments({ 'metadata.cuid': CUID_A });
      expect(count).toBe(3);
    });
  });

  // ─── findByDateRange ─────────────────────────────────────────────────────────

  describe('findByDateRange', () => {
    it('should return snapshots within the date range', async () => {
      const t1 = dayjs().subtract(5, 'day').toDate();
      const t2 = dayjs().subtract(3, 'day').toDate();
      const t3 = dayjs().subtract(1, 'day').toDate();

      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.PAYMENT, { v: 1 }, t1));
      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.PAYMENT, { v: 2 }, t2));
      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.PAYMENT, { v: 3 }, t3));

      const from = dayjs().subtract(4, 'day').toDate();
      const to = dayjs().subtract(2, 'day').toDate();

      const results = await dao.findByDateRange(CUID_A, MetricType.PAYMENT, from, to);

      expect(results).toHaveLength(1);
      expect(results[0].measurements.v).toBe(2);
    });

    it('should be inclusive of the from and to boundaries', async () => {
      const from = dayjs().subtract(3, 'day').toDate();
      const to = dayjs().subtract(1, 'day').toDate();

      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.LEASE, { count: 10 }, from));
      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.LEASE, { count: 20 }, to));

      const results = await dao.findByDateRange(CUID_A, MetricType.LEASE, from, to);

      expect(results).toHaveLength(2);
    });

    it('should return results sorted oldest-first', async () => {
      const older = dayjs().subtract(5, 'day').toDate();
      const newer = dayjs().subtract(2, 'day').toDate();

      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.USER, { total: 99 }, newer));
      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.USER, { total: 1 }, older));

      const from = dayjs().subtract(10, 'day').toDate();
      const to = new Date();
      const results = await dao.findByDateRange(CUID_A, MetricType.USER, from, to);

      expect(results[0].measurements.total).toBe(1);
      expect(results[1].measurements.total).toBe(99);
    });

    it('should not return snapshots for a different cuid', async () => {
      const from = dayjs().subtract(10, 'day').toDate();
      const to = new Date();

      await MetricsSnapshot.create(makeSnapshot(CUID_B, MetricType.PAYMENT, { v: 99 }));

      const results = await dao.findByDateRange(CUID_A, MetricType.PAYMENT, from, to);

      expect(results).toHaveLength(0);
    });

    it('should not return snapshots for a different metricType', async () => {
      const from = dayjs().subtract(10, 'day').toDate();
      const to = new Date();

      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.LEASE, { v: 5 }));

      const results = await dao.findByDateRange(CUID_A, MetricType.PAYMENT, from, to);

      expect(results).toHaveLength(0);
    });

    it('should return empty array when no snapshots fall in range', async () => {
      const results = await dao.findByDateRange(
        CUID_A,
        MetricType.MAINTENANCE,
        dayjs().subtract(5, 'day').toDate(),
        dayjs().subtract(4, 'day').toDate()
      );

      expect(results).toEqual([]);
    });
  });

  // ─── findLatest ──────────────────────────────────────────────────────────────

  describe('findLatest', () => {
    it('should return the most recent snapshot for the given cuid and metricType', async () => {
      const older = dayjs().subtract(5, 'day').toDate();
      const newer = dayjs().subtract(1, 'day').toDate();

      await MetricsSnapshot.create(
        makeSnapshot(CUID_A, MetricType.PROPERTY, { occupancyRate: 60 }, older)
      );
      await MetricsSnapshot.create(
        makeSnapshot(CUID_A, MetricType.PROPERTY, { occupancyRate: 75 }, newer)
      );

      const result = await dao.findLatest(CUID_A, MetricType.PROPERTY);

      expect(result).not.toBeNull();
      expect(result!.measurements.occupancyRate).toBe(75);
    });

    it('should return null when no snapshots exist for the cuid', async () => {
      const result = await dao.findLatest('NONEXISTENT_CUID', MetricType.PAYMENT);

      expect(result).toBeNull();
    });

    it('should return null when no snapshots exist for the metricType', async () => {
      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.LEASE, { totalLeases: 3 }));

      const result = await dao.findLatest(CUID_A, MetricType.PAYMENT);

      expect(result).toBeNull();
    });

    it('should not return a snapshot belonging to a different cuid', async () => {
      await MetricsSnapshot.create(makeSnapshot(CUID_B, MetricType.USER, { total: 50 }));

      const result = await dao.findLatest(CUID_A, MetricType.USER);

      expect(result).toBeNull();
    });

    it('should return a single snapshot when only one exists', async () => {
      await dao.insertSnapshot(CUID_A, MetricType.MAINTENANCE, { open: 3 });

      const result = await dao.findLatest(CUID_A, MetricType.MAINTENANCE);

      expect(result).not.toBeNull();
      expect(result!.measurements.open).toBe(3);
    });
  });

  // ─── findSince ───────────────────────────────────────────────────────────────

  describe('findSince', () => {
    it('should return snapshots within the last N days', async () => {
      const withinRange = dayjs().subtract(5, 'day').toDate();
      const outsideRange = dayjs().subtract(15, 'day').toDate();

      await MetricsSnapshot.create(
        makeSnapshot(CUID_A, MetricType.PAYMENT, { totalRevenue: 100 }, withinRange)
      );
      await MetricsSnapshot.create(
        makeSnapshot(CUID_A, MetricType.PAYMENT, { totalRevenue: 999 }, outsideRange)
      );

      const results = await dao.findSince(CUID_A, MetricType.PAYMENT, 10);

      expect(results).toHaveLength(1);
      expect(results[0].measurements.totalRevenue).toBe(100);
    });

    it('should return results sorted oldest-first', async () => {
      const day3 = dayjs().subtract(3, 'day').toDate();
      const day1 = dayjs().subtract(1, 'day').toDate();

      await MetricsSnapshot.create(
        makeSnapshot(CUID_A, MetricType.LEASE, { activeLeases: 20 }, day1)
      );
      await MetricsSnapshot.create(
        makeSnapshot(CUID_A, MetricType.LEASE, { activeLeases: 10 }, day3)
      );

      const results = await dao.findSince(CUID_A, MetricType.LEASE, 7);

      expect(results[0].measurements.activeLeases).toBe(10);
      expect(results[1].measurements.activeLeases).toBe(20);
    });

    it('should not return snapshots belonging to a different cuid', async () => {
      await MetricsSnapshot.create(
        makeSnapshot(
          CUID_B,
          MetricType.PROPERTY,
          { total: 99 },
          dayjs().subtract(1, 'day').toDate()
        )
      );

      const results = await dao.findSince(CUID_A, MetricType.PROPERTY, 7);

      expect(results).toHaveLength(0);
    });

    it('should not return snapshots for a different metricType', async () => {
      await MetricsSnapshot.create(
        makeSnapshot(CUID_A, MetricType.USER, { total: 5 }, dayjs().subtract(1, 'day').toDate())
      );

      const results = await dao.findSince(CUID_A, MetricType.MAINTENANCE, 7);

      expect(results).toHaveLength(0);
    });

    it('should return empty array when no snapshots exist within the window', async () => {
      const results = await dao.findSince(CUID_A, MetricType.PAYMENT, 7);

      expect(results).toEqual([]);
    });

    it('should include all matching snapshots when days window is large', async () => {
      const timestamps = [30, 20, 10, 5, 1].map((d) => dayjs().subtract(d, 'day').toDate());

      await Promise.all(
        timestamps.map((ts, i) =>
          MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.MAINTENANCE, { open: i }, ts))
        )
      );

      const results = await dao.findSince(CUID_A, MetricType.MAINTENANCE, 60);

      expect(results).toHaveLength(5);
    });

    it("should correctly scope data so two clients do not see each other's snapshots", async () => {
      const ts = dayjs().subtract(2, 'day').toDate();

      await MetricsSnapshot.create(makeSnapshot(CUID_A, MetricType.USER, { total: 10 }, ts));
      await MetricsSnapshot.create(makeSnapshot(CUID_B, MetricType.USER, { total: 99 }, ts));

      const resultsA = await dao.findSince(CUID_A, MetricType.USER, 7);
      const resultsB = await dao.findSince(CUID_B, MetricType.USER, 7);

      expect(resultsA).toHaveLength(1);
      expect(resultsA[0].measurements.total).toBe(10);
      expect(resultsB).toHaveLength(1);
      expect(resultsB[0].measurements.total).toBe(99);
    });
  });

  // ─── Connection guard ────────────────────────────────────────────────────────

  describe('ensureCollection — connection guard', () => {
    it('should throw when the mongoose connection has no db reference', async () => {
      const originalDb = mongoose.connection.db;
      (mongoose.connection as any).db = undefined;

      try {
        await expect(dao.ensureCollection()).rejects.toThrow('DB not connected');
      } finally {
        (mongoose.connection as any).db = originalDb;
      }
    });
  });
});
