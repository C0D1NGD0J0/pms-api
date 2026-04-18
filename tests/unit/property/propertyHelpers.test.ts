import { Types } from 'mongoose';
import type { LeaseDAO } from '@dao/index';
import { ValidationRequestError } from '@shared/customErrors';
import { validatePropertyLeaseImmutableFields } from '@services/property/propertyHelpers';

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
