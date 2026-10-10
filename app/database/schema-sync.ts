/**
 * Schema Sync — Backfill missing fields on existing documents at startup.
 *
 * Mongoose only applies `default:` values when creating NEW documents.
 * Existing records that predate a schema change will be missing the field entirely.
 * This module runs lightweight `updateMany` operations to backfill those gaps.
 *
 * Each rule is idempotent and uses `{ field: { $exists: false } }` as its filter,
 * so it only touches records that actually need patching and becomes a no-op
 * once every document has the field.
 *
 * Add new rules to the SYNC_RULES array when you add a new field with a default
 * to any model. Remove rules once you're confident all environments are patched.
 *
 * Usage: called once from server.ts after `dbService.connect()`.
 */

import mongoose from 'mongoose';
import { createLogger } from '@utils/helpers';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@services/notification/notificationPolicy';

interface SyncRule {
  /** Filter to find documents needing the patch */
  filter: Record<string, unknown>;
  /** $set payload to apply */
  update: Record<string, unknown>;
  /** MongoDB collection name (lowercase plural, e.g. 'vendors') */
  collection: string;
  /** Human-readable label for logging */
  label: string;
}

interface CleanupRule {
  filter: Record<string, unknown>;
  unset: Record<string, 1>;
  collection: string;
  label: string;
}

const SYNC_RULES: SyncRule[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // VENDORS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'vendor.connectedClients.payoutAccount',
    collection: 'vendors',
    filter: { 'connectedClients.payoutAccount': { $exists: false } },
    update: {
      'connectedClients.$[].payoutAccount': {
        isSetup: false,
        payoutsEnabled: false,
        chargesEnabled: false,
        payoutsBlocked: false,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // INVOICES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'invoice.fundsAvailable',
    collection: 'invoices',
    filter: { fundsAvailable: { $exists: false } },
    update: { fundsAvailable: false, fundsAvailableAt: null },
  },
  {
    label: 'invoice.vendorPayoutStatus',
    collection: 'invoices',
    filter: { vendorPayoutStatus: { $exists: false } },
    update: { vendorPayoutStatus: 'pending' },
  },
  {
    label: 'invoice.tenantPaymentStatus',
    collection: 'invoices',
    filter: { tenantPaymentStatus: { $exists: false } },
    update: { tenantPaymentStatus: 'unpaid' },
  },
  {
    label: 'invoice.currency',
    collection: 'invoices',
    filter: { currency: { $exists: false } },
    update: { currency: 'USD' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENT PROCESSORS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'paymentProcessor.ownerType',
    collection: 'paymentprocessors',
    filter: { ownerType: { $exists: false } },
    update: { ownerType: 'client' },
  },
  {
    label: 'paymentProcessor.payoutsBlocked',
    collection: 'paymentprocessors',
    filter: { payoutsBlocked: { $exists: false } },
    update: { payoutsBlocked: false },
  },
  {
    label: 'paymentProcessor.payoutsPaused',
    collection: 'paymentprocessors',
    filter: { payoutsPaused: { $exists: false } },
    update: { payoutsPaused: false },
  },
  {
    label: 'paymentProcessor.disputeStats',
    collection: 'paymentprocessors',
    filter: { disputeStats: { $exists: false } },
    update: { disputeStats: { total: 0, open: 0 } },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PAYMENTS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'payment.currency',
    collection: 'payments',
    filter: { currency: { $exists: false } },
    update: { currency: 'USD' },
  },
  {
    label: 'payment.isManualEntry',
    collection: 'payments',
    filter: { isManualEntry: { $exists: false } },
    update: { isManualEntry: false },
  },
  {
    label: 'payment.processingFee',
    collection: 'payments',
    filter: { processingFee: { $exists: false } },
    update: { processingFee: 0, applicationFee: 0, platformRevenue: 0 },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // CLIENTS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'client.settings.defaultCurrency',
    collection: 'clients',
    filter: { 'settings.defaultCurrency': { $exists: false } },
    update: { 'settings.defaultCurrency': 'USD' },
  },
  {
    label: 'client.settings.vendorPayoutMode',
    collection: 'clients',
    filter: { 'settings.vendorPayoutMode': { $exists: false } },
    update: { 'settings.vendorPayoutMode': 'platform_hold' },
  },
  {
    label: 'client.settings.timeZone',
    collection: 'clients',
    filter: { 'settings.timeZone': { $exists: false } },
    update: { 'settings.timeZone': 'UTC', 'settings.lang': 'en' },
  },
  {
    label: 'client.settings.tenantFeatures',
    collection: 'clients',
    filter: { 'settings.tenantFeatures': { $exists: false } },
    update: {
      'settings.tenantFeatures': {
        tenantPortalActive: true,
        onlinePayments: true,
        maintenanceRequests: true,
        smsNotifications: false,
        guestPass: false,
      },
    },
  },
  {
    label: 'client.dataProcessingConsent',
    collection: 'clients',
    filter: { dataProcessingConsent: { $exists: false } },
    update: { dataProcessingConsent: false },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // USERS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'user.cuids.isFormerTenant',
    collection: 'users',
    filter: { 'cuids.isFormerTenant': { $exists: false } },
    update: { 'cuids.$[].isFormerTenant': false, 'cuids.$[].leaseExpiredAt': null },
  },
  {
    label: 'user.cuids.requiresOnboarding',
    collection: 'users',
    filter: { 'cuids.requiresOnboarding': { $exists: false } },
    update: { 'cuids.$[].requiresOnboarding': false },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // LEASES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'lease.fees.currency',
    collection: 'leases',
    filter: { 'fees.currency': { $exists: false } },
    update: { 'fees.currency': 'USD' },
  },
  {
    label: 'lease.includeManagementFee',
    collection: 'leases',
    filter: { includeManagementFee: { $exists: false } },
    update: { includeManagementFee: false, includeParkingInfo: false },
  },
  {
    label: 'lease.generateFirstPaymentOnActivation',
    collection: 'leases',
    filter: { generateFirstPaymentOnActivation: { $exists: false } },
    update: { generateFirstPaymentOnActivation: false },
  },
  {
    label: 'lease.renewalOptions',
    collection: 'leases',
    filter: { renewalOptions: { $exists: false } },
    update: {
      renewalOptions: {
        autoRenew: false,
        noticePeriodDays: 30,
        autoApproveRenewal: false,
        daysBeforeExpiryToGenerateRenewal: 14,
        daysBeforeExpiryToAutoSendSignature: 7,
        enableAutoSendForSignature: true,
      },
    },
  },
  // requireApproval → autoApproveRenewal rename (inverted). Must run before the backfill below.
  {
    label: 'lease.renewalOptions.autoApproveRenewal: migrate requireApproval=false',
    collection: 'leases',
    filter: {
      'renewalOptions.requireApproval': false,
      'renewalOptions.autoApproveRenewal': { $exists: false },
    },
    update: { 'renewalOptions.autoApproveRenewal': true },
  },
  // autoRenew leases were always auto-approved (autoRenew used to force approval) — keep that behaviour
  {
    label: 'lease.renewalOptions.autoApproveRenewal: preserve for autoRenew leases',
    collection: 'leases',
    filter: {
      'renewalOptions.autoRenew': true,
      'renewalOptions.autoApproveRenewal': { $exists: false },
    },
    update: { 'renewalOptions.autoApproveRenewal': true },
  },
  {
    label: 'lease.renewalOptions.autoApproveRenewal',
    collection: 'leases',
    filter: {
      renewalOptions: { $exists: true },
      'renewalOptions.autoApproveRenewal': { $exists: false },
    },
    update: { 'renewalOptions.autoApproveRenewal': false },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROPERTIES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'property.fees.currency',
    collection: 'properties',
    filter: { 'fees.currency': { $exists: false } },
    update: { 'fees.currency': 'USD' },
  },
  {
    label: 'property.occupancyStatus',
    collection: 'properties',
    filter: { occupancyStatus: { $exists: false } },
    update: { occupancyStatus: 'vacant' },
  },
  {
    label: 'property.assignedStaff',
    collection: 'properties',
    filter: { assignedStaff: { $exists: false } },
    update: { assignedStaff: [] },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // UNITS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'unit.fees.currency',
    collection: 'units',
    filter: { 'fees.currency': { $exists: false } },
    update: { 'fees.currency': 'USD' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // EXPENSES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'expense.currency',
    collection: 'expenses',
    filter: { currency: { $exists: false } },
    update: { currency: 'USD' },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'subscription.entitlements',
    collection: 'subscriptions',
    filter: { entitlements: { $exists: false } },
    update: {
      entitlements: {
        eSignature: false,
        reportingAnalytics: false,
        leaseTemplates: false,
        vendorManagement: false,
        prioritySupport: false,
        aiTriage: false,
        aiInvoiceScanning: false,
      },
    },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // MAINTENANCE REQUESTS
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'maintenanceRequest.isBillable',
    collection: 'maintenancerequests',
    filter: { isBillable: { $exists: false } },
    update: { isBillable: false },
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // PROFILES
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'profile.settings.notifications',
    collection: 'profiles',
    filter: { 'settings.notifications': { $exists: false } },
    update: {
      'settings.notifications': { ...DEFAULT_NOTIFICATION_SETTINGS },
    },
  },
  {
    label: 'profile.settings.notifications.leases',
    collection: 'profiles',
    filter: {
      'settings.notifications': { $exists: true },
      'settings.notifications.leases': { $exists: false },
    },
    // The legacy `system` switch is folded in by the notification-categories migration
    update: { 'settings.notifications.leases': true },
  },
  {
    label: 'profile.settings.notifications.approvals',
    collection: 'profiles',
    filter: {
      'settings.notifications': { $exists: true },
      'settings.notifications.approvals': { $exists: false },
    },
    // The legacy `system` switch is folded in by the notification-categories migration
    update: { 'settings.notifications.approvals': true },
  },
  {
    label: 'profile.settings.notifications.guestPasses',
    collection: 'profiles',
    filter: {
      'settings.notifications': { $exists: true },
      'settings.notifications.guestPasses': { $exists: false },
    },
    // The legacy `system` switch is folded in by the notification-categories migration
    update: { 'settings.notifications.guestPasses': true },
  },
  {
    label: 'profile.settings.theme',
    collection: 'profiles',
    filter: { 'settings.theme': { $exists: false } },
    update: { 'settings.theme': 'light' },
  },
  {
    label: 'subscription.smsUsage',
    collection: 'subscriptions',
    filter: { smsUsage: { $exists: false } },
    update: {
      smsUsage: {
        countThisPeriod: 0,
        periodStart: new Date(),
        lastResetAt: null,
        notifiedAt80: false,
        notifiedAt100: false,
      },
    },
  },
  {
    label: 'subscription.reportGenerationUsage',
    collection: 'subscriptions',
    filter: { reportGenerationUsage: { $exists: false } },
    update: {
      reportGenerationUsage: {
        countThisPeriod: 0,
        periodStart: new Date(),
      },
    },
  },
  {
    label: 'subscription.reportGenerationUsage.periodStart',
    collection: 'subscriptions',
    filter: {
      reportGenerationUsage: { $exists: true },
      'reportGenerationUsage.periodStart': { $exists: false },
    },
    update: {
      'reportGenerationUsage.periodStart': new Date(),
    },
  },
];

const CLEANUP_RULES: CleanupRule[] = [
  // ═══════════════════════════════════════════════════════════════════════════
  // LEASES — renamed to renewalOptions.autoApproveRenewal
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'lease.renewalOptions: remove renamed requireApproval',
    collection: 'leases',
    filter: { 'renewalOptions.requireApproval': { $exists: true } },
    unset: { 'renewalOptions.requireApproval': 1 },
  },
  // ═══════════════════════════════════════════════════════════════════════════
  // SUBSCRIPTIONS — remove stale entitlement fields
  // ═══════════════════════════════════════════════════════════════════════════
  {
    label: 'subscription.entitlements: remove stale leaseTemplate (singular)',
    collection: 'subscriptions',
    filter: { 'entitlements.leaseTemplate': { $exists: true } },
    unset: { 'entitlements.leaseTemplate': 1 },
  },
  {
    label: 'subscription.entitlements: remove stale RepairRequestService',
    collection: 'subscriptions',
    filter: { 'entitlements.RepairRequestService': { $exists: true } },
    unset: { 'entitlements.RepairRequestService': 1 },
  },
  {
    label: 'subscription.entitlements: remove stale GUESTPASSService',
    collection: 'subscriptions',
    filter: { 'entitlements.GUESTPASSService': { $exists: true } },
    unset: { 'entitlements.GUESTPASSService': 1 },
  },
  {
    label: 'subscription.entitlements: remove stale GuestPassService (wrong casing)',
    collection: 'subscriptions',
    filter: { 'entitlements.GuestPassService': { $exists: true } },
    unset: { 'entitlements.GuestPassService': 1 },
  },
  {
    label: 'subscription.entitlements: remove stale VisitorPassService',
    collection: 'subscriptions',
    filter: { 'entitlements.VisitorPassService': { $exists: true } },
    unset: { 'entitlements.VisitorPassService': 1 },
  },
  {
    label: 'subscription.entitlements: remove stale MaintenanceRequestService (wrong casing)',
    collection: 'subscriptions',
    filter: { 'entitlements.MaintenanceRequestService': { $exists: true } },
    unset: { 'entitlements.MaintenanceRequestService': 1 },
  },
];

export async function runSchemaSync(): Promise<void> {
  const log = createLogger('SchemaSync');
  const db = mongoose.connection.db;

  if (!db) {
    log.warn('No database connection — skipping schema sync');
    return;
  }

  let patched = 0;

  for (const rule of SYNC_RULES) {
    try {
      const result = await db
        .collection(rule.collection)
        .updateMany(rule.filter, { $set: rule.update });

      if (result.modifiedCount > 0) {
        log.info(`[${rule.label}] backfilled ${result.modifiedCount} documents`);
        patched += result.modifiedCount;
      }
    } catch (err: any) {
      log.error(`[${rule.label}] failed: ${err.message}`);
    }
  }

  for (const rule of CLEANUP_RULES) {
    try {
      const ops: Record<string, unknown> = { $unset: rule.unset };

      const result = await db.collection(rule.collection).updateMany(rule.filter, ops);

      if (result.modifiedCount > 0) {
        log.info(`[${rule.label}] cleaned ${result.modifiedCount} documents`);
        patched += result.modifiedCount;
      }
    } catch (err: any) {
      log.error(`[${rule.label}] failed: ${err.message}`);
    }
  }

  // ── Subscription entitlements: re-sync from platform config ──
  // When new entitlement keys are added to platform.config.json, existing
  // subscriptions won't have them. This merges the plan's canonical features
  // into each subscription without overwriting keys that are already set.
  try {
    const platformConfig = await import('@services/subscription/platform.config.json');
    const plans = platformConfig.subscriptionPlans as Record<
      string,
      { features?: Record<string, boolean> }
    >;

    for (const [planName, planDef] of Object.entries(plans)) {
      if (!planDef.features) continue;

      // Build $set for missing keys only: { 'entitlements.aiTriage': true, ... }
      const setFields: Record<string, boolean> = {};
      for (const [key, value] of Object.entries(planDef.features)) {
        setFields[`entitlements.${key}`] = value;
      }

      // Only update subscriptions where at least one key is missing
      const missingFilter = Object.keys(planDef.features).map((key) => ({
        [`entitlements.${key}`]: { $exists: false },
      }));

      const result = await db
        .collection('subscriptions')
        .updateMany({ planName, $or: missingFilter }, { $set: setFields });

      if (result.modifiedCount > 0) {
        log.info(
          `[subscription.entitlements.${planName}] synced ${result.modifiedCount} subscriptions`
        );
        patched += result.modifiedCount;
      }
    }
  } catch (err: any) {
    log.error(`[subscription.entitlements] plan sync failed: ${err.message}`);
  }

  try {
    const relinked = await relinkDepositTenantsToProfiles(db);
    if (relinked > 0) {
      log.info(`[payments.security_deposit.tenant] relinked ${relinked} deposits to profiles`);
      patched += relinked;
    }
  } catch (err: any) {
    log.error(`[payments.security_deposit.tenant] relink failed: ${err.message}`);
  }

  if (patched === 0) {
    log.info('All collections in sync — nothing to patch');
  } else {
    log.info(`Schema sync complete — ${patched} documents patched`);
  }
}

/**
 * Security-deposit records used to store the tenant's User _id in `tenant`, while every other
 * payment stores the Profile _id. Rewrites those to the matching Profile _id. Idempotent: a
 * deposit whose `tenant` already resolves to a profile is left untouched.
 */
export async function relinkDepositTenantsToProfiles(
  db: NonNullable<typeof mongoose.connection.db>
): Promise<number> {
  const payments = db.collection('payments');
  const profiles = db.collection('profiles');
  let relinked = 0;

  const deposits = payments.find(
    { paymentType: 'security_deposit', tenant: { $exists: true } },
    { projection: { _id: 1, tenant: 1 } }
  );

  for await (const deposit of deposits) {
    const isProfileId = await profiles.countDocuments({ _id: deposit.tenant }, { limit: 1 });
    if (isProfileId) continue;

    const profile = await profiles.findOne({ user: deposit.tenant }, { projection: { _id: 1 } });
    if (!profile) continue;

    const result = await payments.updateOne(
      { _id: deposit._id, tenant: deposit.tenant },
      { $set: { tenant: profile._id } }
    );
    relinked += result.modifiedCount;
  }

  return relinked;
}
