import { Types } from 'mongoose';
import { BadRequestError, NotFoundError } from '@shared/customErrors';
import { MaintenanceRequestStatus } from '@interfaces/maintenanceRequest.interface';
import {
  resolvePrimaryVendorId,
  ALLOWED_TRANSITIONS,
  getRequestOrThrow,
  assertTransition,
} from '@services/maintenanceRequest/serviceRequest.helpers';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockDAO = {
  getByMruid: jest.fn(),
} as any;

const mockUserDAO = {
  findFirst: jest.fn(),
} as any;

const mockVendorDAO = {
  getVendorByVuid: jest.fn(),
} as any;

const testCuid = 'CLIENT001';

function makeCurrentUser(overrides: Record<string, unknown> = {}): any {
  return {
    sub: new Types.ObjectId().toString(),
    client: { cuid: testCuid, role: 'vendor', linkedVendorUid: undefined },
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ===========================================================================
// ALLOWED_TRANSITIONS constant
// ===========================================================================

describe('ALLOWED_TRANSITIONS', () => {
  it('PENDING may only transition to OPEN', () => {
    expect(ALLOWED_TRANSITIONS[MaintenanceRequestStatus.PENDING]).toEqual([
      MaintenanceRequestStatus.OPEN,
    ]);
  });

  it('COMPLETED has no valid outgoing transitions', () => {
    expect(ALLOWED_TRANSITIONS[MaintenanceRequestStatus.COMPLETED]).toHaveLength(0);
  });

  it('CANCELLED has no valid outgoing transitions', () => {
    expect(ALLOWED_TRANSITIONS[MaintenanceRequestStatus.CANCELLED]).toHaveLength(0);
  });

  it('ASSIGNED may transition to IN_PROGRESS, OPEN, or CANCELLED', () => {
    const targets = ALLOWED_TRANSITIONS[MaintenanceRequestStatus.ASSIGNED];
    expect(targets).toContain(MaintenanceRequestStatus.IN_PROGRESS);
    expect(targets).toContain(MaintenanceRequestStatus.OPEN);
    expect(targets).toContain(MaintenanceRequestStatus.CANCELLED);
  });
});

// ===========================================================================
// assertTransition
// ===========================================================================

describe('assertTransition', () => {
  it('does not throw for a valid PENDING → OPEN transition', () => {
    expect(() =>
      assertTransition(MaintenanceRequestStatus.PENDING, MaintenanceRequestStatus.OPEN)
    ).not.toThrow();
  });

  it('does not throw for a valid ASSIGNED → IN_PROGRESS transition', () => {
    expect(() =>
      assertTransition(MaintenanceRequestStatus.ASSIGNED, MaintenanceRequestStatus.IN_PROGRESS)
    ).not.toThrow();
  });

  it('throws BadRequestError for PENDING → COMPLETED (not in allowed list)', () => {
    expect(() =>
      assertTransition(MaintenanceRequestStatus.PENDING, MaintenanceRequestStatus.COMPLETED)
    ).toThrow(BadRequestError);
  });

  it('throws BadRequestError for COMPLETED → OPEN (terminal state)', () => {
    expect(() =>
      assertTransition(MaintenanceRequestStatus.COMPLETED, MaintenanceRequestStatus.OPEN)
    ).toThrow(BadRequestError);
  });

  it('throws BadRequestError for CANCELLED → OPEN (terminal state)', () => {
    expect(() =>
      assertTransition(MaintenanceRequestStatus.CANCELLED, MaintenanceRequestStatus.OPEN)
    ).toThrow(BadRequestError);
  });

  it('throws BadRequestError for IN_PROGRESS → ASSIGNED (backwards transition)', () => {
    expect(() =>
      assertTransition(MaintenanceRequestStatus.IN_PROGRESS, MaintenanceRequestStatus.ASSIGNED)
    ).toThrow(BadRequestError);
  });
});

// ===========================================================================
// getRequestOrThrow
// ===========================================================================

describe('getRequestOrThrow', () => {
  it('returns the document when found', async () => {
    const doc = { _id: new Types.ObjectId(), mruid: 'MR001', cuid: testCuid };
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(doc));

    const result = await getRequestOrThrow(mockDAO, 'MR001', testCuid);
    expect(result).toBe(doc);
    expect(mockDAO.getByMruid).toHaveBeenCalledWith('MR001', testCuid);
  });

  it('throws NotFoundError when dao returns null', async () => {
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(null));

    await expect(getRequestOrThrow(mockDAO, 'MR999', testCuid)).rejects.toThrow(NotFoundError);
  });

  it('throws NotFoundError when dao returns undefined', async () => {
    mockDAO.getByMruid.mockReturnValue(Promise.resolve(undefined));

    await expect(getRequestOrThrow(mockDAO, 'MR999', testCuid)).rejects.toThrow(NotFoundError);
  });
});

// ===========================================================================
// resolvePrimaryVendorId
// ===========================================================================

describe('resolvePrimaryVendorId', () => {
  it('returns null immediately when linkedVendorUid is not set', async () => {
    const currentuser = makeCurrentUser({ client: { cuid: testCuid, role: 'vendor' } });

    const result = await resolvePrimaryVendorId(mockVendorDAO, currentuser);
    expect(result).toBeNull();
    expect(mockVendorDAO.getVendorByVuid).not.toHaveBeenCalled();
  });

  it('returns the ObjectId of the primary vendor user when found', async () => {
    const primaryId = new Types.ObjectId();
    const currentuser = makeCurrentUser({
      client: { cuid: testCuid, role: 'vendor', linkedVendorUid: 'vendor-uid-123' },
    });
    mockVendorDAO.getVendorByVuid.mockReturnValue(
      Promise.resolve({
        connectedClients: [{ cuid: testCuid, primaryAccountHolderUserId: primaryId }],
      })
    );

    const result = await resolvePrimaryVendorId(mockVendorDAO, currentuser);
    expect(result).toBe(primaryId);
    expect(mockVendorDAO.getVendorByVuid).toHaveBeenCalledWith('vendor-uid-123');
  });

  it('returns null when the primary vendor user is not found', async () => {
    const currentuser = makeCurrentUser({
      client: { cuid: testCuid, role: 'vendor', linkedVendorUid: 'vendor-uid-missing' },
    });
    mockVendorDAO.getVendorByVuid.mockReturnValue(Promise.resolve(null));

    const result = await resolvePrimaryVendorId(mockVendorDAO, currentuser);
    expect(result).toBeNull();
  });
});
