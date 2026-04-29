/**
 * Migration: rename-fee-fields
 *
 * Standardises fee and specification field names across collections:
 *   - properties.fees.rentalAmount  → fees.rentAmount
 *   - leases.fees.monthlyRent       → fees.rentAmount
 *
 * PropertyUnit already stores specifications.bedrooms — no migration needed.
 *
 * Run this migration BEFORE deploying the new API code that uses the renamed fields.
 *
 * Usage (ts-node):
 *   ts-node app/migrations/rename-fee-fields.ts
 *
 * Or compile and run:
 *   npx tsc app/migrations/rename-fee-fields.ts --outDir dist && node dist/app/migrations/rename-fee-fields.js
 */

import mongoose from 'mongoose';
import * as dotenv from 'dotenv';

dotenv.config();

async function run() {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGO_URI or MONGODB_URI environment variable is required');
  }

  await mongoose.connect(uri);
  const db = mongoose.connection.db;
  if (!db) {
    throw new Error('Failed to get database handle — connection may not be ready');
  }

  console.log('Connected to MongoDB. Starting migration...\n');

  // --- properties: rentalAmount → rentAmount ---
  const propertyResult = await db
    .collection('properties')
    .updateMany({ 'fees.rentalAmount': { $exists: true } }, {
      $rename: { 'fees.rentalAmount': 'fees.rentAmount' },
    } as any);
  console.log(
    `properties: matched=${propertyResult.matchedCount}, modified=${propertyResult.modifiedCount}`
  );

  // --- leases: monthlyRent → rentAmount ---
  const leaseResult = await db
    .collection('leases')
    .updateMany({ 'fees.monthlyRent': { $exists: true } }, {
      $rename: { 'fees.monthlyRent': 'fees.rentAmount' },
    } as any);
  console.log(
    `leases:     matched=${leaseResult.matchedCount}, modified=${leaseResult.modifiedCount}`
  );

  // PropertyUnit: no migration — backend already stores specifications.bedrooms
  console.log('\nMigration complete.');
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
