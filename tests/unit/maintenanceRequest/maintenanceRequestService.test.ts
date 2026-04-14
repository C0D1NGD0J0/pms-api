import { Types } from 'mongoose';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { InvoiceStatus, MaintenanceRequestStatus } from '@interfaces/maintenanceRequest.interface';
import { IRequestContext } from '@interfaces/utils.interface';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';

// ---------------------------------------------------------------------------
// Mock dependencies — only system-boundary objects need mocking here.
// DAOs are mocked because we are testing pure business-rule logic, not DB I/O.
// ---------------------------------------------------------------------------

const mockDAO = {
  getByMruid: jest.fn(),
  findFirst: jest.fn(),
  list: jest.fn(),
  listWithDetails: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  startSession: jest.fn().mockResolvedValue({}),
  withTransaction: jest.fn((session: unknown, cb: (s: unknown) => unknown) => cb(session)),
  getStats: jest.fn(),
} as any;

const mockPropertyDAO = { findFirst: jest.fn() } as any;
const mockPropertyUnitDAO = { findFirst: jest.fn() } as any;
const mockVendorDAO = { findFirst: jest.fn() } as any;
const mockUserDAO = { findFirst: jest.fn() } as any;
const mockLeaseDAO = { findFirst: jest.fn() } as any;
const mockEmailQueue = { addToEmailQueue: jest.fn() } as any;
const mockEmitter = { emit: jest.fn() } as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testCuid = 'CLIENT001';
const vendorObjectId = new Types.ObjectId();

function makeCtx(role: string, sub?: string): Partial<IRequestContext> {
  return {
    currentuser: {
      sub: sub ?? new Types.ObjectId().toString(),
      email: 'user@example.com',
      fullname: 'Test User',
      client: { cuid: testCuid, role },
    } as any,
    request: { params: { cuid: testCuid } } as any,
  };
}

// Context helper for vendor team members (linked accounts).
// linkedVendorUid is the uid string of the primary vendor user.
function makeLinkedCtx(sub: string, linkedVendorUid: string): Partial<IRequestContext> {
  return {
    currentuser: {
      sub,
      email: 'team@example.com',
      fullname: 'Team Member',
      client: { cuid: testCuid, role: 'vendor', linkedVendorUid },
    } as any,
    request: { params: { cuid: testCuid } } as any,
  };
}

function makeRequest(
  status: MaintenanceRequestStatus,
  overrides: Record<string, unknown> = {}
): any {
  return {
    _id: new Types.ObjectId(),
    mruid: 'MR001',
    cuid: testCuid,
    status,
    vendorId: vendorObjectId,
    invoice: undefined,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Service under test
// ---------------------------------------------------------------------------

let service: MaintenanceRequestService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new MaintenanceRequestService({
    maintenanceRequestDAO: mockDAO,
    propertyDAO: mockPropertyDAO,
    propertyUnitDAO: mockPropertyUnitDAO,
    vendorDAO: mockVendorDAO,
    userDAO: mockUserDAO,
    leaseDAO: mockLeaseDAO,
    emailQueue: mockEmailQueue,
    emitterService: mockEmitter,
  });
});

// ===========================================================================
// 1. Status Transition Validation (assertTransition / ALLOWED_TRANSITIONS)
// ===========================================================================

describe('MaintenanceRequestService - status transition validation', () => {
  it('should allow PENDING → OPEN', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING);
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, status: MaintenanceRequestStatus.OPEN });

    const ctx = makeCtx('admin');
    await expect(
      service.updateStatus(ctx as IRequestContext, 'MR001', {
        status: MaintenanceRequestStatus.OPEN,
      })
    ).resolves.toMatchObject({ success: true });
  });

  it('should allow OPEN → ASSIGNED via assignVendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.OPEN, { vendorId: undefined });
    const vendorUserId = new Types.ObjectId();
    const vendorRecord = {
      connectedClients: [
        { cuid: testCuid, isConnected: true, primaryAccountHolderUserId: vendorUserId },
      ],
    };
    const vendorUser = { _id: vendorUserId, email: 'vendor@test.com' };

    mockDAO.getByMruid.mockResolvedValue(request);
    mockVendorDAO.findFirst.mockResolvedValue(vendorRecord);
    mockUserDAO.findFirst.mockResolvedValue(vendorUser);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.ASSIGNED,
      vendorId: vendorUserId,
    });

    const ctx = makeCtx('admin');
    await expect(
      service.assignVendor(ctx as IRequestContext, 'MR001', { vuid: 'vnd-abc123' })
    ).resolves.toMatchObject({ success: true });
  });

  it('should throw BadRequestError when transitioning from COMPLETED to any status', async () => {
    const request = makeRequest(MaintenanceRequestStatus.COMPLETED);
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('admin');
    await expect(
      service.updateStatus(ctx as IRequestContext, 'MR001', {
        status: MaintenanceRequestStatus.OPEN,
      })
    ).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError when transitioning from CANCELLED to any status', async () => {
    const request = makeRequest(MaintenanceRequestStatus.CANCELLED);
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('admin');
    await expect(
      service.updateStatus(ctx as IRequestContext, 'MR001', {
        status: MaintenanceRequestStatus.IN_PROGRESS,
      })
    ).rejects.toThrow(BadRequestError);
  });
});

// ===========================================================================
// 2. createRequest guards
// ===========================================================================

describe('MaintenanceRequestService - createRequest guards', () => {
  const baseData = {
    pid: 'PROP001',
    title: 'Leaky faucet',
    description: { text: 'Water is dripping.' },
    category: 'plumbing' as any,
    priority: 'medium' as any,
    permissionToEnter: true,
    media: [],
  };

  it('should throw NotFoundError when property is not found', async () => {
    mockPropertyDAO.findFirst.mockResolvedValue(null);

    const ctx = makeCtx('admin');
    await expect(service.createRequest(ctx as IRequestContext, baseData)).rejects.toThrow(
      NotFoundError
    );
  });

  it('should throw BadRequestError when property approvalStatus is not approved', async () => {
    mockPropertyDAO.findFirst.mockResolvedValue({
      _id: new Types.ObjectId(),
      approvalStatus: 'pending',
      operationalStatus: 'active',
    });

    const ctx = makeCtx('admin');
    await expect(service.createRequest(ctx as IRequestContext, baseData)).rejects.toThrow(
      BadRequestError
    );
  });

  it('should throw BadRequestError when property operationalStatus is inactive', async () => {
    mockPropertyDAO.findFirst.mockResolvedValue({
      _id: new Types.ObjectId(),
      approvalStatus: 'approved',
      operationalStatus: 'inactive',
    });

    const ctx = makeCtx('admin');
    await expect(service.createRequest(ctx as IRequestContext, baseData)).rejects.toThrow(
      BadRequestError
    );
  });

  it('should throw ForbiddenError when tenant has no active lease on the property', async () => {
    const propertyId = new Types.ObjectId();
    mockPropertyDAO.findFirst.mockResolvedValue({
      _id: propertyId,
      approvalStatus: 'approved',
      operationalStatus: 'active',
    });
    mockLeaseDAO.findFirst.mockResolvedValue(null);

    const tenantSub = new Types.ObjectId().toString();
    const ctx = makeCtx('tenant', tenantSub);
    await expect(service.createRequest(ctx as IRequestContext, baseData)).rejects.toThrow(
      ForbiddenError
    );
  });
});

// ===========================================================================
// 3. assignVendor guards
// ===========================================================================

describe('MaintenanceRequestService - assignVendor guards', () => {
  it('should throw BadRequestError when request status is not OPEN (e.g. COMPLETED)', async () => {
    mockDAO.getByMruid.mockResolvedValue(makeRequest(MaintenanceRequestStatus.COMPLETED));

    const ctx = makeCtx('admin');
    await expect(
      service.assignVendor(ctx as IRequestContext, 'MR001', { vuid: 'vnd-abc123' })
    ).rejects.toThrow(BadRequestError);
  });

  it('should throw NotFoundError when vendor vuid does not exist', async () => {
    mockDAO.getByMruid.mockResolvedValue(makeRequest(MaintenanceRequestStatus.OPEN));
    mockVendorDAO.findFirst.mockResolvedValue(null);

    const ctx = makeCtx('admin');
    await expect(
      service.assignVendor(ctx as IRequestContext, 'MR001', { vuid: 'nonexistent-vuid' })
    ).rejects.toThrow(NotFoundError);
  });
});

// ===========================================================================
// 4. Vendor ownership checks — acceptAssignment / declineAssignment
// ===========================================================================

describe('MaintenanceRequestService - vendor ownership checks', () => {
  it('should throw ForbiddenError in acceptAssignment when caller is not the assigned vendor', async () => {
    const differentVendorId = new Types.ObjectId();
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: vendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    // Caller is a different vendor
    const ctx = makeCtx('vendor', differentVendorId.toString());
    await expect(
      service.acceptAssignment(ctx as IRequestContext, 'MR001', { action: 'accept' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('should throw ForbiddenError in declineAssignment when caller is not the assigned vendor', async () => {
    const differentVendorId = new Types.ObjectId();
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: vendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('vendor', differentVendorId.toString());
    await expect(
      service.declineAssignment(ctx as IRequestContext, 'MR001', { reason: 'Unavailable' })
    ).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// 5. Invoice lifecycle guards — submitInvoice / approveInvoice / rejectInvoice
// ===========================================================================

describe('MaintenanceRequestService - invoice lifecycle guards', () => {
  it('should throw BadRequestError in submitInvoice when request status is PENDING', async () => {
    mockDAO.getByMruid.mockResolvedValue(makeRequest(MaintenanceRequestStatus.PENDING));

    const ctx = makeCtx('admin');
    await expect(
      service.submitInvoice(ctx as IRequestContext, 'MR001', {
        amount: 15000,
        description: 'Labour and parts',
      })
    ).rejects.toThrow(BadRequestError);
  });

  it('should throw BadRequestError in approveInvoice when invoice is already APPROVED', async () => {
    const request = makeRequest(MaintenanceRequestStatus.COMPLETED, {
      invoice: { status: InvoiceStatus.APPROVED, amountInCents: 10000, currency: 'usd' },
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('admin');
    await expect(service.approveInvoice(ctx as IRequestContext, 'MR001')).rejects.toThrow(
      BadRequestError
    );
  });

  it('should throw BadRequestError in rejectInvoice when there is no invoice on the request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.COMPLETED, { invoice: undefined });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('admin');
    await expect(
      service.rejectInvoice(ctx as IRequestContext, 'MR001', { rejectionReason: 'Too expensive' })
    ).rejects.toThrow(BadRequestError);
  });
});

// ===========================================================================
// 6. Team member (linked account) access
// ===========================================================================

describe('MaintenanceRequestService - team member (linked account) access', () => {
  const primaryVendorObjectId = new Types.ObjectId();
  const primaryVendorUid = 'vendor-primary-uid';
  const teamMemberSub = new Types.ObjectId().toString();

  beforeEach(() => {
    // resolvePrimaryVendorId uses userDAO.findFirst to look up the primary vendor by uid
    mockUserDAO.findFirst.mockResolvedValue({
      _id: primaryVendorObjectId,
      uid: primaryVendorUid,
      email: 'primary@vendor.com',
    });
  });

  // ─── buildRoleFilter (via listRequests) ───────────────────────────────────

  it('listRequests: team member filter uses $in with both primary and team member ObjectIds', async () => {
    mockDAO.listWithDetails.mockResolvedValue({ items: [], pagination: {} });

    const ctx = makeLinkedCtx(teamMemberSub, primaryVendorUid);
    await service.listRequests(ctx as IRequestContext, {}, { page: 1, limit: 20 });

    expect(mockDAO.listWithDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: {
          $in: [primaryVendorObjectId, new Types.ObjectId(teamMemberSub)],
        },
      }),
      expect.anything()
    );
  });

  it('listRequests: primary vendor filter uses single vendorId ObjectId (no $in)', async () => {
    mockDAO.listWithDetails.mockResolvedValue({ items: [], pagination: {} });

    const primarySub = primaryVendorObjectId.toString();
    const ctx = makeCtx('vendor', primarySub);
    await service.listRequests(ctx as IRequestContext, {}, { page: 1, limit: 20 });

    expect(mockDAO.listWithDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: new Types.ObjectId(primarySub),
      }),
      expect.anything()
    );
  });

  it('listRequests: team member with unresolvable primary falls back to own ObjectId', async () => {
    mockUserDAO.findFirst.mockResolvedValue(null); // primary not found
    mockDAO.listWithDetails.mockResolvedValue({ items: [], pagination: {} });

    const ctx = makeLinkedCtx(teamMemberSub, 'non-existent-uid');
    await service.listRequests(ctx as IRequestContext, {}, { page: 1, limit: 20 });

    expect(mockDAO.listWithDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        vendorId: new Types.ObjectId(teamMemberSub),
      }),
      expect.anything()
    );
  });

  // ─── acceptAssignment ─────────────────────────────────────────────────────

  it('acceptAssignment: team member can accept when primary vendor is the assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.IN_PROGRESS,
    });

    const ctx = makeLinkedCtx(teamMemberSub, primaryVendorUid);
    await expect(
      service.acceptAssignment(ctx as IRequestContext, 'MR001', { action: 'accept' })
    ).resolves.toMatchObject({ success: true });
  });

  it('acceptAssignment: team member from a different vendor is denied', async () => {
    const otherPrimaryId = new Types.ObjectId();
    // resolvePrimaryVendorId will return otherPrimaryId, not the one on the request
    mockUserDAO.findFirst.mockResolvedValue({ _id: otherPrimaryId, uid: 'other-uid' });

    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId, // assigned to original primary
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeLinkedCtx(teamMemberSub, 'other-uid');
    await expect(
      service.acceptAssignment(ctx as IRequestContext, 'MR001', { action: 'accept' })
    ).rejects.toThrow(ForbiddenError);
  });

  // ─── declineAssignment ────────────────────────────────────────────────────

  it('declineAssignment: team member can decline when primary vendor is the assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, status: MaintenanceRequestStatus.OPEN });

    const ctx = makeLinkedCtx(teamMemberSub, primaryVendorUid);
    await expect(
      service.declineAssignment(ctx as IRequestContext, 'MR001', { reason: 'Capacity full' })
    ).resolves.toMatchObject({ success: true });
  });

  it('declineAssignment: team member from a different vendor is denied', async () => {
    const otherPrimaryId = new Types.ObjectId();
    mockUserDAO.findFirst.mockResolvedValue({ _id: otherPrimaryId, uid: 'other-uid' });

    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeLinkedCtx(teamMemberSub, 'other-uid');
    await expect(
      service.declineAssignment(ctx as IRequestContext, 'MR001', { reason: 'N/A' })
    ).rejects.toThrow(ForbiddenError);
  });

  // ─── submitWorkOrder ──────────────────────────────────────────────────────

  it('submitWorkOrder: team member can submit a work order for primary vendor assignment', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, workOrder: { status: 'pending_review' } });

    const ctx = makeLinkedCtx(teamMemberSub, primaryVendorUid);
    await expect(
      service.submitWorkOrder(ctx as IRequestContext, 'MR001', {
        scope: 'Replace pipes',
        estimatedCostInCents: 50000,
      })
    ).resolves.toMatchObject({ success: true });
  });

  it('submitWorkOrder: team member from a different vendor is denied', async () => {
    const otherPrimaryId = new Types.ObjectId();
    mockUserDAO.findFirst.mockResolvedValue({ _id: otherPrimaryId, uid: 'other-uid' });

    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeLinkedCtx(teamMemberSub, 'other-uid');
    await expect(
      service.submitWorkOrder(ctx as IRequestContext, 'MR001', {
        scope: 'Replace pipes',
        estimatedCostInCents: 50000,
      })
    ).rejects.toThrow(ForbiddenError);
  });

  // ─── submitInvoice ────────────────────────────────────────────────────────

  it('submitInvoice: team member can submit invoice for primary vendor assignment', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      invoice: { status: InvoiceStatus.PENDING },
    });

    const ctx = makeLinkedCtx(teamMemberSub, primaryVendorUid);
    await expect(
      service.submitInvoice(ctx as IRequestContext, 'MR001', {
        amount: 20000,
        description: 'Parts and labour',
      })
    ).resolves.toMatchObject({ success: true });
  });

  it('submitInvoice: team member from a different vendor is denied', async () => {
    const otherPrimaryId = new Types.ObjectId();
    mockUserDAO.findFirst.mockResolvedValue({ _id: otherPrimaryId, uid: 'other-uid' });

    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeLinkedCtx(teamMemberSub, 'other-uid');
    await expect(
      service.submitInvoice(ctx as IRequestContext, 'MR001', {
        amount: 20000,
        description: 'Parts and labour',
      })
    ).rejects.toThrow(ForbiddenError);
  });
});
