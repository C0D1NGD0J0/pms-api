import { Types } from 'mongoose';
import { IRequestContext } from '@interfaces/utils.interface';
import { mockSubscriptionService } from '@tests/setup/externalMocks';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';

// Break the circular import chain: lease.service → @shared/middlewares → @di/index → registerResources → lease.service (undefined)
jest.mock('@shared/middlewares', () => ({
  preventTenantConflict: jest.requireActual('@shared/middlewares/middleware').preventTenantConflict,
}));
jest.mock('@di/index', () => ({ container: {} }));

import { LeaseService } from '@services/lease/lease.service';

/**
 * The lease API speaks public ids (pid, unit puid, user uids); the service resolves them within
 * the client and stores ObjectId refs.
 */
describe('LeaseService — public id resolution', () => {
  const cuid = 'CLIENT000001';
  const actorId = new Types.ObjectId();
  const propertyId = new Types.ObjectId();
  const unitId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const managerId = new Types.ObjectId();

  const property = {
    _id: propertyId,
    pid: 'PROPERTY0001',
    name: 'Maple Court',
    address: { fullAddress: '1 Maple Court, Toronto' },
    approvalStatus: 'approved',
    cuid,
    isManagementAuthorized: () => true,
    verificationStatus: 'verified',
    authorization: { isActive: true },
    isVerifiedForLeasing: () => true,
    owner: { type: 'company_owned' },
    propertyType: 'apartment',
  };
  const unit = { _id: unitId, puid: 'UNIT00000001', unitNumber: '101', status: 'available' };
  const tenant = {
    _id: tenantId,
    uid: 'TENANT000001',
    cuids: [{ cuid, roles: ['tenant'], isConnected: true }],
  };

  const context = {
    currentuser: {
      sub: actorId.toString(),
      email: 'admin@example.com',
      fullname: 'Admin User',
      client: { cuid, role: 'admin' },
    },
    request: { params: { cuid } },
  } as unknown as IRequestContext;

  const leaseRequest = (overrides: Record<string, unknown> = {}) =>
    ({
      tenantInfo: { uid: tenant.uid },
      property: { pid: property.pid, puid: unit.puid, managedBy: 'MANAGER00001' },
      duration: { startDate: new Date(), endDate: new Date(Date.now() + 365 * 86400000) },
      fees: { rentAmount: 1000, securityDeposit: 1000, rentDueDay: 1 },
      ...overrides,
    }) as any;

  let leaseService: LeaseService;
  let leaseDAO: any;
  let userDAO: any;
  let propertyDAO: any;
  let propertyUnitDAO: any;

  beforeEach(() => {
    leaseDAO = {
      createLease: jest.fn().mockResolvedValue({ _id: new Types.ObjectId(), luid: 'LEASE0000001' }),
      findFirst: jest.fn(),
      startSession: jest.fn(),
      withTransaction: jest.fn((session, callback) => callback(session)),
      checkOverlappingLeases: jest.fn().mockResolvedValue([]),
    };
    userDAO = {
      findFirst: jest.fn().mockResolvedValue(tenant),
      // Only employees connected to the client come back from the cuid-scoped query
      list: jest.fn().mockResolvedValue({ items: [{ _id: managerId, uid: 'MANAGER00001' }] }),
    };
    propertyDAO = { findFirst: jest.fn().mockResolvedValue(property) };
    propertyUnitDAO = {
      findFirst: jest.fn().mockResolvedValue(unit),
      updateById: jest.fn().mockResolvedValue(unit),
    };

    leaseService = new LeaseService({
      subscriptionService: mockSubscriptionService as any,
      leaseDAO,
      userDAO,
      clientDAO: {
        getClientByCuid: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          cuid,
          accountAdmin: actorId,
          accountType: { isEnterpriseAccount: false, category: 'individual' },
        }),
      } as any,
      propertyDAO,
      invitationDAO: { findFirst: jest.fn() } as any,
      profileDAO: {
        findFirst: jest.fn().mockResolvedValue({
          personalInfo: { firstName: 'Test', lastName: 'Landlord' },
          user: { email: 'landlord@example.com' },
        }),
      } as any,
      mailerService: {} as any,
      invitationService: {} as any,
      leaseCache: { invalidateLease: jest.fn(), invalidateLeaseLists: jest.fn() } as any,
      emitterService: { on: jest.fn(), off: jest.fn(), emit: jest.fn() } as any,
      notificationService: {} as any,
      leaseSignatureService: {} as any,
      leaseDocumentService: {} as any,
      leaseTemplateService: {} as any,
      leaseRenewalService: {} as any,
      mediaUploadService: {} as any,
      leasePdfService: {} as any,
      boldSignService: {} as any,
      propertyUnitDAO,
      queueFactory: {} as any,
      userService: {} as any,
      smsService: { sendToUser: jest.fn().mockResolvedValue({}) } as any,
      paymentDAO: {} as any,
      userCache: { invalidateUserDetail: jest.fn().mockResolvedValue({ success: true }) } as any,
      s3Service: { getSignedUrl: jest.fn(), uploadFiles: jest.fn() } as any,
    });
  });

  const rejectionOf = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      return error as { errorInfo?: Record<string, string[]> } & ValidationRequestError;
    }
    throw new Error('expected the call to reject');
  };

  describe('createLease', () => {
    it('resolves pid, puid, tenant uid and manager uid within the client and stores ObjectIds', async () => {
      await leaseService.createLease(cuid, leaseRequest(), context);

      expect(propertyDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ pid: property.pid, cuid, deletedAt: null }),
        expect.anything()
      );
      expect(propertyUnitDAO.findFirst).toHaveBeenCalledWith({
        puid: unit.puid,
        propertyId,
        cuid,
        deletedAt: null,
      });
      expect(userDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ uid: tenant.uid, 'cuids.cuid': cuid })
      );

      const [, stored] = leaseDAO.createLease.mock.calls[0];
      expect(stored.tenantId).toBe(tenantId);
      expect(stored.property).toMatchObject({ id: propertyId, unitId, managedBy: managerId });
      expect(stored).not.toHaveProperty('tenantInfo');
      expect(stored.property).not.toHaveProperty('pid');
      expect(propertyUnitDAO.updateById).toHaveBeenCalledWith(
        unitId.toString(),
        expect.anything(),
        undefined
      );
    });

    it('rejects a property pid outside the client', async () => {
      propertyDAO.findFirst.mockResolvedValue(null);

      await expect(
        leaseService.createLease(cuid, leaseRequest({ property: { pid: 'OTHERPROP001' } }), context)
      ).rejects.toThrow(BadRequestError);
      expect(leaseDAO.createLease).not.toHaveBeenCalled();
    });

    it.each([
      [{ approvalStatus: 'pending' }, 'lease.errors.propertyNotApproved'],
      [{ verificationStatus: 'unverified' }, 'lease.errors.ownershipUnverified'],
      [
        { owner: { type: 'external_owner' }, authorization: undefined },
        'lease.errors.managementNotAuthorized',
      ],
    ])(
      'says why a property that fails the ownership checks (%o) cannot be leased',
      async (overrides, key) => {
        propertyDAO.findFirst.mockResolvedValue({ ...property, ...overrides });

        await expect(leaseService.createLease(cuid, leaseRequest(), context)).rejects.toThrow(key);
        expect(leaseDAO.createLease).not.toHaveBeenCalled();
      }
    );

    it('rejects an unknown or other-client tenant uid', async () => {
      userDAO.findFirst.mockResolvedValue(null);

      const error = await rejectionOf(leaseService.createLease(cuid, leaseRequest(), context));

      expect(error).toBeInstanceOf(ValidationRequestError);
      expect(error.errorInfo).toHaveProperty(['tenantInfo.uid']);
      expect(leaseDAO.createLease).not.toHaveBeenCalled();
    });

    it("rejects a unit puid that is not one of the property's units", async () => {
      propertyUnitDAO.findFirst.mockResolvedValue(null);

      const error = await rejectionOf(leaseService.createLease(cuid, leaseRequest(), context));

      expect(error).toBeInstanceOf(ValidationRequestError);
      expect(error.errorInfo).toHaveProperty(['property.puid']);
    });

    it('rejects a manager uid that is not an employee of this client', async () => {
      userDAO.list.mockResolvedValue({ items: [] });

      const error = await rejectionOf(leaseService.createLease(cuid, leaseRequest(), context));

      expect(error).toBeInstanceOf(ValidationRequestError);
      expect(error.errorInfo).toHaveProperty(['property.managedBy']);
      expect(userDAO.list.mock.calls[0][0]).toMatchObject({
        uid: { $in: ['MANAGER00001'] },
        cuids: { $elemMatch: { cuid, isConnected: true } },
      });
    });
  });

  describe('updateLease property refs', () => {
    const lease = { property: { id: propertyId } };
    const resolve = (requested: Record<string, unknown>) =>
      (leaseService as any).resolveLeasePropertyUpdate(cuid, lease, requested);

    it('swaps pid, puid and the manager uid for ObjectIds', async () => {
      const newPropertyId = new Types.ObjectId();
      propertyDAO.findFirst.mockResolvedValue({ _id: newPropertyId });

      const resolved = await resolve({
        pid: 'PROPERTY0002',
        puid: unit.puid,
        managedBy: 'MANAGER00001',
        address: '2 Maple Court',
      });

      expect(resolved).toEqual({
        id: newPropertyId,
        unitId: unitId.toString(),
        managedBy: managerId,
        address: '2 Maple Court',
      });
      expect(propertyDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ pid: 'PROPERTY0002', cuid }),
        expect.anything()
      );
      // the unit is looked up on the new property
      expect(propertyUnitDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ puid: unit.puid, propertyId: newPropertyId, cuid })
      );
    });

    it("looks a puid up on the lease's current property when pid is unchanged", async () => {
      await resolve({ puid: unit.puid });

      expect(propertyDAO.findFirst).not.toHaveBeenCalled();
      expect(propertyUnitDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ puid: unit.puid, propertyId })
      );
    });

    it.each([
      ['an other-client pid', () => propertyDAO.findFirst.mockResolvedValue(null), { pid: 'X' }],
      ['an unknown puid', () => propertyUnitDAO.findFirst.mockResolvedValue(null), { puid: 'X' }],
      [
        'an other-client manager uid',
        () => userDAO.list.mockResolvedValue({ items: [] }),
        { managedBy: 'OTHERCLIENT1' },
      ],
    ])('rejects %s with a 400', async (_label, arrange, requested) => {
      arrange();

      await expect(resolve(requested)).rejects.toThrow(BadRequestError);
    });
  });

  describe('getLeaseById (edit form data)', () => {
    it('adds the public ids of the property, unit, manager and tenant to the raw lease', async () => {
      const storedLease = {
        luid: 'LEASE0000001',
        cuid,
        tenantId,
        property: { id: propertyId, unitId, managedBy: managerId, address: '1 Maple Court' },
      };
      leaseDAO.findFirst.mockResolvedValue({
        ...storedLease,
        toObject: () => ({ ...storedLease }),
      });
      propertyDAO.findFirst.mockResolvedValue({ pid: property.pid });
      userDAO.list.mockResolvedValue({
        items: [
          { _id: managerId, uid: 'MANAGER00001' },
          { _id: tenantId, uid: tenant.uid },
        ],
      });

      const result = await leaseService.getLeaseById(context, 'LEASE0000001', false);

      expect(result.data.lease.property).toMatchObject({
        pid: property.pid,
        puid: unit.puid,
        managedByUid: 'MANAGER00001',
      });
      expect(result.data.lease.tenantUid).toBe(tenant.uid);
    });

    it('returns internal note authors as user uids', async () => {
      const storedLease = {
        luid: 'LEASE0000001',
        cuid,
        tenantId,
        property: { id: propertyId, managedBy: managerId, address: '1 Maple Court' },
        internalNotes: [{ note: 'Keys handed over', author: 'Pat', authorId: managerId }],
      };
      leaseDAO.findFirst.mockResolvedValue({
        ...storedLease,
        toObject: () => ({ ...storedLease }),
      });
      userDAO.list.mockResolvedValue({ items: [{ _id: managerId, uid: 'MANAGER00001' }] });

      const result = await leaseService.getLeaseById(context, 'LEASE0000001', false);

      expect(result.data.lease.internalNotes).toEqual([
        { note: 'Keys handed over', author: 'Pat', authorId: 'MANAGER00001' },
      ]);
    });
  });

  describe('renewLease', () => {
    const luid = 'LEASE0000001';
    const leaseToRenew = { luid, cuid, tenantId, property: { id: propertyId, unitId } };
    let renewLease: jest.Mock;

    beforeEach(() => {
      renewLease = jest.fn().mockResolvedValue({ success: true, data: {} });
      (leaseService as any).leaseRenewalService = { renewLease };
      leaseDAO.findFirst.mockResolvedValue(leaseToRenew);
      // getUserIdsByUid queries by uid (the manager); getUidsByUserId by _id (the tenant)
      userDAO.list.mockImplementation((filter: any) =>
        Promise.resolve({
          items: filter.uid
            ? [{ _id: managerId, uid: 'MANAGER00001' }]
            : [{ _id: tenantId, uid: tenant.uid }],
        })
      );
    });

    const renewalRequest = (overrides: Record<string, unknown> = {}) => ({
      fees: { rentAmount: 1100 },
      property: { pid: property.pid, puid: unit.puid, managedBy: 'MANAGER00001' },
      tenantInfo: { uid: tenant.uid },
      ...overrides,
    });

    it("checks the public ids name the lease's property, unit and tenant and resolves the manager", async () => {
      await leaseService.renewLease(cuid, luid, renewalRequest() as any, context);

      expect(leaseDAO.findFirst).toHaveBeenCalledWith({ luid, cuid, deletedAt: null });
      expect(propertyDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ pid: property.pid, cuid }),
        expect.anything()
      );
      expect(propertyUnitDAO.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ puid: unit.puid, propertyId, cuid })
      );
      const [, , renewalTerms] = renewLease.mock.calls[0];
      expect(renewalTerms).toEqual({
        fees: { rentAmount: 1100 },
        property: { managedBy: managerId },
      });
    });

    it('passes the renewal terms through untouched when no public ids are sent', async () => {
      await leaseService.renewLease(cuid, luid, { fees: { rentAmount: 1100 } } as any, context);

      expect(leaseDAO.findFirst).not.toHaveBeenCalled();
      expect(renewLease.mock.calls[0][2]).toEqual({ fees: { rentAmount: 1100 } });
    });

    it.each([
      [
        'a pid of another property of the client',
        () => propertyDAO.findFirst.mockResolvedValue({ _id: new Types.ObjectId() }),
      ],
      ['a pid outside the client', () => propertyDAO.findFirst.mockResolvedValue(null)],
      [
        'a puid of another unit',
        () => propertyUnitDAO.findFirst.mockResolvedValue({ _id: new Types.ObjectId() }),
      ],
      ['an unknown puid', () => propertyUnitDAO.findFirst.mockResolvedValue(null)],
      [
        'a manager who is not an employee of the client',
        () =>
          userDAO.list.mockImplementation((filter: any) =>
            Promise.resolve({ items: filter.uid ? [] : [{ _id: tenantId, uid: tenant.uid }] })
          ),
      ],
      [
        "a tenant uid that is not the lease's tenant",
        () =>
          userDAO.list.mockImplementation((filter: any) =>
            Promise.resolve({
              items: filter.uid
                ? [{ _id: managerId, uid: 'MANAGER00001' }]
                : [{ _id: tenantId, uid: 'OTHERTENANT1' }],
            })
          ),
      ],
    ])('rejects %s', async (_label, arrange) => {
      arrange();

      await expect(
        leaseService.renewLease(cuid, luid, renewalRequest() as any, context)
      ).rejects.toThrow(BadRequestError);
      expect(renewLease).not.toHaveBeenCalled();
    });
  });

  describe('internal note authors', () => {
    const currentUser = { ...context.currentuser, uid: 'ADMIN0000001' } as any;
    const resolveNotes = (notes: unknown[], existing: unknown[] = []) =>
      (leaseService as any).resolveInternalNoteAuthors(notes, currentUser, existing);

    it("stores the current user's ObjectId for their own notes and author-less new notes", async () => {
      const notes = await resolveNotes([
        { note: 'Mine', author: 'Admin', authorId: 'ADMIN0000001' },
        { note: 'Also mine', author: 'Admin' },
      ]);

      expect(notes.map((n: any) => String(n.authorId))).toEqual([
        actorId.toString(),
        actorId.toString(),
      ]);
      expect(userDAO.list).not.toHaveBeenCalled();
    });

    it("keeps an existing note's author when the lease is edited", async () => {
      userDAO.list.mockResolvedValue({ items: [{ _id: managerId, uid: 'MANAGER00001' }] });

      const [note] = await resolveNotes(
        [{ note: 'Keys handed over', author: 'Pat', authorId: 'MANAGER00001' }],
        [{ note: 'Keys handed over', author: 'Pat', authorId: managerId }]
      );

      expect(String(note.authorId)).toBe(managerId.toString());
    });

    it('rejects a note attributed to anyone else', async () => {
      await expect(
        resolveNotes([{ note: 'Spoofed', author: 'Someone', authorId: 'SOMEONEELSE1' }])
      ).rejects.toThrow(BadRequestError);
    });
  });

  describe('getLeaseStats', () => {
    beforeEach(() => {
      leaseDAO.getLeaseStats = jest.fn().mockResolvedValue({ totalLeases: 1 });
    });

    it('filters by the property resolved from its pid within the client', async () => {
      await leaseService.getLeaseStats(cuid, { pid: property.pid });

      expect(propertyDAO.findFirst).toHaveBeenCalledWith(
        { pid: property.pid, cuid, deletedAt: null },
        expect.anything()
      );
      expect(leaseDAO.getLeaseStats).toHaveBeenCalledWith(cuid, { 'property.id': propertyId });
    });

    it('rejects a pid outside the client', async () => {
      propertyDAO.findFirst.mockResolvedValue(null);

      await expect(leaseService.getLeaseStats(cuid, { pid: 'OTHERPROP001' })).rejects.toThrow(
        BadRequestError
      );
      expect(leaseDAO.getLeaseStats).not.toHaveBeenCalled();
    });

    it('narrows to leases whose term overlaps the date window', async () => {
      const startDate = new Date('2026-01-01');
      const endDate = new Date('2026-06-30');

      await leaseService.getLeaseStats(cuid, { startDate, endDate });

      expect(leaseDAO.getLeaseStats).toHaveBeenCalledWith(cuid, {
        'duration.startDate': { $lte: endDate },
        'duration.endDate': { $gte: startDate },
      });
    });
  });
});
