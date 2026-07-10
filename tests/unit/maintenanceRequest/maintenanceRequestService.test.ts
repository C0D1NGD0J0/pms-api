import { Types } from 'mongoose';
import { IRequestContext } from '@interfaces/utils.interface';
import { ServiceAreaService } from '@services/serviceArea/serviceArea.service';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { MaintenanceRequestService } from '@services/maintenanceRequest/serviceRequest.service';
import {
  MaintenanceRequestStatus,
  AvailabilityWindow,
  WorkOrderStatus,
} from '@interfaces/maintenanceRequest.interface';

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
  update: jest.fn(),
  updateById: jest.fn(),
  startSession: jest.fn().mockResolvedValue({}),
  withTransaction: jest.fn((session: unknown, cb: (s: unknown) => unknown) => cb(session)),
  getStats: jest.fn(),
  getVendorStats: jest.fn(),
  getVendorAvgRating: jest.fn(),
  getVendorStatsBatch: jest.fn(),
  getVendorAvgRatingBatch: jest.fn(),
} as any;

const mockPropertyDAO = { findFirst: jest.fn() } as any;
const mockPropertyUnitDAO = { findFirst: jest.fn() } as any;
const mockVendorDAO = { findFirst: jest.fn(), getClientVendors: jest.fn(), getVendorByVuid: jest.fn() } as any;
const mockUserDAO = { findFirst: jest.fn() } as any;
const mockLeaseDAO = { findFirst: jest.fn() } as any;
const mockEmitter = { emit: jest.fn(), on: jest.fn() } as any;
const mockSession = {
  withTransaction: jest.fn((fn: () => Promise<void>) => fn()),
  endSession: jest.fn(),
};
const mockInvoiceDAO = {
  findFirst: jest.fn(),
  findByMaintenanceRequest: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  startSession: jest.fn().mockResolvedValue(mockSession),
} as any;
const _mockAiService = {
  categorize: jest.fn(),
  categorizeMaintenanceRequest: jest.fn(),
  selectBestVendor: jest.fn(),
} as any;
const mockPaymentDAO = { findFirst: jest.fn() } as any;
const _mockServiceAreaService: jest.Mocked<Pick<ServiceAreaService, 'isLocationInVendorServiceArea'>> = {
  isLocationInVendorServiceArea: jest.fn(),
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testCuid = 'CLIENT001';
const vendorObjectId = new Types.ObjectId();

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
    invoiceDAO: mockInvoiceDAO,
    paymentDAO: mockPaymentDAO,
    emitterService: mockEmitter,
    vendorSuggestionService: {
      runAITriage: jest.fn().mockReturnValue(Promise.resolve()),
    } as any,
    maintenanceInvoiceService: {
      submitInvoice: jest.fn(),
      reviewInvoice: jest.fn(),
      submitWorkOrder: jest.fn(),
      reviewWorkOrder: jest.fn(),
      handleInvoiceWebhook: jest.fn(),
    } as any,
    smsService: {
      sendSMS: jest.fn(),
      sendToUser: jest.fn().mockReturnValue(Promise.resolve(undefined)),
    } as any,
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
// 2b. createRequest — hasPet defaults from lease petPolicy
// ===========================================================================

describe('MaintenanceRequestService - createRequest hasPet lease default', () => {
  const propertyId = new Types.ObjectId();
  const unitId = new Types.ObjectId();
  const tenantSub = new Types.ObjectId().toString();

  const baseData = {
    pid: 'PROP001',
    puid: 'UNIT001',
    title: 'Leaky faucet',
    description: { text: 'Water is dripping.' },
    category: 'plumbing' as any,
    priority: 'medium' as any,
    permissionToEnter: true,
    media: [],
  };

  function setupMocks(petPolicyAllowed: boolean) {
    mockPropertyDAO.findFirst.mockResolvedValue({
      _id: propertyId,
      approvalStatus: 'approved',
      operationalStatus: 'active',
    });
    mockPropertyUnitDAO.findFirst.mockResolvedValue({
      _id: unitId,
      isActive: true,
    });
    // leaseDAO.findFirst is called twice for tenants:
    // 1) any active lease check (line ~268)
    // 2) property-specific lease check (line ~307)
    const leaseDoc = { _id: new Types.ObjectId(), petPolicy: { allowed: petPolicyAllowed } };
    mockLeaseDAO.findFirst.mockResolvedValue(leaseDoc);
    mockDAO.insert.mockImplementation((data: any) => Promise.resolve({ ...data, _id: new Types.ObjectId(), mruid: 'MR-NEW' }));
  }

  it('should default hasPet to true when lease petPolicy.allowed is true and hasPet not provided', async () => {
    setupMocks(true);
    const ctx = makeCtx('tenant', tenantSub);
    const { hasPet: _hp, ...dataWithoutHasPet } = baseData as any;
    await service.createRequest(ctx as IRequestContext, dataWithoutHasPet);

    const insertCall = mockDAO.insert.mock.calls[0][0];
    expect(insertCall.hasPet).toBe(true);
  });

  it('should default hasPet to false when lease petPolicy.allowed is false and hasPet not provided', async () => {
    setupMocks(false);
    const ctx = makeCtx('tenant', tenantSub);
    const { hasPet: _hp, ...dataWithoutHasPet } = baseData as any;
    await service.createRequest(ctx as IRequestContext, dataWithoutHasPet);

    const insertCall = mockDAO.insert.mock.calls[0][0];
    expect(insertCall.hasPet).toBe(false);
  });

  it('should respect explicit hasPet=false even when lease petPolicy.allowed is true', async () => {
    setupMocks(true);
    const ctx = makeCtx('tenant', tenantSub);
    await service.createRequest(ctx as IRequestContext, { ...baseData, hasPet: false });

    const insertCall = mockDAO.insert.mock.calls[0][0];
    expect(insertCall.hasPet).toBe(false);
  });

  it('should respect explicit hasPet=true even when lease petPolicy.allowed is false', async () => {
    setupMocks(false);
    const ctx = makeCtx('tenant', tenantSub);
    await service.createRequest(ctx as IRequestContext, { ...baseData, hasPet: true });

    const insertCall = mockDAO.insert.mock.calls[0][0];
    expect(insertCall.hasPet).toBe(true);
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
// 5. Unified dispatch — respondToAssignment / reviewInvoice
// ===========================================================================

describe('MaintenanceRequestService - respondToAssignment dispatch', () => {
  it('should call acceptAssignment when action is "accept"', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: vendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.IN_PROGRESS,
    });

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.respondToAssignment(ctx as IRequestContext, 'MR001', {
      action: 'accept',
      technician: { name: 'John Tech', phone: '555-0001', email: 'tech@vendor.com' },
    });

    expect(result).toMatchObject({ success: true });
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: expect.objectContaining({ status: MaintenanceRequestStatus.IN_PROGRESS }),
      }),
      undefined,
      expect.anything()
    );
  });

  it('should call declineAssignment when action is not "accept"', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: vendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.OPEN,
      vendorId: undefined,
    });

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.respondToAssignment(ctx as IRequestContext, 'MR001', {
      action: 'decline',
      reason: 'Not available',
    });

    expect(result).toMatchObject({ success: true });
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: { status: MaintenanceRequestStatus.OPEN },
        $unset: expect.objectContaining({ vendorId: 1 }),
      }),
      undefined,
      expect.anything()
    );
  });

  it('should propagate ForbiddenError from acceptAssignment when caller is not assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: vendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const differentVendorId = new Types.ObjectId();
    const ctx = makeCtx('vendor', differentVendorId.toString());
    await expect(
      service.respondToAssignment(ctx as IRequestContext, 'MR001', { action: 'accept' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('should propagate ForbiddenError from declineAssignment when caller is not assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: vendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const differentVendorId = new Types.ObjectId();
    const ctx = makeCtx('vendor', differentVendorId.toString());
    await expect(
      service.respondToAssignment(ctx as IRequestContext, 'MR001', {
        action: 'decline',
        reason: 'Busy',
      })
    ).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// 5b. abandonAssignment — escape hatch after WO rejection
// ===========================================================================

describe('MaintenanceRequestService - abandonAssignment', () => {
  const abandonedRequest = () =>
    makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      vendorId: vendorObjectId,
      workOrder: { status: WorkOrderStatus.REJECTED },
    });

  it('succeeds when SR is in_progress and WO is rejected', async () => {
    const request = abandonedRequest();
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.OPEN,
      vendorId: undefined,
      workOrder: undefined,
    });

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.abandonAssignment(ctx as IRequestContext, 'MR001');

    expect(result).toMatchObject({ success: true });
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: { status: MaintenanceRequestStatus.OPEN },
        $unset: expect.objectContaining({ vendorId: 1, workOrder: 1 }),
      }),
      undefined,
      expect.anything()
    );
    expect(mockEmitter.emit).toHaveBeenCalled();
  });

  it('throws BadRequestError when SR is not in_progress', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: vendorObjectId,
      workOrder: { status: WorkOrderStatus.REJECTED },
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.abandonAssignment(ctx as IRequestContext, 'MR001')
    ).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when WO is not rejected (pending_review)', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      vendorId: vendorObjectId,
      workOrder: { status: WorkOrderStatus.PENDING_REVIEW },
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.abandonAssignment(ctx as IRequestContext, 'MR001')
    ).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when WO is approved (not rejected)', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      vendorId: vendorObjectId,
      workOrder: { status: WorkOrderStatus.APPROVED },
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.abandonAssignment(ctx as IRequestContext, 'MR001')
    ).rejects.toThrow(BadRequestError);
  });

  it('throws ForbiddenError when caller is not the assigned vendor', async () => {
    const request = abandonedRequest();
    mockDAO.getByMruid.mockResolvedValue(request);

    const differentVendor = new Types.ObjectId();
    const ctx = makeCtx('vendor', differentVendor.toString());
    await expect(
      service.abandonAssignment(ctx as IRequestContext, 'MR001')
    ).rejects.toThrow(ForbiddenError);
  });

  it('respondToAssignment routes to abandonAssignment when action is "abandon"', async () => {
    const request = abandonedRequest();
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.OPEN,
      vendorId: undefined,
      workOrder: undefined,
    });

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.respondToAssignment(ctx as IRequestContext, 'MR001', {
      action: 'abandon',
    });

    expect(result).toMatchObject({ success: true });
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: { status: MaintenanceRequestStatus.OPEN },
        $unset: expect.objectContaining({ vendorId: 1, workOrder: 1 }),
      }),
      undefined,
      expect.anything()
    );
  });
});

describe('MaintenanceRequestService - updateRequest', () => {
  const updateData = {
    title: 'Updated title for the issue',
    description: { text: 'Updated description with more detail.' },
    category: 'electrical' as any,
    priority: 'high' as any,
  };

  it('should update a PENDING request successfully', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING);
    const updated = { ...request, ...updateData };
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue(updated);

    const ctx = makeCtx('staff');
    const result = await service.updateRequest(ctx as IRequestContext, 'MR001', updateData);

    expect(result).toMatchObject({ success: true });
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        $set: expect.objectContaining({
          title: updateData.title,
          category: updateData.category,
        }),
      }),
      undefined,
      expect.anything()
    );
  });

  it('should update an OPEN request successfully', async () => {
    const request = makeRequest(MaintenanceRequestStatus.OPEN);
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, ...updateData });

    const ctx = makeCtx('staff');
    const result = await service.updateRequest(ctx as IRequestContext, 'MR001', updateData);

    expect(result).toMatchObject({ success: true });
  });

  it('should emit MAINTENANCE_REQUEST_UPDATED event on success', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING);
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, ...updateData });

    const ctx = makeCtx('staff');
    await service.updateRequest(ctx as IRequestContext, 'MR001', updateData);

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      'maintenance:request:updated',
      expect.objectContaining({ mruid: request.mruid, cuid: testCuid })
    );
  });

  it.each([
    MaintenanceRequestStatus.AWAITING_INVOICE,
    MaintenanceRequestStatus.COMPLETED,
    MaintenanceRequestStatus.CANCELLED,
  ])('should throw ForbiddenError when status is %s', async (status) => {
    mockDAO.getByMruid.mockResolvedValue(makeRequest(status));

    const ctx = makeCtx('staff');
    await expect(
      service.updateRequest(ctx as IRequestContext, 'MR001', updateData)
    ).rejects.toThrow(ForbiddenError);
  });

  it.each([
    MaintenanceRequestStatus.ASSIGNED,
    MaintenanceRequestStatus.IN_PROGRESS,
  ])('should allow limited edit (hasPet + availability only) when status is %s', async (status) => {
    const request = makeRequest(status);
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, hasPet: true });

    const ctx = makeCtx('staff');
    const result = await service.updateRequest(ctx as IRequestContext, 'MR001', {
      hasPet: true,
      availabilityInfo: { preferredDate: '2026-06-01', options: [AvailabilityWindow.MORNING] },
    });

    expect(result.success).toBe(true);
    // Only the allowed limited fields should be written — title from updateData is ignored
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      { $set: { hasPet: true, availabilityInfo: { preferredDate: '2026-06-01', options: ['morning'] } } },
      undefined,
      undefined
    );
  });

  it('should only set fields that are explicitly provided', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING);
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, priority: 'urgent' });

    const ctx = makeCtx('staff');
    await service.updateRequest(ctx as IRequestContext, 'MR001', { priority: 'urgent' as any });

    expect(mockDAO.updateById).toHaveBeenCalledWith(
      expect.any(String),
      { $set: { priority: 'urgent' } },
      undefined,
      expect.anything()
    );
  });
});

// ===========================================================================
// 7. Invoice lifecycle guards — submitInvoice / approveInvoice / rejectInvoice
// ===========================================================================

describe('MaintenanceRequestService - team member (linked account) access', () => {
  const primaryVendorObjectId = new Types.ObjectId();
  const primaryVendorUid = 'vendor-primary-uid';
  const teamMemberSub = new Types.ObjectId().toString();

  beforeEach(() => {
    // resolvePrimaryVendorId calls vendorDAO.getVendorByVuid(linkedVendorUid)
    // and returns the primaryAccountHolderUserId from the matching connectedClient.
    mockVendorDAO.getVendorByVuid.mockResolvedValue({
      vuid: primaryVendorUid,
      connectedClients: [
        { cuid: testCuid, primaryAccountHolderUserId: primaryVendorObjectId },
      ],
    });
  });

  // ─── buildRoleFilter (via listRequests) ───────────────────────────────────

  it('listRequests: team member sees unscoped results (buildRoleFilter returns empty for linked accounts)', async () => {
    mockDAO.listWithDetails.mockResolvedValue({ items: [], pagination: {} });

    const ctx = makeLinkedCtx(teamMemberSub, primaryVendorUid);
    await service.listRequests(ctx as IRequestContext, {}, { page: 1, limit: 20 });

    // Team members are not isPrimaryVendor, so buildRoleFilter returns {} — no vendorId filter
    expect(mockDAO.listWithDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: testCuid,
        deletedAt: null,
      }),
      expect.anything()
    );
  });

  it('listRequests: primary vendor with no linkedVendorUid gets unscoped filter (resolvePrimaryVendorId returns null)', async () => {
    mockDAO.listWithDetails.mockResolvedValue({ items: [], pagination: {} });

    const primarySub = primaryVendorObjectId.toString();
    const ctx = makeCtx('vendor', primarySub);
    // isPrimaryVendor is true (no linkedVendorUid), but resolvePrimaryVendorId
    // returns null when linkedVendorUid is absent, so no vendorId filter is added.
    await service.listRequests(ctx as IRequestContext, {}, { page: 1, limit: 20 });

    expect(mockDAO.listWithDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: testCuid,
        deletedAt: null,
      }),
      expect.anything()
    );
  });

  it('listRequests: primary vendor with unresolvable vendorDAO falls back to no vendorId filter', async () => {
    mockVendorDAO.getVendorByVuid.mockResolvedValue(null); // primary not found
    mockDAO.listWithDetails.mockResolvedValue({ items: [], pagination: {} });

    const ctx = makeLinkedCtx(teamMemberSub, 'non-existent-uid');
    await service.listRequests(ctx as IRequestContext, {}, { page: 1, limit: 20 });

    // No vendorId filter when primary can't be resolved
    expect(mockDAO.listWithDetails).toHaveBeenCalledWith(
      expect.objectContaining({
        cuid: testCuid,
        deletedAt: null,
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
    mockVendorDAO.getVendorByVuid.mockResolvedValue({
      vuid: 'other-uid',
      connectedClients: [{ cuid: testCuid, primaryAccountHolderUserId: otherPrimaryId }],
    });

    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId, // assigned to original primary
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeLinkedCtx(teamMemberSub, 'other-uid');
    await expect(
      service.acceptAssignment(ctx as IRequestContext, 'MR001', { action: 'accept' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('acceptAssignment: stores assignedTechnician.userId when technician.userId is provided', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.IN_PROGRESS,
    });

    const ctx = makeCtx('vendor', primaryVendorObjectId.toString());
    await service.acceptAssignment(ctx as IRequestContext, 'MR001', {
      action: 'accept',
      technician: { name: 'Tech One', userId: teamMemberSub },
    });

    const updateCall = mockDAO.updateById.mock.calls[0];
    const setPayload = updateCall[1].$set;
    // userId is stored as an ObjectId, compare via toString()
    expect(setPayload.assignedTechnician.userId.toString()).toBe(teamMemberSub);
  });

  it('acceptAssignment: defaults assignedTechnician.userId to caller sub when not provided', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({
      ...request,
      status: MaintenanceRequestStatus.IN_PROGRESS,
    });

    const callerSub = primaryVendorObjectId.toString();
    const ctx = makeCtx('vendor', callerSub);
    await service.acceptAssignment(ctx as IRequestContext, 'MR001', {
      action: 'accept',
      technician: { name: 'Tech One' }, // no userId
    });

    const updateCall = mockDAO.updateById.mock.calls[0];
    const setPayload = updateCall[1].$set;
    // When no userId is provided, the service defaults it to currentuser.sub
    expect(setPayload.assignedTechnician.userId.toString()).toBe(callerSub);
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
    mockVendorDAO.getVendorByVuid.mockResolvedValue({
      vuid: 'other-uid',
      connectedClients: [{ cuid: testCuid, primaryAccountHolderUserId: otherPrimaryId }],
    });

    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      vendorId: primaryVendorObjectId,
    });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeLinkedCtx(teamMemberSub, 'other-uid');
    await expect(
      service.declineAssignment(ctx as IRequestContext, 'MR001', { reason: 'N/A' })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe('MaintenanceRequestService - updateRequest re-triage', () => {
  const baseRequest = {
    _id: new Types.ObjectId(),
    mruid: 'MR001',
    cuid: testCuid,
    status: MaintenanceRequestStatus.OPEN,
    title: 'Original title',
    description: { text: 'Original description' },
    aiAnalysis: {
      suggestedCategory: 'general',
      suggestedPriority: 'medium',
      confidence: 0.6,
      accepted: false,
    },
  };

  beforeEach(() => {
    mockDAO.updateById.mockResolvedValue({ ...baseRequest });
    mockDAO.startSession.mockResolvedValue({});
    mockDAO.withTransaction.mockImplementation(
      (_session: unknown, cb: (s: unknown) => unknown) => cb({})
    );
    // vendorSuggestionService.runAITriage is already mocked as jest.fn() in the main beforeEach
  });

  it('clears aiAnalysis when title changes and accepted is false', async () => {
    mockDAO.getByMruid.mockResolvedValue(baseRequest);

    const ctx = makeCtx('staff');
    await service.updateRequest(ctx as IRequestContext, 'MR001', {
      title: 'Updated title — sparking outlet',
    });

    const callArgs = mockDAO.updateById.mock.calls[0][1].$set;
    expect(callArgs.aiAnalysis).toEqual({});
  });

  it('clears aiAnalysis when description changes', async () => {
    mockDAO.getByMruid.mockResolvedValue(baseRequest);

    const ctx = makeCtx('staff');
    await service.updateRequest(ctx as IRequestContext, 'MR001', {
      description: { text: 'New description with more detail' },
    });

    const callArgs = mockDAO.updateById.mock.calls[0][1].$set;
    expect(callArgs.aiAnalysis).toEqual({});
  });

  it('does not clear aiAnalysis when only category changes (no content change)', async () => {
    mockDAO.getByMruid.mockResolvedValue(baseRequest);

    const ctx = makeCtx('staff');
    await service.updateRequest(ctx as IRequestContext, 'MR001', {
      category: 'plumbing' as any,
    });

    const callArgs = mockDAO.updateById.mock.calls[0][1].$set;
    expect(callArgs.aiAnalysis).toBeUndefined();
  });

  it('does not clear aiAnalysis when PM has already accepted it', async () => {
    const acceptedRequest = {
      ...baseRequest,
      aiAnalysis: { ...baseRequest.aiAnalysis, accepted: true },
    };
    mockDAO.getByMruid.mockResolvedValue(acceptedRequest);

    const ctx = makeCtx('admin');
    await service.updateRequest(ctx as IRequestContext, 'MR001', {
      title: 'Title changed after accept',
    });

    const callArgs = mockDAO.updateById.mock.calls[0][1].$set;
    expect(callArgs.aiAnalysis).toBeUndefined();
  });
});

// ===========================================================================
// 9. Ownership checks — updateRequest
// ===========================================================================

describe('MaintenanceRequestService - updateRequest ownership', () => {
  const tenantId = new Types.ObjectId();
  const otherTenantId = new Types.ObjectId();
  const updateData = { title: 'New title' };

  it('allows tenant to update their own PENDING request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING, { tenantId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue(request);

    const ctx = makeCtx('tenant', tenantId.toString());
    await expect(
      service.updateRequest(ctx as IRequestContext, 'MR001', updateData)
    ).resolves.toMatchObject({ success: true });
  });

  it('throws ForbiddenError when tenant tries to update another tenant request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING, { tenantId: otherTenantId });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('tenant', tenantId.toString());
    await expect(
      service.updateRequest(ctx as IRequestContext, 'MR001', updateData)
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows management role to update any PENDING request regardless of tenantId', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING, { tenantId: otherTenantId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue(request);

    for (const role of ['admin', 'manager', 'super-admin']) {
      jest.clearAllMocks();
      mockDAO.getByMruid.mockResolvedValue(request);
      mockDAO.updateById.mockResolvedValue(request);
      const ctx = makeCtx(role);
      await expect(
        service.updateRequest(ctx as IRequestContext, 'MR001', updateData)
      ).resolves.toMatchObject({ success: true });
    }
  });

  it('allows assigned vendor to update request in limited-edit status', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, { vendorId: vendorObjectId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue(request);

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.updateRequest(ctx as IRequestContext, 'MR001', { hasPet: true })
    ).resolves.toMatchObject({ success: true });
  });

  it('throws ForbiddenError when unassigned vendor tries to update request', async () => {
    const otherVendorId = new Types.ObjectId();
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, { vendorId: otherVendorId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockVendorDAO.findFirst.mockResolvedValue(null);

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.updateRequest(ctx as IRequestContext, 'MR001', { hasPet: true })
    ).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// 10. Ownership checks — cancelRequest
// ===========================================================================

describe('MaintenanceRequestService - cancelRequest ownership', () => {
  const tenantId = new Types.ObjectId();
  const otherTenantId = new Types.ObjectId();
  const cancelData = { reason: 'No longer needed' };

  it('allows tenant to cancel their own OPEN request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.OPEN, { tenantId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, status: MaintenanceRequestStatus.CANCELLED });

    const ctx = makeCtx('tenant', tenantId.toString());
    await expect(
      service.cancelRequest(ctx as IRequestContext, 'MR001', cancelData)
    ).resolves.toMatchObject({ success: true });
  });

  it('throws ForbiddenError when tenant cancels another tenant OPEN request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.OPEN, { tenantId: otherTenantId });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('tenant', tenantId.toString());
    await expect(
      service.cancelRequest(ctx as IRequestContext, 'MR001', cancelData)
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows management role to cancel any request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.OPEN, { tenantId: otherTenantId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, status: MaintenanceRequestStatus.CANCELLED });

    const ctx = makeCtx('manager');
    await expect(
      service.cancelRequest(ctx as IRequestContext, 'MR001', cancelData)
    ).resolves.toMatchObject({ success: true });
  });

  it('allows assigned vendor to cancel their own ASSIGNED request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, { vendorId: vendorObjectId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, status: MaintenanceRequestStatus.CANCELLED });

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.cancelRequest(ctx as IRequestContext, 'MR001', cancelData)
    ).resolves.toMatchObject({ success: true });
  });

  it('throws ForbiddenError when unassigned vendor cancels request', async () => {
    const otherVendorId = new Types.ObjectId();
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, { vendorId: otherVendorId });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.cancelRequest(ctx as IRequestContext, 'MR001', cancelData)
    ).rejects.toThrow(ForbiddenError);
  });
});

// ===========================================================================
// 11. Ownership checks — updateStatus
// ===========================================================================

describe('MaintenanceRequestService - updateStatus ownership', () => {
  it('throws ForbiddenError when tenant tries to update status', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING);
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('tenant');
    await expect(
      service.updateStatus(ctx as IRequestContext, 'MR001', { status: MaintenanceRequestStatus.OPEN })
    ).rejects.toThrow(ForbiddenError);
  });

  it('allows management role to update status', async () => {
    const request = makeRequest(MaintenanceRequestStatus.PENDING);
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, status: MaintenanceRequestStatus.OPEN });

    const ctx = makeCtx('admin');
    await expect(
      service.updateStatus(ctx as IRequestContext, 'MR001', { status: MaintenanceRequestStatus.OPEN })
    ).resolves.toMatchObject({ success: true });
  });

  it('allows assigned vendor to update status on their own request', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, { vendorId: vendorObjectId });
    mockDAO.getByMruid.mockResolvedValue(request);
    mockDAO.updateById.mockResolvedValue({ ...request, status: MaintenanceRequestStatus.IN_PROGRESS });

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.updateStatus(ctx as IRequestContext, 'MR001', { status: MaintenanceRequestStatus.IN_PROGRESS })
    ).resolves.toMatchObject({ success: true });
  });

  it('throws ForbiddenError when vendor updates status on unassigned request', async () => {
    const otherVendorId = new Types.ObjectId();
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, { vendorId: otherVendorId });
    mockDAO.getByMruid.mockResolvedValue(request);

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(
      service.updateStatus(ctx as IRequestContext, 'MR001', { status: MaintenanceRequestStatus.IN_PROGRESS })
    ).rejects.toThrow(ForbiddenError);
  });
});

