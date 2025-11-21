import { Types } from 'mongoose';
import { LeaseService } from '@services/lease/lease.service';
import { IUserRole } from '@shared/constants/roles.constants';
import { LeaseStatus, LeaseType } from '@interfaces/lease.interface';
import { ForbiddenError, BadRequestError } from '@shared/customErrors';

const createMockDeps = () => ({
  leaseDAO: { findFirst: jest.fn(), update: jest.fn() },
  propertyDAO: { findFirst: jest.fn() },
  propertyUnitDAO: { findFirst: jest.fn() },
  userDAO: { findFirst: jest.fn() },
  profileDAO: { findFirst: jest.fn() },
  clientDAO: { getClientByCuid: jest.fn() },
  invitationDAO: { findFirst: jest.fn() },
  invitationService: { sendInvitation: jest.fn() },
  assetService: { createAssets: jest.fn() },
  emitterService: { emit: jest.fn(), on: jest.fn() },
  leaseCache: { invalidateLease: jest.fn() },
  notificationService: { notifyPropertyUpdate: jest.fn() },
});

const createContext = (role = IUserRole.ADMIN) => ({
  request: { params: { cuid: 'C123' }, path: '', method: 'PATCH', url: '', query: {} },
  currentuser: {
    uid: 'U123',
    sub: new Types.ObjectId().toString(),
    displayName: 'Test User',
    email: 'test@example.com',
    client: { cuid: 'C123', role },
  },
  userAgent: { isMobile: false, isBot: false },
  langSetting: { lang: 'en' },
  timing: { startTime: Date.now() },
});

const createLease = (status = LeaseStatus.DRAFT) => ({
  _id: new Types.ObjectId(),
  luid: 'L123',
  cuid: 'C123',
  status,
  tenantId: new Types.ObjectId(),
  property: { id: new Types.ObjectId() },
  fees: { monthlyRent: 1000 },
  duration: { startDate: new Date(), endDate: new Date(), monthCount: 12 },
  modifications: [],
  toObject: function () {
    return { ...this };
  },
});

describe('LeaseService - updateLease', () => {
  let service: LeaseService;
  let deps: ReturnType<typeof createMockDeps>;

  beforeEach(() => {
    jest.clearAllMocks();
    deps = createMockDeps();
    service = new LeaseService(deps as any);
  });

  it('should reject unauthorized users', async () => {
    const ctx = createContext('VIEWER' as any);
    deps.leaseDAO.findFirst.mockResolvedValue(createLease());

    await expect(service.updateLease(ctx as any, 'L123', { internalNotes: 'Test' })).rejects.toThrow(
      ForbiddenError
    );
  });

  it('should allow admin to update DRAFT lease directly', async () => {
    const ctx = createContext(IUserRole.ADMIN);
    const lease = createLease();
    deps.leaseDAO.findFirst.mockResolvedValue(lease);
    deps.leaseDAO.update.mockResolvedValue({ ...lease, fees: { monthlyRent: 1500 } });

    const result = await service.updateLease(ctx as any, 'L123', { fees: { monthlyRent: 1500 } });

    expect(result.success).toBe(true);
    expect(result.data.requiresApproval).toBe(false);
  });

  it('should require approval for staff high-impact changes in DRAFT', async () => {
    const ctx = createContext(IUserRole.STAFF);
    const lease = createLease();
    deps.leaseDAO.findFirst.mockResolvedValue(lease);
    deps.leaseDAO.update.mockResolvedValue({ ...lease, pendingChanges: {} });
    deps.profileDAO.findFirst.mockResolvedValue({
      personalInfo: { firstName: 'Test', lastName: 'User' },
    });

    const result = await service.updateLease(ctx as any, 'L123', {
      property: { id: new Types.ObjectId().toString() },
    });

    expect(result.success).toBe(true);
    expect(result.data.requiresApproval).toBe(true);
  });

  it('should allow staff low-impact changes in DRAFT directly', async () => {
    const ctx = createContext(IUserRole.STAFF);
    const lease = createLease();
    deps.leaseDAO.findFirst.mockResolvedValue(lease);
    deps.leaseDAO.update.mockResolvedValue({ ...lease, internalNotes: 'Staff note' });

    const result = await service.updateLease(ctx as any, 'L123', { internalNotes: 'Staff note' });

    expect(result.success).toBe(true);
    expect(result.data.requiresApproval).toBe(false);
  });

  it('should reject staff updates on PENDING_SIGNATURE', async () => {
    const ctx = createContext(IUserRole.STAFF);
    deps.leaseDAO.findFirst.mockResolvedValue(createLease(LeaseStatus.PENDING_SIGNATURE));

    await expect(service.updateLease(ctx as any, 'L123', { internalNotes: 'Test' })).rejects.toThrow(
      ForbiddenError
    );
  });

  it('should reject staff updates on EXPIRED leases', async () => {
    const ctx = createContext(IUserRole.STAFF);
    deps.leaseDAO.findFirst.mockResolvedValue(createLease(LeaseStatus.EXPIRED));

    await expect(service.updateLease(ctx as any, 'L123', { internalNotes: 'Test' })).rejects.toThrow(
      ForbiddenError
    );
  });

  it('should require approval for staff high-impact changes in ACTIVE', async () => {
    const ctx = createContext(IUserRole.STAFF);
    const lease = createLease(LeaseStatus.ACTIVE);
    deps.leaseDAO.findFirst.mockResolvedValue(lease);
    deps.leaseDAO.update.mockResolvedValue({ ...lease, pendingChanges: {} });
    deps.profileDAO.findFirst.mockResolvedValue({
      personalInfo: { firstName: 'Test', lastName: 'User' },
    });

    const result = await service.updateLease(ctx as any, 'L123', { fees: { monthlyRent: 1500 } });

    expect(result.success).toBe(true);
    expect(result.data.requiresApproval).toBe(true);
  });

  it('should sanitize empty unitId to undefined', async () => {
    const ctx = createContext(IUserRole.ADMIN);
    const lease = createLease();
    deps.leaseDAO.findFirst.mockResolvedValue(lease);
    deps.leaseDAO.update.mockResolvedValue(lease);

    await service.updateLease(ctx as any, 'L123', {
      property: { id: lease.property.id.toString(), unitId: '' },
    });

    const updateCall = deps.leaseDAO.update.mock.calls[0];
    expect(updateCall[1].$set.property.unitId).toBeUndefined();
  });

  it('should invalidate cache after update', async () => {
    const ctx = createContext(IUserRole.ADMIN);
    const lease = createLease();
    deps.leaseDAO.findFirst.mockResolvedValue(lease);
    deps.leaseDAO.update.mockResolvedValue(lease);

    await service.updateLease(ctx as any, 'L123', { internalNotes: 'Test' });

    expect(deps.leaseCache.invalidateLease).toHaveBeenCalledWith('C123', 'L123');
  });

  it('should throw error if lease not found', async () => {
    const ctx = createContext(IUserRole.ADMIN);
    deps.leaseDAO.findFirst.mockResolvedValue(null);

    await expect(service.updateLease(ctx as any, 'L123', { internalNotes: 'Test' })).rejects.toThrow(
      BadRequestError
    );
  });
});
