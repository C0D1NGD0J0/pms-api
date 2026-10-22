import { Types } from 'mongoose';
import type { LeaseDAO, UserDAO } from '@dao/index';
import { ValidationRequestError, BadRequestError } from '@shared/customErrors';
import {
  validatePropertyLeaseImmutableFields,
  resolveConnectedUserIds,
  getUidsByUserId,
  getUserIdsByUid,
} from '@services/property/propertyHelpers';

const makeProperty = (overrides = {}) =>
  ({
    _id: new Types.ObjectId(),
    cuid: 'client-123',
    ...overrides,
  }) as any;

const makeLeaseDAO = (hasHistory: boolean) =>
  ({
    hasNonDraftLeaseForProperty: jest.fn().mockReturnValue(Promise.resolve(hasHistory)),
  }) as unknown as LeaseDAO;

describe('validatePropertyLeaseImmutableFields', () => {
  it('returns without DB call when no locked fields are in the payload', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const property = makeProperty();

    await expect(
      validatePropertyLeaseImmutableFields(property, 'client-123', { name: 'New Name' }, leaseDAO)
    ).resolves.toBeUndefined();

    expect(leaseDAO.hasNonDraftLeaseForProperty).not.toHaveBeenCalled();
  });

  it('does not throw when locked fields are present but no lease history exists', async () => {
    const leaseDAO = makeLeaseDAO(false);
    const property = makeProperty();

    await expect(
      validatePropertyLeaseImmutableFields(
        property,
        'client-123',
        { address: { fullAddress: '123 New St' } } as any,
        leaseDAO
      )
    ).resolves.toBeUndefined();

    expect(leaseDAO.hasNonDraftLeaseForProperty).toHaveBeenCalledTimes(1);
  });

  it('throws ValidationRequestError when address is updated and lease history exists', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const property = makeProperty();

    await expect(
      validatePropertyLeaseImmutableFields(
        property,
        'client-123',
        { address: { fullAddress: '456 Changed Ave' } } as any,
        leaseDAO
      )
    ).rejects.toThrow(ValidationRequestError);
  });

  it('throws ValidationRequestError when propertyType is updated and lease history exists', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const property = makeProperty();

    await expect(
      validatePropertyLeaseImmutableFields(
        property,
        'client-123',
        { propertyType: 'commercial' } as any,
        leaseDAO
      )
    ).rejects.toThrow(ValidationRequestError);
  });

  it('includes the locked field name in the error info', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const property = makeProperty();

    let caught: any;
    try {
      await validatePropertyLeaseImmutableFields(
        property,
        'client-123',
        { address: { fullAddress: 'X' }, propertyType: 'house' } as any,
        leaseDAO
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ValidationRequestError);
    const fieldMessages: string[] = (caught as any).errorInfo?.fields ?? [];
    expect(fieldMessages.some((m: string) => m.includes("'address'"))).toBe(true);
    expect(fieldMessages.some((m: string) => m.includes("'propertyType'"))).toBe(true);
  });

  it('passes through non-locked fields even when lease history exists', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const property = makeProperty();

    await expect(
      validatePropertyLeaseImmutableFields(
        property,
        'client-123',
        { description: { text: 'Updated description', html: '' } } as any,
        leaseDAO
      )
    ).resolves.toBeUndefined();

    expect(leaseDAO.hasNonDraftLeaseForProperty).not.toHaveBeenCalled();
  });

  it('passes the correct propertyId and cuid to the DAO', async () => {
    const objectId = new Types.ObjectId();
    const leaseDAO = makeLeaseDAO(false);
    const property = makeProperty({ _id: objectId });

    await validatePropertyLeaseImmutableFields(
      property,
      'client-abc',
      { address: { fullAddress: 'test' } } as any,
      leaseDAO
    );

    expect(leaseDAO.hasNonDraftLeaseForProperty).toHaveBeenCalledWith(
      objectId.toString(),
      'client-abc'
    );
  });
});

describe('user uid ↔ ObjectId resolution', () => {
  const managerId = new Types.ObjectId();
  const staffId = new Types.ObjectId();
  // The DAO only returns users matching the cuid-scoped filter, as Mongo would
  const makeUserDAO = (users: Array<{ _id: Types.ObjectId; uid: string }>) =>
    ({ list: jest.fn().mockResolvedValue({ items: users }) }) as unknown as UserDAO;

  it('maps uids to ObjectIds, querying only users connected to the client', async () => {
    const userDAO = makeUserDAO([
      { _id: managerId, uid: 'MANAGER00001' },
      { _id: staffId, uid: 'STAFFUID0001' },
    ]);

    const idsByUid = await resolveConnectedUserIds(
      userDAO,
      'client-123',
      ['MANAGER00001', 'STAFFUID0001', 'MANAGER00001'],
      'not found',
      ['admin', 'manager']
    );

    expect(idsByUid.get('MANAGER00001')).toBe(managerId);
    expect(idsByUid.get('STAFFUID0001')).toBe(staffId);
    expect((userDAO.list as jest.Mock).mock.calls[0][0]).toEqual({
      uid: { $in: ['MANAGER00001', 'STAFFUID0001'] },
      deletedAt: null,
      cuids: {
        $elemMatch: { cuid: 'client-123', isConnected: true, roles: { $in: ['admin', 'manager'] } },
      },
    });
  });

  it('rejects an unknown or other-client uid with a 400', async () => {
    // OTHERCLIENT1 belongs to another client, so the cuid-scoped query does not return it
    const userDAO = makeUserDAO([{ _id: managerId, uid: 'MANAGER00001' }]);

    await expect(
      resolveConnectedUserIds(userDAO, 'client-123', ['MANAGER00001', 'OTHERCLIENT1'], 'nope')
    ).rejects.toThrow(BadRequestError);
  });

  it('getUserIdsByUid leaves unknown uids out instead of throwing', async () => {
    const userDAO = makeUserDAO([]);

    const idsByUid = await getUserIdsByUid(userDAO, 'client-123', ['OTHERCLIENT1']);

    expect(idsByUid.size).toBe(0);
  });

  it('skips the query when there is nothing to resolve', async () => {
    const userDAO = makeUserDAO([]);

    await expect(resolveConnectedUserIds(userDAO, 'client-123', [], 'nope')).resolves.toEqual(
      new Map()
    );
    await expect(getUidsByUserId(userDAO, [null, undefined, 'not-an-id'])).resolves.toEqual(
      new Map()
    );
    expect(userDAO.list).not.toHaveBeenCalled();
  });

  it('getUidsByUserId maps stored ObjectIds back to public uids', async () => {
    const userDAO = makeUserDAO([{ _id: managerId, uid: 'MANAGER00001' }]);

    const uidsById = await getUidsByUserId(userDAO, [managerId, managerId.toString()]);

    expect(uidsById.get(managerId.toString())).toBe('MANAGER00001');
  });
});
