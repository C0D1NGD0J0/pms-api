/**
 * System Bot Seed Script
 *
 * Creates a reserved system bot user for audit trail entries in system-initiated
 * actions (cron jobs, webhooks, offboarding). This user is created once and never
 * recreated — its ObjectId is used as `lastModifiedBy.userId` wherever the system
 * modifies a lease or other audited document.
 *
 * ─── How to run ───────────────────────────────────────────────────────────────
 *
 *  DEV_DB_URL="mongodb://localhost:27017/pms-dev" \
 *    npx ts-node -r tsconfig-paths/register scripts/seeds/seed-system-bot.ts
 *
 *  Or with a remote DB:
 *  PROD_DB_URL="mongodb+srv://user:pass@cluster/dbname" \
 *    npx ts-node -r tsconfig-paths/register scripts/seeds/seed-system-bot.ts
 *
 * The script is idempotent — if the bot user already exists, it logs the existing
 * ObjectId and exits without changes.
 */

import path from 'path';
import { config } from 'dotenv';
import mongoose, { Types } from 'mongoose';

config({ path: path.resolve(__dirname, '../../.env') });

import UserModel from '../../app/models/user/user.model';

// ─── Config ───────────────────────────────────────────────────────────────────

const MONGO_URI = process.env.DEV_DB_URL;
const SYSTEM_BOT_EMAIL = 'system-bot@propertydesk.internal';
const SYSTEM_BOT_UID = 'SYSTEM_BOT_01';
const PLATFORM_CUID = 'PLATFORM';

// ─── Seed ─────────────────────────────────────────────────────────────────────

async function seed() {
  console.log('\n───────────────────────────────────────────────────────');
  console.log('  Seeding system bot user');
  console.log('───────────────────────────────────────────────────────\n');

  // Never recreate — always reuse the existing bot
  const existing = await UserModel.findOne({ uid: SYSTEM_BOT_UID });
  if (existing) {
    console.log('  System bot already exists — skipping.');
    console.log(`  _id:   ${existing._id}`);
    console.log(`  uid:   ${existing.uid}`);
    console.log(`  email: ${existing.email}`);
    console.log('\n  Use this _id for SYSTEM_BOT_USER_ID in your .env\n');
    return;
  }

  const botId = new Types.ObjectId();

  await UserModel.create({
    _id: botId,
    uid: SYSTEM_BOT_UID,
    email: SYSTEM_BOT_EMAIL,
    password: 'NOLOGIN', // bot cannot authenticate — no valid bcrypt hash
    isActive: false,
    activecuid: PLATFORM_CUID,
    cuids: [
      {
        cuid: PLATFORM_CUID,
        roles: ['staff'],
        primaryRole: 'staff',
        clientDisplayName: 'System',
        isConnected: false,
        requiresOnboarding: false,
      },
    ],
    consent: {
      acceptedOn: new Date(),
      acceptedBy: 'seed-script',
    },
    activationToken: '',
    passwordResetToken: '',
  });

  console.log('  System bot created successfully.');
  console.log(`  _id:   ${botId}`);
  console.log(`  uid:   ${SYSTEM_BOT_UID}`);
  console.log(`  email: ${SYSTEM_BOT_EMAIL}`);
  console.log('\n  Add to your .env:');
  console.log(`  SYSTEM_BOT_USER_ID=${botId}\n`);
}

// ─── Run ──────────────────────────────────────────────────────────────────────

(async () => {
  if (!MONGO_URI) {
    console.error('Set DEV_DB_URL or PROD_DB_URL in .env');
    process.exit(1);
  }
  await mongoose.connect(MONGO_URI);
  try {
    await seed();
  } finally {
    await mongoose.disconnect();
  }
})();
