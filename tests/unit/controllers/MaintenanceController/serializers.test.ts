import { ROLES } from '@shared/constants/roles.constants';
import {
  serializeMaintenanceRequestListItem,
  serializeMaintenanceRequest,
} from '@controllers/MaintenanceController/serializers';

// ── Fixture ───────────────────────────────────────────────────────────────────

const full: Record<string, any> = {
  mruid: 'MR-001',
  cuid: 'cuid-1',
  title: 'Leaking faucet',
  description: 'Kitchen sink drips',
  status: 'in_progress',
  priority: 'normal',
  category: 'plumbing',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
  completedAt: null,
  scheduledDate: null,
  locationDescription: 'Kitchen',
  permissionToEnter: true,
  hasPet: false,
  availabilityInfo: 'Weekdays',
  propertyId: 'prop-1',
  propertyAddress: '123 Main St',
  propertyUnit: 'Unit 1',
  vendorId: 'v-1',
  vendorName: 'ACME Repairs',
  completionNotes: null,
  media: [],
  notes: [],
  isBillable: true,
  tenantFeedback: null,
  assignedAt: '2026-01-01T12:00:00Z',

  // PM-internal / sensitive fields
  estimatedCost: 500,
  actualCost: 450,
  aiAnalysis: { summary: 'Routine fix', confidence: 0.9 },
  tenantName: 'Jane Doe',
  tenantId: 'tenant-obj-id',
  leaseEndDate: '2026-12-31',
  internalNotes: 'Landlord aware',

  workOrder: {
    status: 'approved',
    submittedAt: '2026-01-03T00:00:00Z',
    rejectionReason: null,
    estimatedCostInCents: 20000,
    actualCostInCents: 18000,
  },
  workOrderHistory: [{ status: 'pending_review', changedAt: '2026-01-02T00:00:00Z' }],

  invoice: {
    invuid: 'inv-1',
    submittedAt: '2026-01-04T00:00:00Z',
    amountInCents: 20000,
    currency: 'usd',
    description: 'Faucet repair',
    status: 'approved',
    source: 'vendor',
    lineItems: [
      { desc: 'Labour', amountInCents: 15000 },
      { desc: 'Parts', amountInCents: 5000 },
    ],
    attachmentUrl: 'https://example.com/inv.pdf',
    attachmentKey: 'inv.pdf',
    reviewedAt: '2026-01-05T00:00:00Z',
    rejectionReason: null,
    externalInvoiceId: 'ext-1',
    externalInvoiceUrl: 'https://stripe.com/inv/1',
    vendorPayoutStatus: 'pending',
    vendorPaidAt: null,
    isBillable: true,
    tenantPaymentStatus: 'unpaid',
  },

  assignedTechnician: {
    name: 'John Smith',
    specialization: 'plumbing',
    phone: '555-1234',
    email: 'john@example.com',
  },
};

const listItem: Record<string, any> = {
  mruid: 'MR-001',
  cuid: 'cuid-1',
  title: 'Leaking faucet',
  status: 'in_progress',
  priority: 'normal',
  estimatedCost: 500,
  actualCost: 450,
  aiAnalysis: { summary: 'Routine fix' },
  tenantName: 'Jane Doe',
  tenantId: 'tenant-obj-id',
  leaseEndDate: '2026-12-31',
  internalNotes: 'Landlord aware',
  createdAt: '2026-01-01T00:00:00Z',
};

// ── serializeMaintenanceRequest ───────────────────────────────────────────────

describe('serializeMaintenanceRequest — employee roles', () => {
  const employeeRoles = [ROLES.MANAGER, ROLES.ADMIN, ROLES.STAFF, ROLES.SUPER_ADMIN] as const;

  it.each(employeeRoles)('%s: returns the full response unchanged', (role) => {
    const result = serializeMaintenanceRequest(full, role);
    expect(result).toBe(full); // same reference — no copy
  });

  it('manager: retains estimatedCost, aiAnalysis, leaseEndDate', () => {
    const result = serializeMaintenanceRequest(full, ROLES.MANAGER);
    expect(result.estimatedCost).toBe(500);
    expect(result.aiAnalysis).toBeDefined();
    expect(result.leaseEndDate).toBe('2026-12-31');
  });

  it('manager: retains invoice.lineItems and assignedTechnician.email', () => {
    const result = serializeMaintenanceRequest(full, ROLES.MANAGER);
    expect(result.invoice.lineItems).toHaveLength(2);
    expect(result.assignedTechnician.email).toBe('john@example.com');
  });
});

describe('serializeMaintenanceRequest — vendor role', () => {
  let result: Record<string, any>;

  beforeEach(() => {
    result = serializeMaintenanceRequest(full, ROLES.VENDOR);
  });

  it('strips PM-internal cost fields', () => {
    expect(result.estimatedCost).toBeUndefined();
    expect(result.actualCost).toBeUndefined();
  });

  it('strips AI analysis and internal notes', () => {
    expect(result.aiAnalysis).toBeUndefined();
    expect(result.internalNotes).toBeUndefined();
  });

  it('strips tenant PII fields', () => {
    expect(result.tenantName).toBeUndefined();
    expect(result.tenantId).toBeUndefined();
    expect(result.leaseEndDate).toBeUndefined();
  });

  it('retains workOrder (vendor submitted it) including estimatedCostInCents', () => {
    expect(result.workOrder).toBeDefined();
    expect(result.workOrder.estimatedCostInCents).toBe(20000);
  });

  it('retains workOrderHistory', () => {
    expect(result.workOrderHistory).toBeDefined();
    expect(result.workOrderHistory).toHaveLength(1);
  });

  it('strips invoice.lineItems but keeps payout fields', () => {
    expect(result.invoice.lineItems).toBeUndefined();
    expect(result.invoice.amountInCents).toBe(20000);
    expect(result.invoice.vendorPayoutStatus).toBe('pending');
    expect(result.invoice.vendorPaidAt).toBeNull();
  });

  it('retains assignedTechnician in full (vendor coordinates with their tech)', () => {
    expect(result.assignedTechnician.phone).toBe('555-1234');
    expect(result.assignedTechnician.email).toBe('john@example.com');
  });

  it('retains common fields', () => {
    expect(result.mruid).toBe('MR-001');
    expect(result.title).toBe('Leaking faucet');
    expect(result.status).toBe('in_progress');
    expect(result.vendorName).toBe('ACME Repairs');
  });
});

describe('serializeMaintenanceRequest — tenant role', () => {
  let result: Record<string, any>;

  beforeEach(() => {
    result = serializeMaintenanceRequest(full, ROLES.TENANT);
  });

  it('strips all cost fields', () => {
    expect(result.estimatedCost).toBeUndefined();
    expect(result.actualCost).toBeUndefined();
  });

  it('strips AI analysis, internal notes, and lease end date', () => {
    expect(result.aiAnalysis).toBeUndefined();
    expect(result.internalNotes).toBeUndefined();
    expect(result.leaseEndDate).toBeUndefined();
  });

  it('strips workOrder cost figures', () => {
    expect(result.workOrder?.estimatedCostInCents).toBeUndefined();
    expect(result.workOrder?.actualCostInCents).toBeUndefined();
  });

  it('retains workOrder status and rejectionReason for scheduling context', () => {
    expect(result.workOrder?.status).toBe('approved');
    expect(result.workOrder?.rejectionReason).toBeNull();
  });

  it('strips invoice.lineItems and financial amounts', () => {
    expect(result.invoice?.lineItems).toBeUndefined();
    expect(result.invoice?.amountInCents).toBeUndefined();
  });

  it('retains invoice status, isBillable, and tenant payment status', () => {
    expect(result.invoice?.status).toBe('approved');
    expect(result.invoice?.isBillable).toBe(true);
    expect(result.invoice?.tenantPaymentStatus).toBe('unpaid');
  });

  it('strips assignedTechnician phone and email (PII)', () => {
    expect(result.assignedTechnician?.phone).toBeUndefined();
    expect(result.assignedTechnician?.email).toBeUndefined();
  });

  it('retains assignedTechnician name and specialization', () => {
    expect(result.assignedTechnician?.name).toBe('John Smith');
    expect(result.assignedTechnician?.specialization).toBe('plumbing');
  });

  it('retains common fields', () => {
    expect(result.mruid).toBe('MR-001');
    expect(result.title).toBe('Leaking faucet');
    expect(result.status).toBe('in_progress');
  });
});

describe('serializeMaintenanceRequest — unknown role fallback', () => {
  it('returns only COMMON_FIELDS for an unrecognised role', () => {
    const result = serializeMaintenanceRequest(full, 'unknown-role' as any);
    expect(result.estimatedCost).toBeUndefined();
    expect(result.aiAnalysis).toBeUndefined();
    expect(result.leaseEndDate).toBeUndefined();
    expect(result.workOrder).toBeUndefined();
    expect(result.invoice).toBeUndefined();
    expect(result.assignedTechnician).toBeUndefined();
    // Common fields still present
    expect(result.mruid).toBe('MR-001');
    expect(result.status).toBe('in_progress');
  });
});

describe('serializeMaintenanceRequest — missing nested objects', () => {
  const withoutNested = {
    ...full,
    workOrder: undefined,
    invoice: undefined,
    assignedTechnician: undefined,
  };

  it('vendor: handles missing invoice gracefully', () => {
    const result = serializeMaintenanceRequest(withoutNested, ROLES.VENDOR);
    expect(result.invoice).toBeUndefined();
    expect(result.assignedTechnician).toBeUndefined();
  });

  it('tenant: handles missing workOrder gracefully', () => {
    const result = serializeMaintenanceRequest(withoutNested, ROLES.TENANT);
    expect(result.workOrder).toBeUndefined();
    expect(result.invoice).toBeUndefined();
  });
});

// ── serializeMaintenanceRequestListItem ──────────────────────────────────────

describe('serializeMaintenanceRequestListItem — employee roles', () => {
  it('manager: returns data unchanged', () => {
    const result = serializeMaintenanceRequestListItem(listItem, ROLES.MANAGER);
    expect(result).toBe(listItem);
  });
});

describe('serializeMaintenanceRequestListItem — vendor role', () => {
  let result: Record<string, any>;

  beforeEach(() => {
    result = serializeMaintenanceRequestListItem(listItem, ROLES.VENDOR);
  });

  it('strips tenantName and tenantId', () => {
    expect(result.tenantName).toBeUndefined();
    expect(result.tenantId).toBeUndefined();
  });

  it('strips estimatedCost, aiAnalysis, and internalNotes', () => {
    expect(result.estimatedCost).toBeUndefined();
    expect(result.aiAnalysis).toBeUndefined();
    expect(result.internalNotes).toBeUndefined();
  });

  it('strips leaseEndDate', () => {
    expect(result.leaseEndDate).toBeUndefined();
  });

  it('retains status and title', () => {
    expect(result.status).toBe('in_progress');
    expect(result.title).toBe('Leaking faucet');
  });
});

describe('serializeMaintenanceRequestListItem — tenant role', () => {
  let result: Record<string, any>;

  beforeEach(() => {
    result = serializeMaintenanceRequestListItem(listItem, ROLES.TENANT);
  });

  it('strips estimatedCost and actualCost', () => {
    expect(result.estimatedCost).toBeUndefined();
    expect(result.actualCost).toBeUndefined();
  });

  it('strips aiAnalysis, internalNotes, leaseEndDate, tenantName', () => {
    expect(result.aiAnalysis).toBeUndefined();
    expect(result.internalNotes).toBeUndefined();
    expect(result.leaseEndDate).toBeUndefined();
    expect(result.tenantName).toBeUndefined();
  });

  it('retains status, title, and mruid', () => {
    expect(result.status).toBe('in_progress');
    expect(result.title).toBe('Leaking faucet');
    expect(result.mruid).toBe('MR-001');
  });
});
