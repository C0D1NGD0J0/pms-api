import { Types } from 'mongoose';
import {
  splitStaffPropertyChanges,
  mergePendingFieldChanges,
} from '@services/property/propertyHelpers';

const managerId = new Types.ObjectId();

const storedProperty = {
  name: 'Maple Court',
  propertyType: 'apartment',
  managedBy: managerId,
  fees: { currency: 'CAD', rentAmount: 120000, managementFees: 5000, securityDeposit: 0 },
  address: { fullAddress: '12 Maple St, Toronto, ON', city: 'Toronto' },
  financialDetails: { purchaseDate: new Date('2020-01-01') },
} as any;

describe('splitStaffPropertyChanges', () => {
  it('saves operational fields directly and holds the rest', () => {
    const { direct, held } = splitStaffPropertyChanges(storedProperty, {
      description: { text: 'Bright units' },
      utilities: { water: true },
      specifications: { floors: 3 },
      name: 'Maple Court North',
    } as any);

    expect(direct).toEqual({
      description: { text: 'Bright units' },
      utilities: { water: true },
      specifications: { floors: 3 },
    });
    expect(held).toEqual({ name: 'Maple Court North' });
  });

  it('holds only fields that change what is stored', () => {
    const { held } = splitStaffPropertyChanges(storedProperty, {
      name: 'Maple Court',
      managedBy: new Types.ObjectId(managerId.toString()),
      fees: { managementFees: 5000 },
      financialDetails: { purchaseDate: new Date('2020-01-01') },
    } as any);

    expect(held).toEqual({});
  });

  it('compares a partial nested edit key by key', () => {
    const { held } = splitStaffPropertyChanges(storedProperty, {
      fees: { managementFees: 6000 },
    } as any);

    expect(held).toEqual({ fees: { managementFees: 6000 } });
  });

  it('holds a new address', () => {
    const address = { fullAddress: '40 Oak Ave, Toronto, ON', streetNumber: '40' };
    const { direct, held } = splitStaffPropertyChanges(storedProperty, { address } as any);

    expect(direct).toEqual({});
    expect(held).toEqual({ address });
  });
});

describe('mergePendingFieldChanges', () => {
  const earlier = {
    name: 'Maple Court North',
    fees: { rentAmount: 130000 },
    updatedBy: new Types.ObjectId(),
    updatedAt: new Date(),
    displayName: 'Sam Staff',
    pendingMedia: { images: [], documents: [] },
  } as any;

  it('keeps the earlier submission and drops its bookkeeping', () => {
    expect(mergePendingFieldChanges(earlier, { operationalStatus: 'maintenance' } as any)).toEqual({
      name: 'Maple Court North',
      fees: { rentAmount: 130000 },
      operationalStatus: 'maintenance',
    });
  });

  it('combines partial nested edits but replaces an address whole', () => {
    const withAddress = { ...earlier, address: { fullAddress: 'Old', unitNumber: '2' } };
    const merged = mergePendingFieldChanges(withAddress, {
      fees: { securityDeposit: 50000 },
      address: { fullAddress: 'New' },
    } as any);

    expect(merged.fees).toEqual({ rentAmount: 130000, securityDeposit: 50000 });
    expect(merged.address).toEqual({ fullAddress: 'New' });
  });

  it('starts fresh when nothing is pending', () => {
    expect(mergePendingFieldChanges(null, { name: 'X' } as any)).toEqual({ name: 'X' });
  });
});
