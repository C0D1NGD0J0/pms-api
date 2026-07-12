import { Types } from 'mongoose';
import type { LeaseDAO } from '@dao/index';
import { ValidationRequestError } from '@shared/customErrors';
import { validateUnitLeaseImmutableFields } from '@services/property/propertyUnitHelpers';

const makeUnit = (overrides = {}) =>
  ({
    _id: new Types.ObjectId(),
    currentLease: null,
    ...overrides,
  }) as any;

const makeLeaseDAO = (hasHistory: boolean) =>
  ({
    hasNonDraftLeaseForUnit: jest.fn().mockReturnValue(Promise.resolve(hasHistory)),
  }) as unknown as LeaseDAO;

describe('validateUnitLeaseImmutableFields', () => {
  it('returns without DB call when no locked fields are in the payload', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const unit = makeUnit();

    await expect(
      validateUnitLeaseImmutableFields(unit, 'client-123', { status: 'available' }, leaseDAO)
    ).resolves.toBeUndefined();

    expect(leaseDAO.hasNonDraftLeaseForUnit).not.toHaveBeenCalled();
  });

  it('does not throw when locked fields are present and no lease history exists', async () => {
    const leaseDAO = makeLeaseDAO(false);
    const unit = makeUnit({ currentLease: null });

    await expect(
      validateUnitLeaseImmutableFields(unit, 'client-123', { unitNumber: 'A1', floor: 2 }, leaseDAO)
    ).resolves.toBeUndefined();

    expect(leaseDAO.hasNonDraftLeaseForUnit).toHaveBeenCalledTimes(1);
  });

  it('throws ValidationRequestError when unitNumber is updated and unit has active lease', async () => {
    const leaseDAO = makeLeaseDAO(false); // DAO won't be called — fast path
    const unit = makeUnit({ currentLease: new Types.ObjectId() }); // has currentLease set

    await expect(
      validateUnitLeaseImmutableFields(unit, 'client-123', { unitNumber: 'B2' }, leaseDAO)
    ).rejects.toThrow(ValidationRequestError);

    // Fast path: currentLease is set, so DAO should NOT be called
    expect(leaseDAO.hasNonDraftLeaseForUnit).not.toHaveBeenCalled();
  });

  it('throws ValidationRequestError when unitType is updated and historical lease exists', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const unit = makeUnit({ currentLease: null });

    await expect(
      validateUnitLeaseImmutableFields(
        unit,
        'client-123',
        { unitType: 'commercial' } as any,
        leaseDAO
      )
    ).rejects.toThrow(ValidationRequestError);
  });

  it('throws ValidationRequestError when floor is updated and historical lease exists', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const unit = makeUnit({ currentLease: null });

    await expect(
      validateUnitLeaseImmutableFields(unit, 'client-123', { floor: 5 }, leaseDAO)
    ).rejects.toThrow(ValidationRequestError);
  });

  it('throws ValidationRequestError when propertyId is updated and historical lease exists', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const unit = makeUnit({ currentLease: null });

    await expect(
      validateUnitLeaseImmutableFields(
        unit,
        'client-123',
        { propertyId: new Types.ObjectId() } as any,
        leaseDAO
      )
    ).rejects.toThrow(ValidationRequestError);
  });

  it('uses fast path (no DB call) when currentLease is set', async () => {
    const leaseDAO = makeLeaseDAO(false);
    const unit = makeUnit({ currentLease: new Types.ObjectId() });

    await expect(
      validateUnitLeaseImmutableFields(unit, 'client-123', { floor: 3 }, leaseDAO)
    ).rejects.toThrow(ValidationRequestError);

    expect(leaseDAO.hasNonDraftLeaseForUnit).not.toHaveBeenCalled();
  });

  it('includes locked field names in the error info', async () => {
    const leaseDAO = makeLeaseDAO(true);
    const unit = makeUnit({ currentLease: null });

    let caught: any;
    try {
      await validateUnitLeaseImmutableFields(
        unit,
        'client-123',
        { unitNumber: 'C3', floor: 4 },
        leaseDAO
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ValidationRequestError);
    const fieldMessages: string[] = (caught as any).errorInfo?.fields ?? [];
    expect(fieldMessages.some((m: string) => m.includes("'unitNumber'"))).toBe(true);
    expect(fieldMessages.some((m: string) => m.includes("'floor'"))).toBe(true);
  });

  it('passes non-locked fields without a DB call when no lease exists', async () => {
    const leaseDAO = makeLeaseDAO(false);
    const unit = makeUnit();

    await expect(
      validateUnitLeaseImmutableFields(
        unit,
        'client-123',
        { fees: { rentAmount: 1200 } } as any,
        leaseDAO
      )
    ).resolves.toBeUndefined();

    expect(leaseDAO.hasNonDraftLeaseForUnit).not.toHaveBeenCalled();
  });
});
