import { IUserRoleType, RoleHelpers, ROLES } from '@shared/constants/roles.constants';

/**
 * Picks a subset of keys from an object.
 * Used to build explicit allow-lists rather than omit-lists,
 * so new fields added to the service response are not accidentally
 * leaked to restricted roles.
 */
function pick(obj: Record<string, any>, keys: string[]): Record<string, any> {
  const out: Record<string, any> = {};
  for (const key of keys) {
    if (key in obj) out[key] = obj[key];
  }
  return out;
}

/**
 * Fields shared by all roles — no sensitive financial or internal data.
 */
const COMMON_FIELDS = [
  'mruid',
  'cuid',
  'title',
  'description',
  'status',
  'priority',
  'category',
  'createdAt',
  'updatedAt',
  'completedAt',
  'scheduledDate',
  'locationDescription',
  'permissionToEnter',
  'hasPet',
  'availabilityInfo',
  'propertyId',
  'propertyAddress',
  'propertyUnit',
  'vendorId',
  'vendorName',
  'completionNotes',
  'media',
  'notes',
  'isBillable',
  'tenantFeedback',
] as const;

/**
 * Full detail serializer for a single maintenance request.
 *
 * Role allow-lists:
 *   - Employee (PM / admin / staff): full response
 *   - Vendor: own work + financials, no tenant PII or PM-internal fields
 *   - Tenant: minimal — status / scheduling / their invoice summary, no cost or PII
 */
export function serializeMaintenanceRequest(
  data: Record<string, any>,
  role: IUserRoleType
): Record<string, any> {
  if (RoleHelpers.isEmployeeRole(role)) {
    return data;
  }

  if (role === ROLES.VENDOR) {
    const out = pick(data, [
      ...COMMON_FIELDS,
      'assignedAt',
      'workOrder',
      'workOrderHistory',
      'invoice',
    ]);

    // Work order — vendor gets full access (they submitted it)
    // No additional filtering needed

    // Invoice — vendor sees their own payout info, but NOT tenant-facing payment fields
    if (out.invoice) {
      out.invoice = pick(out.invoice, [
        'invuid',
        'submittedAt',
        'amountInCents',
        'currency',
        'description',
        'status',
        'source',
        'attachmentUrl',
        'attachmentKey',
        'reviewedAt',
        'rejectionReason',
        'externalInvoiceId',
        'externalInvoiceUrl',
        'vendorPayoutStatus',
        'vendorPaidAt',
      ]);
    }

    // Assigned technician — vendor coordinates with their own tech; full access
    if (data.assignedTechnician) {
      out.assignedTechnician = data.assignedTechnician;
    }

    return out;
  }

  if (role === ROLES.TENANT) {
    const out = pick(data, [...COMMON_FIELDS, 'assignedAt']);

    // Work order — tenant sees status only (for scheduling context); no cost data
    if (data.workOrder) {
      out.workOrder = pick(data.workOrder, ['status', 'rejectionReason', 'submittedAt']);
    }

    // Invoice — tenant sees their own billing summary; no raw cost or line items
    if (data.invoice) {
      out.invoice = pick(data.invoice, [
        'invuid',
        'status',
        'currency',
        'description',
        'isBillable',
        'attachmentUrl',
        'externalInvoiceUrl',
        'rejectionReason',
        'reviewedAt',
        'tenantPaymentStatus',
      ]);
    }

    // Technician — tenant sees name only (no PII: no phone, no email)
    if (data.assignedTechnician) {
      out.assignedTechnician = pick(data.assignedTechnician, ['name', 'specialization']);
    }

    return out;
  }

  // Fallback: unknown role → return common fields only (fail safe)
  return pick(data, [...COMMON_FIELDS]);
}

/**
 * List-item serializer for maintenance request list responses.
 * List items carry a smaller field set than detail — we primarily guard
 * against tenant/vendor seeing estimatedCost or vendorName on list items.
 */
export function serializeMaintenanceRequestListItem(
  data: Record<string, any>,
  role: IUserRoleType
): Record<string, any> {
  if (RoleHelpers.isEmployeeRole(role)) {
    return data;
  }

  if (role === ROLES.VENDOR) {
    // Vendor list — strip tenant PII and PM-internal fields
    const {
      tenantName,
      tenantId,
      estimatedCost,
      aiAnalysis,
      internalNotes,
      leaseEndDate,
      ...rest
    } = data;
    void tenantName;
    void tenantId;
    void estimatedCost;
    void aiAnalysis;
    void internalNotes;
    void leaseEndDate;
    return rest;
  }

  if (role === ROLES.TENANT) {
    // Tenant list — strip all cost, PM-internal, and PII fields
    const {
      estimatedCost,
      actualCost,
      aiAnalysis,
      internalNotes,
      leaseEndDate,
      tenantName,
      ...rest
    } = data;
    void estimatedCost;
    void actualCost;
    void aiAnalysis;
    void internalNotes;
    void leaseEndDate;
    void tenantName;
    return rest;
  }

  return data;
}
