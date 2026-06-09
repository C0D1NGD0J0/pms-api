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
        smsNotifications: true,
        visitorPass: true,
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
        requireApproval: true,
        daysBeforeExpiryToGenerateRenewal: 14,
        daysBeforeExpiryToAutoSendSignature: 7,
        enableAutoSendForSignature: true,
      },
    },
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
        MaintenanceRequestService: false,
        VisitorPassService: false,
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
      'settings.notifications': {
        messages: false,
        comments: false,
        announcements: true,
        maintenance: true,
        payments: true,
        system: true,
        propertyUpdates: true,
        emailNotifications: true,
        inAppNotifications: true,
        emailFrequency: 'immediate',
      },
    },
  },
  {
    label: 'profile.settings.theme',
    collection: 'profiles',
    filter: { 'settings.theme': { $exists: false } },
    update: { 'settings.theme': 'light' },
  },
];

const CLEANUP_RULES: CleanupRule[] = [
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

  if (patched === 0) {
    log.info('All collections in sync — nothing to patch');
  } else {
    log.info(`Schema sync complete — ${patched} documents patched`);
  }
}
