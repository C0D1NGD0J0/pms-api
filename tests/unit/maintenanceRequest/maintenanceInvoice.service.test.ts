import { Types } from 'mongoose';
import { EventTypes } from '@interfaces/events.interface';
import { IRequestContext } from '@interfaces/utils.interface';
import { BadRequestError, ForbiddenError, NotFoundError } from '@shared/customErrors';
import { MaintenanceInvoiceService } from '@services/maintenanceRequest/maintenanceInvoice.service';
import {
  MaintenanceRequestStatus,
  WorkOrderStatus,
  InvoiceSource,
  InvoiceStatus,
} from '@interfaces/maintenanceRequest.interface';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSession = {
  withTransaction: jest.fn((fn: () => Promise<void>) => fn()),
  endSession: jest.fn(),
};

const mockDAO = {
  getByMruid: jest.fn(),
  findFirst: jest.fn(),
  update: jest.fn(),
  updateById: jest.fn(),
  startSession: jest.fn().mockReturnValue(Promise.resolve(mockSession)),
  withTransaction: jest.fn((session: unknown, cb: (s: unknown) => unknown) => cb(session)),
} as any;

const mockInvoiceDAO = {
  findByMaintenanceRequest: jest.fn(),
  insert: jest.fn(),
  updateById: jest.fn(),
  startSession: jest.fn().mockReturnValue(Promise.resolve(mockSession)),
} as any;

const mockUserDAO = {
  findFirst: jest.fn(),
} as any;

const mockEmitter = { emit: jest.fn() } as any;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testCuid = 'CLIENT001';
const vendorObjectId = new Types.ObjectId();

function makeCtx(role: string, sub?: string, extras: Record<string, unknown> = {}): IRequestContext {
  return {
    currentuser: {
      sub: sub ?? new Types.ObjectId().toString(),
      email: 'user@example.com',
      fullname: 'Test User',
      client: { cuid: testCuid, role, ...extras },
    } as any,
    request: { params: { cuid: testCuid } } as any,
  } as IRequestContext;
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
    isBillable: false,
    ...overrides,
  };
}

function makeInvoice(status: InvoiceStatus, overrides: Record<string, unknown> = {}): any {
  return {
    _id: new Types.ObjectId(),
    mruid: 'MR001',
    cuid: testCuid,
    status,
    amountInCents: 15000,
    currency: 'USD',
    lineItems: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Service under test
// ---------------------------------------------------------------------------

let service: MaintenanceInvoiceService;

beforeEach(() => {
  jest.clearAllMocks();
  service = new MaintenanceInvoiceService({
    maintenanceRequestDAO: mockDAO,
    invoiceDAO: mockInvoiceDAO,
    userDAO: mockUserDAO,
    emitterService: mockEmitter,
  });
});

// ===========================================================================
// submitInvoice
// ===========================================================================

describe('submitInvoice', () => {
  const invoiceData = {
    amount: 15000,
    currency: 'USD',
    description: 'Plumbing repair',
    lineItems: [],
    source: 'manual' as any,
  };

  it('throws BadRequestError when MR status is not AWAITING_INVOICE', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(service.submitInvoice(ctx, 'MR001', invoiceData)).rejects.toThrow(BadRequestError);
  });

  it('throws ForbiddenError when vendor is not the assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));

    const ctx = makeCtx('vendor', new Types.ObjectId().toString()); // different sub
    await expect(service.submitInvoice(ctx, 'MR001', invoiceData)).rejects.toThrow(ForbiddenError);
  });

  it('allows the assigned vendor to submit an invoice', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const createdInvoice = makeInvoice(InvoiceStatus.PENDING);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));
    mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(createdInvoice));
    mockDAO.updateById.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.submitInvoice(ctx, 'MR001', invoiceData);

    expect(result.success).toBe(true);
    expect(result.data).toBe(createdInvoice);
    expect(mockInvoiceDAO.insert).toHaveBeenCalled();
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      request._id.toString(),
      expect.objectContaining({ $set: { invoiceId: createdInvoice._id } }),
      {},
      expect.anything()
    );
  });

  it('throws BadRequestError when an invoice is already PENDING', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const existingInvoice = makeInvoice(InvoiceStatus.PENDING);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(existingInvoice));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(service.submitInvoice(ctx, 'MR001', invoiceData)).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when an invoice is already APPROVED', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const existingInvoice = makeInvoice(InvoiceStatus.APPROVED);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(existingInvoice));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(service.submitInvoice(ctx, 'MR001', invoiceData)).rejects.toThrow(BadRequestError);
  });

  it('allows resubmission after a REJECTED invoice', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const rejectedInvoice = makeInvoice(InvoiceStatus.REJECTED);
    const newInvoice = makeInvoice(InvoiceStatus.PENDING);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(rejectedInvoice));
    mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(newInvoice));
    mockDAO.updateById.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.submitInvoice(ctx, 'MR001', invoiceData);
    expect(result.success).toBe(true);
  });

  it('allows a team member (linkedVendorUid) to submit when they resolve to the assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const createdInvoice = makeInvoice(InvoiceStatus.PENDING);
    const teamMemberSub = new Types.ObjectId().toString();
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));
    mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(createdInvoice));
    mockDAO.updateById.mockReturnValue(Promise.resolve(request));
    // resolvePrimaryVendorId returns the assigned vendorId
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

    const ctx = makeCtx('vendor', teamMemberSub, { linkedVendorUid: 'primary-vendor-uid' });
    const result = await service.submitInvoice(ctx, 'MR001', invoiceData);
    expect(result.success).toBe(true);
  });

  describe('technician authorization', () => {
    const assignedTechId = new Types.ObjectId().toString();
    const otherTeamMemberId = new Types.ObjectId().toString();

    it('allows primary vendor to submit invoice even when a specific technician is assigned', async () => {
      const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE, {
        assignedTechnician: { userId: assignedTechId, name: 'Tech One' },
      });
      const createdInvoice = makeInvoice(InvoiceStatus.PENDING);
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));
      mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(createdInvoice));
      mockDAO.updateById.mockReturnValue(Promise.resolve(request));

      const ctx = makeCtx('vendor', vendorObjectId.toString());
      const result = await service.submitInvoice(ctx, 'MR001', invoiceData);
      expect(result.success).toBe(true);
    });

    it('allows the assigned technician to submit invoice', async () => {
      const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE, {
        assignedTechnician: { userId: assignedTechId, name: 'Tech One' },
      });
      const createdInvoice = makeInvoice(InvoiceStatus.PENDING);
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));
      mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(createdInvoice));
      mockDAO.updateById.mockReturnValue(Promise.resolve(request));
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

      const ctx = makeCtx('vendor', assignedTechId, { linkedVendorUid: 'primary-vendor-uid' });
      const result = await service.submitInvoice(ctx, 'MR001', invoiceData);
      expect(result.success).toBe(true);
    });

    it('blocks a non-assigned team member when a specific technician is set', async () => {
      const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE, {
        assignedTechnician: { userId: assignedTechId, name: 'Tech One' },
      });
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

      const ctx = makeCtx('vendor', otherTeamMemberId, { linkedVendorUid: 'primary-vendor-uid' });
      await expect(service.submitInvoice(ctx, 'MR001', invoiceData)).rejects.toThrow(ForbiddenError);
    });

    it('allows any linked team member to submit invoice when no specific technician is set (fallback)', async () => {
      const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE, {
        assignedTechnician: { name: 'Some Tech' }, // no userId
      });
      const createdInvoice = makeInvoice(InvoiceStatus.PENDING);
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));
      mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(createdInvoice));
      mockDAO.updateById.mockReturnValue(Promise.resolve(request));
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

      const ctx = makeCtx('vendor', otherTeamMemberId, { linkedVendorUid: 'primary-vendor-uid' });
      const result = await service.submitInvoice(ctx, 'MR001', invoiceData);
      expect(result.success).toBe(true);
    });
  });

  it('emits MAINTENANCE_INVOICE_SUBMITTED event on success', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const createdInvoice = makeInvoice(InvoiceStatus.PENDING);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));
    mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(createdInvoice));
    mockDAO.updateById.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await service.submitInvoice(ctx, 'MR001', invoiceData);

    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_INVOICE_SUBMITTED,
      expect.objectContaining({ mruid: 'MR001', cuid: testCuid })
    );
  });
});

// ===========================================================================
// approveInvoice
// ===========================================================================

describe('approveInvoice', () => {
  it('throws ForbiddenError for non-management roles', async () => {
    const ctx = makeCtx('tenant');
    await expect(service.approveInvoice(ctx, 'MR001')).rejects.toThrow(ForbiddenError);
  });

  it('throws ForbiddenError for vendor role', async () => {
    const ctx = makeCtx('vendor');
    await expect(service.approveInvoice(ctx, 'MR001')).rejects.toThrow(ForbiddenError);
  });

  it('throws NotFoundError when request does not exist', async () => {
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(null));
    const ctx = makeCtx('manager');
    await expect(service.approveInvoice(ctx, 'MR001')).rejects.toThrow(NotFoundError);
  });

  it('throws BadRequestError when no invoice exists for the MR', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(null));

    const ctx = makeCtx('manager');
    await expect(service.approveInvoice(ctx, 'MR001')).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when invoice is not PENDING', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const invoice = makeInvoice(InvoiceStatus.APPROVED);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(invoice));

    const ctx = makeCtx('manager');
    await expect(service.approveInvoice(ctx, 'MR001')).rejects.toThrow(BadRequestError);
  });

  it('approves a PENDING invoice and emits MAINTENANCE_INVOICE_APPROVED', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const invoice = makeInvoice(InvoiceStatus.PENDING);
    const updatedInvoice = makeInvoice(InvoiceStatus.APPROVED);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(invoice));
    mockInvoiceDAO.updateById.mockReturnValue(Promise.resolve(updatedInvoice));
    mockDAO.updateById.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('manager');
    const result = await service.approveInvoice(ctx, 'MR001', { isBillable: true });

    expect(result.success).toBe(true);
    expect(mockInvoiceDAO.updateById).toHaveBeenCalledWith(
      invoice._id.toString(),
      expect.objectContaining({ $set: expect.objectContaining({ status: InvoiceStatus.APPROVED }) })
    );
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_INVOICE_APPROVED,
      expect.objectContaining({ mruid: 'MR001', cuid: testCuid, isBillable: true })
    );
  });
});

// ===========================================================================
// rejectInvoice
// ===========================================================================

describe('rejectInvoice', () => {
  it('throws ForbiddenError for non-management roles', async () => {
    const ctx = makeCtx('vendor');
    await expect(
      service.rejectInvoice(ctx, 'MR001', { rejectionReason: 'Too expensive' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws BadRequestError when invoice is not PENDING', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const invoice = makeInvoice(InvoiceStatus.REJECTED);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(invoice));

    const ctx = makeCtx('admin');
    await expect(
      service.rejectInvoice(ctx, 'MR001', { rejectionReason: 'Too expensive' })
    ).rejects.toThrow(BadRequestError);
  });

  it('rejects a PENDING invoice and persists the reason', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const invoice = makeInvoice(InvoiceStatus.PENDING);
    const updatedInvoice = makeInvoice(InvoiceStatus.REJECTED);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(invoice));
    mockInvoiceDAO.updateById.mockReturnValue(Promise.resolve(updatedInvoice));

    const ctx = makeCtx('admin');
    const result = await service.rejectInvoice(ctx, 'MR001', { rejectionReason: 'Too expensive' });

    expect(result.success).toBe(true);
    expect(mockInvoiceDAO.updateById).toHaveBeenCalledWith(
      invoice._id.toString(),
      expect.objectContaining({
        $set: expect.objectContaining({
          status: InvoiceStatus.REJECTED,
          'review.rejectionReason': 'Too expensive',
        }),
      })
    );
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_INVOICE_REJECTED,
      expect.objectContaining({ rejectionReason: 'Too expensive' })
    );
  });
});

// ===========================================================================
// reviewInvoice (dispatcher)
// ===========================================================================

describe('reviewInvoice', () => {
  it('delegates to approveInvoice when action is "approve"', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const invoice = makeInvoice(InvoiceStatus.PENDING);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(invoice));
    mockInvoiceDAO.updateById.mockReturnValue(Promise.resolve(makeInvoice(InvoiceStatus.APPROVED)));

    const ctx = makeCtx('manager');
    const result = await service.reviewInvoice(ctx, 'MR001', { action: 'approve' });
    expect(result.success).toBe(true);
    expect(mockInvoiceDAO.updateById).toHaveBeenCalledWith(
      invoice._id.toString(),
      expect.objectContaining({ $set: expect.objectContaining({ status: InvoiceStatus.APPROVED }) })
    );
  });

  it('delegates to rejectInvoice when action is "reject"', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const invoice = makeInvoice(InvoiceStatus.PENDING);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.findByMaintenanceRequest.mockReturnValue(Promise.resolve(invoice));
    mockInvoiceDAO.updateById.mockReturnValue(Promise.resolve(makeInvoice(InvoiceStatus.REJECTED)));

    const ctx = makeCtx('admin');
    const result = await service.reviewInvoice(ctx, 'MR001', {
      action: 'reject',
      rejectionReason: 'Incomplete',
    });
    expect(result.success).toBe(true);
    expect(mockInvoiceDAO.updateById).toHaveBeenCalledWith(
      invoice._id.toString(),
      expect.objectContaining({ $set: expect.objectContaining({ status: InvoiceStatus.REJECTED }) })
    );
  });
});

// ===========================================================================
// submitWorkOrder
// ===========================================================================

describe('submitWorkOrder', () => {
  const workOrderData = {
    scope: '<p>Fix the pipe</p>',
    estimatedCostInCents: 20000,
    lineItems: [],
  };

  it('throws BadRequestError when MR is not in an accepted status', async () => {
    const request = makeRequest(MaintenanceRequestStatus.OPEN);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(service.submitWorkOrder(ctx, 'MR001', workOrderData)).rejects.toThrow(
      BadRequestError
    );
  });

  it('throws ForbiddenError when caller is not a vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('manager');
    await expect(service.submitWorkOrder(ctx, 'MR001', workOrderData)).rejects.toThrow(
      ForbiddenError
    );
  });

  it('throws ForbiddenError when vendor is not the assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', new Types.ObjectId().toString());
    await expect(service.submitWorkOrder(ctx, 'MR001', workOrderData)).rejects.toThrow(
      ForbiddenError
    );
  });

  it('throws BadRequestError when a work order is already PENDING_REVIEW', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      workOrder: { status: WorkOrderStatus.PENDING_REVIEW },
    });
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(service.submitWorkOrder(ctx, 'MR001', workOrderData)).rejects.toThrow(
      BadRequestError
    );
  });

  it('throws BadRequestError when a work order is already APPROVED', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      workOrder: { status: WorkOrderStatus.APPROVED },
    });
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    await expect(service.submitWorkOrder(ctx, 'MR001', workOrderData)).rejects.toThrow(
      BadRequestError
    );
  });

  it('submits a work order successfully for the assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED);
    const updated = { ...request, workOrder: { status: WorkOrderStatus.PENDING_REVIEW } };
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockDAO.updateById.mockReturnValue(Promise.resolve(updated));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.submitWorkOrder(ctx, 'MR001', workOrderData);

    expect(result.success).toBe(true);
    expect(mockDAO.updateById).toHaveBeenCalled();
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_WORK_ORDER_SUBMITTED,
      expect.objectContaining({ mruid: 'MR001', cuid: testCuid })
    );
  });

  it('allows a team member to submit when they resolve to the assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED);
    const updated = { ...request, workOrder: { status: WorkOrderStatus.PENDING_REVIEW } };
    const teamMemberSub = new Types.ObjectId().toString();
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockDAO.updateById.mockReturnValue(Promise.resolve(updated));
    mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

    const ctx = makeCtx('vendor', teamMemberSub, { linkedVendorUid: 'primary-uid' });
    const result = await service.submitWorkOrder(ctx, 'MR001', workOrderData);
    expect(result.success).toBe(true);
  });

  describe('technician authorization', () => {
    const assignedTechId = new Types.ObjectId().toString();
    const otherTeamMemberId = new Types.ObjectId().toString();

    it('allows primary vendor to submit WO even when a specific technician is assigned', async () => {
      const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
        assignedTechnician: { userId: assignedTechId, name: 'Tech One' },
      });
      const updated = { ...request, workOrder: { status: WorkOrderStatus.PENDING_REVIEW } };
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockDAO.updateById.mockReturnValue(Promise.resolve(updated));

      const ctx = makeCtx('vendor', vendorObjectId.toString());
      const result = await service.submitWorkOrder(ctx, 'MR001', workOrderData);
      expect(result.success).toBe(true);
    });

    it('allows the assigned technician to submit WO', async () => {
      const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
        assignedTechnician: { userId: assignedTechId, name: 'Tech One' },
      });
      const updated = { ...request, workOrder: { status: WorkOrderStatus.PENDING_REVIEW } };
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockDAO.updateById.mockReturnValue(Promise.resolve(updated));
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

      const ctx = makeCtx('vendor', assignedTechId, { linkedVendorUid: 'primary-uid' });
      const result = await service.submitWorkOrder(ctx, 'MR001', workOrderData);
      expect(result.success).toBe(true);
    });

    it('blocks a non-assigned team member when a specific technician is set', async () => {
      const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
        assignedTechnician: { userId: assignedTechId, name: 'Tech One' },
      });
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

      const ctx = makeCtx('vendor', otherTeamMemberId, { linkedVendorUid: 'primary-uid' });
      await expect(service.submitWorkOrder(ctx, 'MR001', workOrderData)).rejects.toThrow(
        ForbiddenError
      );
    });

    it('allows any linked team member when no specific technician is set (fallback)', async () => {
      // No assignedTechnician.userId — original behavior preserved
      const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
        assignedTechnician: { name: 'Some Tech' }, // no userId
      });
      const updated = { ...request, workOrder: { status: WorkOrderStatus.PENDING_REVIEW } };
      mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
      mockDAO.updateById.mockReturnValue(Promise.resolve(updated));
      mockUserDAO.findFirst.mockReturnValue(Promise.resolve({ _id: vendorObjectId }));

      const ctx = makeCtx('vendor', otherTeamMemberId, { linkedVendorUid: 'primary-uid' });
      const result = await service.submitWorkOrder(ctx, 'MR001', workOrderData);
      expect(result.success).toBe(true);
    });
  });

  it('allows resubmission after a REJECTED work order', async () => {
    const request = makeRequest(MaintenanceRequestStatus.ASSIGNED, {
      workOrder: { status: WorkOrderStatus.REJECTED },
    });
    const updated = { ...request, workOrder: { status: WorkOrderStatus.PENDING_REVIEW } };
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockDAO.updateById.mockReturnValue(Promise.resolve(updated));

    const ctx = makeCtx('vendor', vendorObjectId.toString());
    const result = await service.submitWorkOrder(ctx, 'MR001', workOrderData);
    expect(result.success).toBe(true);
  });
});

// ===========================================================================
// reviewWorkOrder
// ===========================================================================

describe('reviewWorkOrder', () => {
  it('throws BadRequestError when no work order exists', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS);
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('manager');
    await expect(
      service.reviewWorkOrder(ctx, 'MR001', { action: 'approve' })
    ).rejects.toThrow(BadRequestError);
  });

  it('throws BadRequestError when work order is not PENDING_REVIEW', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      workOrder: { status: WorkOrderStatus.APPROVED },
    });
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('manager');
    await expect(
      service.reviewWorkOrder(ctx, 'MR001', { action: 'reject' })
    ).rejects.toThrow(BadRequestError);
  });

  it('throws ForbiddenError when a vendor tries to review', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      workOrder: { status: WorkOrderStatus.PENDING_REVIEW },
    });
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));

    const ctx = makeCtx('vendor');
    await expect(
      service.reviewWorkOrder(ctx, 'MR001', { action: 'approve' })
    ).rejects.toThrow(ForbiddenError);
  });

  it('approves the work order and emits MAINTENANCE_WORK_ORDER_APPROVED', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      workOrder: { status: WorkOrderStatus.PENDING_REVIEW },
    });
    const updated = { ...request, workOrder: { status: WorkOrderStatus.APPROVED } };
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockDAO.updateById.mockReturnValue(Promise.resolve(updated));

    const ctx = makeCtx('manager');
    const result = await service.reviewWorkOrder(ctx, 'MR001', { action: 'approve' });

    expect(result.success).toBe(true);
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_WORK_ORDER_APPROVED,
      expect.objectContaining({ mruid: 'MR001' })
    );
  });

  it('rejects the work order and emits MAINTENANCE_WORK_ORDER_REJECTED', async () => {
    const request = makeRequest(MaintenanceRequestStatus.IN_PROGRESS, {
      workOrder: { status: WorkOrderStatus.PENDING_REVIEW },
    });
    const updated = { ...request, workOrder: { status: WorkOrderStatus.REJECTED } };
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(request));
    mockDAO.updateById.mockReturnValue(Promise.resolve(updated));

    const ctx = makeCtx('admin');
    const result = await service.reviewWorkOrder(ctx, 'MR001', {
      action: 'reject',
      rejectionReason: 'Incomplete scope',
    });

    expect(result.success).toBe(true);
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_WORK_ORDER_REJECTED,
      expect.objectContaining({ rejectionReason: 'Incomplete scope' })
    );
  });
});

// ===========================================================================
// handleInvoiceWebhook
// ===========================================================================

describe('handleInvoiceWebhook', () => {
  const rawBody = Buffer.from('{}');
  const headers = {} as Record<string, string>;

  function makePayload(overrides: Record<string, unknown> = {}): any {
    return {
      mruid: 'MR001',
      cuid: testCuid,
      source: 'manual' as InvoiceSource,
      amount: 15000,
      currency: 'USD',
      description: 'Invoice via webhook',
      lineItems: [],
      rawPayload: {},
      ...overrides,
    };
  }

  it('throws NotFoundError when no MR matches the payload mruid', async () => {
    mockDAO.findFirst.mockReturnValue(Promise.resolve(null));

    await expect(
      service.handleInvoiceWebhook('manual', rawBody, headers, makePayload())
    ).rejects.toThrow(NotFoundError);
  });

  it('throws ForbiddenError when request cuid does not match payload cuid', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE, {
      cuid: 'DIFFERENT_CLIENT',
    });
    mockDAO.findFirst.mockReturnValue(Promise.resolve(request));

    await expect(
      service.handleInvoiceWebhook('manual', rawBody, headers, makePayload({ cuid: testCuid }))
    ).rejects.toThrow(ForbiddenError);
  });

  it('throws BadRequestError when MR has no assigned vendor', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE, { vendorId: null });
    mockDAO.findFirst.mockReturnValue(Promise.resolve(request));

    await expect(
      service.handleInvoiceWebhook('manual', rawBody, headers, makePayload())
    ).rejects.toThrow(BadRequestError);
  });

  it('creates an invoice and links it to the MR atomically', async () => {
    const request = makeRequest(MaintenanceRequestStatus.AWAITING_INVOICE);
    const createdInvoice = makeInvoice(InvoiceStatus.PENDING);
    mockDAO.findFirst.mockReturnValue(Promise.resolve(request));
    mockInvoiceDAO.insert.mockReturnValue(Promise.resolve(createdInvoice));
    mockDAO.updateById.mockReturnValue(Promise.resolve(request));

    const result = await service.handleInvoiceWebhook(
      'manual',
      rawBody,
      headers,
      makePayload()
    );

    expect(result.success).toBe(true);
    expect(mockInvoiceDAO.insert).toHaveBeenCalled();
    expect(mockDAO.updateById).toHaveBeenCalledWith(
      request._id.toString(),
      expect.objectContaining({ $set: { invoiceId: createdInvoice._id } }),
      {},
      expect.anything()
    );
    expect(mockEmitter.emit).toHaveBeenCalledWith(
      EventTypes.MAINTENANCE_INVOICE_SUBMITTED,
      expect.objectContaining({ mruid: 'MR001', cuid: testCuid })
    );
  });
});
