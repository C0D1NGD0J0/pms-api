/**
 * Migration: run-all (multi-currency enforcement)
 *
 * Backfills three schema changes introduced by the multi-currency enforcement work:
 *   1. maintenancerequests.invoice.currency  'usd' → 'USD'  (uppercase in place)
 *   2. clients.settings.defaultCurrency      backfill 'USD' where field is absent
 *   3. payments.currency                     backfill from linked lease fees.currency, fallback 'USD'
 *
 * leases.fees.currency and expenses.currency are pre-existing fields with a 'USD'
 * default — those collections need no migration.
 *
 * Run BEFORE deploying the new application code.
 *
 * Usage (ts-node):
 *   ts-node -r tsconfig-paths/register app/migrations/run-all.ts
 *
 * Or compile and run:
 *   npx tsc app/migrations/run-all.ts --outDir dist && node dist/app/migrations/run-all.js
 */

import { Db } from 'mongodb';
import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Step 3 — backfill payments.currency from linked lease, fallback 'USD'
// ---------------------------------------------------------------------------
async function backfillPaymentCurrency(db: Db): Promise<void> {
  // Phase 1: find all payments that are missing the currency field
  const payments = await db
    .collection('payments')
    .find({ currency: { $exists: false } }, { projection: { _id: 1, lease: 1 } })
    .toArray();

  if (payments.length === 0) {
    console.log('payment currency:     nothing to migrate');
    return;
  }

  // Phase 2: batch-fetch the linked leases to resolve their fees.currency
  const leaseIds = payments.map((p) => p.lease).filter(Boolean);
  const leases = leaseIds.length
    ? await db
        .collection('leases')
        .find({ _id: { $in: leaseIds } }, { projection: { _id: 1, 'fees.currency': 1 } })
        .toArray()
    : [];

  const leaseCurrencyMap = new Map<string, string>(
    leases.map((l) => [l._id.toString(), l.fees?.currency])
  );

  // Phase 3: one updateOne per payment — lease currency when available, else 'USD'
  const ops = payments.map((p) => ({
    updateOne: {
      filter: { _id: p._id },
      update: { $set: { currency: leaseCurrencyMap.get(p.lease?.toString()) || 'USD' } },
    },
  }));

  const result = await db.collection('payments').bulkWrite(ops, { ordered: false });
  console.log(`payment currency:     matched=${payments.length}, modified=${result.modifiedCount}`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db!;

  console.log('Connected to MongoDB. Running migrations...\n');

  await fixInvoiceCurrencyCase(db);
  await backfillClientDefaultCurrency(db);
  await backfillPaymentCurrency(db);

  console.log('\nAll migrations complete.');
  await mongoose.disconnect();
}

// ---------------------------------------------------------------------------
// Step 1 — uppercase invoice.currency ('usd' → 'USD')
// ---------------------------------------------------------------------------
async function fixInvoiceCurrencyCase(db: Db): Promise<void> {
  const result = await db
    .collection('maintenancerequests')
    .updateMany({ 'invoice.currency': { $exists: true } }, [
      { $set: { 'invoice.currency': { $toUpper: '$invoice.currency' } } },
    ] as any);
  console.log(
    `invoice currency:     matched=${result.matchedCount}, modified=${result.modifiedCount}`
  );
}

// ---------------------------------------------------------------------------
// Step 2 — backfill clients.settings.defaultCurrency
// ---------------------------------------------------------------------------
async function backfillClientDefaultCurrency(db: Db): Promise<void> {
  const result = await db
    .collection('clients')
    .updateMany(
      { 'settings.defaultCurrency': { $exists: false } },
      { $set: { 'settings.defaultCurrency': 'USD' } }
    );
  console.log(
    `client defaultCurrency: matched=${result.matchedCount}, modified=${result.modifiedCount}`
  );
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
