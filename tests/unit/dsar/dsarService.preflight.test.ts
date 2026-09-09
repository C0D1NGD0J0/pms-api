/**
 * DSARService — preflightAnonymise tests
 *
 * Verifies the safety gate checks before data deletion:
 * account owner blocking, active lease blocking, managed property blocking,
 * and clean eligibility when no blockers exist.
 */
import { Types } from 'mongoose';

jest.mock('@di/index', () => ({ container: {} }));

import { DSARService } from '@services/dsar/dsar.service';
import { ForbiddenError, NotFoundError } from '@shared/customErrors';

const CUID = 'TEST_CUID';
const UID = 'TEST_UID';

const makeUser = (overrides: Record<string, any> = {}) => ({
  _id: new Types.ObjectId(),
  uid: UID,
  email: 'user@test.com',
  fullname: 'Test User',
  cuids: [
    {
      cuid: CUID,
      roles: ['tenant'],
      isConnected: true,
      clientDisplayName: 'Test Company',
    },
  ],
  ...overrides,
});

const makeService = (overrides: Record<string, any> = {}) => {
  return new DSARService({
    userDAO: overrides.userDAO ?? { getUserByUId: jest.fn() },
    clientDAO: overrides.clientDAO ?? {
      findFirst: jest.fn().mockReturnValue(Promise.resolve(null)),
    },
    leaseDAO: overrides.leaseDAO ?? {
      getActiveLeaseByTenant: jest.fn().mockReturnValue(Promise.resolve(null)),
      list: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
    },
    propertyDAO: overrides.propertyDAO ?? {
      getPropertiesByClientId: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
    },
    profileDAO: {} as any,
    userCache: {} as any,
    authCache: {} as any,
    s3Service: {} as any,
    userService: {} as any,
    emitterService: { emit: jest.fn(), on: jest.fn() } as any,
    vendorService: {} as any,
    queueFactory: { getQueue: jest.fn() } as any,
  } as any);
};

describe('DSARService — preflightAnonymise', () => {
  afterEach(() => jest.clearAllMocks());

  it('should throw NotFoundError when user does not exist', async () => {
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(null)) };
    const service = makeService({ userDAO });

    await expect(service.preflightAnonymise(UID, CUID)).rejects.toThrow(NotFoundError);
  });

  it('should throw ForbiddenError when user is not connected to client', async () => {
    const user = makeUser({
      cuids: [{ cuid: 'OTHER_CUID', roles: ['tenant'], isConnected: true }],
    });
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(user)) };
    const service = makeService({ userDAO });

    await expect(service.preflightAnonymise(UID, CUID)).rejects.toThrow(ForbiddenError);
  });

  it('should return eligible when no blockers exist', async () => {
    const user = makeUser();
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(user)) };
    const clientDAO = {
      findFirst: jest.fn().mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          accountAdmin: new Types.ObjectId(), // different from user._id
        })
      ),
    };
    const service = makeService({ userDAO, clientDAO });

    const result = await service.preflightAnonymise(UID, CUID);

    expect(result.eligible).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.userEmail).toBe('user@test.com');
  });

  it('should block when user is account owner', async () => {
    const user = makeUser();
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(user)) };
    const clientDAO = {
      findFirst: jest.fn().mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          accountAdmin: user._id, // same as user
        })
      ),
    };
    const service = makeService({ userDAO, clientDAO });

    const result = await service.preflightAnonymise(UID, CUID);

    expect(result.eligible).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].type).toBe('account_owner');
  });

  it('should block when tenant has active lease', async () => {
    const user = makeUser();
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(user)) };
    const leaseDAO = {
      getActiveLeaseByTenant: jest
        .fn()
        .mockReturnValue(Promise.resolve({ _id: new Types.ObjectId() })),
      list: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
    };
    const service = makeService({ userDAO, leaseDAO });

    const result = await service.preflightAnonymise(UID, CUID);

    expect(result.eligible).toBe(false);
    expect(result.blockers.some((b: any) => b.type === 'active_leases')).toBe(true);
  });

  it('should block when PM manages properties with active leases', async () => {
    const propId = new Types.ObjectId();
    const user = makeUser({
      cuids: [
        {
          cuid: CUID,
          roles: ['manager'],
          isConnected: true,
          clientDisplayName: 'Test Company',
        },
      ],
    });
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(user)) };
    const propertyDAO = {
      getPropertiesByClientId: jest.fn().mockReturnValue(
        Promise.resolve({
          items: [{ _id: propId }],
        })
      ),
    };
    const leaseDAO = {
      getActiveLeaseByTenant: jest.fn().mockReturnValue(Promise.resolve(null)),
      list: jest.fn().mockReturnValue(
        Promise.resolve({
          items: [{ _id: new Types.ObjectId() }, { _id: new Types.ObjectId() }],
        })
      ),
    };
    const service = makeService({ userDAO, propertyDAO, leaseDAO });

    const result = await service.preflightAnonymise(UID, CUID);

    expect(result.eligible).toBe(false);
    expect(result.blockers.some((b: any) => b.type === 'managed_active_leases')).toBe(true);
    expect(result.blockers.find((b: any) => b.type === 'managed_active_leases')?.count).toBe(2);
  });

  it('should skip disconnected clients', async () => {
    const user = makeUser({
      cuids: [
        { cuid: CUID, roles: ['tenant'], isConnected: true, clientDisplayName: 'Active' },
        { cuid: 'OTHER', roles: ['tenant'], isConnected: false, clientDisplayName: 'Disconnected' },
      ],
    });
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(user)) };
    const leaseDAO = {
      getActiveLeaseByTenant: jest.fn().mockReturnValue(Promise.resolve(null)),
      list: jest.fn().mockReturnValue(Promise.resolve({ items: [] })),
    };
    const service = makeService({ userDAO, leaseDAO });

    const result = await service.preflightAnonymise(UID, CUID);

    expect(result.eligible).toBe(true);
    // Only called once for the connected client, not the disconnected one
    expect(leaseDAO.getActiveLeaseByTenant).toHaveBeenCalledTimes(1);
  });

  it('should return multiple blockers when user has multiple issues', async () => {
    const user = makeUser({
      cuids: [
        {
          cuid: CUID,
          roles: ['tenant', 'manager'],
          isConnected: true,
          clientDisplayName: 'Test Company',
        },
      ],
    });
    const userDAO = { getUserByUId: jest.fn().mockReturnValue(Promise.resolve(user)) };
    const clientDAO = {
      findFirst: jest.fn().mockReturnValue(
        Promise.resolve({
          _id: new Types.ObjectId(),
          accountAdmin: user._id,
        })
      ),
    };
    const leaseDAO = {
      getActiveLeaseByTenant: jest
        .fn()
        .mockReturnValue(Promise.resolve({ _id: new Types.ObjectId() })),
      list: jest.fn().mockReturnValue(Promise.resolve({ items: [{ _id: new Types.ObjectId() }] })),
    };
    const propertyDAO = {
      getPropertiesByClientId: jest.fn().mockReturnValue(
        Promise.resolve({
          items: [{ _id: new Types.ObjectId() }],
        })
      ),
    };
    const service = makeService({ userDAO, clientDAO, leaseDAO, propertyDAO });

    const result = await service.preflightAnonymise(UID, CUID);

    expect(result.eligible).toBe(false);
    expect(result.blockers.length).toBeGreaterThanOrEqual(3);
    const types = result.blockers.map((b: any) => b.type);
    expect(types).toContain('account_owner');
    expect(types).toContain('active_leases');
    expect(types).toContain('managed_active_leases');
  });
});
